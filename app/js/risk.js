/*
 * risk.js - Transparent, explainable risk stratification engine.
 *
 * This is intentionally a RULE-BASED, white-box scorer (no machine-learning black box).
 * Every flag exposes the exact factors that produced it, and the overall priority score
 * is an interpretable sum of per-flag contributions. The same rules are documented in
 * CLINICAL_LOGIC.md and mirrored in model/risk_model.py.
 *
 * Output of computeRisk(patient):
 *   {
 *     score:        Number,         // overall priority score
 *     level:        'alta'|'media'|'bassa',
 *     neda:         Boolean,        // NEDA-3-like stable state
 *     flags:        [ Flag, ... ],  // only ACTIVE flags, sorted by points desc
 *     contributions:[ {key,label,points}, ... ],
 *     insights:     [ {key,title,detail}, ... ]  // non-scoring contextual notes (e.g. pseudo-relapse)
 *   }
 * Flag = { key, label, category, severity:'high'|'med'|'low', points, factors:[String,...] }
 *
 * NOTE: thresholds below are DEMONSTRATIVE/educational, calibrated for a readable demo.
 * They are not clinical guidelines.
 */

(function (global) {
  "use strict";

  // ---- Transparent, tweakable thresholds (single source of truth) --------------------
  var RISK_CONFIG = {
    activity: {
      relapseWindowDays: 365,       // relapse counts as "activity" if within 1 year
      relapseHighDays: 90,          // very recent relapse -> high severity
      nflRisingDelta: 2.0,          // pg/mL increase vs baseline to call NfL "rising"
    },
    pira: {
      edssWorseningLowDisability: 1.0,  // EDSS delta if baseline EDSS < 6
      edssWorseningHighDisability: 0.5, // EDSS delta if baseline EDSS >= 6
      noRelapseWindowDays: 365,
    },
    suboptimal: {
      minMonthsOnDmt: 6,            // need >= 6 months on DMT to judge response
      strongMonths: 12,            // >= 12 months with activity -> high severity
    },
    invisible: {
      mfisRise: 8,                 // MFIS increase considered meaningful
      sdmtDrop: 4,                 // SDMT decrease considered clinically meaningful
      phq9Rise: 5,                 // PHQ-9 increase considered meaningful
    },
    adherence: {
      pctLow: 80,                  // adherence below this is a concern
      pctHigh: 65,                 // below this -> high severity
      missedDoses: 6,
      refillGap: 14,
      refillGapHigh: 21,
    },
    // Flag base weights and severity multipliers -> interpretable points
    weights: {
      disease_activity: 3.0,
      pira_smouldering: 3.0,
      suboptimal: 2.5,
      invisible_symptoms: 2.0,
      adherence: 2.0,
      monitoring: 1.5,
    },
    sevFactor: { high: 1.0, med: 0.66, low: 0.33 },
    levelCut: { alta: 6.0, media: 3.0 },  // score thresholds for priority level
  };

  // ---- Date helpers (anchor comes from the dataset, never the system clock) -----------
  function anchorDate() {
    try {
      return new Date(global.MS_DATA.meta.generated_anchor_date + "T00:00:00");
    } catch (e) {
      return new Date("2026-06-10T00:00:00");
    }
  }
  function daysSince(dateStr) {
    var a = anchorDate();
    var dt = new Date(dateStr + "T00:00:00");
    return Math.round((a - dt) / 86400000);
  }
  function monthsBetween(dateStrA, dateStrB) {
    var a = new Date(dateStrA + "T00:00:00");
    var b = new Date(dateStrB + "T00:00:00");
    return Math.abs((a - b) / (86400000 * 30.4));
  }

  // ---- Series helpers -----------------------------------------------------------------
  function vals(series) { return series.map(function (p) { return p.value; }); }
  function last(series) { return series.length ? series[series.length - 1].value : null; }
  function recentMean(series, k) {
    k = k || 2;
    var v = vals(series).slice(-k);
    if (!v.length) return null;
    return v.reduce(function (s, x) { return s + x; }, 0) / v.length;
  }
  // Baseline = value ~`backVisits` visits ago (mean of a small window), to reduce noise.
  function baselineMean(series, backVisits, k) {
    k = k || 2;
    var n = series.length;
    if (n === 0) return null;
    var endIdx = Math.max(0, n - 1 - backVisits);
    var startIdx = Math.max(0, endIdx - (k - 1));
    var slice = vals(series).slice(startIdx, endIdx + 1);
    if (!slice.length) return vals(series)[0];
    return slice.reduce(function (s, x) { return s + x; }, 0) / slice.length;
  }
  function fmt(x, dec) {
    if (x === null || x === undefined) return "-";
    dec = (dec === undefined) ? 1 : dec;
    return (Math.round(x * Math.pow(10, dec)) / Math.pow(10, dec)).toString();
  }

  // ---- Most recent MRI ---------------------------------------------------------------
  function latestMri(p) {
    var m = p.timeline.mri;
    return m && m.length ? m[m.length - 1] : null;
  }
  function recentRelapses(p, windowDays, includePseudo) {
    return (p.timeline.relapses || []).filter(function (r) {
      if (!includePseudo && r.type !== "relapse") return false;
      return daysSince(r.date) <= windowDays;
    });
  }

  // ---- Points helper ------------------------------------------------------------------
  function points(key, severity) {
    var w = RISK_CONFIG.weights[key] || 1.0;
    var f = RISK_CONFIG.sevFactor[severity] || 0.5;
    return Math.round(w * f * 10) / 10;
  }

  // =====================================================================================
  // FLAG 1 - Disease activity
  // =====================================================================================
  function flagDiseaseActivity(p) {
    var factors = [];
    var cfg = RISK_CONFIG.activity;
    var signals = 0;       // count of INDEPENDENT activity signals (clinical / radiological / biomarker)
    var gad = false;       // gadolinium enhancement -> strong marker
    var relapseRecent = false;

    // (a) clinical relapse within window (pseudo-relapses do NOT count)
    var rel = recentRelapses(p, cfg.relapseWindowDays, false);
    if (rel.length) {
      signals++;
      var mostRecent = rel[rel.length - 1];
      var dd = daysSince(mostRecent.date);
      if (dd <= cfg.relapseHighDays) relapseRecent = true;
      factors.push("Ricaduta clinica " + Math.round(dd / 30) + " mesi fa (" +
        mostRecent.severity + ", recupero " + mostRecent.recovery + ")");
    }

    // (b) recent MRI activity
    var mri = latestMri(p);
    if (mri && (mri.new_t2 > 0 || mri.enlarging_t2 > 0 || mri.gad_enhancing > 0)) {
      signals++;
      var bits = [];
      if (mri.new_t2 > 0) bits.push(mri.new_t2 + " nuova/e lesione/i T2");
      if (mri.enlarging_t2 > 0) bits.push(mri.enlarging_t2 + " lesione/i T2 ingrandita/e");
      if (mri.gad_enhancing > 0) { bits.push(mri.gad_enhancing + " lesione/i captante/i gadolinio"); gad = true; }
      factors.push("RMN " + Math.round(daysSince(mri.date) / 30) + " mesi fa: " + bits.join(", "));
    }

    // (c) NfL above age-adjusted URL AND rising (lone above-threshold is too noisy -> excluded)
    var nfl = p.timeline.nfl;
    if (nfl && nfl.length) {
      var nl = last(nfl), url = nfl[nfl.length - 1].url;
      var nb = baselineMean(nfl, 3);
      if (nl > url && (nl - nb) >= cfg.nflRisingDelta) {
        signals++;
        factors.push("NfL sierico " + fmt(nl) + " pg/mL sopra soglia per età (" + fmt(url) +
          ") e in salita (era ~" + fmt(nb) + ")");
      }
    }

    if (signals === 0) return null;
    // Severity: high if gad enhancement, OR >=2 converging signals, OR a very recent relapse.
    var severity = (gad || signals >= 2 || relapseRecent) ? "high" : "med";
    return {
      key: "disease_activity", label: "Attività di malattia", category: "Attività",
      severity: severity, points: points("disease_activity", severity), factors: factors,
    };
  }

  // =====================================================================================
  // FLAG 2 - Possible PIRA / smouldering (progression independent of activity)
  // =====================================================================================
  function flagPira(p) {
    var cfg = RISK_CONFIG.pira;
    var factors = [];

    var edss = p.timeline.edss;
    if (!edss || edss.length < 3) return null;
    // Baseline = patient's early/nadir value (mean of first 2 visits) so that SLOW confirmed
    // progression is captured, not just the last few months. "Confirmed" = sustained at last 2 visits.
    var baseEdss = (vals(edss).slice(0, 2).reduce(function (s, x) { return s + x; }, 0)) /
      Math.min(2, edss.length);
    var recEdss = recentMean(edss, 2);
    // Standard-style thresholds: >=1.0 if baseline EDSS <= 5.5, else >=0.5.
    var thr = (baseEdss <= 5.5) ? cfg.edssWorseningLowDisability : cfg.edssWorseningHighDisability;
    var edssWorse = (recEdss - baseEdss) >= thr && (last(edss) - baseEdss) >= (thr - 0.001);
    if (!edssWorse) return null;

    // must be WITHOUT recent relapse
    var rel = recentRelapses(p, cfg.noRelapseWindowDays, false);
    if (rel.length) return null;

    // must be WITHOUT recent MRI activity
    var mri = latestMri(p);
    if (mri && (mri.new_t2 > 0 || mri.enlarging_t2 > 0 || mri.gad_enhancing > 0)) return null;

    // supporting biology: GFAP elevated OR PRL present
    var gfap = p.timeline.gfap;
    var gfapHigh = gfap && gfap.length && (last(gfap) > gfap[gfap.length - 1].url);
    var prl = mri && mri.prl > 0;
    if (!gfapHigh && !prl) return null;   // require some smouldering substrate

    factors.push("Peggioramento EDSS confermato: da " + fmt(baseEdss) + " a " + fmt(recEdss) +
      " senza ricadute negli ultimi 12 mesi");
    if (mri) factors.push("RMN senza nuove lesioni/captazione (assenza di attività focale)");
    if (gfapHigh) factors.push("GFAP " + fmt(last(gfap), 0) + " pg/mL sopra soglia per età (" +
      fmt(gfap[gfap.length - 1].url, 0) + "): marcatore di progressione");
    if (prl) factors.push(mri.prl + " PRL (lesioni croniche attive) e atrofia '" + mri.atrophy + "'");

    // PRO worsening adds weight
    var mfis = p.timeline.mfis, sdmt = p.timeline.sdmt;
    var mfisRise = mfis ? (recentMean(mfis, 2) - baselineMean(mfis, 4)) : 0;
    var sdmtDrop = sdmt ? (baselineMean(sdmt, 4) - recentMean(sdmt, 2)) : 0;
    if (mfisRise >= RISK_CONFIG.invisible.mfisRise || sdmtDrop >= RISK_CONFIG.invisible.sdmtDrop) {
      factors.push("Trend PRO coerente: fatica e/o cognizione in peggioramento");
    }

    return {
      key: "pira_smouldering", label: "Possibile PIRA / smouldering", category: "Progressione",
      severity: "high", points: points("pira_smouldering", "high"), factors: factors,
    };
  }

  // =====================================================================================
  // FLAG 3 - Suboptimal treatment response
  // =====================================================================================
  function flagSuboptimal(p, activityFlag) {
    if (!activityFlag) return null;            // needs ongoing activity
    var dmt = p.current_dmt;
    if (!dmt || dmt.klass === "nessuno" || !dmt.months_on_dmt) return null;
    var cfg = RISK_CONFIG.suboptimal;
    if (dmt.months_on_dmt < cfg.minMonthsOnDmt) {
      return null;  // too early to judge (e.g., recently started high-efficacy)
    }

    // Clinical nuance: don't call it "drug failure" if the patient isn't taking the drug.
    // Very poor adherence -> the activity is more likely adherence-driven -> suppress this flag
    // (the adherence flag already captures it). Mildly reduced -> soften and reframe.
    var pct = p.adherence ? p.adherence.recent_pct : 100;
    var factors;
    var severity;
    if (pct < RISK_CONFIG.adherence.pctHigh) {
      return null;  // <65%: this is an adherence problem, not suboptimal response
    } else if (pct < RISK_CONFIG.adherence.pctLow) {
      severity = "med";
      factors = [
        "Attività di malattia nonostante " + dmt.months_on_dmt + " mesi su " + dmt.drug +
          " (" + dmt.klass + ")",
        "Aderenza ridotta (" + pct + "%): ottimizzare l'aderenza e rivalutare; lo switch va " +
          "considerato se l'attività persiste con buona aderenza",
      ];
    } else {
      severity = (dmt.months_on_dmt >= cfg.strongMonths) ? "high" : "med";
      factors = [
        "Attività di malattia in corso nonostante " + dmt.months_on_dmt + " mesi su " +
          dmt.drug + " (" + dmt.klass + ") con buona aderenza",
        "Soglia: rivalutare la terapia se attività persiste oltre 6-12 mesi (switch/escalation)",
      ];
    }
    return {
      key: "suboptimal", label: "Risposta subottimale al trattamento", category: "Terapia",
      severity: severity, points: points("suboptimal", severity), factors: factors,
    };
  }

  // =====================================================================================
  // FLAG 4 - Rising invisible-symptom burden
  // =====================================================================================
  function flagInvisible(p) {
    var cfg = RISK_CONFIG.invisible;
    var factors = [], domains = 0;

    var mfis = p.timeline.mfis;
    if (mfis && mfis.length >= 3) {
      var mr = recentMean(mfis, 2), mb = baselineMean(mfis, 4);
      if (mr - mb >= cfg.mfisRise) {
        domains++;
        factors.push("Fatica (MFIS) in aumento: da " + fmt(mb, 0) + " a " + fmt(mr, 0));
      }
    }
    var sdmt = p.timeline.sdmt;
    if (sdmt && sdmt.length >= 3) {
      var sr = recentMean(sdmt, 2), sb = baselineMean(sdmt, 4);
      if (sb - sr >= cfg.sdmtDrop) {
        domains++;
        factors.push("Cognizione (SDMT) in calo: da " + fmt(sb, 0) + " a " + fmt(sr, 0) +
          " (decremento clinicamente rilevante)");
      }
    }
    var phq = p.timeline.phq9;
    if (phq && phq.length >= 3) {
      var pr = recentMean(phq, 2), pb = baselineMean(phq, 4);
      if (pr - pb >= cfg.phq9Rise) {
        domains++;
        factors.push("Umore (PHQ-9) in peggioramento: da " + fmt(pb, 0) + " a " + fmt(pr, 0));
      }
    }
    if (domains === 0) return null;

    // Digital-biomarker corroboration (supporting, not required)
    var wear = p.timeline.wearable;
    if (wear && wear.length >= 8) {
      var stepsRecent = wear.slice(-4).reduce(function (s, w) { return s + w.steps; }, 0) / 4;
      var stepsBase = wear.slice(0, 4).reduce(function (s, w) { return s + w.steps; }, 0) / 4;
      if (stepsBase - stepsRecent >= 800) {
        factors.push("Biomarcatore digitale coerente: passi/giorno da ~" +
          Math.round(stepsBase) + " a ~" + Math.round(stepsRecent));
      }
    }

    var severity = domains >= 3 ? "high" : (domains === 2 ? "med" : "low");
    // scale points by domain count for interpretability
    var pts = Math.round(RISK_CONFIG.weights.invisible_symptoms *
      (domains >= 3 ? 1.0 : domains === 2 ? 0.75 : 0.5) * 10) / 10;
    return {
      key: "invisible_symptoms", label: "Carico sintomi invisibili in aumento",
      category: "Sintomi invisibili", severity: severity, points: pts, factors: factors,
    };
  }

  // =====================================================================================
  // FLAG 5 - Adherence at risk
  // =====================================================================================
  function flagAdherence(p) {
    var a = p.adherence;
    if (!a) return null;
    var cfg = RISK_CONFIG.adherence;
    var triggers = [];
    if (a.recent_pct < cfg.pctLow) triggers.push("aderenza stimata " + a.recent_pct + "%");
    if (a.missed_doses_90d >= cfg.missedDoses) triggers.push(a.missed_doses_90d + " dosi mancate/90gg");
    if (a.refill_gap_days >= cfg.refillGap) triggers.push("gap nei rifornimenti " + a.refill_gap_days + " giorni");
    if (a.trend === "in calo" && a.recent_pct < 90 && !triggers.length) triggers.push("trend aderenza in calo");
    if (!triggers.length) return null;

    var severity = (a.recent_pct < cfg.pctHigh || a.refill_gap_days >= cfg.refillGapHigh) ? "high" : "med";
    return {
      key: "adherence", label: "Aderenza a rischio", category: "Aderenza",
      severity: severity, points: points("adherence", severity),
      factors: triggers.map(function (t) { return t.charAt(0).toUpperCase() + t.slice(1); }),
    };
  }

  // =====================================================================================
  // FLAG 6 - Monitoring due
  // =====================================================================================
  function flagMonitoring(p) {
    var items = p.monitoring || [];
    var overdue = items.filter(function (m) { return m.status === "scaduto"; });
    var soon = items.filter(function (m) { return m.status === "in_scadenza"; });
    if (!overdue.length && !soon.length) return null;

    var factors = [];
    overdue.forEach(function (m) {
      factors.push("SCADUTO: " + m.item + " (atteso " + m.due_date + ")");
    });
    soon.forEach(function (m) {
      factors.push("In scadenza: " + m.item + " (entro " + m.due_date + ")");
    });
    var safety = overdue.some(function (m) { return /JCV|PML|epatica|linfociti|emocromo/i.test(m.item); });
    var severity = overdue.length ? (safety ? "high" : "med") : "low";
    return {
      key: "monitoring", label: "Monitoraggio in scadenza", category: "Monitoraggio",
      severity: severity, points: points("monitoring", severity), factors: factors,
    };
  }

  // =====================================================================================
  // Non-scoring contextual insights (e.g., pseudo-relapse to disambiguate)
  // =====================================================================================
  function buildInsights(p) {
    var insights = [];
    var pseudo = (p.timeline.relapses || []).filter(function (r) {
      return r.type === "pseudo_relapse_suspected" && daysSince(r.date) <= 90;
    });
    pseudo.forEach(function (r) {
      var trig = r.trigger === "caldo" ? "caldo (fenomeno di Uhthoff)" :
        (r.trigger === "infezione_IVU" ? "infezione delle vie urinarie / febbre" :
          (r.trigger === "febbre" ? "febbre" : r.trigger));
      insights.push({
        key: "pseudo_relapse",
        title: "Sospetta pseudo-ricaduta (" + Math.round(daysSince(r.date)) + " gg fa)",
        detail: "Episodio recente legato a " + trig + ", recupero " + r.recovery +
          ". Da distinguere da una ricaduta vera prima di modificare la terapia.",
      });
    });
    return insights;
  }

  // =====================================================================================
  // NEDA-3-like stable state (for the green badge)
  // =====================================================================================
  function isNeda(p, flags) {
    if (flags.length) return false;
    // NEDA-3 is a relapsing-MS concept; do not award it to progressive phenotypes.
    if (/SPMS|PPMS/.test(p.ms_type)) return false;
    var rel = recentRelapses(p, 365, false);
    if (rel.length) return false;
    var mri = latestMri(p);
    if (mri && (mri.new_t2 > 0 || mri.enlarging_t2 > 0 || mri.gad_enhancing > 0)) return false;
    var edss = p.timeline.edss;
    if (edss && edss.length >= 3) {
      var worse = recentMean(edss, 2) - baselineMean(edss, 4, 1);
      if (worse >= 1.0) return false;
    }
    return true;
  }

  // =====================================================================================
  // Main entry
  // =====================================================================================
  function computeRisk(p) {
    var flags = [];
    var fAct = flagDiseaseActivity(p);
    if (fAct) flags.push(fAct);
    var fPira = flagPira(p);
    if (fPira) flags.push(fPira);
    var fSub = flagSuboptimal(p, fAct);
    if (fSub) flags.push(fSub);
    var fInv = flagInvisible(p);
    if (fInv) flags.push(fInv);
    var fAdh = flagAdherence(p);
    if (fAdh) flags.push(fAdh);
    var fMon = flagMonitoring(p);
    if (fMon) flags.push(fMon);

    flags.sort(function (a, b) { return b.points - a.points; });

    var score = flags.reduce(function (s, f) { return s + f.points; }, 0);
    score = Math.round(score * 10) / 10;

    var neda = isNeda(p, flags);
    var level;
    if (score >= RISK_CONFIG.levelCut.alta) level = "alta";
    else if (score >= RISK_CONFIG.levelCut.media) level = "media";
    else level = "bassa";

    return {
      score: score,
      level: level,
      neda: neda,
      flags: flags,
      contributions: flags.map(function (f) {
        return { key: f.key, label: f.label, points: f.points, severity: f.severity };
      }),
      insights: buildInsights(p),
    };
  }

  // ---- Public API ---------------------------------------------------------------------
  global.RiskEngine = {
    computeRisk: computeRisk,
    config: RISK_CONFIG,
    // helpers exposed for the UI (trends/sparklines)
    helpers: {
      daysSince: daysSince, monthsBetween: monthsBetween,
      vals: vals, last: last, recentMean: recentMean, baselineMean: baselineMean,
      latestMri: latestMri, anchorDate: anchorDate, fmt: fmt,
    },
  };
})(window);

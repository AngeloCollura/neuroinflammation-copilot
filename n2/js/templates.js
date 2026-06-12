/*
 * templates.js - Deterministic Italian text assembly for the AI-style outputs.
 *
 * This is the OFFLINE FALLBACK generator: it builds a structured visit summary, a referral
 * letter draft and plain-language post-visit instructions directly from the patient data and
 * the transparent risk flags. Every patient therefore always has an output, with no network.
 * Curated, hand-written summaries (summaries.js) override these for the key archetypes; a live
 * LLM (llm.js) can replace them when an API key is configured. All outputs are clinician-gated.
 */

(function (global) {
  "use strict";
  var H = global.RiskEngine.helpers;

  var MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
  function fmtDate(iso) {
    if (!iso) return "-";
    var p = iso.split("-");
    return parseInt(p[2], 10) + " " + MONTHS[parseInt(p[1], 10) - 1] + " " + p[0];
  }
  function todayStr() {
    return fmtDate(global.MS_DATA.meta.generated_anchor_date);
  }
  function last(series) { return series && series.length ? series[series.length - 1].value : null; }
  function baseRecent(series, back) {
    if (!series || series.length < 2) return [null, null];
    var b = H.baselineMean(series, back || 4, 2);
    var r = H.recentMean(series, 2);
    return [b, r];
  }
  function arrow(deltaPositiveIsWorse, base, rec) {
    if (base === null || rec === null) return "→";
    var d = rec - base;
    if (Math.abs(d) < 1e-6) return "→";
    return d > 0 ? "↑" : "↓";
  }

  // ---- Section builders ---------------------------------------------------------------
  function activitySection(p) {
    var lines = [];
    var rel = (p.timeline.relapses || []).filter(function (r) { return r.type === "relapse"; });
    var lastRel = rel.length ? rel[rel.length - 1] : null;
    if (lastRel) {
      var dd = H.daysSince(lastRel.date);
      lines.push("- **Ultima ricaduta:** " + fmtDate(lastRel.date) + " (" + Math.round(dd / 30) +
        " mesi fa, " + lastRel.severity + ", recupero " + lastRel.recovery + ").");
    } else {
      lines.push("- **Ricadute:** nessuna ricaduta clinica registrata di recente.");
    }
    var mri = H.latestMri(p);
    if (mri) {
      var act = (mri.new_t2 > 0 || mri.enlarging_t2 > 0 || mri.gad_enhancing > 0);
      var bits = [];
      if (mri.new_t2 > 0) bits.push(mri.new_t2 + " nuova/e T2");
      if (mri.enlarging_t2 > 0) bits.push(mri.enlarging_t2 + " T2 ingrandita/e");
      if (mri.gad_enhancing > 0) bits.push(mri.gad_enhancing + " captante/i Gd");
      if (mri.prl > 0) bits.push(mri.prl + " PRL");
      lines.push("- **RMN più recente** (" + fmtDate(mri.date) + "): " +
        (act ? bits.join(", ") + " — **attività radiologica**" :
          (mri.prl > 0 ? bits.join(", ") + "; nessuna nuova lesione" : "nessuna nuova lesione/captazione")) +
        "; atrofia: " + mri.atrophy + ".");
    }
    var nfl = p.timeline.nfl;
    if (nfl && nfl.length) {
      var nb = baseRecent(nfl, 3), url = nfl[nfl.length - 1].url;
      var nrec = last(nfl);
      var over = nrec > url;
      lines.push("- **NfL sierico:** " + H.fmt(nrec) + " pg/mL " + arrow(true, nb[0], nrec) +
        " (baseline ~" + H.fmt(nb[0]) + "), soglia per età " + H.fmt(url) + " → " +
        (over ? "**sopra soglia**" : "nei limiti") + ".");
    }
    var gfap = p.timeline.gfap;
    if (gfap && gfap.length) {
      var gurl = gfap[gfap.length - 1].url, grec = last(gfap);
      lines.push("- **GFAP sierico:** " + H.fmt(grec, 0) + " pg/mL, soglia " + H.fmt(gurl, 0) + " → " +
        (grec > gurl ? "**elevato** (marcatore di progressione)" : "nei limiti") + ".");
    }
    var edss = p.timeline.edss;
    if (edss && edss.length) {
      var eb = (H.vals(edss).slice(0, 2).reduce(function (s, x) { return s + x; }, 0)) / Math.min(2, edss.length);
      var er = H.recentMean(edss, 2);
      lines.push("- **EDSS:** " + H.fmt(eb) + " → " + H.fmt(er) + " " + arrow(true, eb, er) + ".");
    }
    return lines.join("\n");
  }

  function invisibleSection(p) {
    var lines = [];
    var defs = [
      ["mfis", "Fatica (MFIS)", true, 0],
      ["sdmt", "Cognizione (SDMT)", false, 0],
      ["phq9", "Umore (PHQ-9)", true, 0],
      ["msis29", "Impatto SM (MSIS-29)", true, 0],
    ];
    defs.forEach(function (def) {
      var s = p.timeline[def[0]];
      if (!s || s.length < 2) return;
      var br = baseRecent(s, 4);
      var worseUp = def[2];
      var d = br[1] - br[0];
      var worsening = worseUp ? d > 0 : d < 0;
      lines.push("- **" + def[1] + ":** " + H.fmt(br[0], 0) + " → " + H.fmt(br[1], 0) + " " +
        arrow(worseUp, br[0], br[1]) + (worsening && Math.abs(d) >= 3 ? " *(in peggioramento)*" : ""));
    });
    var wear = p.timeline.wearable;
    if (wear && wear.length >= 8) {
      var sRec = wear.slice(-4).reduce(function (a, w) { return a + w.steps; }, 0) / 4;
      var sBase = wear.slice(0, 4).reduce(function (a, w) { return a + w.steps; }, 0) / 4;
      var gRec = wear.slice(-4).reduce(function (a, w) { return a + w.gait_speed_ms; }, 0) / 4;
      lines.push("- **Biomarcatori digitali (wearable):** passi/giorno ~" + Math.round(sBase) +
        " → ~" + Math.round(sRec) + ", velocità del cammino ~" + H.fmt(gRec, 2) + " m/s.");
    }
    return lines.join("\n");
  }

  function adherenceMonitoringSection(p) {
    var lines = [];
    var a = p.adherence;
    if (a) {
      lines.push("- **Aderenza stimata:** " + a.recent_pct + "% (" + a.trend + ")" +
        (a.missed_doses_90d ? ", " + a.missed_doses_90d + " dosi mancate/90gg" : "") +
        (a.refill_gap_days ? ", gap rifornimenti " + a.refill_gap_days + " gg" : "") + ".");
    }
    var due = (p.monitoring || []).filter(function (m) { return m.status !== "ok"; });
    if (due.length) {
      due.forEach(function (m) {
        lines.push("- **Monitoraggio " + (m.status === "scaduto" ? "SCADUTO" : "in scadenza") + ":** " +
          m.item + " (atteso " + fmtDate(m.due_date) + ").");
      });
    } else {
      lines.push("- **Monitoraggio:** nessun esame in scadenza.");
    }
    return lines.join("\n");
  }

  function suggestionsList(p, risk) {
    var s = [];
    var keys = risk.flags.map(function (f) { return f.key; });
    if (keys.indexOf("disease_activity") >= 0) {
      s.push("Valutare **anticipo della RMN** e rivalutazione dell'attività di malattia; correlare clinica, RMN e NfL.");
    }
    risk.flags.forEach(function (f) {
      if (f.key === "suboptimal") {
        if (f.severity === "high") {
          s.push("Discutere **switch/escalation della DMT**: attività persistente oltre 6–12 mesi con buona aderenza.");
        } else {
          s.push("**Ottimizzare prima l'aderenza** e poi rivalutare la risposta; considerare switch se l'attività persiste.");
        }
      }
    });
    if (keys.indexOf("pira_smouldering") >= 0) {
      s.push("Quadro compatibile con **progressione indipendente dalle ricadute (PIRA/smouldering)**: l'escalation antinfiammatoria classica può non bastare; valutare follow-up ravvicinato, riabilitazione e gestione dei sintomi.");
    }
    if (keys.indexOf("invisible_symptoms") >= 0) {
      s.push("**Indagare attivamente fatica, cognizione e umore** (spesso non emergono spontaneamente): SDMT/MFIS strutturati e interventi dedicati.");
    }
    if (keys.indexOf("adherence") >= 0) {
      s.push("**Esplorare le barriere all'aderenza** (tollerabilità, dimenticanze, organizzazione); rinforzo educativo ed eventuali reminder.");
    }
    if (keys.indexOf("monitoring") >= 0) {
      var due = (p.monitoring || []).filter(function (m) { return m.status !== "ok"; })
        .map(function (m) { return m.item; });
      s.push("**Programmare gli esami di monitoraggio** in scadenza/scaduti: " + due.join("; ") + ".");
    }
    (risk.insights || []).forEach(function (i) {
      if (i.key === "pseudo_relapse") {
        s.push("**Distinguere il recente peggioramento (sospetta pseudo-ricaduta) da una ricaduta vera** prima di modificare la terapia: escludere caldo, infezioni e febbre.");
      }
    });
    if (!s.length) {
      s.push("Quadro stabile: proseguire la terapia e il monitoraggio programmato; confermare assenza di nuovi sintomi.");
    }
    return s.map(function (x) { return "- " + x; }).join("\n");
  }

  function whySection(risk) {
    if (!risk.flags.length) {
      return "- Nessun flag attivo: paziente clinicamente e radiologicamente stabile" +
        (risk.neda ? " (**NEDA-3**)." : ".");
    }
    return risk.flags.map(function (f) {
      return "- **" + f.label + "** — " + f.factors[0];
    }).join("\n");
  }

  // ---- Public assemblers --------------------------------------------------------------
  function visitSummary(p, risk) {
    var dmt = p.current_dmt;
    var dmtStr = (dmt && dmt.klass !== "nessuno") ?
      (dmt.drug + " da " + dmt.months_on_dmt + " mesi") : "nessuna DMT in corso";
    var head =
      "# Sintesi pre-visita — " + p.name + "\n" +
      "*" + p.age + " anni · " + (p.sex === "F" ? "donna" : "uomo") + " · " + p.ms_type +
      " · malattia da " + p.disease_duration_years + " anni · " + dmtStr + "*\n\n" +
      "*Generato il " + todayStr() + " · Priorità copilot: **" + risk.level.toUpperCase() +
      "** (punteggio " + risk.score + ")*\n\n" +
      "> Bozza generata a supporto del clinico. **Da rivedere e validare.** Non è una diagnosi.\n";

    var body =
      "\n## Perché è prioritario\n" + whySection(risk) +
      "\n\n## Attività e progressione\n" + activitySection(p) +
      "\n\n## Sintomi invisibili e qualità di vita\n" + invisibleSection(p) +
      "\n\n> I sintomi invisibili (fatica, cognizione, umore, sonno) hanno alto impatto e spesso **non emergono spontaneamente** in visita.\n" +
      "\n## Aderenza e monitoraggio\n" + adherenceMonitoringSection(p) +
      "\n\n## Suggerimenti operativi *(da validare dal clinico)*\n" + suggestionsList(p, risk) +
      "\n\n---\n*Dati sintetici a scopo dimostrativo. Strumento di supporto decisionale: la decisione resta al clinico.*";

    return head + body;
  }

  function letter(p, risk) {
    var dmt = p.current_dmt;
    var dmtStr = (dmt && dmt.klass !== "nessuno") ?
      (dmt.drug + " (in corso da " + dmt.months_on_dmt + " mesi)") : "nessuna terapia modificante in corso";
    var keyPoints = risk.flags.slice(0, 3).map(function (f) { return f.label.toLowerCase(); });
    var pira = risk.flags.some(function (f) { return f.key === "pira_smouldering"; });
    var act = risk.flags.some(function (f) { return f.key === "disease_activity"; });

    var assessment;
    if (act && risk.flags.some(function (f) { return f.key === "suboptimal" && f.severity === "high"; })) {
      assessment = "Il quadro depone per **attività di malattia in corso nonostante terapia adeguata per durata**; " +
        "si pone indicazione a rivalutare la strategia terapeutica (switch/escalation), previa conferma clinica.";
    } else if (pira) {
      assessment = "Il quadro è compatibile con **progressione indipendente dall'attività di ricaduta (PIRA/smouldering)**; " +
        "si propone follow-up ravvicinato, valutazione riabilitativa e gestione dei sintomi.";
    } else if (act) {
      assessment = "Si rilevano **segnali di possibile attività di malattia** da correlare in sede clinica; " +
        "si propone rivalutazione ravvicinata ed eventuale anticipo della RMN.";
    } else {
      assessment = "Il quadro appare **clinicamente e radiologicamente stabile**; si propone proseguire terapia e monitoraggio.";
    }

    return (
      "# Bozza di relazione clinica\n" +
      "*" + todayStr() + " · Ambulatorio SM — bozza da rivedere e firmare*\n\n" +
      "> Bozza generata a supporto del clinico. **Da rivedere, integrare e firmare.** Non valida senza firma del medico.\n\n" +
      "**Gentile Collega,**\n\n" +
      "Le scrivo in merito a **" + p.name + "** (" + p.age + " anni, " + p.ms_type +
      ", malattia da " + p.disease_duration_years + " anni), attualmente in trattamento con " + dmtStr + ".\n\n" +
      "Agli ultimi controlli si segnalano in particolare: " +
      (keyPoints.length ? keyPoints.join("; ") + "." : "quadro sostanzialmente stabile.") + "\n\n" +
      "**Valutazione.** " + assessment + "\n\n" +
      "**Proposta operativa** *(da validare dal clinico)*:\n" + suggestionsList(p, risk) + "\n\n" +
      "Resto a disposizione per ogni chiarimento.\n\n" +
      "Cordiali saluti,\n\n_______________________\n" +
      "Dr. ____________ — Centro SM\n\n" +
      "---\n*Bozza prodotta dal NeuroInflammation Copilot su dati sintetici. Da rivedere e firmare dal clinico.*"
    );
  }

  function instructions(p, risk) {
    var items = [];
    if (risk.flags.some(function (f) { return f.key === "disease_activity"; })) {
      items.push("Effettuerà una **risonanza magnetica di controllo** a breve: la contatteremo per l'appuntamento.");
    }
    if (risk.flags.some(function (f) { return f.key === "invisible_symptoms"; })) {
      items.push("Abbiamo parlato di **stanchezza, memoria/concentrazione e umore**: sono sintomi comuni e gestibili. Le proporremo strategie dedicate; ne riparleremo al prossimo controllo.");
    }
    if (risk.flags.some(function (f) { return f.key === "adherence"; })) {
      items.push("È importante **assumere la terapia con regolarità**. Se ha difficoltà (effetti, dimenticanze, organizzazione), ce lo dica: troveremo insieme una soluzione.");
    }
    var due = (p.monitoring || []).filter(function (m) { return m.status !== "ok"; });
    if (due.length) {
      items.push("Da programmare alcuni **esami di controllo**: " +
        due.map(function (m) { return m.item; }).join(", ") + ".");
    }
    var pseudo = (risk.insights || []).some(function (i) { return i.key === "pseudo_relapse"; });
    if (pseudo) {
      items.push("Il recente peggioramento sembra legato a **caldo o a un'infezione** e tende a risolversi: non è detto sia una ricaduta. Se i sintomi **non migliorano in qualche giorno** o compaiono sintomi nuovi, ci contatti.");
    }
    items.push("**Quando contattarci subito:** nuovi disturbi della vista, della forza, dell'equilibrio o della sensibilità che durano più di 24 ore.");

    return (
      "# Istruzioni post-visita — " + p.name + "\n" +
      "*In linguaggio semplice · " + todayStr() + "*\n\n" +
      "> Bozza per il paziente. **Da rivedere e consegnare dal clinico.**\n\n" +
      "Gentile " + p.name.split(" ")[0] + ",\ndi seguito un riepilogo semplice di quanto ci siamo detti:\n\n" +
      items.map(function (x) { return "- " + x; }).join("\n") +
      "\n\nUn caro saluto,\nil suo team del Centro SM.\n\n" +
      "---\n*Documento prodotto su dati sintetici a scopo dimostrativo. Da validare dal clinico.*"
    );
  }

  global.Templates = {
    visitSummary: visitSummary,
    letter: letter,
    instructions: instructions,
    fmtDate: fmtDate,
    todayStr: todayStr,
  };
})(window);

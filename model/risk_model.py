#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
risk_model.py - Transparent, rule-based MS risk model (Python mirror of app/js/risk.js).

EXTRA / supporting artifact. The canonical engine used by the web app is app/js/risk.js;
this file re-implements the SAME documented rules (see CLINICAL_LOGIC.md) in Python and
prints, for every synthetic patient, the active flags and the per-feature contributions to
the overall priority score. It is a WHITE BOX: no machine learning, every number traceable.

Run:  python3 model/risk_model.py
      python3 model/risk_model.py MS-0142     # detail for one patient

Reads data/dataset.json. Standard library only.
"""

import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATASET = os.path.join(ROOT, "data", "dataset.json")

# ---- Transparent thresholds (kept in sync with RISK_CONFIG in app/js/risk.js) ----------
CFG = {
    "relapse_window_days": 365,
    "relapse_high_days": 90,
    "nfl_rising_delta": 2.0,
    "pira_edss_low": 1.0,     # baseline EDSS <= 5.5
    "pira_edss_high": 0.5,    # baseline EDSS > 5.5
    "sub_min_months": 6,
    "sub_strong_months": 12,
    "mfis_rise": 8,
    "sdmt_drop": 4,
    "phq9_rise": 5,
    "adh_pct_low": 80,
    "adh_pct_high": 65,
    "adh_missed": 6,
    "adh_gap": 14,
    "adh_gap_high": 21,
    "weights": {
        "disease_activity": 3.0, "pira_smouldering": 3.0, "suboptimal": 2.5,
        "invisible_symptoms": 2.0, "adherence": 2.0, "monitoring": 1.5,
    },
    "sev": {"high": 1.0, "med": 0.66, "low": 0.33},
    "cut": {"alta": 6.0, "media": 3.0},
}


# ---- helpers ---------------------------------------------------------------------------
def load():
    with open(DATASET, encoding="utf-8") as f:
        return json.load(f)


def anchor(meta):
    return date.fromisoformat(meta["generated_anchor_date"])


def days_since(anchor_d, iso):
    return (anchor_d - date.fromisoformat(iso)).days


def vals(series):
    return [p["value"] for p in series]


def last(series):
    return series[-1]["value"] if series else None


def recent_mean(series, k=2):
    v = vals(series)[-k:]
    return sum(v) / len(v) if v else None


def baseline_mean(series, back, k=2):
    n = len(series)
    if n == 0:
        return None
    end = max(0, n - 1 - back)
    start = max(0, end - (k - 1))
    s = vals(series)[start:end + 1]
    return sum(s) / len(s) if s else vals(series)[0]


def latest_mri(p):
    m = p["timeline"]["mri"]
    return m[-1] if m else None


def recent_relapses(p, anchor_d, window, include_pseudo=False):
    out = []
    for r in p["timeline"]["relapses"]:
        if not include_pseudo and r["type"] != "relapse":
            continue
        if days_since(anchor_d, r["date"]) <= window:
            out.append(r)
    return out


def r1(x):
    """Round to 1 decimal, half-up — matches JS Math.round used in app/js/risk.js."""
    import math
    return math.floor(x * 10 + 0.5) / 10


def points(key, sev):
    return r1(CFG["weights"][key] * CFG["sev"][sev])


def fmt(x, dec=1):
    return ("%." + str(dec) + "f") % x


# ---- flags -----------------------------------------------------------------------------
def flag_activity(p, a):
    factors, signals, gad, relapse_recent = [], 0, False, False
    rel = recent_relapses(p, a, CFG["relapse_window_days"])
    if rel:
        signals += 1
        r = rel[-1]
        dd = days_since(a, r["date"])
        if dd <= CFG["relapse_high_days"]:
            relapse_recent = True
        factors.append("Ricaduta clinica %d mesi fa (%s, recupero %s)" % (round(dd / 30), r["severity"], r["recovery"]))
    mri = latest_mri(p)
    if mri and (mri["new_t2"] > 0 or mri["enlarging_t2"] > 0 or mri["gad_enhancing"] > 0):
        signals += 1
        bits = []
        if mri["new_t2"] > 0:
            bits.append("%d nuova/e T2" % mri["new_t2"])
        if mri["enlarging_t2"] > 0:
            bits.append("%d T2 ingrandita/e" % mri["enlarging_t2"])
        if mri["gad_enhancing"] > 0:
            bits.append("%d captante/i Gd" % mri["gad_enhancing"]); gad = True
        factors.append("RMN %d mesi fa: %s" % (round(days_since(a, mri["date"]) / 30), ", ".join(bits)))
    nfl = p["timeline"]["nfl"]
    if nfl:
        nl, url, nb = last(nfl), nfl[-1]["url"], baseline_mean(nfl, 3)
        if nl > url and (nl - nb) >= CFG["nfl_rising_delta"]:
            signals += 1
            factors.append("NfL %s pg/mL sopra soglia (%s) e in salita (era ~%s)" % (fmt(nl), fmt(url), fmt(nb)))
    if signals == 0:
        return None
    sev = "high" if (gad or signals >= 2 or relapse_recent) else "med"
    return {"key": "disease_activity", "label": "Attività di malattia", "severity": sev,
            "points": points("disease_activity", sev), "factors": factors}


def flag_pira(p, a):
    edss = p["timeline"]["edss"]
    if len(edss) < 3:
        return None
    base = sum(vals(edss)[:2]) / min(2, len(edss))
    rec = recent_mean(edss, 2)
    thr = CFG["pira_edss_low"] if base <= 5.5 else CFG["pira_edss_high"]
    if not ((rec - base) >= thr and (last(edss) - base) >= thr - 0.001):
        return None
    if recent_relapses(p, a, CFG["relapse_window_days"]):
        return None
    mri = latest_mri(p)
    if mri and (mri["new_t2"] > 0 or mri["enlarging_t2"] > 0 or mri["gad_enhancing"] > 0):
        return None
    gfap = p["timeline"]["gfap"]
    gfap_high = bool(gfap) and last(gfap) > gfap[-1]["url"]
    prl = bool(mri) and mri["prl"] > 0
    if not gfap_high and not prl:
        return None
    factors = ["Peggioramento EDSS confermato: da %s a %s senza ricadute (12 mesi)" % (fmt(base), fmt(rec))]
    if mri:
        factors.append("RMN senza nuove lesioni/captazione")
    if gfap_high:
        factors.append("GFAP %s pg/mL sopra soglia (%s): progressione" % (fmt(last(gfap), 0), fmt(gfap[-1]["url"], 0)))
    if prl:
        factors.append("%d PRL + atrofia '%s'" % (mri["prl"], mri["atrophy"]))
    return {"key": "pira_smouldering", "label": "Possibile PIRA / smouldering", "severity": "high",
            "points": points("pira_smouldering", "high"), "factors": factors}


def flag_suboptimal(p, activity):
    if not activity:
        return None
    dmt = p["current_dmt"]
    if dmt["klass"] == "nessuno" or not dmt["months_on_dmt"]:
        return None
    if dmt["months_on_dmt"] < CFG["sub_min_months"]:
        return None
    pct = p["adherence"]["recent_pct"]
    if pct < CFG["adh_pct_high"]:
        return None  # adherence problem, not drug failure
    if pct < CFG["adh_pct_low"]:
        sev = "med"
        factors = ["Attività nonostante %d mesi su %s" % (dmt["months_on_dmt"], dmt["drug"]),
                   "Aderenza ridotta (%d%%): ottimizzare prima dello switch" % pct]
    else:
        sev = "high" if dmt["months_on_dmt"] >= CFG["sub_strong_months"] else "med"
        factors = ["Attività nonostante %d mesi su %s con buona aderenza" % (dmt["months_on_dmt"], dmt["drug"]),
                   "Rivalutare la terapia (switch/escalation) oltre 6-12 mesi"]
    return {"key": "suboptimal", "label": "Risposta subottimale al trattamento", "severity": sev,
            "points": points("suboptimal", sev), "factors": factors}


def flag_invisible(p):
    factors, domains = [], 0
    mfis = p["timeline"]["mfis"]
    if len(mfis) >= 3 and (recent_mean(mfis) - baseline_mean(mfis, 4)) >= CFG["mfis_rise"]:
        domains += 1
        factors.append("Fatica (MFIS): da %s a %s" % (fmt(baseline_mean(mfis, 4), 0), fmt(recent_mean(mfis), 0)))
    sdmt = p["timeline"]["sdmt"]
    if len(sdmt) >= 3 and (baseline_mean(sdmt, 4) - recent_mean(sdmt)) >= CFG["sdmt_drop"]:
        domains += 1
        factors.append("Cognizione (SDMT): da %s a %s (calo rilevante)" % (fmt(baseline_mean(sdmt, 4), 0), fmt(recent_mean(sdmt), 0)))
    phq = p["timeline"]["phq9"]
    if len(phq) >= 3 and (recent_mean(phq) - baseline_mean(phq, 4)) >= CFG["phq9_rise"]:
        domains += 1
        factors.append("Umore (PHQ-9): da %s a %s" % (fmt(baseline_mean(phq, 4), 0), fmt(recent_mean(phq), 0)))
    if domains == 0:
        return None
    wear = p["timeline"]["wearable"]
    if len(wear) >= 8:
        sr = sum(w["steps"] for w in wear[-4:]) / 4
        sb = sum(w["steps"] for w in wear[:4]) / 4
        if sb - sr >= 800:
            factors.append("Biomarcatore digitale: passi/giorno ~%d -> ~%d" % (round(sb), round(sr)))
    sev = "high" if domains >= 3 else ("med" if domains == 2 else "low")
    pts = r1(CFG["weights"]["invisible_symptoms"] * (1.0 if domains >= 3 else 0.75 if domains == 2 else 0.5))
    return {"key": "invisible_symptoms", "label": "Carico sintomi invisibili in aumento", "severity": sev,
            "points": pts, "factors": factors}


def flag_adherence(p):
    a = p["adherence"]
    triggers = []
    if a["recent_pct"] < CFG["adh_pct_low"]:
        triggers.append("aderenza %d%%" % a["recent_pct"])
    if a["missed_doses_90d"] >= CFG["adh_missed"]:
        triggers.append("%d dosi mancate/90gg" % a["missed_doses_90d"])
    if a["refill_gap_days"] >= CFG["adh_gap"]:
        triggers.append("gap rifornimenti %dgg" % a["refill_gap_days"])
    if a["trend"] == "in calo" and a["recent_pct"] < 90 and not triggers:
        triggers.append("trend in calo")
    if not triggers:
        return None
    sev = "high" if (a["recent_pct"] < CFG["adh_pct_high"] or a["refill_gap_days"] >= CFG["adh_gap_high"]) else "med"
    return {"key": "adherence", "label": "Aderenza a rischio", "severity": sev,
            "points": points("adherence", sev), "factors": [t.capitalize() for t in triggers]}


def flag_monitoring(p):
    items = p["monitoring"]
    overdue = [m for m in items if m["status"] == "scaduto"]
    soon = [m for m in items if m["status"] == "in_scadenza"]
    if not overdue and not soon:
        return None
    factors = ["SCADUTO: " + m["item"] for m in overdue] + ["In scadenza: " + m["item"] for m in soon]
    safety = any(any(k in m["item"] for k in ("JCV", "PML", "epatica", "linfociti", "Emocromo")) for m in overdue)
    sev = ("high" if safety else "med") if overdue else "low"
    return {"key": "monitoring", "label": "Monitoraggio in scadenza", "severity": sev,
            "points": points("monitoring", sev), "factors": factors}


def compute(p, a):
    flags = []
    fa = flag_activity(p, a)
    if fa:
        flags.append(fa)
    fp = flag_pira(p, a)
    if fp:
        flags.append(fp)
    fs = flag_suboptimal(p, fa)
    if fs:
        flags.append(fs)
    fi = flag_invisible(p)
    if fi:
        flags.append(fi)
    fad = flag_adherence(p)
    if fad:
        flags.append(fad)
    fm = flag_monitoring(p)
    if fm:
        flags.append(fm)
    flags.sort(key=lambda f: -f["points"])
    score = r1(sum(f["points"] for f in flags))
    level = "alta" if score >= CFG["cut"]["alta"] else ("media" if score >= CFG["cut"]["media"] else "bassa")
    neda = (not flags) and ("SPMS" not in p["ms_type"] and "PPMS" not in p["ms_type"]) \
        and not recent_relapses(p, a, 365)
    return {"score": score, "level": level, "neda": neda, "flags": flags}


def main():
    ds = load()
    a = anchor(ds["meta"])
    pats = ds["patients"]
    results = [(p, compute(p, a)) for p in pats]
    results.sort(key=lambda x: -x[1]["score"])

    target = sys.argv[1] if len(sys.argv) > 1 else None

    print("=" * 78)
    print("NeuroInflammation Copilot — modello di rischio trasparente (Python)")
    print("Dati 100%% sintetici · ancora %s · regole = CLINICAL_LOGIC.md" % ds["meta"]["generated_anchor_date"])
    print("=" * 78)

    for p, r in results:
        if target and p["id"] != target:
            continue
        badge = " [NEDA-3]" if r["neda"] else ""
        print("\n#%s  %-20s  %-12s  priorità %-5s  punteggio %s%s"
              % (p["id"], p["name"], p["ms_type"], r["level"], r["score"], badge))
        if not r["flags"]:
            print("   (nessun flag attivo — quadro stabile)")
        for f in r["flags"]:
            print("   • %-34s  %-5s  +%s" % (f["label"], f["severity"], f["points"]))
            if target:  # detailed factors only in single-patient mode
                for fc in f["factors"]:
                    print("       - %s" % fc)

    if not target:
        print("\n" + "-" * 78)
        print("Contributi al punteggio (feature → punti) per i primi 3 pazienti:")
        for p, r in results[:3]:
            contrib = ", ".join("%s=%s" % (f["key"], f["points"]) for f in r["flags"])
            print("  %-16s %s  → totale %s" % (p["name"], contrib, r["score"]))
        top = results[0][0]["name"]
        print("\nPaziente in cima alla lista: %s (atteso: Giulia Rossi).%s"
              % (top, "  ✓" if top == "Giulia Rossi" else "  ⚠ verifica"))


if __name__ == "__main__":
    main()

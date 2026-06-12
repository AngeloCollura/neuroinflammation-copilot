# PLAN.md — NeuroInflammation Copilot

> Prototipo per **Digital Neuro Hub 2026 — NeuroHackathon**, gruppo "Sclerosi Multipla e malattie neuroinfiammatorie".
> Sfida affrontata: **#2 HCP Digital Copilot** (assistente digitale per il neurologo).
> ⚠️ Prototipo dimostrativo con **dati 100% sintetici**. NON per uso clinico. Il clinico resta sempre al centro della decisione.

---

## 1. Obiettivo del prodotto

Una piattaforma **AI-native HCP-facing** che integra in un'unica vista clinicamente
interpretabile dati eterogenei di pazienti con SM (cartella, RMN, biomarcatori sierici,
scale cliniche, PRO, biomarcatori digitali da wearable, storia terapeutica) e aiuta il
neurologo a **intercettare precocemente** attività di malattia, progressione silente (PIRA/
smouldering) e risposta subottimale, **riducendo il carico cognitivo** e mantenendo la
**trasparenza/spiegabilità** di ogni segnalazione.

Il copilot **non diagnostica**: prioritizza, sintetizza, spiega e propone — la decisione resta al clinico.

## 2. Strategia per vincere (analisi del contesto)

La giuria è composta da clinici e premia **fattibilità, chiarezza, impatto clinico e demo memorabile**.
Dal materiale dell'evento ricaviamo i criteri di successo per la Sfida #2 (output richiesti):
mappa del workflow, ruolo del copilot, dati usati, output generati, decisioni che restano al
clinico, rischi e mitigazioni.

Differenziatori deliberati (anche rispetto al progetto-esempio "ScleroGPT" mostrato all'evento):
1. **Risk stratification trasparente e spiegabile** (regole leggibili, niente black-box) — ogni flag espone il "PERCHÉ".
2. **Biomarcatori digitali da wearable** integrati nei segnali (passi, velocità del cammino, sonno) — tema forte dell'evento (Cereatti).
3. **Governance/Intended-use visibile** + classificazione preliminare come *Clinical Decision Support* + nota GDPR — tema forte dell'evento (Modulo 4, Coro).
4. **KPI clinici corretti** (minuti/visita, completezza documentazione, % sintomi invisibili emersi, concordanza copilot↔clinico, SUS, PREM) — **NO ROI da ore di segreteria** (errore esplicito da evitare).
5. **Demo offline-robusta** che racconta la storia di **Giulia** end-to-end.

## 3. Architettura (sintesi)

- **Self-contained, offline-first.** Web app vanilla (HTML+CSS+JS, zero framework, zero build, zero rete).
  Si apre con doppio click su `app/index.html` (protocollo `file://`) → funziona sempre.
- **Dati**: generatore Python riproducibile (seed fisso, solo stdlib) → CSV + JSON in `/data`
  (esplorabili in R/Quarto) **e** `app/data.js` (stessi dati embeddati per girare offline).
- **Risk engine** in JS (`app/js/risk.js`): calcola flag + punteggio + contributi **live** sui dati,
  così la logica è verificabile e non precalcolata. Le stesse regole sono documentate in `CLINICAL_LOGIC.md`
  e replicate in `model/risk_model.py` (extra, riproducibilità cross-linguaggio).
- **Visit summary / lettera**: 3 livelli, tutti con clinico al centro:
  1. **Live LLM** (opzionale) via `app/serve.py` che legge la API key da env e fa da proxy;
  2. **Fallback curato** (riassunti pre-generati salvati in `app/generated_summaries/`);
  3. **Fallback template** assemblato deterministicamente dai dati (sempre disponibile, offline).
  Prompt template salvato in `app/prompts/`.
- **Governance**: banner intended-use + disclaimer, audit trail (chi/quando ha generato/validato),
  badge "DA RIVEDERE E FIRMARE DAL CLINICO".

## 4. Fasi di lavoro

### Fase 0 — Setup & docs di base ✅
- [x] Lettura materiale evento, scelta sfida, struttura cartelle
- [x] `PLAN.md`, `ASSUMPTIONS.md`

### Fase 1 — Dataset sintetico (MVP-core)
- [x] `data/generate_data.py` (pure-python, seed fisso, ~14 pazienti longitudinali plausibili)
- [x] Archetipi: Giulia (flagship), 2 NEDA stabili, PIRA/smouldering, risposta subottimale,
      aderenza a rischio, monitoraggio in scadenza, PPMS, CIS/RIS, attività elevata, confounder pseudo-ricaduta
- [x] Output: CSV (long, R-friendly) + `dataset.json` + `data/data_dictionary.md` + `app/data.js`
- [x] Verifica: dati riproducibili e clinicamente coerenti

### Fase 2 — Risk engine trasparente
- [x] `app/js/risk.js`: regole flag (attività, PIRA/smouldering, subottimale, sintomi invisibili,
      aderenza, monitoraggio) + punteggio priorità con scomposizione contributi
- [x] Allineamento con `CLINICAL_LOGIC.md`

### Fase 3 — Web app MVP
- [x] `app/index.html` shell + `app/css/styles.css`
- [x] **Vista Panel**: lista pazienti per priorità, badge/flag, pannello "PERCHÉ"
- [x] **Vista Dettaglio**: timeline longitudinale + sparkline (EDSS, NfL/GFAP, MFIS/SDMT, RMN, DMT), evidenza peggioramento silente + sintomi invisibili
- [x] **Visit summary** (3 livelli) + **bozza lettera/istruzioni** con badge firma
- [x] **Layer governance**: intended use, disclaimer, audit trail
- [x] Verifica end-to-end della storia di Giulia

### Fase 4 — Summaries & prompt
- [x] `app/prompts/visit_summary_prompt.md` (+ lettera)
- [x] `app/generated_summaries/*.json|md` (curati per archetipi chiave) + `app/summaries.js`
- [x] `app/js/llm.js` + `app/serve.py` (live opzionale con fallback)

### Fase 5 — Extra (se avanza tempo, senza rompere l'MVP)
- [x] Filtri (per flag/forma) + ricerca nel Panel
- [x] Confronto rispetto alla coorte (UI v2: chip percentile sui biomarcatori, es. "93° pct coorte")
- [x] Vista dedicata biomarcatori digitali (wearable)
- [x] Export PDF/print del summary
- [x] `model/risk_model.py` (modello trasparente in Python con contributi feature)

### Fase 7 — UI v2 "Console clinica" + agenti (post-MVP)
- [x] `n2/`: redesign completo (sidebar scura, ring di punteggio, area chart con soglie,
      barre di contributo del punteggio, percentili di coorte, timeline con icone/anni, drawer governance, toast)
- [x] Logica condivisa: `n2/js/{risk,templates,llm}.js` copie sincronizzate; generatori scrivono in tutte le UI
- [x] `.claude/agents/` — 7 agenti pronti per l'hackathon + guida `AGENTS.md`

### Fase 8 — App del paziente (Patient Companion, chiude il loop)
- [x] `paziente/`: mobile-first (phone-frame su desktop), warm & accessibile — Oggi, Diario, Assistente, Andamenti, Visita
- [x] **Assistente conversazionale sicuro**: classificatore escalation-first (112 / Centro SM / crisi),
      base curata offline, niente diagnosi/modifiche terapia, niente over-reassurance, LLM live opzionale ri-classificato
- [x] Diario PRO con rilevazione sintomi-sentinella; Andamenti amichevoli; promemoria visita auto-generato
- [x] **Loop** con il copilot: stessa coorte; revisione di sicurezza con l'agente `clinical-guardian` (rilievi bloccanti risolti)
- [x] `paziente/serve.py` (porta 8002) + prompt `app/prompts/patient_assistant_prompt.md`

### Fase 6 — Documentazione finale & verifica
- [x] `README.md` (avvio in 30s, architettura, modello dati, assunzioni, LIMITI)
- [x] `ARCHITECTURE.md` (+ diagramma mermaid)
- [x] `CLINICAL_LOGIC.md`, `VALIDATION_KPI.md`, `PITCH_OUTLINE.md`
- [x] Verifica finale: la demo parte con un comando e racconta Giulia dall'inizio alla fine

## 5. Definition of Done (MVP)
- Apri `app/index.html` senza rete → Giulia è in cima con i flag e il "perché".
- La sua scheda mostra i trend (fatica/cognizione/NfL/RMN/EDSS/aderenza) e il sospetto pseudo-ricaduta.
- Generi il visit summary pre-visita e una bozza di lettera, con badge "da validare dal clinico".
- Governance visibile (intended use, disclaimer, audit trail).
- 1–2 pazienti NEDA stabili per contrasto.
- README spiega l'avvio in 30 secondi.

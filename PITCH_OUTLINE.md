# PITCH_OUTLINE.md — Pitch 3–5 minuti + storia flagship

> Pubblico: **clinici**. Premiano fattibilità, chiarezza, impatto clinico, demo memorabile.
> Filo conduttore: **la storia di Giulia**, raccontata dal vivo nell'app.

## Scaletta (≈ 4 minuti)

**0:00–0:30 — Il problema (gancio)**
> “Il neurologo della SM annega in dati eterogenei — RMN, NfL, GFAP, scale, PRO, wearable, storia terapeutica — e i segnali che contano (attività precoce, progressione silente, sintomi invisibili) si perdono nel rumore. Risultato: carico cognitivo alto e diagnosi/azioni tardive.”

**0:30–1:00 — La soluzione in una frase**
> “**NeuroInflammation Copilot**: una piattaforma AI-native per il clinico che **prioritizza** i pazienti, **spiega** ogni segnalazione e **prepara** la visita — con il **clinico sempre al centro**. Niente black box, niente diagnosi autonome.”

**1:00–3:00 — Demo dal vivo: la storia di Giulia** *(vedi sotto)*

**3:00–3:40 — Perché è fattibile e diverso**
- **Trasparente e spiegabile:** ogni flag mostra il “perché”; punteggio scomposto. (I clinici si fidano di ciò che possono verificare.)
- **Biomarcatori digitali** da wearable integrati nei segnali.
- **Governance forte:** intended use, audit trail, decisione al clinico, privacy/GDPR, profilo CDS.
- **Demo offline-robusta:** gira con un comando, anche senza rete.
- **KPI corretti:** minuti/visita, completezza, sintomi invisibili emersi, concordanza copilot↔clinico, SUS/PREM — **non** un ROI da ore di segreteria.

**3:40–4:00 — Chiusura**
> “Non sostituiamo il neurologo: gli restituiamo **tempo e attenzione** per ciò che conta. Dal prototipo al pilota a un centro, con un percorso di validazione e regolatorio già tracciato.”

---

## Storia flagship — Giulia, 34 anni, RRMS

**Setup (1 frase):** “Giulia, 34 anni, RRMS da 5 anni, in DMT orale da 18 mesi. In una lista di 14 pazienti, il copilot la mette **in cima**. Perché?”

**Demo passo-passo (nell'app):**
1. **Panel** → Giulia è **#1, priorità ALTA (punteggio 8.0)**. Clic su **“Perché?”**: attività di malattia (nuova lesione T2 + NfL in salita sopra soglia), risposta subottimale, sintomi invisibili in aumento, aderenza a rischio.
2. **Scheda paziente** → i **trend** parlano da soli: NfL 7 → 16.6 (sopra soglia), SDMT in calo, MFIS in salita, EDSS 2.0 → 2.5; GFAP **normale** → è **attività**, non progressione. I **biomarcatori digitali** (passi e cammino in calo) confermano.
3. **Insight pseudo-ricaduta** → “peggioramento recente da **caldo** (~3 settimane fa): distinguere dal vero relapse **prima** di toccare la terapia”.
4. **Genera visit summary** → one-pager pre-visita strutturato in 2 secondi (offline).
5. **Bozza lettera + istruzioni** → con banner **“DA RIVEDERE E FIRMARE DAL CLINICO”**.
6. **Valida e firma** → compare la firma; l'azione entra nell'**audit trail** (Governance).

**Il punto clinico:** in <2 minuti il copilot ha trasformato dati sparsi in **una storia clinica azionabile** — attività precoce + sintomi invisibili + aderenza — distinguendo i confondenti (pseudo-ricaduta) e tenendo la **decisione al clinico**.

**Contrasto (10 secondi):** torna al Panel e mostra **Marco** (NEDA-3, verde) — “il copilot **non grida al lupo**: i pazienti stabili restano in fondo, così il clinico spende attenzione dove serve.”

---

## Chiusura del loop (opzionale, ~40 secondi) — l'app del paziente
> Apri `paziente/index.html` (il telefono di Giulia).

“Ma da dove vengono quei segnali? Da **qui**. Questa è l'app di Giulia, tra una visita e l'altra.”
1. **Oggi/Diario:** fa un check-in — segna **stanchezza alta**, una **dose saltata**, e una **giornata storta col caldo**.
2. **Assistente:** chiede *“peggioro con il caldo”* → l'assistente la rassicura **senza minimizzare**, dà strategie e le dice **quando contattare** il centro. Poi prova un **sintomo d'allarme** (“non vedo bene da un occhio”) → parte l'**escalation** (Centro SM / 112).
3. **Punchline del loop:** “Tutto ciò che Giulia registra qui è **esattamente** ciò che il copilot del neurologo ha intercettato lì. Il paziente genera i segnali, il copilot li rende priorità spiegabili, **il clinico decide**. Un unico anello — con la **sicurezza by-design** su entrambi i lati: l'assistente del paziente non diagnostica, non tocca la terapia, e in emergenza manda subito al posto giusto.”

*(Nota: il contenuto clinico dell'assistente paziente è stato revisionato con l'agente `clinical-guardian` — utile da citare se la giuria chiede della sicurezza.)*

---

## Domande probabili della giuria & risposte rapide
- **“È una black box?”** → No: regole leggibili, pannello “perché”, punteggio scomposto; l'LLM è opzionale e vincolato ai dati.
- **“E la privacy?”** → Demo su dati 100% sintetici; in produzione pseudonimizzazione, GDPR, cifratura, RBAC, audit server-side.
- **“Stato regolatorio?”** → Decision support (uomo-nel-loop); roadmap verso software medical device/CE con validazione clinica.
- **“Come dimostrate il valore?”** → KPI clinici (minuti/visita, completezza, sintomi invisibili emersi, concordanza, SUS/PREM), non ROI da segreteria.
- **“Funziona senza rete?”** → Sì: tutto embeddato, si apre con un doppio click; l'LLM live è un extra.

## Checklist pre-demo (30 secondi)
- [ ] Aprire `app/index.html` (doppio click) — verificare Giulia #1.
- [ ] Scheda Giulia: trend + insight pseudo-ricaduta visibili.
- [ ] Generare summary → firmare → mostrare audit nel modale Governance.
- [ ] Mostrare un paziente NEDA (Marco) per contrasto.

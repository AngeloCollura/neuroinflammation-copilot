# PITCH_SCRIPT.md — Script parlato completo (~5 minuti)

> Script pronto da provare a voce per il pitch finale del NeuroHackathon (giuria di clinici).
> Corpo parlato ≈ 690 parole ≈ **4:55** a 140 parole/min (margine per clic e pause).
> Convenzioni: **[SCHERMO]** = cosa si vede / cosa cliccare · *(respiro)* = pausa · **(rallenta)** = scandisci.
>
> UI da aprire: copilot neurologo **`n2/index.html`** · app paziente **`paziente/index.html`**.
> Nota: il ring di Giulia mostra **8** (punteggio 8.0, priorità alta) — sotto è scritto "priorità alta"
> senza pronunciare il numero, per non contraddirsi dal vivo; se vuoi citarlo, è "otto".

---

### 0:00 – 0:30 — Il problema (gancio)
**[SCHERMO: slide nera o nessuno schermo. Guarda la giuria.]**

> Immaginate il mercoledì di un neurologo della SM. *(respiro)*
> Quattordici pazienti in lista. Per ognuno: risonanze, NfL, GFAP, scale, questionari, dati del wearable, storia terapeutica.
> I segnali che contano davvero — attività precoce, progressione silente, sintomi invisibili — **(rallenta)** si perdono nel rumore.
> Il risultato non è un problema di tempo. È **carico cognitivo**. E azioni che arrivano tardi.

### 0:30 – 1:00 — La soluzione in una frase
**[SCHERMO: apri `n2/index.html`. Console clinica v2: sidebar scura, statistiche di coorte, lista pazienti.]**

> Questo è **NeuroInflammation Copilot**. *(respiro)*
> Una frase: **prioritizza** i pazienti, **spiega** ogni segnalazione, e **prepara** la visita — con il **clinico sempre al centro**.
> Niente black box. Niente diagnosi automatiche. **(rallenta)** Il copilot non decide: prepara, e il medico firma.
> Ve lo mostro dal vivo. E gira **anche senza rete** — tutto offline.

### 1:00 – 1:35 — Demo: il Panel e il "Perché?"
**[SCHERMO: il Panel. Punta Giulia in cima. Clic su Giulia → clic su "Perché?". Compaiono le barre di contributo.]**

> In cima alla lista c'è Giulia. Trentaquattro anni, recidivante-remittente, in terapia orale da diciotto mesi.
> Priorità **alta**. La domanda del clinico è una sola: **perché?**
> **[indica le barre]** Il copilot non dà un numero e basta. **Scompone il punteggio.**
> Attività di malattia. Risposta subottimale. Sintomi invisibili in aumento. Aderenza a rischio. *(respiro)*
> Ogni barra è un fattore verificabile. Il clinico si fida di ciò che può controllare.

### 1:35 – 2:25 — Demo: la scheda e i trend
**[SCHERMO: scheda di Giulia. Area chart con banda di soglia. Indica NfL, SDMT, MFIS, GFAP, poi i biomarcatori digitali.]**

> Apriamo la sua scheda. I trend parlano da soli. *(respiro)*
> **[NfL]** NfL in salita, **sopra soglia** — novantatreesimo percentile della coorte.
> **[SDMT]** SDMT, la cognizione, in calo. **[MFIS]** La fatica in salita. EDSS da due a due e mezzo.
> Ma attenzione **(rallenta)**: **[GFAP]** il GFAP è **normale**.
> Questo è il punto clinico. NfL alto, GFAP normale: è **attività infiammatoria**, **non** progressione silente. Due cose diverse, e il copilot le tiene distinte.
> **[passi/cammino]** E i biomarcatori digitali — passi e velocità del cammino in calo — confermano dal mondo reale.

### 2:25 – 2:50 — Demo: l'insight pseudo-ricaduta
**[SCHERMO: scorri all'insight "pseudo-ricaduta da caldo".]**

> Qui il copilot fa una cosa che evita un errore. *(respiro)*
> **[leggi l'insight]** Segnala: peggioramento recente legato al **caldo**, circa tre settimane fa.
> Prima di toccare la terapia: **(rallenta)** distinguere una pseudo-ricaduta da una vera ricaduta.
> Non decide lui. Mette il dubbio giusto davanti al medico, al momento giusto.

### 2:50 – 3:25 — Demo: genera, valida, firma, audit
**[SCHERMO: "Genera visit summary" → one-pager. Mostra il banner "DA RIVEDERE E FIRMARE". "Valida e firma" → toast + firma. Apri drawer Governance → audit trail.]**

> Ora preparo la visita. Un clic. *(respiro)* **[clic Genera]**
> Visit summary pre-visita, strutturato, in due secondi. Offline.
> **[il banner]** E nasce con un'etichetta: **"da rivedere e firmare dal clinico"**. È una **bozza**, sempre.
> Il medico legge, integra, e **firma**. **[clic Valida e firma]**
> **[Governance]** E l'azione entra nell'**audit trail**: chi ha generato, chi ha validato, quando. Tracciabile.
> In meno di due minuti: dati sparsi diventano **una storia clinica azionabile**. Con la decisione **al clinico**.

### 3:25 – 3:40 — Contrasto: il paziente NEDA
**[SCHERMO: torna al Panel. Apri Marco Bianchi (NEDA-3, verde, in fondo).]**

> Una prova del contrario. **[Marco]** NEDA-3. Stabile. In fondo alla lista, verde.
> Il copilot **non grida al lupo**. *(respiro)* I pazienti stabili restano in fondo.
> Così l'attenzione del clinico va dove serve davvero.

### 3:40 – 4:20 — Chiusura del loop: l'app del paziente
**[SCHERMO: apri `paziente/index.html` — il telefono di Giulia. "Oggi/Diario": stanchezza alta, dose saltata, giornata col caldo.]**

> Ma quei segnali — da dove vengono? Da **qui**. *(respiro)*
> Questa è l'app di Giulia, tra una visita e l'altra. Oggi fa un check-in: **stanchezza alta**, una **dose saltata**, una **giornata storta col caldo**.

**[SCHERMO: "Assistente". Scrivi "peggioro con il caldo" → consigli + quando contattare il centro.]**

> Chiede all'assistente: *"peggioro con il caldo"*.
> L'assistente la rassicura **senza minimizzare**, le dà strategie, e le dice **quando contattare** il centro.

**[SCHERMO: scrivi "non vedo bene da un occhio" → escalation Centro SM / 112.]**

> Poi un sintomo d'allarme: *"non vedo bene da un occhio"*. **(rallenta)**
> Parte subito l'**escalation**: Centro SM, 112. Niente diagnosi. Niente rassicurazioni di troppo.
> **[guarda la giuria]** E qui si chiude l'anello: ciò che Giulia registra **qui**, è esattamente ciò che il copilot ha intercettato **lì**.
> Il paziente genera i segnali. Il copilot li rende **priorità spiegabili**. Il **clinico decide**. Con la sicurezza **by-design** su entrambi i lati.

### 4:20 – 4:45 — Fattibilità, governance, KPI
**[SCHERMO: torna alla Console v2, o slide unica con i KPI.]**

> È fattibile. *(respiro)* Tutto trasparente: ogni flag mostra il perché.
> Governance solida: intended use, audit trail, GDPR, profilo di supporto decisionale.
> E lo misuriamo nel modo giusto. **(rallenta)** Non ROI da ore di segreteria.
> Misuriamo: **minuti per visita** nella preparazione, **completezza** della documentazione, **percentuale di sintomi invisibili** emersi, **concordanza** copilot-clinico, usabilità con la SUS.
> Il percorso è chiaro: dal prototipo al **pilota a un centro**, poi validazione e regolatorio.

### 4:45 – 5:00 — Chiusura
**[SCHERMO: Console v2 con Giulia in cima, o logo/titolo.]**

> Non sostituiamo il neurologo. **(rallenta)**
> Gli restituiamo **tempo e attenzione** per ciò che conta.
> Il paziente registra. Il copilot spiega. **Il clinico decide.** *(respiro)*
> Grazie.

---

## Q&A — 8 domande difficili (risposte da ~20 secondi)

**1. "È una black box?"**
> No, ed è una scelta di design. Il motore è a **regole leggibili**: ogni flag ha il suo "perché", e il punteggio è **scomposto** in contributi, come avete visto sulle barre. L'LLM è **opzionale** e vincolato ai dati del paziente. Se non c'è, il sistema funziona lo stesso, con i template deterministici.

**2. "E la privacy, il GDPR?"**
> La demo gira su dati **100% sintetici**, nessun paziente reale. In produzione: pseudonimizzazione, cifratura, controllo accessi per ruolo, audit lato server, e DPIA. Nel pilota partiamo con parere del comitato etico e intended use formale, prima di toccare un solo dato reale.

**3. "Stato regolatorio? È un dispositivo medico?"**
> Oggi è un **supporto decisionale** con l'uomo nel loop: non diagnostica e non decide. Per questo ogni output è una bozza da firmare. La roadmap prevede la classificazione come software medical device, percorso CE e gestione del rischio secondo ISO 14971. Lo dichiariamo come intended use esplicito.

**4. "Come dimostrate che funziona davvero?"**
> Con un **pilota monocentrico** prospettico, tre mesi, 80–120 pazienti. KPI clinici, non di segreteria: minuti per visita, completezza del referto, sintomi invisibili emersi, e **concordanza** tra i flag del copilot e il giudizio del clinico, in cieco, con il Cohen's kappa. Più usabilità con la SUS.

**5. "Perché meglio di un chatbot tipo ScleroGPT?"**
> Perché non è un chatbot. **(rallenta)** Un chatbot risponde a domande. Questo **prioritizza una coorte** su dati strutturati e longitudinali, **spiega** ogni segnalazione in modo verificabile, e **prepara documenti firmabili** dentro il workflow. Il valore non è la chiacchierata: è la storia clinica azionabile, con l'audit trail.

**6. "E i falsi allarmi? Un NfL ballerino e scatta l'allarme."**
> Lo abbiamo affrontato a monte. Non guardiamo il **singolo dato**, ma il **trend** nel tempo. E per la priorità alta serve la **convergenza di almeno due segnali**, non uno solo. Inoltre il "subottimale" è modulato dall'aderenza: non confondiamo un farmaco che fallisce con una dose saltata.

**7. "Chi paga? È sostenibile?"**
> Il valore è clinico, non da risparmio di segreteria: meno carico cognitivo, intercettazione precoce, meno azioni tardive. Tecnicamente è **leggerissimo** — zero framework, gira offline, costi di infrastruttura minimi. Il pilota serve proprio a quantificare il beneficio reale prima di qualunque scaling.

**8. "Un chatbot per pazienti non è pericoloso?"**
> È la superficie più delicata, e l'abbiamo trattata così. L'assistente è **escalation-first**: un classificatore deterministico intercetta emergenze, possibili ricadute, sintomi d'allarme **prima** di qualsiasi risposta. Non diagnostica, non tocca la terapia, non rassicura troppo. E il contenuto clinico è stato revisionato con un agente dedicato, il clinical-guardian.

---

## Note di regia per la prova
- **Segmenti più densi:** 1:35–2:50 (trend + pseudo-ricaduta). Se sei in ritardo, taglia **una** frase dell'insight, **non** i trend NfL/GFAP (è il cuore clinico).
- **Respiri obbligatori:** dopo "carico cognitivo" (0:30), dopo "GFAP normale" (2:10), prima di "qui si chiude l'anello" (4:10).
- **Rallenta sui claim memorabili:** "è attività infiammatoria, non progressione silente"; "il copilot non grida al lupo"; "ciò che registra qui è ciò che il copilot intercetta lì"; "il clinico decide".
- **Clic da provare a vuoto (l'ordine è load-bearing):** Giulia → Perché? → scheda → trend → pseudo-ricaduta → Genera summary → Valida e firma → Governance/audit → Panel → Marco → app paziente (Diario → Assistente).
- **Margine:** corpo a ~4:55. Per stare comodo sotto i 5:00, accorcia la chiusura a tre frasi: "Non sostituiamo il neurologo. Il paziente registra, il copilot spiega, il clinico decide. Grazie."

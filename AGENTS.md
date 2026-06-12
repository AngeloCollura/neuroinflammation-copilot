# AGENTS.md — Agenti pronti per l'hackathon

Sette agenti specializzati, già configurati in **`.claude/agents/`**, da usare con Claude Code durante il
Digital Neuro Hub 2026. Ognuno conosce già il progetto (percorsi, comandi, vincoli, dominio clinico):
non serve spiegare il contesto, basta chiedere.

## Come si usano
- **In automatico**: descrivi il bisogno in chat ("verifica che la demo funzioni", "aggiungi un paziente
  PPMS giovane", "prepara le risposte sulla privacy") — Claude delega all'agente giusto in base alla descrizione.
- **Esplicitamente**: nomina l'agente — *"Usa l'agente `pitch-coach` per la versione da 2 minuti"*.
- Gli agenti girano in un contesto separato e riportano il risultato: il lavoro in chat principale non si sporca.

## Gli agenti

| Agente | Cosa fa | Quando invocarlo | Modifica file? |
|---|---|---|---|
| **`demo-sentinel`** | Smoke-test completo: dati riproducibili, motore di rischio coerente (Giulia in cima), file integri, entrambe le UI servibili. Verdetto PASS/FAIL. | Prima del pitch; dopo qualunque modifica; "siamo pronti?" | No (solo verifica) |
| **`data-sculptor`** | Aggiunge/modifica pazienti sintetici e trend nel generatore, rigenera i dati per entrambe le UI e verifica che i flag attesi scattino. | "La giuria vuole vedere un caso di X", "rendi più evidente il trend Y" | Sì (generatore + dati) |
| **`clinical-guardian`** | Revisione clinico-scientifica dei testi (summary, lettere, slide, pitch): claim impropri, terminologia SM, disclaimer mancanti. Propone riformulazioni pronte. | Prima di mostrare qualunque testo clinico alla giuria | No (propone) |
| **`pitch-coach`** | Script parlato con timestamp, varianti 30s/2min/5min, Q&A simulate da giuria di clinici, prova cronometrata. | Per provare/riscrivere il pitch e prepararsi alle domande | No (consegna testo) |
| **`ui-surgeon`** | Ritocchi mirati alla UI (v1 `app/` o v2 `n2/`): copy, colori, layout — con verifica in anteprima browser e screenshot. Non rompe l'offline-first. | "Cambia il colore di…", "correggi il testo…", "sposta…" | Sì (UI, con verifica) |
| **`reg-navigator`** | Risposte governance/regolatorio (MDR, GDPR/DPIA, AI Act, classificazione CDS vs medical device) in formato slide o Q&A da 20 secondi. | Domande normative della giuria; slide di governance | No (consegna testo) |
| **`quarto-analyst`** | Notebook R/Quarto in `/analysis` sui CSV sintetici: spaghetti plot NfL con soglie, traiettorie EDSS, grafici ggplot2 pronti per slide. | Materiale quantitativo extra per pitch o appendice | Sì (solo `/analysis`) |

## Esempi di richieste pronte (copia-incolla)

```text
Usa demo-sentinel: verifica che tutto sia pronto per la presentazione.
Usa data-sculptor: aggiungi una paziente di 26 anni con sindrome radiologicamente isolata (RIS) in sorveglianza.
Usa clinical-guardian: controlla il visit summary di Giulia e questa slide [incolla testo].
Usa pitch-coach: scrivimi lo script da 4 minuti con i tempi e cosa cliccare nella demo v2.
Usa ui-surgeon: nella v2 rendi più grande il punteggio nel ring dell'hero.
Usa reg-navigator: prepara 5 bullet su privacy e classificazione per la slide di governance.
Usa quarto-analyst: spaghetti plot del NfL di tutta la coorte con la soglia per età e Giulia evidenziata.
```

## Combinazioni utili in gara
- **Mattina della demo**: `demo-sentinel` → (se serve) `ui-surgeon` → `demo-sentinel` di nuovo.
- **Cambio richiesto dalla giuria sui dati**: `data-sculptor` → `demo-sentinel`.
- **Preparazione finale**: `clinical-guardian` su slide e summary → `pitch-coach` per la prova → `reg-navigator` per le Q&A normative.
- **Tocchi all'assistente del paziente** (`paziente/js/chat.js`): `clinical-guardian` (verifica escalation/sicurezza) → `ui-surgeon` per l'estetica.

> L'app del paziente (`paziente/`) chiude il loop con il copilot del neurologo. Il contenuto clinico del suo
> assistente è già stato revisionato con `clinical-guardian` (rilievi bloccanti risolti): rifai la revisione
> ogni volta che ne modifichi i testi clinici o i criteri di escalation.

> Nota: gli agenti vivono nel repository (`.claude/agents/*.md`), quindi sono versionabili e modificabili
> come qualunque altro file. I vincoli che rispettano (dati sintetici, offline-first, clinico al centro,
> niente claim non validati) sono scritti nei loro prompt.

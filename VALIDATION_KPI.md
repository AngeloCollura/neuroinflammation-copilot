# VALIDATION_KPI.md — Piano di validazione minimo e KPI

> Obiettivo: dimostrare **fattibilità, sicurezza e valore clinico** del copilot con uno
> studio pilota sobrio a 1 centro, prima di qualunque scaling. KPI **clinici e di processo
> corretti** — **NON** un ROI basato su ore di segreteria.

## 1. Disegno dello studio pilota (1 centro SM)
- **Tipo:** studio pilota prospettico, monocentrico, a misure ripetute (pre/post introduzione del copilot), con componente di **concordanza** copilot↔clinico.
- **Durata:** 3 mesi di pilota + 1 mese di analisi.
- **Popolazione:** ~80–120 pazienti con SM/malattie neuroinfiammatorie in follow-up; 4–6 neurologi + team multidisciplinare.
- **Uso:** il copilot prepara la pre-visita e le bozze; **il clinico valida e firma**. Nessuna decisione automatizzata.
- **Governance:** parere del comitato etico, DPIA/GDPR, intended use formale, registro degli incidenti, possibilità di disattivazione.
- **Disegno di concordanza:** per un sottoinsieme di visite, confronto in cieco tra i flag del copilot e la valutazione indipendente del clinico (e, dove possibile, di un secondo neurologo) su attività/progressione/risposta.

## 2. KPI primari (valore clinico e di processo)
| KPI | Definizione | Misura | Target indicativo |
|---|---|---|---|
| **Minuti/visita risparmiati nella preparazione** | tempo di preparazione pre-visita con vs senza copilot | cronometraggio / log | riduzione misurabile e clinicamente sensata (non ROI segreteria) |
| **Completezza della documentazione** | presenza degli elementi chiave (attività, progressione, PRO, aderenza, monitoraggio) nel referto | checklist su cartelle | ↑ completezza vs baseline |
| **% di sintomi invisibili emersi** | quota di visite in cui fatica/cognizione/umore/sonno sono indagati e documentati | confronto vs baseline storico | ↑ significativo vs baseline |
| **Concordanza copilot↔clinico sui flag** | accordo sui flag attività/progressione/subottimale/aderenza/monitoraggio | Cohen's κ / % accordo | κ moderato-buono; nessun disaccordo “pericoloso” non spiegabile |
| **Intercettazione precoce** | gap di monitoraggio di sicurezza colmati (es. anti-JCV/PML, esami DMT) | conteggio gap rilevati/risolti | ↑ gap colmati nei tempi |

## 3. KPI secondari
- **Usabilità:** **SUS** (System Usability Scale) ≥ 70–75; tempo di onboarding.
- **Esperienza:** **PREM** (clinici e, se applicabile, pazienti) sul percorso.
- **Carico cognitivo percepito:** NASA-TLX o scala breve dedicata.
- **Carico documentale:** completezza e tempo di stesura di lettere/istruzioni (bozza → firma).
- **Appropriatezza dei flag:** tasso di flag confermati vs rifiutati dal clinico; falsi allarmi.
- **Adozione:** % di pre-visite effettivamente preparate col copilot; ritenzione d'uso.

## 4. KPI di sicurezza / governance (vincolanti)
- **Override sempre possibile:** % di output modificati/rifiutati dal clinico (atteso e desiderabile, non un fallimento).
- **Audit completo:** tracciabilità chi/quando ha generato/validato.
- **Eventi avversi legati allo strumento:** nessun evento clinico attribuibile a un suggerimento non validato.
- **Robustezza offline:** zero indisponibilità della demo/strumento per problemi di rete.

## 5. Cosa NON misuriamo (anti-pattern)
- ❌ **ROI da ore di segreteria × tariffa oraria** con break-even pluriennale: metrica fuorviante per uno strumento clinico, non cattura il valore (intercettazione precoce, qualità della cura, riduzione del carico cognitivo).
- ❌ Claim di performance cliniche non validate.
- ❌ Accuratezza diagnostica “stand-alone” (lo strumento è **decision support**, non un classificatore diagnostico autonomo).

## 6. Endpoint digitali (biomarcatori da wearable) — validazione dedicata
- Definire endpoint digitali interpretabili (passi/giorno, velocità del cammino, sonno) e **correlazione** con outcome clinici (EDSS, T25FW, MFIS).
- Frequenza di monitoraggio e criteri di alert tarati per **evitare overload informativo**.
- Validazione di **affidabilità** (test-retest) e **significato clinico** prima dell'uso decisionale.

## 7. Roadmap dal prototipo alla soluzione (sintesi)
1. **Prototipo (oggi):** dati sintetici, regole trasparenti, demo offline.
2. **Pilota a 1 centro:** dati reali pseudonimizzati, etica/GDPR, KPI sopra, intended use formale.
3. **Validazione tecnica/clinica/usabilità:** concordanza, SUS/PREM, sicurezza; calibrazione delle soglie su dati reali.
4. **Classificazione regolatoria:** valutazione come software medical device, percorso CE, gestione del rischio (es. ISO 14971), cybersecurity.
5. **Scaling controllato:** 2–5 centri, integrazione con cartella/PACS/LIS, monitoraggio continuo della performance e del bias.

> **Criterio di successo del pilota:** il copilot riduce il carico cognitivo e fa emergere più
> segnali precoci/sintomi invisibili **mantenendo il clinico al centro**, con buona usabilità,
> concordanza accettabile e **zero eventi di sicurezza** attribuibili a output non validati.

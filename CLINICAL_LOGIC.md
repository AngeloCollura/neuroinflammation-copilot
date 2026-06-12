# CLINICAL_LOGIC.md — Regole di risk stratification (trasparenti e spiegabili)

> Il motore di rischio è **a regole leggibili, non una black box**. Ogni flag espone i
> fattori che lo hanno generato (vedi pannello “Perché?” nell'app). Implementazione
> canonica: [`app/js/risk.js`](app/js/risk.js); replica Python: [`model/risk_model.py`](model/risk_model.py).
> ⚠️ Soglie **dimostrative/didattiche**, non linee guida. Prototipo non clinico.

## Principi
1. **Spiegabilità prima di tutto.** Nessun punteggio senza la sua scomposizione.
2. **Fedeltà ai dati.** Le regole leggono le serie reali del paziente (calcolo *live*, non precalcolato).
3. **Clinico al centro.** I flag **prioritizzano e spiegano**; non decidono né diagnosticano.
4. **Sfumature cliniche esplicite** (es. attività vs progressione; attività vs non-aderenza; ricaduta vs pseudo-ricaduta).

## Concetti clinici codificati
- **NEDA-3** = nessuna ricaduta + nessuna attività RMN (nuove/ingrandite T2 o lesioni captanti Gd) + nessuna progressione EDSS.
- **Attività** (ricadute, nuove lesioni, NfL in salita) **vs progressione** (PIRA/smouldering: peggioramento indipendente dalle ricadute, GFAP, PRL, atrofia).
- **NfL**: sale con l'attività acuta; **GFAP**: associato alla progressione. Soglie aggiustate per età.
- **Pseudo-ricaduta**: peggioramento transitorio e reversibile da caldo (Uhthoff), infezioni (es. IVU) o febbre — da distinguere dalla ricaduta vera.

## Parametri (single source of truth — `RISK_CONFIG` in `risk.js`)
| Gruppo | Parametro | Valore | Significato |
|---|---|---|---|
| activity | `relapseWindowDays` | 365 | ricaduta conta come “attività” se < 1 anno |
| activity | `relapseHighDays` | 180 | ricaduta molto recente → gravità alta |
| activity | `nflRisingDelta` | 2.0 pg/mL | incremento vs baseline per dire NfL “in salita” |
| pira | EDSS worsening | ≥1.0 (se baseline EDSS ≤5.5), altrimenti ≥0.5 | peggioramento confermato |
| pira | `noRelapseWindowDays` | 365 | assenza di ricadute per qualificare PIRA |
| suboptimal | `minMonthsOnDmt` / `strongMonths` | 6 / 12 | finestra per giudicare la risposta |
| invisible | MFIS↑ / SDMT↓ / PHQ-9↑ | ≥8 / ≥4 / ≥5 | variazioni clinicamente rilevanti |
| adherence | pct / missed / gap | <80% / ≥6 / ≥14gg | soglie di rischio (gravità alta se pct<65% o gap≥21gg) |

I trend usano **baseline** (media delle prime valutazioni o ~12 mesi prima) vs **recente** (media delle ultime 2 valutazioni) per ridurre il rumore.

---

## I flag

### 1) Attività di malattia · `disease_activity`
**Attivo se ≥1 segnale fra:**
- ricaduta clinica negli ultimi 12 mesi (le **pseudo-ricadute NON contano**);
- RMN più recente con nuove/ingrandite lesioni T2 **o** lesioni captanti gadolinio;
- NfL sierico **sopra soglia per età E in salita** (≥ +2.0 pg/mL vs baseline).

**Gravità:** *alta* se captazione Gd, oppure **≥2 segnali convergenti**, oppure ricaduta < 90 giorni; altrimenti *media*.
**Razionale:** intercettare precocemente l'attività infiammatoria. La convergenza di più segnali (es. nuova lesione + NfL in salita) è più robusta del singolo dato. Un NfL appena sopra soglia ma **piatto** non basta (evita falsi allarmi).

### 2) Possibile PIRA / smouldering · `pira_smouldering`
**Attivo se TUTTE:**
- **peggioramento EDSS confermato** rispetto al nadir iniziale (≥1.0 se baseline ≤5.5, ≥0.5 se >5.5), sostenuto nelle ultime valutazioni;
- **assenza di ricadute** negli ultimi 12 mesi;
- **assenza di attività RMN focale** (nessuna nuova/ingrandita/captante);
- substrato di smouldering: **GFAP elevato per età** *oppure* **PRL presenti** alla RMN;
- (di supporto) trend PRO coerente (fatica↑ e/o cognizione↓).

**Gravità:** *alta*.
**Razionale:** la progressione indipendente dall'attività di ricaduta è spesso “silente” e sfugge: l'escalation antinfiammatoria classica può non bastare. Il flag separa esplicitamente **progressione** da **attività**.

### 3) Risposta subottimale al trattamento · `suboptimal`
**Attivo se:** è attivo `disease_activity` **E** il paziente è in DMT da **≥6 mesi** (classe ≠ nessuno).
**Modulazione per aderenza (sfumatura clinica):**
- aderenza **<65%** → flag **soppresso** (è un problema di **aderenza**, non di fallimento del farmaco; lo cattura il flag dedicato);
- aderenza **65–80%** → gravità *media*, con nota “ottimizzare l'aderenza, poi rivalutare”;
- aderenza **≥80%** → gravità *alta* se ≥12 mesi, altrimenti *media*.

**Razionale:** “attività persistente nonostante ≥6–12 mesi di DMT → valutare switch”. Ma non si può parlare di **fallimento del farmaco** se il farmaco non viene assunto: la logica distingue i due casi (es. *Luca* = subottimale con buona aderenza → switch; *Sofia/Giulia* = aderenza ridotta → prima ottimizzare l'aderenza). I pazienti in terapia da **<6 mesi** (es. *Chiara*, early-high-efficacy) **non** sono etichettati subottimali.

### 4) Carico sintomi invisibili in aumento · `invisible_symptoms`
**Attivo se** peggioramento in ≥1 dominio:
- fatica **MFIS ≥ +8**; cognizione **SDMT ≤ −4**; umore **PHQ-9 ≥ +5**.

**Gravità:** *bassa* (1 dominio), *media* (2), *alta* (3). Corroborazione opzionale dai **biomarcatori digitali** (passi/giorno in calo) aggiunta come fattore.
**Razionale:** i sintomi invisibili (fatica ~90%, cognizione, umore, sonno) hanno alto impatto e **spesso non emergono spontaneamente in visita**. Il copilot li fa emergere proattivamente (anche in isolamento, es. *Martina*).

### 5) Aderenza a rischio · `adherence`
**Attivo se ≥1:** aderenza stimata <80%; ≥6 dosi mancate/90gg; gap rifornimenti ≥14gg; (oppure trend in calo con pct<90).
**Gravità:** *alta* se pct<65% o gap≥21gg; altrimenti *media*.
**Razionale:** l'aderenza subottimale è una causa frequente e correggibile di “apparente” attività; va esplorata (tollerabilità, dimenticanze, organizzazione) prima di modificare la terapia.

### 6) Monitoraggio in scadenza · `monitoring`
**Attivo se** ≥1 esame `scaduto` o `in_scadenza`.
**Gravità:** *alta* se scaduto un esame di **sicurezza** (anti-JCV/PML, emocromo/linfociti, funzione epatica); *media* se altro scaduto; *bassa* se solo in scadenza.
**Razionale:** cattura i gap di sicurezza anche in pazienti per il resto stabili (es. *Giorgio*: anti-JCV e RMN PML scaduti su natalizumab).

---

## Insight contestuale (non a punteggio): sospetta pseudo-ricaduta
Se esiste un evento recente (<90 giorni) di tipo `pseudo_relapse_suspected`, il copilot mostra un **avviso** che invita a **distinguere il flare da caldo/infezione/febbre da una ricaduta vera** prima di modificare la terapia. Non incide sul punteggio: è un supporto al ragionamento clinico (es. *Giulia* — caldo; *Alessandro* — IVU).

## Punteggio di priorità
`punteggio = Σ (peso_flag × fattore_gravità)` con pesi base
(`disease_activity` 3.0, `pira_smouldering` 3.0, `suboptimal` 2.5, `invisible_symptoms` 2.0, `adherence` 2.0, `monitoring` 1.5)
e fattori di gravità (alta 1.0, media 0.66, bassa 0.33). Il flag *sintomi invisibili* scala col numero di domini.
**Livello:** alta ≥ 6.0; media ≥ 3.0; altrimenti bassa. **Badge NEDA-3** per i pazienti senza flag, senza ricadute/attività/progressione (escluse forme progressive SPMS/PPMS).

> La scomposizione completa (flag → punti) è sempre visibile nell'app: priorità trasparente, mai “magica”.

## Limiti
- Soglie e finestre sono **didattiche**; richiedono calibrazione e validazione su dati reali.
- La conferma EDSS è approssimata sulla cadenza delle visite sintetiche (non un criterio temporale formale a 3/6 mesi).
- Il modello **non** sostituisce il giudizio clinico né integra l'esame obiettivo completo.

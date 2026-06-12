/*
 * chat.js - Safe conversational assistant for the Patient Companion.
 *
 * DESIGN FOR SAFETY (this is the clinically sensitive surface):
 *  - Clear scope: general info, daily self-management, visit prep. NEVER diagnoses,
 *    NEVER prescribes, NEVER tells the patient to change/stop therapy.
 *  - Escalation first: a safety classifier runs BEFORE any topical answer and routes
 *    emergencies (112), mental-health crises, and possible relapses to the right channel.
 *  - No over-reassurance: banned to say "it's nothing / don't worry / surely fine". Every
 *    answer that could mask a warning sign includes a "when to contact the center" line.
 *  - Offline-first & deterministic: curated, reviewed answers (no free generation by default).
 *    An optional, heavily-constrained live LLM can answer free text only as a fallback.
 *  - Transparency: many answers carry a small "informational, not a diagnosis" note.
 *
 * Output of respond(text, ctx):
 *   { bubbles:[htmlString,...], safenote, escalation, addToVisit, kind }
 */

(function (global) {
  "use strict";

  var ACC = { "à": "a", "á": "a", "è": "e", "é": "e", "ì": "i",
    "í": "i", "ò": "o", "ó": "o", "ù": "u", "ú": "u" };
  function norm(s) {
    return (s || "").toLowerCase()
      .replace(/[à-ú]/g, function (c) { return ACC[c] || c; })   // strip Italian accents
      .replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
  }
  function has(t, arr) { return arr.some(function (k) { return t.indexOf(k) >= 0; }); }

  var EMERGENCY_TEL = "112";

  // Reusable escalation cards ------------------------------------------------------------
  function emergencyCard() {
    return {
      level: "emerg",
      title: "Potrebbe essere un'emergenza",
      detail: "Se hai un sintomo improvviso e grave — difficoltà a respirare, dolore al petto, " +
        "viso o braccio che cedono da un lato, difficoltà a parlare, una convulsione, " +
        "oppure gonfiore di labbra/gola o affanno dopo un'iniezione o un'infusione — non aspettare.",
      actions: [
        { label: "Chiama il 112", kind: "red", tel: EMERGENCY_TEL },
        { label: "Vai al pronto soccorso", kind: "ghost" },
      ],
    };
  }
  function crisisCard() {
    return {
      level: "emerg",
      title: "Non sei sola/o — chiedi aiuto adesso",
      detail: "Se stai pensando di farti del male, è importante parlarne subito con qualcuno. " +
        "Contatta ora un servizio di emergenza, una linea di ascolto o una persona di fiducia. Anche il tuo team del Centro SM può aiutarti.",
      actions: [
        { label: "Chiama il 112", kind: "red", tel: EMERGENCY_TEL },
        { label: "Linea di ascolto (da configurare)", kind: "amber" },
        { label: "Contatta il Centro SM", kind: "amber" },
      ],
    };
  }
  function centerCard(title, detail) {
    return {
      level: "urgent",
      title: title,
      detail: detail,
      actions: [
        { label: "Contatta il Centro SM", kind: "amber" },
        { label: "Quando preoccuparsi", kind: "ghost", sheet: "contatti" },
      ],
    };
  }

  // ---- Safety classifier (runs first) --------------------------------------------------
  function classifySafety(t) {
    // 1) Medical emergency (FAST / acute / anaphylaxis-infusion reaction)
    var swelling = has(t, ["gonfi", "si chiude"]) && has(t, ["gola", "labbra", "lingua"]);
    if (swelling || has(t, ["non riesco a respirare", "fatico a respirare", "dolore al petto", "dolore petto",
      "convulsion", "convulsi", "ho perso i sensi", "sono svenut", "faccia storta", "bocca storta",
      "lato del corpo", "un lato del corpo", "non riesco a parlare", "non riesco piu a parlare", "ictus",
      "la mano non risponde", "tenda sull'occhio", "orticaria", "reazione dopo l'infusione",
      "reazione all'iniezione", "reazione all'infusione", "dopo l'infusione non respiro"])) {
      return { kind: "escalation", escalation: emergencyCard(),
        bubbles: ["Quello che descrivi può richiedere aiuto immediato. <strong>Non aspettare</strong>: contatta subito i soccorsi."] };
    }
    // 2) Mental-health crisis
    if (has(t, ["farmi del male", "farla finita", "non voglio piu vivere", "non voglio vivere",
      "uccidermi", "togliermi la vita", "suicid", "non ce la faccio piu a vivere"])) {
      return { kind: "escalation", escalation: crisisCard(),
        bubbles: ["Mi dispiace che tu stia soffrendo così. Quello che senti è importante e non devi affrontarlo da sola/o."] };
    }
    // 3) New neurological symptoms -> possible relapse (contact center today)
    var relapseSigns = has(t, ["non vedo", "ci vedo male", "vista offuscata", "vedo doppio", "vista doppia",
      "calo della vista", "perso la vista", "un occhio", "non muovo", "non riesco a muovere", "debolezza",
      "mi si addormenta", "perso la forza", "non cammino", "equilibrio", "non sto in piedi", "vertigini forti",
      "non trattengo la pipi", "non trattengo l'urina", "ritenzione", "non sento le gambe"]);
    if (relapseSigns) {
      return {
        kind: "escalation",
        escalation: centerCard("Sintomi da non rimandare",
          "Sintomi neurologici nuovi o in peggioramento (vista, forza, sensibilità, equilibrio, parola, controllo della vescica) " +
          "che durano più di 24 ore vanno valutati dal tuo Centro SM, preferibilmente oggi. Potrebbe trattarsi di una " +
          "ricaduta — oppure, se c'è caldo o un'infezione, di un peggioramento temporaneo: sarà il tuo team a distinguerlo. " +
          "Se invece sono comparsi all'improvviso e sono importanti (per esempio non riesci a parlare o un lato del corpo cede), chiama il 112."),
        bubbles: ["Grazie per avermelo detto. Questo è il tipo di sintomo che è meglio <strong>non rimandare</strong>."],
        addToVisit: "Sintomo nuovo segnalato all'assistente (da valutare)",
      };
    }
    // 4) Fever / infection (can worsen MS — pseudo-relapse)
    if (has(t, ["febbre", "ho la febbre", "infezione", "bruciore quando faccio", "cistite", "brucia la pipi"])) {
      return {
        kind: "escalation",
        escalation: centerCard("Febbre o infezione: meglio farsi sentire",
          "Un'infezione o la febbre possono peggiorare temporaneamente i sintomi della SM. Spesso migliorano curando la " +
          "causa, ma è bene avvisare il tuo medico. Contatta il Centro SM in particolare se compaiono sintomi neurologici " +
          "nuovi, o se un peggioramento va avanti per più giorni invece di migliorare."),
        bubbles: ["Con la febbre o un'infezione i sintomi della SM possono accentuarsi per qualche giorno. Vale la pena farsi sentire dal tuo medico."],
      };
    }
    // 5) Medication change request (never advise this)
    if (has(t, ["smetto", "smettere", "interrompo", "interrompere", "sospendo", "sospendere",
      "cambio terapia", "cambiare terapia", "cambio farmaco", "cambiare farmaco", "raddoppi", "doppia dose"])) {
      return {
        kind: "safe",
        bubbles: [
          "Capisco la domanda, ma <strong>la terapia non va modificata, sospesa o raddoppiata di tua iniziativa</strong>: " +
          "anche quando ci sono dubbi o effetti collaterali, è il tuo neurologo a decidere insieme a te.",
          "Posso aiutarti a <strong>preparare la domanda per la visita</strong>, oppure puoi contattare il Centro SM se la cosa è urgente.",
        ],
        safenote: "Informazione generale: non è una prescrizione.",
        addToVisit: "Vorrei parlare della mia terapia con il neurologo",
      };
    }
    // 6) Direct diagnosis / "is it serious" request
    if (has(t, ["ho una ricaduta", "sto avendo una ricaduta", "e una ricaduta", "e grave", "e preoccupante",
      "cosa ho", "che cosa ho", "cosa mi succede", "sto peggiorando", "sto andando peggio"])) {
      return {
        kind: "safe",
        bubbles: [
          "Non posso dirti se si tratta di una ricaduta o quanto sia grave — <strong>una valutazione del genere spetta al tuo neurologo</strong>, " +
          "che conosce la tua storia e può visitarti.",
          "Quello che possiamo fare insieme: <strong>annotare bene cosa stai notando</strong> (cosa, da quando, se peggiora) per la visita. " +
          "E se è un sintomo nuovo che dura oltre 24 ore, conviene contattare il Centro SM.",
        ],
        safenote: "Informazione generale: non è una diagnosi.",
        addToVisit: "Descrivere al neurologo i sintomi recenti",
      };
    }
    return null;
  }

  // ---- Topical knowledge base (safe, personalized) -------------------------------------
  function topical(t, ctx) {
    var name = ctx && ctx.firstName ? ctx.firstName : "";

    if (has(t, ["stanc", "fatica", "spossat", "esaust", "affatic", "senza energia", "energia a terra", "fiacc"])) {
      var fatPers = ctx && ctx.fatigueRising
        ? "Ho visto che nelle ultime settimane la stanchezza è un po' aumentata: è proprio una delle cose più utili da raccontare al neurologo."
        : "Se diventa più intensa del solito, è utile annotarlo per la visita.";
      return {
        kind: "safe",
        bubbles: [
          "La <strong>fatica</strong> è uno dei sintomi più comuni nella sclerosi multipla, e non dipende da quanto ti impegni: è reale.",
          "Qualche strategia che molte persone trovano utile:" +
          "<ul><li>distribuire le attività nella giornata (“pacing”) e fare brevi pause programmate;</li>" +
          "<li>tenere d'occhio sonno e idratazione, ed evitare il caldo intenso;</li>" +
          "<li>un'attività fisica leggera e regolare, nei limiti di come ti senti.</li></ul>",
          fatPers + " Se la stanchezza compare all'improvviso e si accompagna a sintomi nuovi, contatta il Centro SM.",
        ],
        safenote: "Consigli generali di auto-gestione, non sostituiscono il tuo team.",
        addToVisit: "Parlare della stanchezza (fatica) con il neurologo",
      };
    }

    if (has(t, ["caldo", "afa", "il sole", "temperatura", "estate", "uhthoff", "col caldo", "quando fa caldo"])) {
      var heatPers = ctx && ctx.hadHeatFlare
        ? "So che di recente una giornata calda ti aveva messa KO: è un'esperienza che molte persone con SM riferiscono. Se ti capita di nuovo, annota com'è andata e quanto è durata, così potrai parlarne alla visita."
        : "";
      return {
        kind: "safe",
        bubbles: [
          "Con il <strong>caldo</strong> i sintomi della SM possono accentuarsi per un po' (è il cosiddetto fenomeno di Uhthoff). " +
          "Spesso questo peggioramento è <strong>temporaneo</strong> e si attenua quando la temperatura corporea torna normale. " +
          "Capire però se si tratta di questo o di altro spetta al tuo team: non darlo per scontato da sola/o.",
          (heatPers ? heatPers + " " : "") + "Può aiutare: stare al fresco, bere fresco, una doccia tiepida, evitare gli sforzi nelle ore calde.",
          "Attenzione: se il peggioramento <strong>dura più di 24 ore</strong> nonostante ti sia rinfrescata/o, o se compaiono <strong>sintomi nuovi</strong>, " +
          "contatta il Centro SM.",
        ],
        safenote: "Informazione generale: non è una diagnosi.",
        addToVisit: "Riferire l'episodio di peggioramento con il caldo",
      };
    }

    if (has(t, ["dimenticat", "saltato la dose", "salto la dose", "non ho preso", "dose dimenticata", "scordato la"])) {
      var dmt = ctx && ctx.dmt ? ctx.dmt : "la tua terapia";
      return {
        kind: "safe",
        bubbles: [
          "Capita di dimenticare una dose. La regola generale è semplice: <strong>non raddoppiare</strong> per recuperare.",
          "Per indicazioni precise su come comportarti con " + dmt + ", fai riferimento al foglietto illustrativo o " +
          "chiedi al tuo Centro SM / farmacista.",
          "Se ti capita spesso, dimmelo: possiamo annotarlo per la visita e cercare insieme un promemoria che funzioni per te.",
        ],
        safenote: "Informazione generale: non è una prescrizione.",
        addToVisit: "Difficoltà a ricordare le dosi della terapia",
      };
    }

    if (has(t, ["effetti collaterali", "effetto collaterale", "rossore", "vampate", "nausea", "mal di pancia", "diarrea", "arrossament"])) {
      return {
        kind: "safe",
        bubbles: [
          "Alcuni effetti collaterali sono frequenti soprattutto all'inizio della terapia e spesso si attenuano col tempo.",
          "Annota cosa noti (quando, quanto dura): è utile per la visita. <strong>Non modificare la terapia da sola/o.</strong> " +
          "Se l'effetto è intenso, persistente o ti preoccupa, contatta il Centro SM.",
        ],
        safenote: "Informazione generale: non è una prescrizione.",
        addToVisit: "Segnalare un effetto collaterale della terapia",
      };
    }

    if (has(t, ["memoria", "concentr", "dimenticanze", "annebbiat", "nebbia", "le parole", "non mi vengono le parole", "testa annebbiata"])) {
      return {
        kind: "safe",
        bubbles: [
          "Le difficoltà di <strong>memoria e concentrazione</strong> sono comuni nella SM e sono influenzate anche da stanchezza, sonno e umore.",
          "Possono aiutare: liste e promemoria, fare una cosa alla volta, pause regolari, e curare il riposo.",
          "È importante parlarne al tuo neurologo: esistono valutazioni e supporti dedicati. Lo annoto per la visita?",
        ],
        safenote: "Consigli generali, non sostituiscono una valutazione cognitiva.",
        addToVisit: "Parlare di memoria/concentrazione con il neurologo",
      };
    }

    if (has(t, ["triste", "umore", "giu di morale", "sono giu", "ansia", "ansios", "depress", "piango", "demoralizz", "stress", "preoccupat"])) {
      return {
        kind: "safe",
        bubbles: [
          "Convivere con una malattia cronica può pesare sull'umore: quello che provi è comprensibile e <strong>non sei sola/o</strong>.",
          "Parlarne fa la differenza: il tuo team del Centro SM può aiutarti o indirizzarti a un supporto psicologico. " +
          "Anche piccole abitudini (movimento, sonno, contatti sociali) possono aiutare.",
          "Se ti senti sopraffatta/o o hai pensieri che ti spaventano, <strong>chiedi aiuto subito</strong> al tuo medico o ai servizi di emergenza.",
        ],
        safenote: "Supporto informativo, non sostituisce un aiuto professionale.",
        addToVisit: "Parlare di umore / benessere psicologico",
      };
    }

    if (has(t, ["sonno", "dormo", "insonnia", "dormire", "non riesco a dormire", "mi sveglio"])) {
      return {
        kind: "safe",
        bubbles: [
          "Un <strong>sonno</strong> disturbato peggiora stanchezza, umore e concentrazione, quindi prendersene cura aiuta molto.",
          "Qualche idea: orari regolari, ridurre schermi e caffeina la sera, una camera fresca e buia. " +
          "Se il problema persiste o c'è dolore/spasmi notturni, parlane al Centro SM.",
        ],
        safenote: "Consigli generali di igiene del sonno.",
        addToVisit: "Riferire i disturbi del sonno",
      };
    }

    if (has(t, ["sport", "esercizio", "attivit fisica", "palestra", "allenarmi", "camminare", "yoga", "fisioterapia",
      "dieta", "alimentazione", "mangiare", "cosa mangio", "fumo", "alcol", "vitamina d", "integratori"])) {
      return {
        kind: "safe",
        bubbles: [
          "Uno <strong>stile di vita attivo ed equilibrato</strong> fa bene nella SM: attività fisica regolare adattata a come ti senti, " +
          "alimentazione varia, niente fumo, alcol con moderazione.",
          "Evita però programmi “fai-da-te” intensi o integratori senza confronto: parlane con il tuo team, che può personalizzare i consigli " +
          "(ad esempio fisioterapia o riabilitazione dedicata).",
        ],
        safenote: "Consigli generali di benessere, non un piano medico.",
        addToVisit: "Chiedere consigli su attività fisica / stile di vita",
      };
    }

    if (has(t, ["preparar", "cosa dire alla visita", "cosa chiedere", "domande per il", "preparo la visita", "preparami la visita"])) {
      return {
        kind: "safe",
        bubbles: [
          "Ottima idea prepararsi! Nella scheda <strong>“Visita”</strong> ho già messo insieme un promemoria con quello che hai annotato " +
          "(stanchezza, terapia, l'episodio col caldo…) e alcune domande utili.",
          "Vuoi che aggiunga qualcosa in particolare alla lista per il neurologo?",
        ],
        safenote: null,
      };
    }

    if (has(t, ["appuntamento", "prenotaz", "quando e la visita", "prossima visita", "prossimo controllo", "quando devo fare", "esami del sangue", "risonanza quando", "ritiro referto"])) {
      return {
        kind: "safe",
        bubbles: [
          "Trovi <strong>appuntamenti ed esami</strong> nella scheda “Visita”. " +
          "Per prenotazioni, spostamenti o referti, la segreteria del tuo Centro SM è il riferimento giusto.",
        ],
        safenote: null,
      };
    }

    if (has(t, ["cos'e la sclerosi", "cos e la sm", "che cos e la sm", "cosa e la sclerosi", "ricaduta cosa", "cosa e una ricaduta",
      "cos e la risonanza", "a cosa serve la risonanza", "nfl", "neurofilament", "cos e nfl"])) {
      return {
        kind: "safe",
        bubbles: [
          "Posso darti informazioni <strong>generali e affidabili</strong>: la sclerosi multipla è una malattia del sistema nervoso centrale " +
          "in cui l'infiammazione danneggia la guaina dei nervi; il decorso e i sintomi variano molto da persona a persona.",
          "Per qualcosa che riguarda <strong>il tuo caso specifico</strong> (i tuoi esami, la tua terapia, i tuoi sintomi) la persona giusta è il tuo neurologo. " +
          "Vuoi che prepari la domanda per la visita?",
        ],
        safenote: "Informazione educativa generale.",
      };
    }

    if (has(t, ["ciao", "buongiorno", "buonasera", "salve", "hey"])) {
      return { kind: "safe", bubbles: ["Ciao" + (name ? " " + name : "") + "! Come posso aiutarti oggi? Puoi chiedermi della stanchezza, della terapia, del caldo, o farti aiutare a preparare la visita."] };
    }
    if (has(t, ["grazie", "ok grazie", "perfetto grazie"])) {
      return { kind: "safe", bubbles: ["Figurati, sono qui quando ti serve. Ricorda: per qualsiasi cosa nuova o che ti preoccupa, il tuo Centro SM è sempre il riferimento."] };
    }
    return null;
  }

  function fallback() {
    return {
      kind: "fallback",
      bubbles: [
        "Su questo preferisco non rispondere a caso: <strong>la tua sicurezza viene prima</strong>.",
        "Posso aiutarti con informazioni generali (stanchezza, sonno, caldo, terapia, preparazione alla visita). " +
        "Per il resto, <strong>lo annoto per il tuo neurologo</strong> — e se è urgente, contatta il Centro SM.",
      ],
      safenote: "Non sono un medico e non fornisco diagnosi.",
      addToVisit: "Domanda da rivolgere al neurologo",
    };
  }

  // ---- Public: respond ------------------------------------------------------------------
  function respond(text, ctx) {
    var t = norm(text);
    if (!t) return { kind: "safe", bubbles: ["Dimmi pure, ti ascolto."] };
    return classifySafety(t) || topical(t, ctx) || fallback();
  }

  // Optional live answer (only if the local proxy is reachable). Heavily constrained
  // patient-safe prompt lives server-side (app/prompts/patient_assistant_prompt.md).
  function liveAnswer(text, ctx) {
    if (!global.Copilot || !global.Copilot.state || !global.Copilot.state.live || !global.fetch) {
      return Promise.resolve(null);
    }
    var ctrl = new AbortController();
    var tm = setTimeout(function () { ctrl.abort(); }, 20000);
    return fetch("/api/llm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "patient_chat", message: text, ctx: ctx || {} }),
      signal: ctrl.signal,
    }).then(function (r) { clearTimeout(tm); return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.text ? j.text : null; })
      .catch(function () { clearTimeout(tm); return null; });
  }

  var SUGGESTIONS = [
    "Mi sento molto stanca", "Peggioro con il caldo", "Ho dimenticato una dose",
    "Ho problemi di memoria", "Aiutami a preparare la visita", "Quando devo preoccuparmi?",
  ];

  var LIMITS = {
    title: "Cosa posso (e non posso) fare",
    can: [
      "Darti informazioni generali e affidabili sulla SM e sulla gestione quotidiana.",
      "Aiutarti ad annotare sintomi e preparare le domande per la visita.",
      "Ricordarti quando è meglio contattare il tuo Centro SM.",
    ],
    cannot: [
      "Fare diagnosi o dirti se stai avendo una ricaduta.",
      "Prescrivere o modificare la tua terapia.",
      "Sostituire il tuo neurologo o gestire le emergenze.",
    ],
  };

  global.PatientChat = {
    respond: respond, liveAnswer: liveAnswer,
    suggestions: SUGGESTIONS, LIMITS: LIMITS,
  };
})(window);

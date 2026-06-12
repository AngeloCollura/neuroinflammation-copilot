/*
 * app.js - UI controller for the NeuroInflammation Copilot (vanilla JS, no framework).
 *
 * Responsibilities: hash routing, panel (prioritized list + "why"), patient detail
 * (timeline, sparklines, wearable biomarkers), copilot outputs (summary/letter/
 * instructions with clinician sign-off), governance modal + audit trail.
 *
 * All data is local (window.MS_DATA). Risk is computed live by RiskEngine. Outputs come
 * from Copilot (live LLM -> curated -> template). The clinician stays in the loop.
 */

(function () {
  "use strict";

  var DATA = window.MS_DATA;
  var R = window.RiskEngine, T = window.Templates, C = window.Copilot, H = window.RiskEngine.helpers;

  // ---- App state ----------------------------------------------------------------------
  var STATE = {
    user: { name: "Dr. Demo", initials: "DD", role: "Neurologo" },
    filter: "all",
    search: "",
    audit: [],
    outputs: {},   // key `${id}|${kind}` -> { markdown, mode, model, signed }
    whyOpen: {},   // panel: which rows have the "why" panel open
  };

  // Precompute risk for every patient once.
  var RISK = {};
  DATA.patients.forEach(function (p) { RISK[p.id] = R.computeRisk(p); });

  // Stable priority order (desc by score, then name).
  var ORDER = DATA.patients.slice().sort(function (a, b) {
    var d = RISK[b.id].score - RISK[a.id].score;
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });

  // ---- Tiny DOM helpers ---------------------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function")
        n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var CAT_CLASS = {
    "Attività": "cat-Attivita", "Progressione": "cat-Progressione", "Terapia": "cat-Terapia",
    "Sintomi invisibili": "cat-Sintomi", "Aderenza": "cat-Aderenza", "Monitoraggio": "cat-Monitoraggio",
  };
  function fmtDate(iso) { return T.fmtDate(iso); }

  // ---- Minimal Markdown -> HTML (input escaped first; safe for LLM output) -------------
  function inline(s) {
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return s;
  }
  function mdToHtml(md) {
    var lines = md.split("\n");
    var out = [], i = 0;
    function flushList(buf) { if (buf.length) out.push("<ul>" + buf.join("") + "</ul>"); }
    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();
      if (t === "") { i++; continue; }
      if (t === "---") { out.push("<hr/>"); i++; continue; }
      if (t.slice(0, 4) === "### ") { out.push("<h3>" + inline(esc(t.slice(4))) + "</h3>"); i++; continue; }
      if (t.slice(0, 3) === "## ") { out.push("<h2>" + inline(esc(t.slice(3))) + "</h2>"); i++; continue; }
      if (t.slice(0, 2) === "# ") { out.push("<h1>" + inline(esc(t.slice(2))) + "</h1>"); i++; continue; }
      if (t.slice(0, 2) === "> ") {
        var q = [];
        while (i < lines.length && lines[i].trim().slice(0, 2) === "> ") { q.push(inline(esc(lines[i].trim().slice(2)))); i++; }
        out.push("<blockquote>" + q.join(" ") + "</blockquote>");
        continue;
      }
      if (t.slice(0, 2) === "- ") {
        var buf = [];
        while (i < lines.length && lines[i].trim().slice(0, 2) === "- ") { buf.push("<li>" + inline(esc(lines[i].trim().slice(2))) + "</li>"); i++; }
        flushList(buf);
        continue;
      }
      // paragraph (may be emphasis-only meta line)
      var cls = (t.slice(0, 1) === "*" && t.slice(-1) === "*") ? ' class="meta-line"' : "";
      out.push("<p" + cls + ">" + inline(esc(t)) + "</p>");
      i++;
    }
    return out.join("\n");
  }

  // ---- Sparkline (inline SVG) ----------------------------------------------------------
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.w || 150, h = opts.h || 38, pad = 4;
    var ref = (opts.ref !== undefined && opts.ref !== null) ? opts.ref : null;
    var vals = values.slice();
    var domain = vals.slice();
    if (ref !== null) domain.push(ref);
    var min = Math.min.apply(null, domain), max = Math.max.apply(null, domain);
    if (max - min < 1e-9) { max = min + 1; }
    function x(i) { return pad + (w - 2 * pad) * (vals.length === 1 ? 0.5 : i / (vals.length - 1)); }
    function y(v) { return h - pad - (h - 2 * pad) * (v - min) / (max - min); }
    var color = opts.bad ? "var(--risk-high)" : (opts.good ? "var(--risk-low)" : "var(--primary)");
    var pts = vals.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-hidden="true">';
    if (ref !== null) {
      var ry = y(ref).toFixed(1);
      svg += '<line x1="' + pad + '" y1="' + ry + '" x2="' + (w - pad) + '" y2="' + ry +
        '" stroke="var(--muted-2)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>';
    }
    svg += '<polyline fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/>';
    var lx = x(vals.length - 1).toFixed(1), ly = y(vals[vals.length - 1]).toFixed(1);
    svg += '<circle cx="' + lx + '" cy="' + ly + '" r="2.6" fill="' + color + '"/>';
    svg += "</svg>";
    return svg;
  }

  // ---- Severity dot -------------------------------------------------------------------
  function sevDot(sev) { return el("span", { class: "sev s-" + sev }); }

  // ====================================================================================
  // PANEL VIEW
  // ====================================================================================
  function cohortStats() {
    var c = { alta: 0, media: 0, bassa: 0, neda: 0 };
    DATA.patients.forEach(function (p) {
      var r = RISK[p.id]; c[r.level]++; if (r.neda) c.neda++;
    });
    var row = el("div", { class: "cohort" });
    [["Totale", DATA.patients.length, ""], ["Priorità alta", c.alta, "high"],
     ["Priorità media", c.media, "med"], ["Priorità bassa", c.bassa, "low"],
     ["NEDA-3 (stabili)", c.neda, "neda"]].forEach(function (s) {
      row.appendChild(el("div", { class: "stat " + s[2] }, [
        el("div", { class: "n" }, [String(s[1])]),
        el("div", { class: "l" }, [s[0]]),
      ]));
    });
    return row;
  }

  var FILTERS = [
    ["all", "Tutti"], ["disease_activity", "Attività"], ["pira_smouldering", "PIRA / progressione"],
    ["suboptimal", "Subottimale"], ["invisible_symptoms", "Sintomi invisibili"],
    ["adherence", "Aderenza"], ["monitoring", "Monitoraggio"], ["neda", "NEDA / stabili"],
  ];

  function toolbar() {
    var bar = el("div", { class: "toolbar" });
    var search = el("input", {
      type: "search", placeholder: "Cerca paziente…", value: STATE.search,
      "aria-label": "Cerca paziente",
      oninput: function (e) { STATE.search = e.target.value; renderPanel(); },
    });
    bar.appendChild(search);
    FILTERS.forEach(function (f) {
      bar.appendChild(el("button", {
        class: "chip-filter" + (STATE.filter === f[0] ? " active" : ""),
        onclick: function () { STATE.filter = f[0]; renderPanel(); },
      }, [f[1]]));
    });
    return bar;
  }

  function matchesFilter(p, r) {
    if (STATE.search) {
      var q = STATE.search.toLowerCase();
      if (p.name.toLowerCase().indexOf(q) < 0 && p.id.toLowerCase().indexOf(q) < 0 &&
        p.ms_type.toLowerCase().indexOf(q) < 0) return false;
    }
    if (STATE.filter === "all") return true;
    if (STATE.filter === "neda") return r.neda || r.level === "bassa";
    return r.flags.some(function (fl) { return fl.key === STATE.filter; });
  }

  function flagChip(fl) {
    return el("span", { class: "flag " + (CAT_CLASS[fl.category] || ""), title: fl.factors[0] || fl.label }, [
      sevDot(fl.severity), fl.label,
    ]);
  }

  function patientCard(p, rank) {
    var r = RISK[p.id];
    var card = el("div", {
      class: "pcard lvl-" + r.level, tabindex: "0", role: "button",
      "aria-label": "Apri scheda di " + p.name,
      onclick: function (e) { if (e.target.closest(".why-toggle")) return; go("#/patient/" + p.id); },
      onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("#/patient/" + p.id); } },
    });
    card.appendChild(el("div", { class: "rank" }, [String(rank)]));

    var main = el("div", { class: "pmain" });
    main.appendChild(el("div", { class: "pname" }, [p.name]));
    var dmt = p.current_dmt.klass === "nessuno" ? "no DMT" :
      (p.current_dmt.drug + " · " + p.current_dmt.months_on_dmt + "m");
    main.appendChild(el("div", { class: "pmeta", html:
      p.age + " anni · " + (p.sex === "F" ? "F" : "M") + ' <span class="dot">·</span> ' +
      esc(p.ms_type) + ' <span class="dot">·</span> ' + p.disease_duration_years + " anni" +
      ' <span class="dot">·</span> ' + esc(dmt) }));
    var flags = el("div", { class: "flags" });
    if (r.flags.length) r.flags.forEach(function (fl) { flags.appendChild(flagChip(fl)); });
    else flags.appendChild(el("span", { class: "flag cat-Monitoraggio" }, [r.neda ? "NEDA-3 · stabile" : "Stabile"]));
    main.appendChild(flags);
    card.appendChild(main);

    var right = el("div", { class: "pright" });
    if (r.neda) right.appendChild(el("span", { class: "neda-badge" }, ["NEDA-3"]));
    right.appendChild(el("span", { class: "level-badge " + r.level }, ["Priorità " + r.level]));
    right.appendChild(el("span", { class: "score-pill", html: "punteggio <b>" + r.score + "</b>" }));
    if (r.flags.length) {
      var open = !!STATE.whyOpen[p.id];
      right.appendChild(el("button", {
        class: "why-toggle", "aria-expanded": String(open),
        onclick: function () { STATE.whyOpen[p.id] = !STATE.whyOpen[p.id]; renderPanel(); },
      }, [open ? "Nascondi perché ▲" : "Perché? ▼"]));
    }
    card.appendChild(right);

    if (STATE.whyOpen[p.id] && r.flags.length) {
      var why = el("div", { class: "why-panel open" });
      why.appendChild(el("h4", {}, ["Perché è prioritario — fattori che hanno generato i flag"]));
      r.flags.forEach(function (fl) {
        var wf = el("div", { class: "why-flag" });
        wf.appendChild(el("div", { class: "wf-head" }, [sevDot(fl.severity), fl.label]));
        var ul = el("ul");
        fl.factors.forEach(function (fc) { ul.appendChild(el("li", {}, [fc])); });
        wf.appendChild(ul);
        why.appendChild(wf);
      });
      if (r.insights.length) {
        r.insights.forEach(function (ins) {
          why.appendChild(el("div", { class: "why-flag" }, [
            el("div", { class: "wf-head" }, ["💡 " + ins.title]),
            el("ul", {}, [el("li", {}, [ins.detail])]),
          ]));
        });
      }
      card.appendChild(why);
    }
    return card;
  }

  function renderPanel() {
    location.hash = location.hash && location.hash.indexOf("/patient/") >= 0 ? "#/panel" : (location.hash || "#/panel");
    var view = document.getElementById("view");
    clear(view);

    var head = el("div", { class: "page-head" }, [
      el("div", {}, [
        el("h2", {}, ["Pannello pazienti"]),
        el("div", { class: "lead" }, ["Coorte SM ordinata per priorità di rischio. Ogni flag è spiegabile: apri “Perché?” per i fattori."]),
      ]),
    ]);
    view.appendChild(head);
    view.appendChild(cohortStats());
    view.appendChild(toolbar());

    var list = el("div", { class: "plist" });
    var rank = 0, shown = 0;
    ORDER.forEach(function (p) {
      rank++;
      var r = RISK[p.id];
      if (!matchesFilter(p, r)) return;
      shown++;
      list.appendChild(patientCard(p, rank));
    });
    if (shown === 0) list.appendChild(el("div", { class: "empty" }, ["Nessun paziente corrisponde al filtro."]));
    view.appendChild(list);
    document.getElementById("foot-meta").textContent =
      DATA.meta.n_patients + " pazienti sintetici · seed " + DATA.meta.seed;
    window.scrollTo(0, 0);
  }

  // ====================================================================================
  // PATIENT DETAIL VIEW
  // ====================================================================================
  function trendCard(name, series, opts) {
    opts = opts || {};
    if (!series || !series.length) return null;
    var vals = series.map(function (x) { return x.value; });
    var latest = vals[vals.length - 1];
    var base = (vals.slice(0, 2).reduce(function (s, x) { return s + x; }, 0)) / Math.min(2, vals.length);
    var recent = H.recentMean(series, 2);
    var delta = recent - base;
    var worseUp = opts.worseUp; // true: up is bad
    var bad = false, good = false, cls = "flat", arrow = "→";
    if (Math.abs(delta) >= (opts.eps || 0.5)) {
      arrow = delta > 0 ? "↑" : "↓";
      var worsening = worseUp ? delta > 0 : delta < 0;
      bad = worsening; good = !worsening;
      cls = bad ? (delta > 0 ? "up-bad" : "down-bad") : "good";
    }
    var ref = opts.ref;
    var refBad = (ref !== undefined && ref !== null) && (worseUp ? latest > ref : latest < ref);
    var card = el("div", { class: "trend" });
    var top = el("div", { class: "t-top" }, [
      el("span", { class: "t-name" }, [name]),
      el("span", { class: "t-delta " + cls }, [arrow + " " + (delta >= 0 ? "+" : "") + (Math.round(delta * 10) / 10)]),
    ]);
    card.appendChild(top);
    card.appendChild(el("div", { class: "t-val", html: H.fmt(latest, opts.dec === undefined ? 1 : opts.dec) +
      (opts.unit ? ' <span class="unit">' + esc(opts.unit) + "</span>" : "") }));
    card.appendChild(el("div", { class: "spark", html: sparkline(vals, { ref: ref, bad: bad || refBad, good: good && !refBad }) }));
    if (ref !== undefined && ref !== null) {
      card.appendChild(el("div", { class: "t-ref" }, ["soglia per età " + H.fmt(ref, opts.dec === undefined ? 1 : opts.dec) +
        (refBad ? " · sopra soglia" : "")]));
    } else if (opts.note) {
      card.appendChild(el("div", { class: "t-ref" }, [opts.note]));
    }
    return card;
  }

  function trendsCard(p) {
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("activity"), el("h3", {}, ["Andamento clinico e biomarcatori"]),
      el("span", { class: "hint" }, ["trend sulle ultime valutazioni"]),
    ]));
    var body = el("div", { class: "card-body" });
    var grid = el("div", { class: "trend-grid" });
    var tl = p.timeline;
    [
      trendCard("EDSS", tl.edss, { worseUp: true, eps: 0.4, dec: 1 }),
      trendCard("NfL (pg/mL)", tl.nfl, { worseUp: true, eps: 1.0, dec: 1, ref: p.nfl_url }),
      trendCard("GFAP (pg/mL)", tl.gfap, { worseUp: true, eps: 5, dec: 0, ref: p.gfap_url }),
      trendCard("SDMT (cognizione)", tl.sdmt, { worseUp: false, eps: 3, dec: 0, note: "più basso = peggiore" }),
      trendCard("MFIS (fatica)", tl.mfis, { worseUp: true, eps: 4, dec: 0, note: "più alto = peggiore" }),
      trendCard("PHQ-9 (umore)", tl.phq9, { worseUp: true, eps: 3, dec: 0 }),
    ].forEach(function (c) { if (c) grid.appendChild(c); });
    body.appendChild(grid);
    card.appendChild(body);
    return card;
  }

  function wearableCard(p) {
    var w = p.timeline.wearable;
    if (!w || !w.length) return null;
    var steps = w.map(function (x) { return { value: x.steps }; });
    var gait = w.map(function (x) { return { value: x.gait_speed_ms }; });
    var sleep = w.map(function (x) { return { value: x.sleep_hours }; });
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("watch"), el("h3", {}, ["Biomarcatori digitali (wearable)"]),
      el("span", { class: "hint" }, ["monitoraggio passivo · ultime settimane"]),
    ]));
    var body = el("div", { class: "card-body" });
    var grid = el("div", { class: "wear-grid" });
    grid.appendChild(trendCard("Passi/giorno", steps, { worseUp: false, eps: 300, dec: 0 }));
    grid.appendChild(trendCard("Cammino (m/s)", gait, { worseUp: false, eps: 0.03, dec: 2 }));
    grid.appendChild(trendCard("Sonno (h)", sleep, { worseUp: false, eps: 0.3, dec: 1 }));
    body.appendChild(grid);
    card.appendChild(body);
    return card;
  }

  function buildTimeline(p) {
    var ev = [];
    (p.timeline.relapses || []).forEach(function (r) {
      var pseudo = r.type !== "relapse";
      ev.push({
        date: r.date, kind: pseudo ? "pseudo" : "relapse",
        title: pseudo ? "Sospetta pseudo-ricaduta" : "Ricaduta clinica",
        desc: (r.severity ? r.severity + " · " : "") + (r.trigger && r.trigger !== "nessuno" ? "trigger: " + r.trigger + " · " : "") +
          "recupero " + r.recovery + (r.note ? " — " + r.note : ""),
      });
    });
    (p.timeline.mri || []).forEach(function (m) {
      var bits = [];
      if (m.new_t2 > 0) bits.push(m.new_t2 + " nuova/e T2");
      if (m.enlarging_t2 > 0) bits.push(m.enlarging_t2 + " T2 ingrandita/e");
      if (m.gad_enhancing > 0) bits.push(m.gad_enhancing + " captante/i Gd");
      if (m.prl > 0) bits.push(m.prl + " PRL");
      var act = bits.length ? bits.join(", ") : "nessuna nuova lesione";
      ev.push({ date: m.date, kind: "mri", title: "RMN encefalo", desc: act + " · atrofia: " + m.atrophy });
    });
    (p.timeline.dmt_changes || []).forEach(function (d) {
      ev.push({ date: d.date, kind: "dmt", title: "Terapia: " + (d.event || "modifica"),
        desc: (d.to || "") + (d.note ? " — " + d.note : "") });
    });
    ev.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return ev;
  }

  function timelineCard(p) {
    var ev = buildTimeline(p);
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("timeline"), el("h3", {}, ["Timeline longitudinale"]),
      el("span", { class: "hint" }, ["ricadute · RMN · cambi terapia"]),
    ]));
    var body = el("div", { class: "card-body" });
    var tl = el("div", { class: "timeline" });
    ev.slice(0, 9).forEach(function (e) {
      var item = el("div", { class: "tl-item ev-" + e.kind });
      item.appendChild(el("div", { class: "tl-date" }, [fmtDate(e.date)]));
      var b = el("div", { class: "tl-body" });
      var tagClass = e.kind;
      var tagText = { relapse: "Ricaduta", pseudo: "Pseudo", mri: "RMN", dmt: "DMT" }[e.kind];
      b.appendChild(el("div", {}, [
        el("span", { class: "tl-tag " + tagClass }, [tagText]),
        el("span", { class: "tl-ev-title" }, [e.title]),
      ]));
      b.appendChild(el("div", { class: "tl-ev-desc" }, [e.desc]));
      item.appendChild(b);
      tl.appendChild(item);
    });
    body.appendChild(tl);
    card.appendChild(body);
    return card;
  }

  function whyCard(p) {
    var r = RISK[p.id];
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("flag"), el("h3", {}, ["Perché è prioritario"]),
      el("span", { class: "hint" }, ["risk stratification trasparente"]),
    ]));
    var body = el("div", { class: "card-body why-detail" });

    r.insights.forEach(function (ins) {
      body.appendChild(el("div", { class: "insight" }, [
        iconRaw("info"),
        el("div", {}, [el("div", { class: "it" }, [ins.title]), el("div", { class: "id" }, [ins.detail])]),
      ]));
    });

    if (!r.flags.length) {
      body.appendChild(el("div", { class: "empty" }, [
        r.neda ? "Nessun flag attivo: quadro coerente con NEDA-3 (stabile)." :
          "Nessun flag attivo: quadro sostanzialmente stabile.",
      ]));
    } else {
      r.flags.forEach(function (fl) {
        var wf = el("div", { class: "wf" });
        wf.appendChild(el("div", { class: "wf-title" }, [
          el("span", { class: "lbl" }, [el("span", { class: "sev-dot sev s-" + fl.severity }), fl.label]),
          el("span", { class: "wf-pts" }, ["+" + fl.points + " · gravità " + fl.severity]),
        ]));
        var det = el("div", { class: "wf-detail" });
        var ul = el("ul");
        fl.factors.forEach(function (fc) { ul.appendChild(el("li", {}, [fc])); });
        det.appendChild(ul);
        wf.appendChild(det);
        body.appendChild(wf);
      });
    }
    card.appendChild(body);
    return card;
  }

  function monitoringCard(p) {
    var card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("shield"), el("h3", {}, ["Aderenza & monitoraggio"]),
    ]));
    var body = el("div", { class: "card-body" });
    var a = p.adherence;
    body.appendChild(el("div", { html:
      "<b>Aderenza stimata:</b> " + a.recent_pct + "% (" + esc(a.trend) + ")" +
      (a.missed_doses_90d ? " · " + a.missed_doses_90d + " dosi mancate/90gg" : "") +
      (a.refill_gap_days ? " · gap rifornimenti " + a.refill_gap_days + "gg" : ""), class: "muted" }));
    var listWrap = el("div", { style: "margin-top:8px" });
    (p.monitoring || []).forEach(function (m) {
      listWrap.appendChild(el("div", { class: "mon-item" }, [
        el("span", { class: "mon-status " + m.status }, [m.status === "in_scadenza" ? "in scad." : m.status]),
        el("span", { class: "mon-name" }, [m.item]),
        el("span", { class: "mon-date" }, ["atteso " + fmtDate(m.due_date)]),
      ]));
    });
    body.appendChild(listWrap);
    card.appendChild(body);
    return card;
  }

  // ---- Copilot output card (summary / letter / instructions) --------------------------
  var KINDS = { summary: "Visit summary pre-visita", letter: "Bozza lettera / relazione", instructions: "Istruzioni post-visita" };

  function outputCard(p) {
    var card = el("div", { class: "card no-print" });
    card.appendChild(el("div", { class: "card-head" }, [
      icon("doc"), el("h3", {}, ["Copilot — output pre-visita"]),
      el("span", { class: "hint" }, ["bozze AI, sempre validate dal clinico"]),
    ]));
    var body = el("div", { class: "card-body" });
    var actions = el("div", { class: "action-row" });
    actions.appendChild(el("button", { class: "btn", id: "btn-summary",
      onclick: function () { genOutput(p, "summary"); } }, [iconRaw("spark"), "Genera visit summary"]));
    actions.appendChild(el("button", { class: "btn secondary", id: "btn-letter",
      onclick: function () { genOutput(p, "letter"); } }, [iconRaw("pen"), "Bozza lettera"]));
    actions.appendChild(el("button", { class: "btn subtle", id: "btn-instructions",
      onclick: function () { genOutput(p, "instructions"); } }, ["Istruzioni post-visita"]));
    body.appendChild(actions);
    body.appendChild(el("div", { id: "output-mount" }));
    card.appendChild(body);
    return card;
  }

  function genOutput(p, kind) {
    var mount = document.getElementById("output-mount");
    clear(mount);
    var btn = document.getElementById("btn-" + kind);
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generazione…'; }
    mount.appendChild(el("div", { class: "muted", style: "padding:14px 2px", html:
      '<span class="spinner" style="border-color:rgba(17,94,117,.25);border-top-color:var(--primary)"></span> Il copilot sta preparando la bozza…' }));

    C.generate(p, RISK[p.id], kind).then(function (out) {
      STATE.outputs[p.id + "|" + kind] = { markdown: out.markdown, mode: out.mode, model: out.model, signed: false };
      audit("Generato: " + KINDS[kind], p, out.mode);
      if (btn) { btn.disabled = false; btn.textContent = label; }
      renderOutput(p, kind);
    });
  }

  function renderOutput(p, kind) {
    var mount = document.getElementById("output-mount");
    if (!mount) return;
    clear(mount);
    var key = p.id + "|" + kind;
    var out = STATE.outputs[key];
    if (!out) return;

    var modeLabel = { live: "LLM live", fallback: "Fallback curato (offline)", template: "Generato da dati (offline)" }[out.mode];
    var panel = el("div", { class: "output" });
    panel.appendChild(el("div", { class: "sign-banner" }, [
      iconRaw("sign"),
      el("div", {}, [
        el("div", { class: "sb-t" }, ["DA RIVEDERE E FIRMARE DAL CLINICO"]),
        el("div", { class: "sb-s" }, ["Bozza generata dall'AI a supporto della decisione. Non valida senza revisione e firma del medico."]),
      ]),
    ]));
    var meta = el("div", { class: "output-meta" });
    meta.appendChild(el("span", {}, [KINDS[kind]]));
    meta.appendChild(el("span", { class: "mode " + out.mode }, [modeLabel + (out.model ? " · " + out.model : "")]));
    meta.appendChild(el("span", {}, ["Autore bozza: copilot · Validazione: " + (out.signed ? "firmata da " + STATE.user.name : "in attesa del clinico")]));
    panel.appendChild(meta);

    var bodyWrap = el("div", { class: "output-body" });
    var md = el("div", { class: "md", html: mdToHtml(out.markdown) });
    bodyWrap.appendChild(md);
    if (out.signed) {
      bodyWrap.appendChild(el("div", { class: "signed-stamp" }, [
        iconRaw("check"), "Validato e firmato da " + STATE.user.name + " (" + STATE.user.role + ") — " + out.signedAt,
      ]));
    }
    panel.appendChild(bodyWrap);

    var acts = el("div", { class: "output-actions no-print" });
    if (!out.signed) {
      acts.appendChild(el("button", { class: "btn",
        onclick: function () { signOutput(p, kind); } }, [iconRaw("check"), "Valida e firma"]));
    }
    acts.appendChild(el("button", { class: "btn subtle",
      onclick: function (e) { copyText(out.markdown, e.target.closest("button")); } }, ["Copia testo"]));
    acts.appendChild(el("button", { class: "btn subtle", onclick: function () { window.print(); } }, ["Stampa / PDF"]));
    panel.appendChild(acts);

    mount.appendChild(panel);
  }

  function signOutput(p, kind) {
    var out = STATE.outputs[p.id + "|" + kind];
    if (!out) return;
    out.signed = true;
    out.signedAt = nowStr();
    audit("Validato e firmato: " + KINDS[kind], p, null);
    renderOutput(p, kind);
  }

  function copyText(text, btn) {
    function done() { if (btn) { var t = btn.textContent; btn.textContent = "Copiato ✓"; setTimeout(function () { btn.textContent = t; }, 1200); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  }

  // ---- Detail view assembly -----------------------------------------------------------
  function detailHead(p) {
    var r = RISK[p.id];
    var head = el("div", { class: "detail-head" });
    var left = el("div", {});
    left.appendChild(el("h1", { class: "dh-name" }, [p.name]));
    left.appendChild(el("div", { class: "dh-meta", html:
      p.age + " anni · " + (p.sex === "F" ? "donna" : "uomo") + ' <span class="dot">·</span> ' +
      esc(p.ms_type) + ' <span class="dot">·</span> malattia da ' + p.disease_duration_years + " anni" +
      ' <span class="dot">·</span> ' + esc(p.id) }));
    var tags = el("div", { class: "dh-tags" });
    var dmt = p.current_dmt;
    tags.appendChild(el("span", { class: "dh-tag", html: dmt.klass === "nessuno" ? "<b>Nessuna DMT</b>" :
      "DMT: <b>" + esc(dmt.drug) + "</b> (" + dmt.months_on_dmt + " mesi, " + esc(dmt.klass) + ")" }));
    tags.appendChild(el("span", { class: "dh-tag", html: "Aderenza: <b>" + p.adherence.recent_pct + "%</b>" }));
    var nfl = p.timeline.nfl[p.timeline.nfl.length - 1];
    tags.appendChild(el("span", { class: "dh-tag", html: "NfL: <b>" + H.fmt(nfl.value) + "</b>/" + H.fmt(nfl.url) + " pg/mL" }));
    if (r.neda) tags.appendChild(el("span", { class: "dh-tag", html: "<b>NEDA-3</b>" }));
    left.appendChild(tags);
    head.appendChild(left);

    var right = el("div", { class: "dh-right" });
    right.appendChild(el("div", { class: "level-badge " + r.level, style: "display:inline-block;margin-bottom:8px" }, ["Priorità " + r.level]));
    right.appendChild(el("div", { class: "dh-score" }, [String(r.score)]));
    right.appendChild(el("div", { class: "dh-score-l" }, ["punteggio priorità"]));
    head.appendChild(right);
    return head;
  }

  function renderDetail(id) {
    var p = DATA.patients.filter(function (x) { return x.id === id; })[0];
    if (!p) { go("#/panel"); return; }
    var view = document.getElementById("view");
    clear(view);

    view.appendChild(el("button", { class: "back-link", onclick: function () { go("#/panel"); } },
      [iconRaw("back"), "Torna al pannello"]));
    view.appendChild(detailHead(p));

    var grid = el("div", { class: "detail-grid" });
    var col1 = el("div", { class: "col-main" });
    col1.appendChild(whyCard(p));
    col1.appendChild(trendsCard(p));
    var wc = wearableCard(p); if (wc) col1.appendChild(wc);
    col1.appendChild(timelineCard(p));
    grid.appendChild(col1);

    var col2 = el("div", { class: "col-right" });
    col2.appendChild(outputCard(p));
    col2.appendChild(monitoringCard(p));
    col2.appendChild(governanceMiniCard());
    grid.appendChild(col2);

    view.appendChild(grid);
    document.getElementById("foot-meta").textContent = "Scheda " + p.id + " · dati sintetici";
    window.scrollTo(0, 0);
  }

  function governanceMiniCard() {
    var card = el("div", { class: "card no-print" });
    card.appendChild(el("div", { class: "card-head" }, [icon("shield"), el("h3", {}, ["Governance"])]));
    var body = el("div", { class: "card-body" });
    body.appendChild(el("div", { class: "muted", html:
      "Supporto decisionale (CDS), <b>non</b> diagnosi autonoma. Output sempre validati dal clinico. Dati 100% sintetici." }));
    body.appendChild(el("div", { style: "margin-top:10px" }, [
      el("button", { class: "btn subtle", onclick: openGovernance }, ["Intended use & audit trail"]),
    ]));
    card.appendChild(body);
    return card;
  }

  // ====================================================================================
  // GOVERNANCE MODAL + AUDIT
  // ====================================================================================
  function nowStr() {
    var d = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function audit(action, p, mode) {
    STATE.audit.unshift({ ts: nowStr(), actor: STATE.user.name, action: action,
      target: p ? p.name + " (" + p.id + ")" : "-", mode: mode || "" });
  }

  function openGovernance() {
    var body = document.getElementById("modal-body");
    clear(body);
    body.appendChild(el("h4", {}, ["Intended use"]));
    body.appendChild(el("p", {}, ["NeuroInflammation Copilot è uno strumento di supporto decisionale (Clinical Decision Support) " +
      "per il neurologo e il team multidisciplinare nella gestione della SM e delle malattie neuroinfiammatorie. " +
      "Aiuta a prioritizzare i pazienti, sintetizzare i dati e proporre azioni di follow-up. Non formula diagnosi autonome."]));

    body.appendChild(el("h4", {}, ["La decisione resta al clinico"]));
    body.appendChild(el("p", {}, ["Ogni flag è generato da regole trasparenti e mostra i fattori che lo determinano. " +
      "Ogni output (summary, lettera, istruzioni) è una bozza da rivedere e firmare. Il copilot non avvia azioni in autonomia."]));

    body.appendChild(el("h4", {}, ["Classificazione regolatoria preliminare"]));
    body.appendChild(el("ul", {}, [
      el("li", { html: "Profilo: <b>Clinical Decision Support</b> con uomo-nel-loop (non dispositivo diagnostico autonomo)." }),
      el("li", { html: "In uno sviluppo reale: valutazione come <b>software medical device</b>, intended use formale, validazione clinica e percorso regolatorio/CE." }),
    ]));

    body.appendChild(el("h4", {}, ["Dati & privacy"]));
    body.appendChild(el("ul", {}, [
      el("li", { html: "Dati <b>100% sintetici</b> generati con seed riproducibile (" + DATA.meta.seed + "). Nessun dato reale di pazienti." }),
      el("li", { html: "In produzione: pseudonimizzazione, base giuridica e minimizzazione (GDPR), cifratura, controllo accessi (RBAC), audit trail server-side." }),
      el("li", { html: "Modalità LLM live opzionale e <b>off di default</b>: la demo funziona offline con riassunti pre-generati." }),
    ]));

    body.appendChild(el("h4", {}, ["Disclaimer"]));
    body.appendChild(el("p", { html: "<b>Prototipo dimostrativo — NON destinato all'uso clinico.</b> Le performance cliniche non sono validate." }));

    body.appendChild(el("h4", {}, ["Audit trail della sessione"]));
    if (!STATE.audit.length) {
      body.appendChild(el("div", { class: "audit-empty" }, ["Nessuna azione registrata in questa sessione. Genera o valida un output per popolarlo."]));
    } else {
      var table = el("table", { class: "audit-table" });
      table.appendChild(el("tr", {}, [
        el("th", {}, ["Quando"]), el("th", {}, ["Chi"]), el("th", {}, ["Azione"]), el("th", {}, ["Paziente"]),
      ]));
      STATE.audit.forEach(function (a) {
        table.appendChild(el("tr", {}, [
          el("td", {}, [a.ts]), el("td", {}, [a.actor]),
          el("td", {}, [el("span", { class: "audit-act" }, [a.action]), a.mode ? el("span", { class: "muted" }, [" · " + a.mode]) : null]),
          el("td", { class: "muted" }, [a.target]),
        ]));
      });
      body.appendChild(table);
    }
    document.getElementById("modal-overlay").classList.add("open");
  }
  function closeGovernance() { document.getElementById("modal-overlay").classList.remove("open"); }

  // ====================================================================================
  // Icons (inline SVG)
  // ====================================================================================
  var ICONS = {
    activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    watch: '<circle cx="12" cy="12" r="6"/><path d="M12 9v3l2 1M9 3h6M9 21h6"/>',
    timeline: '<path d="M5 4v16M5 7h6M5 12h10M5 17h6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    spark: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
    pen: '<path d="M3 21l4-1 11-11-3-3L4 17z"/>',
    sign: '<path d="M3 17s3-1 5 1 6 1 6 1M4 13l7-7 3 3-7 7-4 1z"/>',
    check: '<path d="M5 12l4 4 10-10"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
  };
  function iconRaw(name) {
    var span = el("span", { style: "display:inline-flex" });
    span.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + "</svg>";
    return span;
  }
  function icon(name) {
    var span = el("span", { class: "ico" });
    span.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + "</svg>";
    return span;
  }

  // ====================================================================================
  // Router + init
  // ====================================================================================
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    var h = location.hash || "#/panel";
    var m = h.match(/#\/patient\/(.+)$/);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else renderPanel();
  }

  function init() {
    document.getElementById("user-initials").textContent = STATE.user.initials;
    document.getElementById("user-name").textContent = STATE.user.name;
    document.getElementById("brand").addEventListener("click", function () { go("#/panel"); });
    document.getElementById("brand").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("#/panel"); } });
    document.getElementById("btn-governance").addEventListener("click", openGovernance);
    document.getElementById("usebar-more").addEventListener("click", openGovernance);
    document.getElementById("modal-close").addEventListener("click", closeGovernance);
    document.getElementById("modal-overlay").addEventListener("click", function (e) {
      if (e.target.id === "modal-overlay") closeGovernance();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeGovernance(); });
    window.addEventListener("hashchange", route);

    // Probe the optional live-LLM proxy in the background (no effect offline).
    if (C && C.probe) C.probe();
    route();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

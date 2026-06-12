/*
 * edss.js — "Test" tab for the Patient Companion ("L'app di Giulia").
 *
 * Brings the Digital EDSS Companion self-assessment modules into the patient app:
 * short, active functional tests on the phone (walking, hand dexterity, balance,
 * attention, symptoms) that produce a friendly "rispetto al tuo solito" index.
 *
 * Design choices (consistent with the rest of the app):
 *  - PATIENT-FRIENDLY language: clinical jargon (EDSS / functional systems) stays out
 *    of the patient's view. Internally these ARE the Digital EDSS subsystem modules.
 *  - PATIENT-AS-OWN-BASELINE: every result is a deviation from the person's own usual,
 *    never a comparison to a population. Run-in sessions are excluded; an MDC threshold
 *    flags changes worth mentioning.
 *  - CLOSE THE LOOP: a meaningful change feeds the visit reminder (addVisit) — exactly
 *    what the clinician copilot would later intercept.
 *  - SCORED features are unit-independent (rates, ratios, times, counts of the user's
 *    own interaction) so the index is robust across phones and across sensor units.
 *    Magnitude features (sway in g vs m/s², instability) are shown but NOT scored.
 *  - OFFLINE-FIRST: history lives in localStorage; no network. Demo data is synthetic.
 *
 * Vanilla ES5, no framework. Exposes window.PatientEDSS.screen(ctx).
 */
(function (global) {
  "use strict";

  // ---- durations (kept short so the demo stays snappy) --------------------------------
  var AMB_MS = 20000;     // walk
  var BAL_MS = 15000;     // per phase (eyes open / closed)
  var HAND_MS = 15000;    // per hand
  var SDMT_MS = 45000;    // attention test (normalised to /90s)

  var RUN_IN = 2;         // first sessions excluded from the baseline
  var MIN_SESSIONS = 3;   // usable sessions needed before an index is shown

  // ---- tiny stats ---------------------------------------------------------------------
  function mean(a) { if (!a.length) return NaN; var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function std(a) { if (a.length < 2) return 0; var m = mean(a), s = 0, i; for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }
  function rms(a) { if (!a.length) return 0; var s = 0, i; for (i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }
  function pathLen(a) { var t = 0, i; for (i = 1; i < a.length; i++) t += Math.abs(a[i] - a[i - 1]); return t; }
  function cov(a) { var m = mean(a); return m === 0 ? 0 : std(a) / Math.abs(m); }
  function clampPos(x) { return x < 0 ? 0 : x; }
  function round(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }
  function randn() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // peak (step) detection on a 1-D AC signal — relative threshold, so unit-independent
  function countPeaks(sig, thr, refractory) {
    var peaks = [], last = -1e9, i;
    for (i = 1; i < sig.length - 1; i++) {
      if (sig[i] > sig[i - 1] && sig[i] >= sig[i + 1] && sig[i] > thr && (i - last) > refractory) { peaks.push(i); last = i; }
    }
    return peaks;
  }

  // ---- storage (per patient id) -------------------------------------------------------
  function key(pid, sub) { return "edss.hist." + pid + "." + sub; }
  function loadHist(pid, sub) { try { return JSON.parse(localStorage.getItem(key(pid, sub)) || "[]"); } catch (e) { return []; } }
  function saveSession(pid, res) {
    var h = loadHist(pid, res.subsystem); h.push(res);
    try { localStorage.setItem(key(pid, res.subsystem), JSON.stringify(h)); } catch (e) {}
  }

  // ---- baseline & scoring (patient-as-own-baseline) -----------------------------------
  function computeBaseline(hist) {
    var usable = [], i;
    for (i = 0; i < hist.length; i++) if (!hist[i].excluded) usable.push(hist[i]);
    usable = usable.slice(RUN_IN); // drop run-in
    var byKey = {};
    usable.forEach(function (s) {
      s.features.forEach(function (f) { if (f.scored === false) return; (byKey[f.key] = byKey[f.key] || []).push(f.value); });
    });
    var base = {};
    Object.keys(byKey).forEach(function (k) {
      var v = byKey[k], sd = std(v);
      base[k] = { mean: mean(v), sd: sd, n: v.length, mdc95: 1.96 * Math.SQRT2 * sd };
    });
    return base;
  }

  function scoreOne(res, base) {
    var zs = [], beyond = false;
    res.features.forEach(function (f) {
      if (f.scored === false) return;
      var b = base[f.key];
      if (!b || b.sd === 0) return;
      var z = (f.value - b.mean) / b.sd;
      if (!f.higherIsBetter) z = -z;
      zs.push(z);
      if (Math.abs(f.value - b.mean) >= b.mdc95) beyond = true;
    });
    if (!zs.length) return null;
    var z = mean(zs);
    return { index: Math.round(Math.max(0, Math.min(100, 80 + z * 10))), z: z, beyondMdc: beyond };
  }

  function summarize(hist) {
    var base = computeBaseline(hist);
    var stats = Object.keys(base).map(function (k) { return base[k].n; });
    var ready = stats.length > 0 && Math.min.apply(null, stats) >= MIN_SESSIONS;
    var trend = [], latest = null;
    if (ready) {
      hist.forEach(function (s) {
        if (s.seed) return;               // chart shows the person's real attempts only
        var sc = scoreOne(s, base);
        if (sc) { trend.push(sc.index); latest = sc.index; }
      });
    }
    return { ready: ready, base: base, trend: trend, latestIndex: latest };
  }

  // ====================================================================================
  // MODULE ANALYSES (raw signals/interactions -> features)
  // ====================================================================================
  function verticalAC(accel) {
    var mags = accel.map(function (s) { return Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z); });
    var dc = mean(mags);
    return mags.map(function (m) { return m - dc; });
  }

  function analyzeAmbulation(accel, durationMs) {
    var sig = verticalAC(accel);
    var fs = accel.length / (durationMs / 1000) || 50;
    var refractory = Math.max(1, Math.round(fs * 0.25));
    var peaks = countPeaks(sig, std(sig) * 0.6, refractory);
    var steps = peaks.length, durS = durationMs / 1000;
    var cadence = durS > 0 ? (steps / durS) * 60 : 0;
    var stepTimes = []; for (var i = 1; i < peaks.length; i++) stepTimes.push((peaks[i] - peaks[i - 1]) / fs);
    var rhythmCv = stepTimes.length ? cov(stepTimes) : 0;
    var speed = (steps * 0.7) / Math.max(durS, 1);
    return {
      subsystem: "ambulation", startedAt: new Date().toISOString(), durationMs: durationMs,
      features: [
        { key: "amb_cadence", value: round(cadence, 1), unit: "passi/min", higherIsBetter: true, scored: true },
        { key: "amb_speed", value: round(speed, 2), unit: "m/s", higherIsBetter: true, scored: true },
        { key: "amb_rhythm_cv", value: round(rhythmCv, 3), unit: "", higherIsBetter: false, scored: true },
        { key: "amb_steps", value: steps, unit: "passi", higherIsBetter: true, scored: false },
        { key: "amb_instability", value: round(std(sig), 3), unit: "", higherIsBetter: false, scored: false }
      ]
    };
  }

  function swayMetrics(samples) {
    if (samples.length < 2) return { rms: 0, path: 0 };
    var mx = mean(samples.map(function (s) { return s.x; })), my = mean(samples.map(function (s) { return s.y; }));
    var ax = samples.map(function (s) { return s.x - mx; }), ay = samples.map(function (s) { return s.y - my; });
    var planar = ax.map(function (x, i) { return Math.sqrt(x * x + ay[i] * ay[i]); });
    return { rms: rms(planar), path: pathLen(ax) + pathLen(ay) };
  }

  function analyzeBalance(open, closed, durationMs) {
    var o = swayMetrics(open), c = swayMetrics(closed);
    var romberg = o.rms > 0 ? c.rms / o.rms : 1;
    return {
      subsystem: "balanceCerebellar", startedAt: new Date().toISOString(), durationMs: durationMs,
      features: [
        { key: "bal_romberg_ratio", value: round(romberg, 2), unit: "", higherIsBetter: false, scored: true },
        { key: "bal_sway_open", value: round(o.rms, 3), unit: "", higherIsBetter: false, scored: false },
        { key: "bal_sway_closed", value: round(c.rms, 3), unit: "", higherIsBetter: false, scored: false }
      ]
    };
  }

  function handFeats(taps) {
    if (taps.length < 2) return { rate: 0, acc: 0, tremor: 0 };
    var durS = (taps[taps.length - 1].t - taps[0].t) / 1000;
    var rate = durS > 0 ? taps.length / durS : 0;
    var dists = taps.map(function (t) { return Math.sqrt((t.x - t.tx) * (t.x - t.tx) + (t.y - t.ty) * (t.y - t.ty)); });
    var iv = []; for (var i = 1; i < taps.length; i++) iv.push(taps[i].t - taps[i - 1].t);
    return { rate: rate, acc: mean(dists), tremor: std(iv) };
  }

  function analyzeHand(taps, durationMs) {
    var R = handFeats(taps.filter(function (t) { return t.hand === "right"; }));
    var L = handFeats(taps.filter(function (t) { return t.hand === "left"; }));
    var asym = (R.rate + L.rate) > 0 ? Math.abs(R.rate - L.rate) / (R.rate + L.rate) : 0;
    return {
      subsystem: "handMotor", startedAt: new Date().toISOString(), durationMs: durationMs,
      features: [
        { key: "hand_rate_right", value: round(R.rate, 2), unit: "tap/s", higherIsBetter: true, scored: true },
        { key: "hand_rate_left", value: round(L.rate, 2), unit: "tap/s", higherIsBetter: true, scored: true },
        { key: "hand_acc_right", value: round(R.acc, 1), unit: "px", higherIsBetter: false, scored: true },
        { key: "hand_acc_left", value: round(L.acc, 1), unit: "px", higherIsBetter: false, scored: true },
        { key: "hand_tremor_right", value: round(R.tremor, 0), unit: "ms", higherIsBetter: false, scored: true },
        { key: "hand_tremor_left", value: round(L.tremor, 0), unit: "ms", higherIsBetter: false, scored: true },
        { key: "hand_asymmetry", value: round(asym, 3), unit: "", higherIsBetter: false, scored: true }
      ]
    };
  }

  function analyzeSdmt(responses, durationMs) {
    var correct = responses.filter(function (r) { return r.ok; }).length;
    var errors = responses.length - correct;
    var c90 = correct * (90000 / Math.max(durationMs, 1));
    var rts = []; for (var i = 0; i < responses.length; i++) rts.push(responses[i].t - (i === 0 ? 0 : responses[i - 1].t));
    return {
      subsystem: "processingSpeed", startedAt: new Date().toISOString(), durationMs: durationMs,
      features: [
        { key: "sdmt_correct_90s", value: round(c90, 1), unit: "", higherIsBetter: true, scored: true },
        { key: "sdmt_errors", value: errors, unit: "", higherIsBetter: false, scored: true },
        { key: "sdmt_mean_rt", value: round(mean(rts.length ? rts : [0]), 0), unit: "ms", higherIsBetter: false, scored: true }
      ]
    };
  }

  // PRO items (patient reported) — short, friendly. Lower = better for all.
  var PRO_ITEMS = [
    { key: "pro_fatigue", label: "Quanta stanchezza in questi giorni?", type: "scale10" },
    { key: "pro_pain", label: "Dolore o formicolii oggi?", type: "scale10" },
    { key: "pro_walking", label: "Quanto la SM ha limitato il cammino?", type: "scale10" },
    { key: "pro_bladder", label: "Urgenza o difficoltà urinaria nell'ultima settimana?", type: "yesno" },
    { key: "pro_falls", label: "Cadute nelle ultime 2 settimane?", type: "count" }
  ];
  function analyzePro(ans, durationMs) {
    var feats = PRO_ITEMS.map(function (it) {
      return { key: it.key, value: typeof ans[it.key] === "number" ? ans[it.key] : 0, unit: "", higherIsBetter: false, scored: true };
    });
    return { subsystem: "patientReported", startedAt: new Date().toISOString(), durationMs: durationMs, features: feats };
  }

  // ====================================================================================
  // SEED — synthetic personal baseline (so the index is meaningful from the first run).
  // Values are duration-independent / interaction-based, matching what the analyses emit.
  // 100% synthetic, like the rest of the demo. Only SCORED keys are seeded.
  // ====================================================================================
  var SEED = {
    ambulation: [
      { key: "amb_cadence", mean: 108, sd: 5, hib: true },
      { key: "amb_speed", mean: 1.2, sd: 0.1, hib: true },
      { key: "amb_rhythm_cv", mean: 0.07, sd: 0.02, hib: false }
    ],
    balanceCerebellar: [
      { key: "bal_romberg_ratio", mean: 1.25, sd: 0.15, hib: false }
    ],
    handMotor: [
      { key: "hand_rate_right", mean: 5.2, sd: 0.4, hib: true },
      { key: "hand_rate_left", mean: 5.0, sd: 0.4, hib: true },
      { key: "hand_acc_right", mean: 16, sd: 4, hib: false },
      { key: "hand_acc_left", mean: 17, sd: 4, hib: false },
      { key: "hand_tremor_right", mean: 22, sd: 5, hib: false },
      { key: "hand_tremor_left", mean: 23, sd: 5, hib: false },
      { key: "hand_asymmetry", mean: 0.04, sd: 0.02, hib: false }
    ],
    processingSpeed: [
      { key: "sdmt_correct_90s", mean: 52, sd: 5, hib: true },
      { key: "sdmt_errors", mean: 2, sd: 1.2, hib: false },
      { key: "sdmt_mean_rt", mean: 1500, sd: 200, hib: false }
    ],
    patientReported: [
      { key: "pro_fatigue", mean: 3, sd: 1.2, hib: false },
      { key: "pro_pain", mean: 2, sd: 1.2, hib: false },
      { key: "pro_walking", mean: 2, sd: 1.2, hib: false },
      { key: "pro_bladder", mean: 0, sd: 0.3, hib: false },
      { key: "pro_falls", mean: 0, sd: 0.3, hib: false }
    ]
  };

  function seedIfEmpty(pid) {
    Object.keys(SEED).forEach(function (sub) {
      if (loadHist(pid, sub).length) return;
      // 6 sessions: after dropping 2 run-in, 4 remain (>= MIN) so a score shows immediately.
      for (var s = 0; s < 6; s++) {
        var feats = SEED[sub].map(function (x) {
          return { key: x.key, value: clampPos(round(x.mean + randn() * x.sd, 3)), unit: "", higherIsBetter: x.hib, scored: true };
        });
        saveSession(pid, { subsystem: sub, startedAt: "2026-05-" + (10 + s) + "T09:00:00Z", durationMs: 0, features: feats, seed: true });
      }
    });
  }

  // ====================================================================================
  // SYNTHETIC FALLBACK (when motion sensors aren't available, e.g. desktop pitch).
  // Produces a plausible run so the flow completes; clearly labelled in the UI.
  // ====================================================================================
  function synthWalk(stepsPerSec) {
    var fs = 50, n = Math.round((AMB_MS / 1000) * fs), out = [], i;
    for (i = 0; i < n; i++) {
      var z = 1 + 0.4 * Math.sin(2 * Math.PI * stepsPerSec * (i / fs)) + 0.03 * randn();
      out.push({ t: (i / fs) * 1000, x: 0.02 * Math.sin(i * 0.3), y: 0.01 * randn(), z: z });
    }
    return out;
  }
  function synthSway(amp) {
    var fs = 50, n = Math.round((BAL_MS / 1000) * fs), out = [], i;
    for (i = 0; i < n; i++) out.push({ t: (i / fs) * 1000, x: amp * Math.sin(i * 0.07) + amp * 0.5 * randn(), y: amp * Math.cos(i * 0.05) + amp * 0.5 * randn(), z: 1 });
    return out;
  }

  // ====================================================================================
  // UI
  // ====================================================================================
  var ctx = null, root = null, sub = { name: "list" }, timer = null;

  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function el() { return ctx.el.apply(null, arguments); }
  function icHtml(n, s) { return ctx.icHtml(n, s); }
  function ic(n, s) { return ctx.ic(n, s); }

  var TESTS = [
    { key: "ambulation", label: "Cammino", icon: "foot", cls: "green", desc: "Cammina ~20 secondi col telefono in mano", dur: "20 s", kind: "motion" },
    { key: "handMotor", label: "Mani", icon: "hand", cls: "blue", desc: "Tocca i due cerchi a ritmo, una mano per volta", dur: "30 s", kind: "tap" },
    { key: "balanceCerebellar", label: "Equilibrio", icon: "balance", cls: "warm", desc: "Stai fermo/a: occhi aperti, poi chiusi", dur: "30 s", kind: "balance" },
    { key: "processingSpeed", label: "Attenzione", icon: "brain", cls: "green", desc: "Abbina simboli e numeri il più in fretta possibile", dur: "45 s", kind: "sdmt" },
    { key: "patientReported", label: "Come stai", icon: "heart", cls: "warm", desc: "Cinque domande veloci sui sintomi di oggi", dur: "1 min", kind: "pro" }
  ];
  function testByKey(k) { for (var i = 0; i < TESTS.length; i++) if (TESTS[i].key === k) return TESTS[i]; return null; }

  function screen(c) {
    ctx = c;
    seedIfEmpty(ctx.getPid());
    root = el("div", { class: "wrap" });
    sub = { name: "list" };
    renderInto();
    return root;
  }

  function renderInto() {
    clear(root);
    if (timer) { clearInterval(timer); timer = null; }
    if (sub.name === "list") return viewList();
    if (sub.name === "result") return viewResult(sub.test, sub.outcome, sub.res);
    var t = testByKey(sub.test);
    if (t.kind === "motion") return runMotionWalk(t);
    if (t.kind === "balance") return runBalance(t);
    if (t.kind === "tap") return runTap(t);
    if (t.kind === "sdmt") return runSdmt(t);
    if (t.kind === "pro") return runPro(t);
  }

  // ---- LIST --------------------------------------------------------------------------
  function ring(index, size) {
    size = size || 56;
    var col = index >= 75 ? "var(--ok)" : index >= 55 ? "var(--care)" : "var(--warm)";
    var r = (size - 8) / 2, cx = size / 2, circ = 2 * Math.PI * r, off = circ * (1 - index / 100);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="var(--soft-2)" stroke-width="6"/>' +
      '<circle cx="' + cx + '" cy="' + cx + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + cx + ' ' + cx + ')"/>' +
      '<text x="' + cx + '" y="' + (cx + 5) + '" text-anchor="middle" font-size="16" font-weight="800" fill="' + col + '">' + index + '</text></svg>';
  }

  function viewList() {
    root.appendChild(el("div", { class: "card flat", style: "background:var(--brand-tint);border-color:#d4e8df" }, [
      el("div", {
        style: "font-size:13.5px;color:var(--ink-2)", html:
          "<strong>Test veloci, quando vuoi.</strong> Misurano come stanno andando cammino, mani, " +
          "equilibrio e attenzione. Il punteggio è sempre <strong>rispetto al tuo solito</strong>, " +
          "non un voto: aiuta te e il tuo Centro SM a notare i cambiamenti."
      })
    ]));

    TESTS.forEach(function (t) {
      var sum = summarize(loadHist(ctx.getPid(), t.key));
      var rightHtml = sum.ready && sum.latestIndex !== null
        ? ring(sum.latestIndex, 50)
        : '<span class="edss-go">' + icHtml("arrow", 18) + '</span>';
      var rowKids = [
        el("span", { class: "ric " + t.cls, html: icHtml(t.icon, 21) }),
        el("div", { class: "rmain" }, [
          el("div", { class: "rt" }, [t.label]),
          el("div", { class: "rs" }, [t.desc])
        ]),
        el("span", { class: "edss-right", html: rightHtml })
      ];
      var card = el("div", { class: "card edss-test", onclick: function () { sub = { name: "run", test: t.key }; renderInto(); } }, [
        el("div", { class: "row", style: "padding:2px 0;border-bottom:none" }, rowKids)
      ]);
      root.appendChild(card);
    });

    root.appendChild(el("div", { class: "loop", style: "margin-top:4px" }, [
      el("span", { html: icHtml("heart", 22) }),
      el("div", {}, [
        el("div", { class: "lt" }, ["Chiude il cerchio con il tuo team"]),
        el("div", { class: "ls" }, ["Un cambiamento che conta finisce nel promemoria della visita — così non te lo dimentichi."])
      ])
    ]));
    root.appendChild(el("div", { class: "disc" }, ["Test dimostrativi su dati sintetici · non sostituiscono l'esame del neurologo."]));
  }

  // ---- shared run header --------------------------------------------------------------
  function runHeader(t) {
    return el("div", { class: "edss-head" }, [
      el("button", { class: "edss-back", html: icHtml("arrow", 18) + " Indietro", onclick: function () { sub = { name: "list" }; renderInto(); } }),
      el("div", { class: "edss-title" }, [el("span", { class: "ric " + t.cls, html: icHtml(t.icon, 19) }), el("span", {}, [t.label])])
    ]);
  }
  function bigTimer(label) {
    var box = el("div", { class: "edss-timer" });
    box.appendChild(el("div", { class: "edss-count", id: "edss-count" }, ["—"]));
    box.appendChild(el("div", { class: "edss-sub", id: "edss-sub" }, [label]));
    return box;
  }
  function countdown(seconds, onTick, onEnd) {
    var left = seconds;
    var c = document.getElementById("edss-count"); if (c) c.textContent = left + "s";
    timer = setInterval(function () {
      left--;
      var cc = document.getElementById("edss-count"); if (cc) cc.textContent = (left > 0 ? left : 0) + "s";
      if (onTick) onTick(left);
      if (left <= 0) { clearInterval(timer); timer = null; onEnd(); }
    }, 1000);
  }

  // ---- AMBULATION (motion, with synthetic fallback) -----------------------------------
  function hasMotion() { return typeof global.DeviceMotionEvent !== "undefined"; }

  function runMotionWalk(t) {
    root.appendChild(runHeader(t));
    root.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["Mettiti comodo/a e in sicurezza"]),
      el("div", { class: "sub" }, ["Tieni il telefono in mano o in tasca e cammina in modo naturale, in piano, per ~20 secondi. Fermati quando vuoi."])
    ]));
    root.appendChild(bigTimer("Pronto/a a partire"));

    var samples = [], t0 = 0;
    function onMotion(e) {
      var a = e.accelerationIncludingGravity || e.acceleration; if (!a) return;
      samples.push({ t: Date.now() - t0, x: a.x || 0, y: a.y || 0, z: a.z || 0 });
    }
    function finish(real) {
      if (real) global.removeEventListener("devicemotion", onMotion);
      var accel = real ? samples : synthWalk(1.7 + 0.25 * Math.random());
      done(t, analyzeAmbulation(accel, AMB_MS));
    }
    function begin() {
      t0 = Date.now(); samples = [];
      var go = function (real) {
        if (real) global.addEventListener("devicemotion", onMotion);
        var s = document.getElementById("edss-sub"); if (s) s.textContent = real ? "Cammina… sto misurando" : "Modalità demo (sensori non disponibili)";
        countdown(AMB_MS / 1000, null, function () { finish(real); });
      };
      if (hasMotion() && global.DeviceMotionEvent.requestPermission) {
        global.DeviceMotionEvent.requestPermission().then(function (p) { go(p === "granted"); }).catch(function () { go(false); });
      } else { go(hasMotion()); }
    }
    root.appendChild(el("button", { class: "pbtn pri", onclick: begin }, [ic("foot", 18), "Inizia il cammino"]));
  }

  // ---- BALANCE (two phases, motion + fallback) ----------------------------------------
  function runBalance(t) {
    root.appendChild(runHeader(t));
    root.appendChild(el("div", { class: "card" }, [
      el("h3", {}, ["⚠️ Prima la sicurezza"]),
      el("div", { class: "sub" }, ["Mettiti vicino a un muro o a un appoggio. Tieni il telefono contro il petto, piedi uniti. Prima a occhi aperti, poi a occhi chiusi."])
    ]));
    root.appendChild(bigTimer("Fase 1 · occhi aperti"));

    var openS = [], closedS = [], cur = null, t0 = 0;
    function onMotion(e) { var a = e.accelerationIncludingGravity || e.acceleration; if (a && cur) cur.push({ t: Date.now() - t0, x: a.x || 0, y: a.y || 0, z: a.z || 0 }); }
    var real = hasMotion();

    function phase2() {
      var s = document.getElementById("edss-sub"); if (s) s.textContent = real ? "Fase 2 · occhi chiusi" : "Fase 2 · occhi chiusi (demo)";
      cur = closedS; t0 = Date.now();
      countdown(BAL_MS / 1000, null, function () {
        if (real) global.removeEventListener("devicemotion", onMotion);
        var open = real ? openS : synthSway(0.05);
        var closed = real ? closedS : synthSway(0.075);
        done(t, analyzeBalance(open, closed, BAL_MS * 2));
      });
    }
    function phase1(granted) {
      real = real && granted !== false;
      if (real) global.addEventListener("devicemotion", onMotion);
      var s = document.getElementById("edss-sub"); if (s) s.textContent = real ? "Fase 1 · occhi aperti, resta fermo/a" : "Fase 1 · occhi aperti (demo)";
      cur = openS; t0 = Date.now();
      countdown(BAL_MS / 1000, null, phase2);
    }
    function begin() {
      if (hasMotion() && global.DeviceMotionEvent.requestPermission) {
        global.DeviceMotionEvent.requestPermission().then(function (p) { phase1(p === "granted"); }).catch(function () { phase1(false); });
      } else { phase1(hasMotion()); }
    }
    root.appendChild(el("button", { class: "pbtn pri", onclick: begin }, [ic("balance", 18), "Inizia"]));
  }

  // ---- HAND TAPPING -------------------------------------------------------------------
  function runTap(t) {
    root.appendChild(runHeader(t));
    var phase = "intro"; // intro -> right -> between -> left
    var taps = [], active = 0, t0 = 0, hand = "right";
    var stage = el("div", {});
    root.appendChild(stage);

    function targetCenter(idx, rect) { var left = idx === 0 ? 40 : rect.width - 40 - 64; return { x: left + 32, y: 100 + 32 }; }

    function board(label) {
      clear(stage);
      stage.appendChild(el("div", { class: "edss-phaselbl" }, [label]));
      stage.appendChild(el("div", { class: "edss-count", id: "edss-count", style: "text-align:center" }, ["—"]));
      var area = el("div", { class: "edss-tap" });
      [0, 1].forEach(function (i) {
        var dot = el("button", { class: "edss-dot" + (active === i ? " on" : ""), "data-i": i });
        dot.style[i === 0 ? "left" : "right"] = "40px";
        dot.addEventListener("click", function (e) {
          var rect = area.getBoundingClientRect();
          var c = targetCenter(active, rect);
          taps.push({ t: Date.now() - t0, x: e.clientX - rect.left, y: e.clientY - rect.top, tx: c.x, ty: c.y, hand: hand });
          active = active === 0 ? 1 : 0;
          area.querySelectorAll(".edss-dot").forEach(function (d, k) { d.className = "edss-dot" + (active === k ? " on" : ""); });
        });
        area.appendChild(dot);
      });
      stage.appendChild(area);
    }

    function startHand(h, label, next) {
      hand = h; active = 0; t0 = Date.now(); board(label);
      countdown(HAND_MS / 1000, null, next);
    }
    function intro() {
      clear(stage);
      stage.appendChild(el("div", { class: "card" }, [
        el("h3", {}, ["Tocca i due cerchi a turno"]),
        el("div", { class: "sub" }, ["Il più veloce e preciso possibile. Prima con la mano destra, poi con la sinistra."])
      ]));
      stage.appendChild(el("button", { class: "pbtn pri", onclick: function () { startHand("right", "Mano destra", between); } }, [ic("hand", 18), "Inizia · mano destra"]));
    }
    function between() {
      clear(stage);
      stage.appendChild(el("div", { class: "saved", style: "background:var(--brand-tint);border-color:#cfe7dd" }, [ic("check", 20), el("div", {}, [el("div", { class: "st" }, ["Bene!"]), el("div", { class: "ss" }, ["Ora ripeti con la mano sinistra."])])]));
      stage.appendChild(el("button", { class: "pbtn pri", style: "margin-top:12px", onclick: function () { startHand("left", "Mano sinistra", finish); } }, [ic("hand", 18), "Inizia · mano sinistra"]));
    }
    function finish() { done(t, analyzeHand(taps, HAND_MS * 2)); }
    intro();
  }

  // ---- SDMT (attention) ---------------------------------------------------------------
  var SYMBOLS = ["◐", "◧", "✦", "▣", "⬮", "◑", "⬗", "✧", "◭"];
  function runSdmt(t) {
    root.appendChild(runHeader(t));
    var responses = [], cur = 0, t0 = 0;
    var stage = el("div", {});
    root.appendChild(stage);

    function legend() {
      var g = el("div", { class: "edss-key" });
      SYMBOLS.forEach(function (s, i) { g.appendChild(el("div", { class: "edss-keycell" }, [el("div", { class: "edss-keysym" }, [s]), el("div", { class: "edss-keynum" }, [String(i + 1)])])); });
      return g;
    }
    function play() {
      clear(stage);
      stage.appendChild(legend());
      stage.appendChild(el("div", { class: "edss-count", id: "edss-count", style: "text-align:center;margin:6px 0" }, ["—"]));
      var prompt = el("div", { class: "edss-prompt" }, [SYMBOLS[cur]]);
      stage.appendChild(prompt);
      var pad = el("div", { class: "edss-pad" });
      for (var d = 1; d <= 9; d++) (function (d) {
        pad.appendChild(el("button", { class: "edss-padbtn", onclick: function () {
          responses.push({ t: Date.now() - t0, ok: (d === cur + 1) });
          cur = Math.floor(Math.random() * SYMBOLS.length); prompt.textContent = SYMBOLS[cur];
        } }, [String(d)]));
      })(d);
      stage.appendChild(pad);
      t0 = Date.now();
      countdown(SDMT_MS / 1000, null, function () { done(t, analyzeSdmt(responses, SDMT_MS)); });
    }
    function intro() {
      clear(stage);
      stage.appendChild(el("div", { class: "card" }, [
        el("h3", {}, ["Ogni simbolo ha un numero"]),
        el("div", { class: "sub" }, ["Guarda la legenda, poi inserisci il numero giusto per ogni simbolo, più in fretta che puoi, per 45 secondi."])
      ]));
      stage.appendChild(legend());
      stage.appendChild(el("button", { class: "pbtn pri", style: "margin-top:12px", onclick: play }, [ic("brain", 18), "Inizia"]));
    }
    intro();
  }

  // ---- PRO ----------------------------------------------------------------------------
  function runPro(t) {
    root.appendChild(runHeader(t));
    var ans = {}; var t0 = Date.now();
    PRO_ITEMS.forEach(function (it) {
      var f = el("div", { class: "field" });
      f.appendChild(el("label", {}, [it.label]));
      if (it.type === "scale10") {
        var sc = el("div", { class: "scale" });
        [0, 2, 4, 6, 8, 10].forEach(function (v) {
          sc.appendChild(el("button", { onclick: function (e) { ans[it.key] = v; sc.querySelectorAll("button").forEach(function (b) { b.classList.remove("sel"); }); e.target.classList.add("sel"); } }, [String(v)]));
        });
        f.appendChild(sc);
        f.appendChild(el("div", { class: "scale-lbls" }, [el("span", {}, ["Per niente"]), el("span", {}, ["Moltissimo"])]));
      } else if (it.type === "yesno") {
        var yn = el("div", { class: "scale" });
        [["No", 0], ["Sì", 1]].forEach(function (p) {
          yn.appendChild(el("button", { onclick: function (e) { ans[it.key] = p[1]; yn.querySelectorAll("button").forEach(function (b) { b.classList.remove("sel"); }); e.target.classList.add("sel"); } }, [p[0]]));
        });
        f.appendChild(yn);
      } else {
        var ct = el("div", { class: "scale" });
        [0, 1, 2, 3].forEach(function (v) {
          ct.appendChild(el("button", { onclick: function (e) { ans[it.key] = v; ct.querySelectorAll("button").forEach(function (b) { b.classList.remove("sel"); }); e.target.classList.add("sel"); } }, [v === 3 ? "3+" : String(v)]));
        });
        f.appendChild(ct);
      }
      root.appendChild(f);
    });
    root.appendChild(el("button", { class: "pbtn pri", onclick: function () { done(t, analyzePro(ans, Date.now() - t0)); } }, [ic("check", 18), "Invia"]));
  }

  // ---- DONE -> persist, score, show result -------------------------------------------
  function done(t, res) {
    if (timer) { clearInterval(timer); timer = null; }
    var pid = ctx.getPid();
    saveSession(pid, res);
    var sum = summarize(loadHist(pid, t.key));
    var outcome = sum.ready ? scoreOne(res, sum.base) : null;
    sub = { name: "result", test: t.key, outcome: outcome, res: res, trend: sum.trend };

    // CLOSE THE LOOP: a meaningful worsening goes to the visit reminder.
    if (outcome && (outcome.beyondMdc || outcome.index < 55)) {
      var loopMsg = {
        ambulation: "Il test del cammino è sotto il mio solito",
        handMotor: "Il test delle mani è sotto il mio solito",
        balanceCerebellar: "Il test dell'equilibrio è sotto il mio solito",
        processingSpeed: "Il test di attenzione è sotto il mio solito",
        patientReported: "Ho segnalato più sintomi del solito"
      }[t.key];
      if (loopMsg && ctx.addVisit) ctx.addVisit(loopMsg);
    }
    renderInto();
  }

  function viewResult(testKey, outcome, res) {
    var t = testByKey(testKey);
    root.appendChild(runHeader(t));

    if (!outcome) {
      root.appendChild(el("div", { class: "saved", style: "background:var(--brand-tint);border-color:#cfe7dd" }, [
        ic("check", 22),
        el("div", {}, [
          el("div", { class: "st" }, ["Fatto, grazie!"]),
          el("div", { class: "ss" }, ["Sto imparando qual è il tuo solito. Ancora qualche prova e ti mostrerò l'andamento."])
        ])
      ]));
    } else {
      var idx = outcome.index;
      var tone = idx >= 75 ? "good" : idx >= 55 ? "warn" : "low";
      var msg = idx >= 75 ? "In linea con il tuo solito. Ottimo, continua così."
        : idx >= 55 ? "Un po' sotto il tuo solito. Può capitare (stanchezza, giornata storta): tienilo d'occhio."
        : "Sotto il tuo solito. Niente allarmismi — l'ho aggiunto al promemoria, così ne parli alla visita.";
      var card = el("div", { class: "edss-result " + tone });
      card.appendChild(el("div", { class: "edss-bigring", html: ring(idx, 96) }));
      card.appendChild(el("div", { class: "edss-rlbl" }, ["rispetto al tuo solito"]));
      card.appendChild(el("div", { class: "edss-rmsg" }, [msg]));
      if (outcome.beyondMdc) card.appendChild(el("div", { class: "edss-flag" }, [ic("alert", 15), "Cambiamento che vale la pena segnalare"]));
      root.appendChild(card);

      if (sub.trend && sub.trend.length > 1) {
        root.appendChild(el("div", { class: "trendc" }, [
          el("div", { class: "tt" }, [el("span", { class: "tic green", html: icHtml("spark", 18) }), el("span", { class: "tname" }, ["Le tue prove"])]),
          el("div", { html: ctx.spark(sub.trend, { color: "var(--brand)", markLast: true }) })
        ]));
      }
    }

    // a couple of friendly metrics from this run (no clinical jargon)
    var friendly = friendlyMetrics(testKey, res);
    if (friendly.length) {
      var mc = el("div", { class: "card" });
      mc.appendChild(el("h3", {}, ["Da questa prova"]));
      friendly.forEach(function (m) {
        mc.appendChild(el("div", { class: "edss-metric" }, [el("span", {}, [m.label]), el("strong", {}, [m.value])]));
      });
      root.appendChild(mc);
    }

    root.appendChild(el("button", { class: "pbtn sec", onclick: function () { sub = { name: "list" }; renderInto(); } }, [ic("check", 18), "Torna ai test"]));
    if (outcome && (outcome.beyondMdc || outcome.index < 55)) {
      root.appendChild(el("button", { class: "pbtn ghost", style: "margin-top:9px", onclick: function () { ctx.goTab("visita"); } }, [ic("visit", 18), "Vai al promemoria visita"]));
    }
    root.appendChild(el("div", { class: "disc" }, ["Indice dimostrativo rispetto al tuo baseline personale (dati sintetici)."]));
  }

  function friendlyMetrics(testKey, res) {
    function v(k) { for (var i = 0; i < res.features.length; i++) if (res.features[i].key === k) return res.features[i].value; return null; }
    if (testKey === "ambulation") return [{ label: "Passi al minuto", value: String(v("amb_cadence")) }, { label: "Regolarità del passo", value: v("amb_rhythm_cv") < 0.1 ? "buona" : "da osservare" }];
    if (testKey === "handMotor") return [{ label: "Tocchi al secondo (dx)", value: String(v("hand_rate_right")) }, { label: "Tocchi al secondo (sx)", value: String(v("hand_rate_left")) }];
    if (testKey === "balanceCerebellar") return [{ label: "Stabilità a occhi chiusi", value: v("bal_romberg_ratio") < 1.4 ? "buona" : "da osservare" }];
    if (testKey === "processingSpeed") return [{ label: "Risposte corrette (/90s)", value: String(v("sdmt_correct_90s")) }, { label: "Errori", value: String(v("sdmt_errors")) }];
    return [];
  }

  global.PatientEDSS = { screen: screen };
})(window);

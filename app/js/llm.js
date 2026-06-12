/*
 * llm.js - Output orchestration with graceful degradation.
 *
 * Three tiers, in order of preference (the demo NEVER depends on the network):
 *   1. LIVE LLM    - only when the app is served by app/serve.py AND an API key is in env.
 *                    The browser POSTs structured data to a same-origin /api/llm proxy;
 *                    the key stays server-side. (See app/serve.py + app/prompts/.)
 *   2. CURATED     - hand-written Italian summaries saved in generated_summaries/ and
 *                    embedded as window.MS_SUMMARIES (offline, file:// safe).
 *   3. TEMPLATE    - deterministic assembly from the data via js/templates.js (always works).
 *
 * Opening app/index.html directly (file://) -> tier 2/3 only, fully offline.
 */

(function (global) {
  "use strict";

  var state = { probed: false, live: false, model: null };

  function isFile() {
    return global.location && global.location.protocol === "file:";
  }

  // Probe the optional local proxy. Short timeout; any failure => offline mode.
  function probe() {
    if (state.probed) return Promise.resolve(state);
    if (isFile() || !global.fetch) {
      state.probed = true;
      return Promise.resolve(state);
    }
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 1200);
    return fetch("/api/health", { signal: ctrl.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        clearTimeout(t);
        if (j && j.llm_enabled) { state.live = true; state.model = j.model || null; }
        state.probed = true;
        return state;
      })
      .catch(function () { clearTimeout(t); state.probed = true; return state; });
  }

  // Deterministic / curated fallback (synchronous).
  function fallback(patient, risk, kind) {
    var curated = global.MS_SUMMARIES && global.MS_SUMMARIES[patient.id]
      ? global.MS_SUMMARIES[patient.id][kind] : null;
    if (curated && typeof curated === "string" && curated.trim()) {
      return { markdown: curated, mode: "fallback", model: null };
    }
    var md;
    if (kind === "letter") md = global.Templates.letter(patient, risk);
    else if (kind === "instructions") md = global.Templates.instructions(patient, risk);
    else md = global.Templates.visitSummary(patient, risk);
    return { markdown: md, mode: "template", model: null };
  }

  // Main entry: returns a Promise<{markdown, mode, model}>.
  function generate(patient, risk, kind) {
    kind = kind || "summary";
    return probe().then(function (s) {
      if (!s.live) return fallback(patient, risk, kind);
      // Live path: send structured data; the server owns the prompt template + API key.
      var body = JSON.stringify({ kind: kind, patient: patient, risk: risk });
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, 45000);
      return fetch("/api/llm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body, signal: ctrl.signal,
      })
        .then(function (r) {
          clearTimeout(t);
          if (!r.ok) throw new Error("llm proxy " + r.status);
          return r.json();
        })
        .then(function (j) {
          if (!j || !j.text) throw new Error("empty");
          return { markdown: j.text, mode: "live", model: j.model || s.model };
        })
        .catch(function () {
          clearTimeout(t);
          // Network/LLM failure -> never break the demo, fall back silently.
          var fb = fallback(patient, risk, kind);
          fb.degraded = true;
          return fb;
        });
    });
  }

  global.Copilot = { probe: probe, generate: generate, fallback: fallback, state: state };
})(window);

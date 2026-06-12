#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serve.py - OPTIONAL local server for the NeuroInflammation Copilot.

Two jobs:
  1. Serve the static app (app/) over http://localhost:<port>.
  2. Expose a tiny same-origin LLM proxy so the "live" visit-summary mode works
     WITHOUT exposing the API key to the browser. The key is read from the
     environment (ANTHROPIC_API_KEY preferred, OPENAI_API_KEY as fallback).

If no key is set (or you just open app/index.html directly), the app falls back to
the offline curated/template summaries - the demo always works without the network.

Run:
  ANTHROPIC_API_KEY=sk-ant-...  python3 app/serve.py          # live LLM enabled
  python3 app/serve.py                                        # static only (offline fallback)

Standard library only. No pip install required.
"""

import json
import os
import sys
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8002"))
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
# Default to the latest Anthropic model; override with LLM_MODEL if desired.
ANTHROPIC_MODEL = os.environ.get("LLM_MODEL", "claude-opus-4-8")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")

PROVIDER = "anthropic" if ANTHROPIC_KEY else ("openai" if OPENAI_KEY else None)
MODEL = ANTHROPIC_MODEL if PROVIDER == "anthropic" else (OPENAI_MODEL if PROVIDER == "openai" else None)

# --------------------------------------------------------------------------------------
# Prompt assembly (mirrors app/prompts/*.md)
# --------------------------------------------------------------------------------------
SYSTEM_SUMMARY = (
    "Sei un assistente clinico ('copilot') a supporto di un neurologo esperto in Sclerosi "
    "Multipla e malattie neuroinfiammatorie. NON sei un medico e NON formuli diagnosi. "
    "Produci una SINTESI PRE-VISITA strutturata, sobria e fedele ai dati forniti. "
    "Usa SOLO i dati forniti; se un dato manca scrivi 'non disponibile'. Distingui i fatti "
    "dai suggerimenti (sempre 'da validare dal clinico'). Nessun claim diagnostico o "
    "prescrittivo definitivo. Evidenzia i sintomi invisibili (fatica, cognizione, umore, sonno) "
    "e i segnali di peggioramento silente. Se c'e una sospetta pseudo-ricaduta (caldo/infezione/"
    "febbre) invita a distinguerla da una ricaduta vera. Italiano clinico conciso, ~una pagina. "
    "Usa queste sezioni Markdown: '# Sintesi pre-visita — <nome>', '## Perche e prioritario', "
    "'## Attivita e progressione', '## Sintomi invisibili e qualita di vita', "
    "'## Aderenza e monitoraggio', '## Suggerimenti operativi (da validare dal clinico)'. "
    "Chiudi con un disclaimer: dati a supporto, decisione al clinico."
)
SYSTEM_LETTER = (
    "Sei un assistente clinico a supporto di un neurologo (SM/neuroinfiammazione). Redigi una "
    "BOZZA di relazione clinica per un collega, basata SOLO sui dati forniti. Non sei un medico "
    "e non formuli diagnosi definitive. Struttura: intestazione, sintesi clinica, valutazione, "
    "proposta operativa (da validare dal clinico), saluti, spazio firma. Inserisci l'avviso "
    "'Bozza generata a supporto del clinico — da rivedere e firmare'. Nessuna prescrizione "
    "definitiva. Italiano, ~250-300 parole."
)
SYSTEM_INSTR = (
    "Sei un assistente clinico. Redigi ISTRUZIONI POST-VISITA per il paziente in linguaggio "
    "semplice e rassicurante, basate SOLO sui dati forniti. Niente diagnosi. Indica quando "
    "ricontattare il centro. Italiano semplice. Chiudi indicando che il documento va validato dal clinico."
)
# Patient-facing assistant: HEAVILY constrained for safety (see app/prompts/patient_assistant_prompt.md).
SYSTEM_PATIENT = (
    "Sei un assistente informativo per una persona che convive con la sclerosi multipla. "
    "NON sei un medico. REGOLE INDEROGABILI: (1) non fai diagnosi e non dici se è una ricaduta; "
    "(2) non prescrivi e non suggerisci MAI di iniziare, sospendere, cambiare o raddoppiare farmaci; "
    "(3) non rassicurare in modo assoluto ('non è niente', 'è sicuramente normale' sono VIETATI); "
    "(4) per sintomi gravi o improvvisi indirizza al 112; per sintomi neurologici nuovi che durano "
    ">24h indirizza al Centro SM; per pensieri di farsi del male invita a chiedere aiuto subito; "
    "(5) dai solo informazioni generali ed educative e consigli di auto-gestione; "
    "(6) invita ad annotare e a parlarne alla visita. Tono caldo, semplice, italiano, 2-4 frasi brevi. "
    "Chiudi ricordando che non sostituisci il medico."
)


def risk_to_text(risk):
    if not risk:
        return "Nessun flag."
    lines = ["Priorita: %s (punteggio %s)." % (risk.get("level", "?"), risk.get("score", "?"))]
    for f in risk.get("flags", []):
        factors = f.get("factors") or []
        lines.append("- [%s] %s: %s" % (f.get("severity", ""), f.get("label", ""),
                                        factors[0] if factors else ""))
    for i in risk.get("insights", []):
        lines.append("- (contesto) %s: %s" % (i.get("title", ""), i.get("detail", "")))
    return "\n".join(lines)


def build_messages(payload):
    kind = payload.get("kind", "summary")

    # Patient-facing assistant (different payload shape: {message, ctx}).
    if kind == "patient_chat":
        ctx = payload.get("ctx", {})
        msg = payload.get("message", "")
        user = (
            "Contesto (sintetico): nome=%s, terapia=%s.\n" % (ctx.get("firstName", "-"), ctx.get("dmt", "-")) +
            "Messaggio della persona:\n" + msg +
            "\n\nRispondi in modo sicuro secondo le regole. Niente diagnosi, niente cambi di terapia."
        )
        return SYSTEM_PATIENT, user

    patient = payload.get("patient", {})
    risk = payload.get("risk", {})
    system = SYSTEM_SUMMARY
    if kind == "letter":
        system = SYSTEM_LETTER
    elif kind == "instructions":
        system = SYSTEM_INSTR
    user = (
        "CONTESTO CLINICO (flag trasparenti gia applicati dal copilot):\n" + risk_to_text(risk) +
        "\n\nDATI (strutturati, sintetici):\n" + json.dumps(patient, ensure_ascii=False) +
        "\n\nVincoli: fedele ai dati; ogni suggerimento etichettato 'da validare dal clinico'; "
        "niente diagnosi/prescrizioni definitive."
    )
    return system, user


# --------------------------------------------------------------------------------------
# Provider calls (raw HTTP via stdlib)
# --------------------------------------------------------------------------------------
def call_anthropic(system, user):
    body = json.dumps({
        "model": ANTHROPIC_MODEL,
        "max_tokens": 1200,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={
            "content-type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip(), ANTHROPIC_MODEL


def call_openai(system, user):
    body = json.dumps({
        "model": OPENAI_MODEL,
        "max_tokens": 1200,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions", data=body, method="POST",
        headers={"content-type": "application/json", "authorization": "Bearer " + OPENAI_KEY},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip(), OPENAI_MODEL


# --------------------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def log_message(self, fmt, *args):
        pass  # quiet

    def _json(self, code, obj):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            return self._json(200, {
                "llm_enabled": PROVIDER is not None,
                "provider": PROVIDER,
                "model": MODEL,
            })
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/llm":
            return self._json(404, {"error": "not found"})
        if PROVIDER is None:
            return self._json(503, {"error": "no API key configured"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            system, user = build_messages(payload)
            if PROVIDER == "anthropic":
                text, model = call_anthropic(system, user)
            else:
                text, model = call_openai(system, user)
            return self._json(200, {"text": text, "model": model, "provider": PROVIDER})
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:400]
            return self._json(502, {"error": "provider error %s" % e.code, "detail": detail})
        except Exception as e:  # noqa: BLE001 - never crash the demo
            return self._json(500, {"error": str(e)})


def main():
    os.chdir(HERE)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Patient Companion (Giulia) — http://localhost:%d" % PORT)
    if PROVIDER:
        print("LLM live: ENABLED (%s, model %s)" % (PROVIDER, MODEL))
    else:
        print("LLM live: disabled (no API key) -> offline fallback summaries in use.")
        print("  Enable with: ANTHROPIC_API_KEY=sk-ant-...  python3 app/serve.py")
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()

# March Madness Bracket

A responsive NCAA-style **64-team bracket picker** with picks saved in `localStorage`, plus a **side-panel chat advisor** powered by [DigitalOcean Serverless Inference](https://docs.digitalocean.com/products/inference/) (OpenAI-compatible chat completions).

The default field is **example data** — use **Edit teams** to paste in a real tournament draw.

## Stack

- Node.js 20+ and Express (single `web` service)
- Static HTML/CSS/JS (no frontend build)
- No database

## Local development

```bash
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080).

Health check:

```bash
curl -sS http://localhost:8080/healthz
```

Without `MODEL_ACCESS_KEY`, `/api/chat` returns HTTP 503 with `{"error":"Inference not configured"}`.

With a key:

```bash
export MODEL_ACCESS_KEY='your-model-access-key'
export INFERENCE_MODEL='openai-gpt-oss-20b'   # optional
npm start
```

Run bracket logic tests:

```bash
npm test
```

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MODEL_ACCESS_KEY` | For chat | — | Server-side secret for inference (never logged or sent to the browser). |
| `INFERENCE_MODEL` | No | `openai-gpt-oss-20b` | Model ID. |
| `INFERENCE_BASE_URL` | No | `https://inference.do-ai.run/v1` | API base URL. |
| `PORT` | No | `8080` | HTTP port. |

## Deploy on DigitalOcean App Platform

Use [`.do/app.yaml`](.do/app.yaml): app `march-madness-bracket`, branch `march-madness`, health check `/healthz`. Set `MODEL_ACCESS_KEY` as a runtime secret in the control panel.

## License

MIT — see [LICENSE](LICENSE).

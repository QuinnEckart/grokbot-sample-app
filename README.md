# grokbot-sample-app — March Madness bracket + inference chat

A responsive **64-team bracket** (demo field — the real **2027 NCAA bracket is not announced yet**) with **local persistence**, **export/import JSON**, **reset confirmation**, and advancement rules that **clear downstream picks** when an earlier winner changes. The **bracket assistant** chat proxies to [DigitalOcean Serverless Inference](https://docs.digitalocean.com/products/inference/how-to/use-serverless-inference/) using the OpenAI-compatible `POST /v1/chat/completions` API. The server sends **bounded** system context summarizing the user’s actual picks (no fabricated stats or odds).

**Bracket editing works without any chat API key.** Until `MODEL_ACCESS_KEY` is set on the server, the UI shows that chat is unconfigured and `/api/chat` returns HTTP **503** with a clear message.

## Stack

- **Node.js 20+** (built-in `fetch`), zero npm runtime dependencies
- Static `public/` HTML/CSS/JS; bracket logic in `lib/bracket.js`
- **Docker** image: `Dockerfile` (Alpine, `npm ci --omit=dev`)

## Environment variables (deployment)

Set these in the **DigitalOcean App Platform** component environment (or Docker / shell). **Do not** commit secrets.

| Variable | Required for chat | Default | Description |
| --- | --- | --- | --- |
| `MODEL_ACCESS_KEY` | Yes | — | Server-side model access key. Never exposed to the browser or logs. |
| `INFERENCE_MODEL` | No | `openai-gpt-oss-20b` | Model id from the [catalog](https://docs.digitalocean.com/products/inference/details/models/). |
| `INFERENCE_BASE_URL` | No | `https://inference.do-ai.run/v1` | OpenAI-compatible base URL (no trailing slash required). |
| `PORT` | No | `8080` | HTTP listen port. |
| `CHAT_RATE_LIMIT_PER_MINUTE` | No | `30` | Max `POST /api/chat` requests per client IP per rolling 60s window. |

**Inference docs:** [Chat Completions](https://docs.digitalocean.com/reference/api/reference/serverless-inference/), [model access keys](https://docs.digitalocean.com/products/inference/how-to/manage-model-access-keys/).

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:8080](http://localhost:8080).

- Without `MODEL_ACCESS_KEY`: bracket UI works; chat shows **unconfigured**; `GET /api/inference-status` returns `"chatConfigured": false`.
- With a key:

```bash
export MODEL_ACCESS_KEY='your-model-access-key'
export INFERENCE_MODEL='openai-gpt-oss-20b'   # optional
npm start
```

Health check:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthz
```

## Docker

```bash
docker build -t grokbot-sample-app .
docker run --rm -p 8080:8080 grokbot-sample-app
```

## Deploy artifact (tar.gz, no clone)

From the repo root (includes `package-lock.json`, `Dockerfile`, app source; excludes secrets and `node_modules`):

```bash
chmod +x scripts/package-deploy-artifact.sh
./scripts/package-deploy-artifact.sh
```

The script prints the **absolute path** to `dist/grokbot-sample-app-deploy-<UTC-timestamp>.tar.gz`.

## App Platform spec

See [`.do/app.yaml`](.do/app.yaml). Replace branch name with your PR branch as needed. **Secrets:** add `MODEL_ACCESS_KEY` in the control panel (the spec uses a `SECRET` placeholder without a value).

## License

MIT — see [LICENSE](LICENSE).

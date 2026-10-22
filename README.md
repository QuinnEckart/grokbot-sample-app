# grokbot-sample-app

A minimal Node.js chat UI that proxies conversation turns to [DigitalOcean Serverless Inference](https://docs.digitalocean.com/products/inference/how-to/use-serverless-inference/) using the OpenAI-compatible [Chat Completions API](https://docs.digitalocean.com/reference/api/reference/serverless-inference/).

This repository is an end-to-end smoke test for the **DigitalOcean Grok Bot** Cursor plugin: run locally, deploy to App Platform, and chat against inference with a model access key kept server-side.

## Default model

| Setting | Value |
| --- | --- |
| `INFERENCE_MODEL` (default) | `openai-gpt-oss-20b` |
| Why | Small open-weight model with **serverless** inference on DigitalOcean-hosted infrastructure (see [Supported Models](https://docs.digitalocean.com/products/inference/details/models/)). |

Override with `INFERENCE_MODEL` if your model access key is scoped to other models.

## Inference endpoint

Base URL: `https://inference.do-ai.run`

Chat completions: `POST https://inference.do-ai.run/v1/chat/completions`

Authenticate with `Authorization: Bearer <MODEL_ACCESS_KEY>` ([model access keys](https://docs.digitalocean.com/products/inference/how-to/manage-model-access-keys/)).

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MODEL_ACCESS_KEY` | Yes (for chat) | — | Secret model access key. Never exposed to the browser. |
| `INFERENCE_MODEL` | No | `openai-gpt-oss-20b` | Model ID from the catalog. |
| `INFERENCE_BASE_URL` | No | `https://inference.do-ai.run/v1` | Override API base (no trailing slash required). |
| `PORT` | No | `8080` | HTTP listen port. |

Server guardrails: ~32 KiB request body, last 20 messages, `max_completion_tokens` capped at 512.

## Run locally

Requires **Node.js 20+** (built-in `fetch`, zero npm dependencies).

```bash
npm start
```

Open [http://localhost:8080](http://localhost:8080).

Without `MODEL_ACCESS_KEY`, the UI loads but `/api/chat` returns a clear configuration error (HTTP 503).

With a key:

```bash
export MODEL_ACCESS_KEY='your-model-access-key'
export INFERENCE_MODEL='openai-gpt-oss-20b'   # optional
npm start
```

Health check:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthz
```

## Model access key

1. Open [Model Access Keys](https://cloud.digitalocean.com/model-studio/manage-keys) in the control panel.
2. Click **Create model access key**, name it, and scope it to your model (or **All models** for testing).
3. Copy the secret once and store it as `MODEL_ACCESS_KEY` (App Platform secret or local env).

See [How to Create and Manage Model Access Keys](https://docs.digitalocean.com/products/inference/how-to/manage-model-access-keys/).

Ensure your team has [Inference prepayment / balance](https://docs.digitalocean.com/products/inference/how-to/manage-serverless-inference-prepayment/) funded; insufficient balance surfaces as a friendly upstream error in the UI (no secret leakage).

## Deploy on App Platform

The spec in [`.do/app.yaml`](.do/app.yaml) deploys from this public Git repository:

- App name: `grokbot-sample-app`
- Region: `nyc`
- One `web` service at repo root (`source_dir` `/`)
- Instance: `basic-xxs`, count `1`
- `http_port` `8080`, health check `/healthz`
- `MODEL_ACCESS_KEY` as a `SECRET` (replace the placeholder before deploy)

Using `doctl` (after replacing the placeholder secret):

```bash
doctl apps create --spec .do/app.yaml
```

Or paste the YAML in the control panel under **Create App → Upload spec**.

## License

MIT — see [LICENSE](LICENSE).

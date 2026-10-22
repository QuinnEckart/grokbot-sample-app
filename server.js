import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const PORT = Number(process.env.PORT) || 8080;
const MODEL_ACCESS_KEY = process.env.MODEL_ACCESS_KEY?.trim() || "";
const INFERENCE_MODEL =
  process.env.INFERENCE_MODEL?.trim() || "openai-gpt-oss-20b";
const INFERENCE_BASE_URL = (
  process.env.INFERENCE_BASE_URL?.trim() ||
  "https://inference.do-ai.run/v1"
).replace(/\/$/, "");

const MAX_BODY_BYTES = 32 * 1024;
const MAX_HISTORY_MESSAGES = 20;
const MAX_COMPLETION_TOKENS = 512;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("messages must be an array");
  }
  const trimmed = raw.slice(-MAX_HISTORY_MESSAGES);
  return trimmed.map((m) => {
    if (!m || typeof m !== "object") {
      throw new Error("invalid message");
    }
    const role = m.role;
    const content = m.content;
    if (
      role !== "user" &&
      role !== "assistant" &&
      role !== "system"
    ) {
      throw new Error("invalid message role");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("message content must be a non-empty string");
    }
    return { role, content: content.slice(0, 16_000) };
  });
}

function upstreamErrorMessage(status, bodyText) {
  try {
    const data = JSON.parse(bodyText);
    const msg =
      data?.error?.message ||
      data?.message ||
      data?.detail ||
      (typeof data?.error === "string" ? data.error : null);
    if (msg && typeof msg === "string") {
      return msg;
    }
  } catch {
    /* ignore */
  }
  if (status === 401 || status === 403) {
    return "Authentication failed. Check that MODEL_ACCESS_KEY is valid and scoped to this model.";
  }
  if (status === 402 || status === 429) {
    return "Inference request was rejected (billing or rate limit). Check your Inference balance and quotas.";
  }
  return `Inference upstream returned HTTP ${status}.`;
}

/** Prefer visible assistant content; reasoning models may leave content empty. */
function extractAssistantReply(message) {
  if (!message || typeof message !== "object") {
    return null;
  }
  const content = message.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }
  const reasoning =
    message.reasoning_content ??
    message.reasoning ??
    message.reasoning_text;
  if (typeof reasoning === "string" && reasoning.trim()) {
    return reasoning;
  }
  return null;
}

async function handleChat(req, res) {
  if (!MODEL_ACCESS_KEY) {
    sendJson(res, 503, {
      error:
        "Chat is unavailable: set MODEL_ACCESS_KEY on the server (see README).",
    });
    return;
  }

  let bodyBuf;
  try {
    bodyBuf = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err.message === "BODY_TOO_LARGE") {
      sendJson(res, 413, { error: "Request body too large." });
      return;
    }
    sendJson(res, 400, { error: "Could not read request body." });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(bodyBuf.toString("utf8"));
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  let messages;
  try {
    messages = sanitizeMessages(payload.messages);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  if (messages.length === 0) {
    sendJson(res, 400, { error: "messages must not be empty." });
    return;
  }

  const upstreamUrl = `${INFERENCE_BASE_URL}/chat/completions`;
  const upstreamBody = {
    model: INFERENCE_MODEL,
    messages,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    max_tokens: MAX_COMPLETION_TOKENS,
    temperature: 0.7,
  };

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MODEL_ACCESS_KEY}`,
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch {
    sendJson(res, 502, {
      error: "Could not reach the inference API. Try again later.",
    });
    return;
  }

  const text = await upstreamRes.text();
  if (!upstreamRes.ok) {
    sendJson(res, upstreamRes.status >= 500 ? 502 : upstreamRes.status, {
      error: upstreamErrorMessage(upstreamRes.status, text),
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    sendJson(res, 502, { error: "Invalid response from inference API." });
    return;
  }

  const reply = extractAssistantReply(data?.choices?.[0]?.message);
  if (reply === null) {
    sendJson(res, 502, { error: "Inference API returned no message content." });
    return;
  }

  sendJson(res, 200, {
    message: { role: "assistant", content: reply },
    usage: data.usage ?? null,
    model: data.model ?? INFERENCE_MODEL,
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "GET" && urlPath === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (req.method === "POST" && urlPath === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res, urlPath);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`grokbot-sample-app listening on :${PORT}`);
});

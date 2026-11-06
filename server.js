import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  summarizeBracketForChat,
  validateLiveBracketPayload,
} from "./lib/bracket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const LIB_DIR = path.join(__dirname, "lib");

const MAX_BODY_BYTES = 48 * 1024;
const MAX_HISTORY_MESSAGES = 12;
const MAX_USER_MESSAGE_CHARS = 4_000;
const MAX_COMPLETION_TOKENS = 512;
const MAX_CONTEXT_CHARS = 6_000;
const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;

const SYSTEM_PROMPT = `You are a bracket discussion assistant for a personal March Madness–style bracket picker.
The field shown is a clearly labeled DEMO — the real 2027 NCAA tournament bracket is not announced yet.
Do not invent current statistics, rankings beyond seed numbers shown, betting odds, injuries, or insider news.
Ground your replies only in the user's picks, team names, seeds, regions, and general tournament concepts.
If asked for stats or odds you do not have, say you do not have that data.
Keep replies concise and helpful. Do not output HTML tags; use plain text only.`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

/**
 * @returns {http.Server}
 */
export function createHttpServer() {
  const PORT = Number(process.env.PORT) || 8080;
  const MODEL_ACCESS_KEY = process.env.MODEL_ACCESS_KEY?.trim() || "";
  const INFERENCE_MODEL =
    process.env.INFERENCE_MODEL?.trim() || "openai-gpt-oss-20b";
  const INFERENCE_BASE_URL = (
    process.env.INFERENCE_BASE_URL?.trim() ||
    "https://inference.do-ai.run/v1"
  ).replace(/\/$/, "");
  const CHAT_RATE_LIMIT_MAX =
    Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE) || 30;

  /** @type {Map<string, number[]>} */
  const chatHits = new Map();

  function clientIp(req) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      return xff.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "local";
  }

  function rateLimitAllowed(key) {
    const now = Date.now();
    const windowStart = now - CHAT_RATE_LIMIT_WINDOW_MS;
    let arr = chatHits.get(key) || [];
    arr = arr.filter((t) => t > windowStart);
    if (arr.length >= CHAT_RATE_LIMIT_MAX) {
      chatHits.set(key, arr);
      return false;
    }
    arr.push(now);
    chatHits.set(key, arr);
    return true;
  }

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

  function sanitizeClientMessages(raw) {
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
      if (role !== "user" && role !== "assistant") {
        throw new Error("invalid message role (only user and assistant allowed)");
      }
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("message content must be a non-empty string");
      }
      return { role, content: content.slice(0, MAX_USER_MESSAGE_CHARS) };
    });
  }

  function bracketContextBlock(validated) {
    const summary = summarizeBracketForChat(validated.teams, validated.picks);
    let block = `Current bracket state:\n${summary}`;
    if (validated.fieldNote) {
      block += `\nField note: ${validated.fieldNote}`;
    }
    if (block.length > MAX_CONTEXT_CHARS) {
      block = block.slice(0, MAX_CONTEXT_CHARS) + "\n…(context truncated)";
    }
    return block;
  }

  function serveStatic(req, res, urlPath) {
    let rel = urlPath === "/" ? "/index.html" : urlPath;
    rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    let baseDir = PUBLIC_DIR;
    if (rel.startsWith("/lib/")) {
      baseDir = LIB_DIR;
      rel = rel.slice(4);
    }
    const filePath = path.join(baseDir, rel);
    if (!filePath.startsWith(baseDir)) {
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
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
      });
      res.end(data);
    });
  }

  async function handleInferenceStatus(_req, res) {
    sendJson(res, 200, {
      chatConfigured: Boolean(MODEL_ACCESS_KEY),
      inferenceModel: INFERENCE_MODEL,
      inferenceBaseUrl: INFERENCE_BASE_URL,
    });
  }

  async function handleChat(req, res) {
    const ip = clientIp(req);
    if (!rateLimitAllowed(ip)) {
      sendJson(res, 429, {
        error: "Too many chat requests. Wait a minute and try again.",
      });
      return;
    }

    if (!MODEL_ACCESS_KEY) {
      sendJson(res, 503, {
        error:
          "Chat is unconfigured: set MODEL_ACCESS_KEY on the server (see README). The bracket editor still works.",
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
      messages = sanitizeClientMessages(payload.messages);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }

    if (messages.length === 0) {
      sendJson(res, 400, { error: "messages must not be empty." });
      return;
    }

    const validated = validateLiveBracketPayload(payload.bracket);
    if (!validated.ok) {
      sendJson(res, 400, { error: validated.error });
      return;
    }

    const context = bracketContextBlock(validated);
    const upstreamMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: context },
      ...messages,
    ];

    const upstreamUrl = `${INFERENCE_BASE_URL}/chat/completions`;
    const upstreamBody = {
      model: INFERENCE_MODEL,
      messages: upstreamMessages,
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
      sendJson(res, 502, {
        error: "Inference API returned no message content.",
      });
      return;
    }

    sendJson(res, 200, {
      message: { role: "assistant", content: reply },
      usage: data.usage ?? null,
      model: data.model ?? INFERENCE_MODEL,
    });
  }

  const server = http.createServer(async (req, res) => {
    const urlPath = (req.url || "/").split("?")[0];

    if (req.method === "GET" && urlPath === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    if (req.method === "GET" && urlPath === "/api/inference-status") {
      await handleInferenceStatus(req, res);
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

  return server;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule && process.env.SKIP_SERVER_LISTEN !== "1") {
  const port = Number(process.env.PORT) || 8080;
  createHttpServer().listen(port, () => {
    console.log(`grokbot-sample-app listening on :${port}`);
  });
}

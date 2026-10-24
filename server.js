import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeBracketForChat } from "./lib/bracket.js";

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

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY_MESSAGES = 12;
const MAX_COMPLETION_TOKENS = 768;

const SYSTEM_PROMPT = `You are a friendly March Madness bracket advisor in a personal side chat.
Help the user think through matchups, potential upsets, and how their picks fit together.
Be concise, enthusiastic about college basketball, and practical — no need to simulate every game in detail unless asked.
When you reference teams, use the names from their bracket.
If their bracket is incomplete, encourage them to finish key regions or the Final Four.
Do not claim to know real-world injury news or insider info; stick to seeds, matchups, and general tournament trends.`;

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
  if (status === 402) {
    return "Inference request was rejected (billing). Check your Inference balance.";
  }
  if (status === 429) {
    return "Rate limited by inference API. Please wait a moment and try again.";
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
    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new Error("invalid message role");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("message content must be a non-empty string");
    }
    return { role, content: content.slice(0, 16_000) };
  });
}

function bracketContextMessage(bracket) {
  if (!bracket || typeof bracket !== "object") {
    return "User bracket: (no bracket data provided)";
  }
  const teams = Array.isArray(bracket.teams) ? bracket.teams : [];
  const picks =
    bracket.picks && typeof bracket.picks === "object" ? bracket.picks : {};
  const summary = summarizeBracketForChat(teams, picks);
  const fieldNote =
    typeof bracket.fieldNote === "string" ? bracket.fieldNote : "";
  return `Current bracket state:\n${summary}${fieldNote ? `\nField note: ${fieldNote}` : ""}`;
}

const app = express();
app.use(express.json({ limit: MAX_BODY_BYTES }));
app.use("/lib", express.static(path.join(__dirname, "lib")));
app.use(express.static(PUBLIC_DIR));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/chat", async (req, res) => {
  if (!MODEL_ACCESS_KEY) {
    res.status(503).json({ error: "Inference not configured" });
    return;
  }

  let messages;
  try {
    messages = sanitizeMessages(req.body?.messages);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (messages.length === 0) {
    res.status(400).json({ error: "messages must not be empty." });
    return;
  }

  const context = bracketContextMessage(req.body?.bracket);
  const upstreamMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: context },
    ...messages.filter((m) => m.role !== "system"),
  ];

  const upstreamUrl = `${INFERENCE_BASE_URL}/chat/completions`;
  const upstreamBody = {
    model: INFERENCE_MODEL,
    messages: upstreamMessages,
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    max_tokens: MAX_COMPLETION_TOKENS,
    temperature: 0.75,
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
    res.status(502).json({
      error: "Could not reach the inference API. Try again later.",
    });
    return;
  }

  const text = await upstreamRes.text();
  if (!upstreamRes.ok) {
    const status =
      upstreamRes.status >= 500 ? 502 : upstreamRes.status;
    res.status(status).json({
      error: upstreamErrorMessage(upstreamRes.status, text),
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    res.status(502).json({ error: "Invalid response from inference API." });
    return;
  }

  const reply = extractAssistantReply(data?.choices?.[0]?.message);
  if (reply === null) {
    res.status(502).json({ error: "Inference API returned no message content." });
    return;
  }

  res.json({
    message: { role: "assistant", content: reply },
    usage: data.usage ?? null,
    model: data.model ?? INFERENCE_MODEL,
  });
});

app.listen(PORT, () => {
  console.log(`march-madness-bracket listening on :${PORT}`);
});

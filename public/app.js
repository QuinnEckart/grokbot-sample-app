const log = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const statusEl = document.getElementById("status");

/** @type {{ role: string, content: string }[]} */
const messages = [
  {
    role: "system",
    content:
      "You are a helpful assistant in a short demo chat. Keep answers concise.",
  },
];

function appendBubble(role, content, isError = false) {
  const el = document.createElement("div");
  el.className = `bubble ${isError ? "error" : role}`;
  el.textContent = content;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  input.disabled = busy;
  statusEl.textContent = busy ? "Waiting for inference…" : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  messages.push({ role: "user", content: text });
  appendBubble("user", text);
  input.value = "";
  setBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err =
        typeof data.error === "string"
          ? data.error
          : "Something went wrong. Try again.";
      appendBubble("assistant", err, true);
      return;
    }

    const reply = data?.message?.content;
    if (typeof reply !== "string") {
      appendBubble("assistant", "Unexpected response from server.", true);
      return;
    }

    messages.push({ role: "assistant", content: reply });
    appendBubble("assistant", reply);
  } catch {
    appendBubble(
      "assistant",
      "Network error. Check your connection and try again.",
      true,
    );
  } finally {
    setBusy(false);
    input.focus();
  }
});

input.focus();

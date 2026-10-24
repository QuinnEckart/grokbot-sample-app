import {
  REGIONS,
  ROUND_LABELS,
  ROUND_ORDER,
  allGameIds,
  autoFillChalk,
  autoFillRandom,
  clearDownstreamPicks,
  contestants,
  createExampleField,
  championTeamId,
  parseGameId,
} from "/lib/bracket.js";

const STORAGE_KEY = "march-madness-bracket-v1";
const FIELD_NOTE =
  "Example field — edit team names to match a real NCAA draw.";

/** @type {{ teams: import('../lib/bracket.js').Team[], picks: Record<string, string>, fieldNote: string }} */
let state = loadState();

const bracketRoot = document.getElementById("bracket-root");
const championBanner = document.getElementById("champion-banner");
const fieldNoteEl = document.getElementById("field-note");
const teamsDialog = document.getElementById("teams-dialog");
const teamsEditor = document.getElementById("teams-editor");

const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const chatStatus = document.getElementById("chat-status");
const inferenceNotice = document.getElementById("inference-notice");
const chatPanel = document.getElementById("chat-panel");

/** @type {{ role: string, content: string }[]} */
const chatMessages = [];

let inferenceAvailable = true;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.teams) && parsed.teams.length === 64) {
        return {
          teams: parsed.teams,
          picks: parsed.picks && typeof parsed.picks === "object" ? parsed.picks : {},
          fieldNote: parsed.fieldNote || FIELD_NOTE,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    teams: createExampleField(),
    picks: {},
    fieldNote: FIELD_NOTE,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function teamById(id) {
  return state.teams.find((t) => t.id === id);
}

function renderFieldNote() {
  fieldNoteEl.textContent = state.fieldNote;
}

function renderChampionBanner() {
  const champId = championTeamId(state.picks);
  if (!champId) {
    championBanner.classList.add("hidden");
    championBanner.textContent = "";
    return;
  }
  const t = teamById(champId);
  championBanner.classList.remove("hidden");
  championBanner.textContent = t
    ? `🏆 Your champion: ${t.name} (${t.region}, #${t.seed})`
    : "🏆 Bracket complete!";
}

function matchupLabel(gid) {
  const p = parseGameId(gid);
  if (p.round === "f4") return `Final Four · Game ${p.index + 1}`;
  if (p.round === "champ") return "National Championship";
  return `${p.region} · ${ROUND_LABELS[p.round]}`;
}

function renderMatchup(gid) {
  const [c1, c2] = contestants(state.teams, state.picks, gid);
  const pick = state.picks[gid];
  const wrap = document.createElement("div");
  wrap.className = "matchup";
  wrap.dataset.gameId = gid;

  const title = document.createElement("div");
  title.className = "matchup-label";
  title.textContent = matchupLabel(gid);
  wrap.appendChild(title);

  for (const c of [c1, c2]) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "team-slot";
    if (!c) {
      row.classList.add("empty");
      row.disabled = true;
      row.textContent = "—";
    } else {
      row.dataset.teamId = c.id;
      const seed = document.createElement("span");
      seed.className = "seed";
      seed.textContent = String(c.seed);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = c.name;
      row.append(seed, name);
      if (pick === c.id) row.classList.add("picked");
    }
    row.addEventListener("click", () => onPick(gid, c?.id));
    wrap.appendChild(row);
  }
  return wrap;
}

function renderRegion(region) {
  const col = document.createElement("div");
  col.className = "region";
  const h = document.createElement("h3");
  h.textContent = region;
  col.appendChild(h);

  const rounds = document.createElement("div");
  rounds.className = "region-rounds";

  for (const round of ["r64", "r32", "s16", "e8"]) {
    const roundCol = document.createElement("div");
    roundCol.className = `round round-${round}`;
    const gids = allGameIds().filter((id) => {
      const p = parseGameId(id);
      return p.region === region && p.round === round;
    });
    for (const gid of gids) {
      roundCol.appendChild(renderMatchup(gid));
    }
    rounds.appendChild(roundCol);
  }
  col.appendChild(rounds);
  return col;
}

function renderFinals() {
  const finals = document.createElement("div");
  finals.className = "finals";
  const h = document.createElement("h3");
  h.textContent = "Final Four & Championship";
  finals.appendChild(h);
  const grid = document.createElement("div");
  grid.className = "finals-grid";
  for (const gid of ["f4:0", "f4:1", "champ:0"]) {
    grid.appendChild(renderMatchup(gid));
  }
  finals.appendChild(grid);
  return finals;
}

function renderBracket() {
  bracketRoot.replaceChildren();
  const regionsRow = document.createElement("div");
  regionsRow.className = "regions-row";
  for (const r of REGIONS) {
    regionsRow.appendChild(renderRegion(r));
  }
  bracketRoot.append(regionsRow, renderFinals());
  renderChampionBanner();
}

function onPick(gid, teamId) {
  if (!teamId) return;
  const [c1, c2] = contestants(state.teams, state.picks, gid);
  if (!c1 || !c2) return;
  if (teamId !== c1.id && teamId !== c2.id) return;

  if (state.picks[gid] === teamId) return;

  state.picks[gid] = teamId;
  state.picks = clearDownstreamPicks(state.picks, gid);
  saveState();
  renderBracket();
}

function resetPicks() {
  if (!confirm("Clear all picks?")) return;
  state.picks = {};
  saveState();
  renderBracket();
}

function fillChalk() {
  state.picks = autoFillChalk(state.teams);
  saveState();
  renderBracket();
}

function fillRandom() {
  state.picks = autoFillRandom(state.teams);
  saveState();
  renderBracket();
}

function openTeamsEditor() {
  teamsEditor.replaceChildren();
  for (const region of REGIONS) {
    const block = document.createElement("fieldset");
    block.className = "region-fieldset";
    const legend = document.createElement("legend");
    legend.textContent = region;
    block.appendChild(legend);
    const regionTeams = state.teams
      .filter((t) => t.region === region)
      .sort((a, b) => a.seed - b.seed);
    for (const t of regionTeams) {
      const row = document.createElement("label");
      row.className = "team-edit-row";
      const seed = document.createElement("span");
      seed.textContent = `#${t.seed}`;
      const input = document.createElement("input");
      input.type = "text";
      input.value = t.name;
      input.dataset.teamId = t.id;
      input.maxLength = 80;
      row.append(seed, input);
      block.appendChild(row);
    }
    teamsEditor.appendChild(block);
  }
  teamsDialog.showModal();
}

function saveTeamsFromDialog() {
  const inputs = teamsEditor.querySelectorAll("input[data-team-id]");
  for (const input of inputs) {
    const id = input.dataset.teamId;
    const team = teamById(id);
    if (team) team.name = input.value.trim() || team.name;
  }
  state.picks = {};
  state.fieldNote = "Custom field — names saved locally.";
  saveState();
  renderFieldNote();
  renderBracket();
}

function appendChatBubble(role, content, isError = false) {
  const el = document.createElement("div");
  el.className = `bubble ${isError ? "error" : role}`;
  el.textContent = content;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setChatBusy(busy) {
  chatSend.disabled = busy;
  chatInput.disabled = busy;
  chatStatus.textContent = busy ? "Thinking…" : "";
}

function bracketPayload() {
  return {
    teams: state.teams,
    picks: state.picks,
    fieldNote: state.fieldNote,
  };
}

async function probeInference() {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "ping" }],
        bracket: bracketPayload(),
      }),
    });
    if (res.status === 503) {
      inferenceAvailable = false;
      inferenceNotice.textContent =
        "Chat advisor is offline until MODEL_ACCESS_KEY is configured on the server.";
      inferenceNotice.classList.remove("hidden");
      return;
    }
    inferenceAvailable = true;
    inferenceNotice.classList.add("hidden");
  } catch {
    /* ignore probe errors */
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatMessages.push({ role: "user", content: text });
  appendChatBubble("user", text);
  chatInput.value = "";
  setChatBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatMessages.slice(-12),
        bracket: bracketPayload(),
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err =
        typeof data.error === "string"
          ? data.error
          : "Something went wrong. Try again.";
      if (res.status === 503) {
        inferenceAvailable = false;
        inferenceNotice.textContent =
          "Chat advisor needs MODEL_ACCESS_KEY on the server. You can still fill out your bracket.";
        inferenceNotice.classList.remove("hidden");
      }
      appendChatBubble("assistant", err, true);
      return;
    }

    const reply = data?.message?.content;
    if (typeof reply !== "string") {
      appendChatBubble("assistant", "Unexpected response from server.", true);
      return;
    }
    chatMessages.push({ role: "assistant", content: reply });
    appendChatBubble("assistant", reply);
  } catch {
    appendChatBubble(
      "assistant",
      "Network error. Check your connection and try again.",
      true,
    );
  } finally {
    setChatBusy(false);
    chatInput.focus();
  }
});

document.getElementById("btn-reset").addEventListener("click", resetPicks);
document.getElementById("btn-chalk").addEventListener("click", fillChalk);
document.getElementById("btn-random").addEventListener("click", fillRandom);
document.getElementById("btn-teams").addEventListener("click", openTeamsEditor);
document.getElementById("teams-cancel").addEventListener("click", () =>
  teamsDialog.close(),
);
document.getElementById("teams-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveTeamsFromDialog();
  teamsDialog.close();
});

const chatToggle = document.getElementById("btn-chat-toggle");
const chatClose = document.getElementById("btn-chat-close");
chatToggle.addEventListener("click", () => {
  chatPanel.classList.add("open");
  chatToggle.setAttribute("aria-expanded", "true");
});
chatClose.addEventListener("click", () => {
  chatPanel.classList.remove("open");
  chatToggle.setAttribute("aria-expanded", "false");
});

appendChatBubble(
  "assistant",
  "Hi! I'm your bracket advisor. Ask me about matchups, chalk vs. chaos, or how your Final Four looks.",
);

renderFieldNote();
renderBracket();
probeInference();

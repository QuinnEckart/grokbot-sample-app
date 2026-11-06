import {
  REGIONS,
  ROUND_LABELS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  DEMO_FIELD_NOTE,
  allGameIds,
  autoFillChalk,
  autoFillRandom,
  clearDownstreamPicks,
  contestants,
  createExampleField,
  championTeamId,
  parseGameId,
  validateBracketImport,
} from "/lib/bracket.js";

const STORAGE_KEY = "march-madness-bracket-v2";

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
const importFile = document.getElementById("import-file");

/** @type {{ role: string, content: string }[]} */
const chatMessages = [];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.teams) && parsed.teams.length === 64) {
        return {
          teams: parsed.teams,
          picks:
            parsed.picks && typeof parsed.picks === "object" ? parsed.picks : {},
          fieldNote:
            typeof parsed.fieldNote === "string" ? parsed.fieldNote : DEMO_FIELD_NOTE,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return {
    teams: createExampleField(),
    picks: {},
    fieldNote: DEMO_FIELD_NOTE,
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
  if (!confirm("Clear all picks in every round?")) return;
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

function exportBracket() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: EXPORT_FORMAT,
          version: EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          fieldNote: state.fieldNote,
          teams: state.teams,
          picks: state.picks,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bracket-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

function applyImport(parsed) {
  const result = validateBracketImport(parsed);
  if (!result.ok) {
    alert(result.error);
    return;
  }
  state.teams = result.teams;
  state.picks = result.picks;
  state.fieldNote = result.fieldNote;
  saveState();
  chatMessages.length = 0;
  chatLog.replaceChildren();
  appendChatBubble(
    "assistant",
    "Imported bracket loaded. Chat history was cleared so the assistant matches your new picks.",
  );
  renderFieldNote();
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
  state.fieldNote = "Custom field — team names saved locally (demo / not the official draw).";
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
  chatStatus.textContent = busy ? "Waiting for inference…" : "";
}

function bracketPayload() {
  return {
    teams: state.teams,
    picks: state.picks,
    fieldNote: state.fieldNote,
  };
}

async function refreshInferenceNotice() {
  try {
    const res = await fetch("/api/inference-status");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || typeof data !== "object") return;
    if (data.chatConfigured) {
      inferenceNotice.classList.add("hidden");
      inferenceNotice.textContent = "";
      return;
    }
    inferenceNotice.textContent =
      "Chat is unconfigured until MODEL_ACCESS_KEY is set on the server. You can still fill the bracket.";
    inferenceNotice.classList.remove("hidden");
  } catch {
    /* ignore */
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
        inferenceNotice.textContent = err;
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
    inferenceNotice.classList.add("hidden");
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
document.getElementById("btn-export").addEventListener("click", exportBracket);
document.getElementById("btn-import").addEventListener("click", () =>
  importFile.click(),
);
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    applyImport(JSON.parse(text));
  } catch {
    alert("Could not read that file as JSON.");
  }
});
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
  "This is a demo field — the real 2027 NCAA bracket is not announced yet. I only discuss the teams and seeds you see here (no live stats or odds). When chat is configured on the server, I can reason about your picks in context.",
);

renderFieldNote();
renderBracket();
refreshInferenceNotice();

"use strict";

const SCREENS = ["welcome", "chat", "review", "done"];
const STATUS_LABELS = [
  ["active", "Looking now"],
  ["standing", "Tell me when something comes up"],
  ["conditional", "Only if the conditions are right"],
  ["dormant", "Open to it, not looking"],
];
const BASIS_LABELS = [
  ["one-off", "one-off"],
  ["per-hour", "per hour"],
  ["per-month", "per month"],
];
// The first participant turn is the automatic greeting, so this means at least two real answers.
const MIN_PARTICIPANT_TURNS_FOR_REVIEW = 3;

let session = null;

const $ = (selector, root = document) => root.querySelector(selector);

// Builds DOM nodes; strings become text nodes, so participant and model text is never parsed as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function show(screen) {
  for (const s of SCREENS) $(`#${s}`).hidden = s !== screen;
  window.scrollTo(0, 0);
}

function setError(form, message) {
  $(".error", form).textContent = message;
}

function setBusy(form, busy) {
  for (const control of form.querySelectorAll("button, input, textarea, select")) control.disabled = busy;
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Something went wrong (${response.status}).`);
  return data;
}

function rememberSession() {
  history.replaceState(null, "", `#${session.id}`);
}

function showSession() {
  if (session.status === "interviewing") renderChat();
  else if (session.status === "reviewing") renderReview();
  else renderDone();
}

// Welcome

$("#start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = $('button[type="submit"]', form);
  setError(form, "");
  setBusy(form, true);
  button.textContent = "Starting…";
  try {
    session = await api("POST", "/api/sessions", {
      name: String(data.get("name") || "").trim(),
      kind: data.get("kind"),
      consent: data.get("consent") === "on",
    });
    rememberSession();
    renderChat();
  } catch (err) {
    setError(form, err.message);
  } finally {
    setBusy(form, false);
    button.textContent = "Start the interview";
  }
});

// Chat

function renderChat(pending = false) {
  const list = $("#messages");
  list.replaceChildren(...session.transcript.map((turn) => el("li", { class: turn.role }, turn.text)));
  if (pending) list.append(el("li", { class: "interviewer typing" }, "…"));
  const participantTurns = session.transcript.filter((turn) => turn.role === "participant").length;
  $("#review-button").disabled = pending || participantTurns < MIN_PARTICIPANT_TURNS_FOR_REVIEW;
  show("chat");
  list.lastElementChild?.scrollIntoView({ block: "end" });
}

const messageForm = $("#message-form");

messageForm.text.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageForm.text.value.trim();
  if (!text) return;
  setError(messageForm, "");
  session.transcript.push({ role: "participant", text });
  messageForm.text.value = "";
  setBusy(messageForm, true);
  renderChat(true);
  try {
    session = await api("POST", `/api/sessions/${session.id}/messages`, { text });
  } catch (err) {
    session.transcript.pop();
    messageForm.text.value = text;
    setError(messageForm, err.message);
  } finally {
    setBusy(messageForm, false);
    renderChat();
    messageForm.text.focus();
  }
});

$("#review-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  setError(messageForm, "");
  setBusy(messageForm, true);
  button.textContent = "Summarizing your answers…";
  try {
    session = await api("POST", `/api/sessions/${session.id}/extract`);
    renderReview();
  } catch (err) {
    setError(messageForm, err.message);
  } finally {
    setBusy(messageForm, false);
    button.textContent = "Review my answers";
    if (session.status === "interviewing") renderChat();
  }
});

// Review

function field(label, control, hint) {
  return el("label", { class: "field" }, el("span", {}, label), control, hint ? el("small", {}, hint) : null);
}

function numberInput(name, value) {
  return el("input", { type: "number", min: "0", step: "any", inputMode: "decimal", name, value: value ?? "" });
}

function select(name, options, selected) {
  return el("select", { name }, ...options.map(([value, label]) => el("option", { value, selected: value === selected }, label)));
}

function blockerRow(blocker) {
  return el(
    "fieldset",
    { class: "blocker" },
    el("legend", {}, "What's stopping you"),
    field("The obstacle", el("input", { name: "description", value: blocker.description })),
    field("What would solve it", el("input", { name: "resolvedBy", value: blocker.resolvedBy }), "Short label, e.g. data-migration"),
    field("Most you'd pay toward solving it ($)", numberInput("maxContribution", blocker.maxContribution)),
  );
}

function intentCard(intent, index) {
  const isOffer = intent.direction === "offer";
  const removeBox = el("input", { type: "checkbox", name: "remove" });
  const card = el(
    "fieldset",
    { class: "intent", dataset: { direction: intent.direction, index: String(index) } },
    el("legend", {}, isOffer ? "You could offer" : "You'd be open to"),
    intent.evidence ? el("blockquote", {}, `You said: “${intent.evidence}”`) : null,
    field("In your words", el("textarea", { name: "summary", rows: 2, value: intent.summary })),
    field("Category", el("input", { name: "tag", value: intent.tag }), "Short label used to match people, e.g. product-feedback"),
    field("How actively", select("status", STATUS_LABELS, intent.status)),
    el(
      "div",
      { class: "row" },
      field(isOffer ? "Least you'd accept ($)" : "Most you'd pay ($)", numberInput("reservationPrice", intent.reservationPrice)),
      field("Basis", select("priceBasis", BASIS_LABELS, intent.priceBasis)),
    ),
    isOffer ? field("Hours per week this takes", numberInput("hours", intent.hours)) : null,
    isOffer && session.participant.kind === "business"
      ? field("Budget to win a customer ($)", numberInput("incentiveBudget", intent.incentiveBudget), "For example, covering their switching costs")
      : null,
    ...(isOffer ? [] : intent.blockers.map(blockerRow)),
    el("label", { class: "choice" }, el("input", { type: "checkbox", name: "group", checked: true }), "OK to be part of an arrangement with several people"),
    el("label", { class: "choice remove" }, removeBox, "Leave this out"),
  );
  removeBox.addEventListener("change", () => card.classList.toggle("removed", removeBox.checked));
  return card;
}

function renderReview() {
  const extraction = session.extraction;
  const form = $("#review-form");
  setError(form, "");
  form.hoursPerWeek.value = extraction.hoursPerWeek ?? "";

  const intents = $("#intents");
  intents.replaceChildren(...extraction.intents.map(intentCard));
  if (extraction.intents.length === 0)
    intents.append(el("p", { class: "lede" }, "We didn't pick up anything to keep. You can go back to the interview, or confirm to finish."));

  const questions = $("#open-questions");
  questions.replaceChildren();
  if (extraction.openQuestions.length > 0)
    questions.append(el("p", {}, "Details we didn't catch"), el("ul", {}, ...extraction.openQuestions.map((q) => el("li", {}, q))));

  show("review");
}

function readNumber(input) {
  if (!input || input.value.trim() === "") return null;
  const n = Number(input.value);
  return Number.isFinite(n) ? n : NaN;
}

function collectReview(form) {
  const problems = [];
  const intents = [];
  for (const card of form.querySelectorAll(".intent")) {
    const get = (name) => $(`[name="${name}"]`, card);
    if (get("remove").checked) continue;

    const isOffer = card.dataset.direction === "offer";
    const summary = get("summary").value.trim();
    const label = summary ? `“${summary}”` : "an item";
    const price = readNumber(get("reservationPrice"));
    if (price === null || Number.isNaN(price) || price < 0) {
      problems.push(`Add a price for ${label}, or tick "Leave this out".`);
      continue;
    }
    if (!get("tag").value.trim()) {
      problems.push(`Add a category for ${label}.`);
      continue;
    }

    const blockers = isOffer
      ? []
      : [...card.querySelectorAll(".blocker")]
          .map((row) => ({
            description: $('[name="description"]', row).value.trim(),
            resolvedBy: $('[name="resolvedBy"]', row).value.trim(),
            maxContribution: readNumber($('[name="maxContribution"]', row)) || 0,
          }))
          .filter((b) => b.description);
    for (const b of blockers) if (!b.resolvedBy) problems.push(`Say what would solve "${b.description}".`);

    intents.push({
      direction: card.dataset.direction,
      status: get("status").value,
      summary,
      tag: get("tag").value.trim(),
      reservationPrice: price,
      priceBasis: get("priceBasis").value,
      hours: isOffer ? readNumber(get("hours")) || 0 : 0,
      capacity: 1,
      incentiveBudget: isOffer ? readNumber(get("incentiveBudget")) || 0 : 0,
      blockers,
      mandate: { mayNegotiate: true, mayJoinMultiParty: get("group").checked },
      evidence: session.extraction.intents[Number(card.dataset.index)].evidence,
    });
  }
  const hours = readNumber(form.hoursPerWeek);
  if (Number.isNaN(hours) || (hours !== null && hours < 0)) problems.push("Hours per week should be a number.");
  return { problems, body: { hoursPerWeek: hours || 0, intents } };
}

$("#review-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const { problems, body } = collectReview(form);
  if (problems.length > 0) return setError(form, problems.join(" "));
  setError(form, "");
  setBusy(form, true);
  try {
    session = await api("POST", `/api/sessions/${session.id}/confirm`, body);
    renderDone();
  } catch (err) {
    setError(form, err.message);
  } finally {
    setBusy(form, false);
  }
});

$("#back-button").addEventListener("click", () => renderChat());

// Done

function renderDone() {
  const kept = session.confirmed?.intents.length ?? 0;
  $("#done-summary").textContent =
    kept > 0
      ? `We saved ${kept} ${kept === 1 ? "item" : "items"} for matching. Nothing else from the conversation is used.`
      : "Nothing was kept for matching, and that's useful to know too.";
  show("done");
}

// Resume an interview from the URL hash, so a refresh doesn't lose it.

async function init() {
  const id = location.hash.slice(1);
  if (!id) return show("welcome");
  try {
    session = await api("GET", `/api/sessions/${encodeURIComponent(id)}`);
    showSession();
  } catch {
    history.replaceState(null, "", "/");
    show("welcome");
  }
}

init();

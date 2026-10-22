// Browser side of the prototype. It never changes state itself: it sends an
// "action" to the server, and redraws whenever the server broadcasts "state".

let myRole = null;
const socket = new WebSocket(`ws://${location.host}/ws`);

function send(message) {
  socket.send(JSON.stringify(message));
}

function doAction(action, extra = {}) {
  send({ type: "action", action, ...extra });
}

// ---- Role picker --------------------------------------------------------

document.querySelectorAll("#role-picker button").forEach((button) => {
  button.addEventListener("click", () => {
    myRole = button.dataset.role;
    send({ type: "join", role: myRole });
    document.getElementById("my-role").textContent = myRole;
    document.getElementById("role-picker").hidden = true;
    document.getElementById("workspace").hidden = false;
    if (myRole === "expert") setUpExpertControls();
    if (myRole === "novice") setUpNoviceControls();
  });
});

// ---- Shared LED button (both roles) -------------------------------------

document.getElementById("led-button").addEventListener("click", () => {
  doAction("toggle_led");
});

// ---- Messages from the server -------------------------------------------

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "state") render(msg);
  if (msg.type === "error") showError(msg.message);
});

socket.addEventListener("close", () => {
  showError("Lost connection to the server. Is server.py still running?");
});

function render({ state, online }) {
  document.getElementById("led").classList.toggle("on", state.led_on);
  document.getElementById("last-changed").textContent = state.last_changed_by
    ? `Last switched by the ${state.last_changed_by}`
    : "";
  document.getElementById("online").textContent =
    `Online: ${online.expert} expert, ${online.novice} novice`;
  showError("");

  // Later: drawAvatar(state.avatar); drawHighlight(state.highlighted);
}

function showError(text) {
  document.getElementById("error").textContent = text;
}

// ---- Expert skeleton (NOT IMPLEMENTED YET) ------------------------------

function setUpExpertControls() {
  // Pseudocode:
  //   on keydown:
  //     W / ArrowUp    -> doAction("move_avatar", { dx: 0,  dy: -1 })
  //     S / ArrowDown  -> doAction("move_avatar", { dx: 0,  dy: 1 })
  //     A / ArrowLeft  -> doAction("move_avatar", { dx: -1, dy: 0 })
  //     D / ArrowRight -> doAction("move_avatar", { dx: 1,  dy: 0 })
  //     Space          -> doAction("point_at")   // highlight what the figure points at
}

// function drawAvatar(position) {
//   move the stick figure <svg>/<img> to position.x, position.y on #stage
//   swap to a "walking" frame while moving, "pointing" frame when pointing
// }

// function drawHighlight(objectId) {
//   add a glowing outline to the element on the fake Blender image with that id
// }

// ---- Novice skeleton (NOT IMPLEMENTED YET) ------------------------------

function setUpNoviceControls() {
  // Pseudocode:
  //   for each clickable region on the fake Blender image (e.g. "add_cube"):
  //     on click -> doAction("press_ui_button", { button_id: region.id })
}

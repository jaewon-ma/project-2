// Expertise-sharing prototype, running entirely in the browser so it can be
// hosted on GitHub Pages (which can't run a server).
//
// How the two users connect: the expert's browser is the "host". It creates a
// room on the free PeerJS service and then talks directly to the novice's
// browser over WebRTC. The PeerJS server is only used to introduce the two
// browsers; the button presses themselves go peer to peer.
//
// The host owns the one shared `state` and the RBAC table. The novice never
// changes state itself: it sends an "action", the host checks the novice's
// role against PERMISSIONS, applies it, and sends the new state back to
// everyone. There is no authentication; each user just says which role they
// are. This is a proof of concept.

const ROOM_PREFIX = "cpsc581-expertise-"; // keeps our room ids apart from other PeerJS users
const PEER_OPTIONS = window.PEER_OPTIONS || {}; // e.g. { host, port } for a self-hosted PeerJS server

// ---- RBAC: which role may do which action ------------------------------

const PERMISSIONS = {
  expert: new Set(["toggle_led", "move_avatar", "point_at"]),
  novice: new Set(["toggle_led", "press_ui_button"]),
};

function can(role, action) {
  return PERMISSIONS[role]?.has(action) ?? false;
}

// ---- Shared state (only the expert's copy is the real one) --------------

const state = {
  led_on: false,
  last_changed_by: null,
  // Placeholders for later features:
  avatar: { x: 0, y: 0 }, // expert's stick figure position
  highlighted: null, // id of the object the expert is pointing at
};

// ---- Action handlers (run on the expert's browser only) -----------------

class NotImplemented extends Error {}

const HANDLERS = {
  toggle_led(role, msg) {
    state.led_on = !state.led_on;
    state.last_changed_by = role;
  },

  move_avatar(role, msg) {
    // NOT IMPLEMENTED YET. Pseudocode:
    //   dx, dy = msg.dx, msg.dy               // e.g. -1/0/1 from WASD/arrows
    //   state.avatar.x = clamp(x + dx * STEP, 0, SCREEN_WIDTH)
    //   state.avatar.y = clamp(y + dy * STEP, 0, SCREEN_HEIGHT)
    throw new NotImplemented();
  },

  point_at(role, msg) {
    // NOT IMPLEMENTED YET. Pseudocode:
    //   target = object on the fake Blender image nearest the avatar's hand
    //   state.highlighted = target             // everyone sees it glow
    throw new NotImplemented();
  },

  press_ui_button(role, msg) {
    // NOT IMPLEMENTED YET. Pseudocode:
    //   button_id = msg.button_id              // e.g. "add_cube", "extrude"
    //   update the fake Blender scene
    //   maybe clear state.highlighted if the novice pressed the right thing
    throw new NotImplemented();
  },
};

// ---- Connection setup ---------------------------------------------------

let myRole = null;
let peer = null;
const guests = new Set(); // expert only: open connections to novices
let hostConn = null; // novice only: connection to the expert

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, they look like 1 and 0
  let code = "";
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function startAsExpert(code = randomCode()) {
  myRole = "expert";
  peer = new Peer(ROOM_PREFIX + code, PEER_OPTIONS);

  peer.on("open", () => {
    showWorkspace(code);
    setUpExpertControls();
    broadcastState();
  });

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      guests.add(conn);
      broadcastState();
    });
    conn.on("data", (msg) => {
      if (msg.type === "action") handleAction(conn.metadata?.role, msg, conn);
    });
    conn.on("close", () => {
      guests.delete(conn);
      broadcastState();
    });
  });

  peer.on("error", (err) => {
    if (err.type === "unavailable-id") {
      peer.destroy(); // that room code is taken, try another one
      startAsExpert();
    } else {
      showError(`Connection problem: ${err.type}`);
    }
  });
}

function startAsNovice(code) {
  myRole = "novice";
  peer = new Peer(PEER_OPTIONS);

  peer.on("open", () => {
    hostConn = peer.connect(ROOM_PREFIX + code, { metadata: { role: "novice" }, reliable: true });
    hostConn.on("open", () => {
      showWorkspace(code);
      setUpNoviceControls();
    });
    hostConn.on("data", (msg) => {
      if (msg.type === "state") render(msg);
      if (msg.type === "error") showError(msg.message);
    });
    hostConn.on("close", () => showError("The expert left, so the session has ended."));
  });

  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") {
      showPickerError(`No expert is in room ${code}. Check the code and try again.`);
      peer.destroy();
    } else {
      showPickerError(`Connection problem: ${err.type}`);
    }
  });
}

// ---- Applying actions (expert's browser) --------------------------------

function handleAction(role, msg, fromConn) {
  const reply = (text) => {
    if (fromConn) fromConn.send({ type: "error", message: text });
    else showError(text);
  };

  if (!can(role, msg.action)) return reply(`A ${role} is not allowed to ${msg.action}.`);
  try {
    HANDLERS[msg.action](role, msg);
    broadcastState();
  } catch (e) {
    if (e instanceof NotImplemented) reply(`${msg.action} is not implemented yet.`);
    else throw e;
  }
}

function broadcastState() {
  const roles = [...guests].map((c) => c.metadata?.role);
  const msg = {
    type: "state",
    state,
    online: { expert: 1, novice: roles.filter((r) => r === "novice").length },
  };
  render(msg);
  guests.forEach((conn) => conn.send(msg));
}

// Both roles call this. The expert applies it locally; the novice sends it.
function doAction(action, extra = {}) {
  const msg = { type: "action", action, ...extra };
  if (myRole === "expert") handleAction("expert", msg, null);
  else hostConn.send(msg);
}

// ---- Page wiring ---------------------------------------------------------

const roomInput = document.getElementById("room-input");
const roomFromLink = new URLSearchParams(location.search).get("room");
if (roomFromLink) roomInput.value = roomFromLink;

document.getElementById("expert-button").addEventListener("click", () => startAsExpert());

document.getElementById("novice-button").addEventListener("click", () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) return showPickerError("Enter the room code from your expert first.");
  showPickerError("Connecting…");
  startAsNovice(code);
});

document.getElementById("led-button").addEventListener("click", () => doAction("toggle_led"));

// Close connections cleanly when the tab closes, so the other side finds out right away.
window.addEventListener("pagehide", () => peer?.destroy());

function showWorkspace(code) {
  document.getElementById("my-role").textContent = myRole;
  document.getElementById("room-code").textContent = code;
  document.getElementById("role-picker").hidden = true;
  document.getElementById("workspace").hidden = false;
}

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

function showPickerError(text) {
  document.getElementById("picker-error").textContent = text;
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

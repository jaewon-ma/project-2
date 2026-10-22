// Expertise-sharing prototype, running entirely in the browser so it can be
// hosted on GitHub Pages (which can't run a server).
//
// How the two users connect: the expert's browser is the "host". It creates a
// room on the free PeerJS service and then talks directly to the novice's
// browser over WebRTC. The PeerJS server is only used to introduce the two
// browsers; everything else goes peer to peer.
//
// The host owns the one shared `state` and the RBAC table. The novice never
// changes state itself: it sends an "action", the host checks the novice's
// role against PERMISSIONS, applies it, and sends the new state back to
// everyone. There is no authentication; each user just says which role they
// are. This is a proof of concept.
//
// Everything on the fake Blender screen uses the drawing's own pixel
// coordinates (1920 x 1080), so both users see the same thing at any size.

const ROOM_PREFIX = "cpsc581-expertise-"; // keeps our room ids apart from other PeerJS users
const PEER_OPTIONS = window.PEER_OPTIONS || {}; // e.g. { host, port } for a self-hosted PeerJS server
const SCREEN_W = 1920;
const SCREEN_H = 1080;

// ---- RBAC: which role may do which action ------------------------------

const PERMISSIONS = {
  expert: new Set(["move_avatar", "point_at", "highlight", "set_emotion", "say"]),
  novice: new Set(["press_ui_button"]),
};

function can(role, action) {
  return PERMISSIONS[role]?.has(action) ?? false;
}

// ---- The clickable parts of the fake Blender screen ----------------------
// Only a few, as a proof of concept. x/y/w/h are pixels on the drawing.
// Pressing a button with a `group` makes it the selected one in that group
// (one active tool, one selected object), like in real Blender.

const HOTSPOTS = [
  { id: "tool_select", label: "Select tool", group: "tool", x: 22, y: 178, w: 58, h: 58 },
  { id: "tool_move", label: "Move tool", group: "tool", x: 22, y: 302, w: 58, h: 66 },
  { id: "tool_rotate", label: "Rotate tool", group: "tool", x: 22, y: 374, w: 58, h: 60 },
  { id: "menu_add", label: "Add menu", x: 432, y: 58, w: 66, h: 38 },
  { id: "outliner_camera", label: "Camera (outliner)", group: "object", value: "Camera", x: 1548, y: 170, w: 120, h: 30 },
  { id: "outliner_cube", label: "Cube (outliner)", group: "object", value: "Cube", x: 1548, y: 200, w: 92, h: 32 },
  { id: "outliner_light", label: "Light (outliner)", group: "object", value: "Light", x: 1544, y: 234, w: 102, h: 32 },
  // The cube in the 3D view selects the same object as "Cube" in the outliner.
  // It gets no blue outline when selected, since a box around it looks odd.
  { id: "viewport_cube", label: "the Cube", group: "object", value: "Cube", noOutline: true, x: 645, y: 500, w: 258, h: 308 },
];

const HOTSPOT_BY_ID = Object.fromEntries(HOTSPOTS.map((h) => [h.id, h]));

function hotspotAt(x, y) {
  return HOTSPOTS.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) || null;
}

function isActive(h) {
  return Boolean(h.group) && state.active[h.group] === (h.value ?? h.id);
}

// ---- Shared state (only the expert's copy is the real one) --------------

const EMOTIONS = ["neutral", "happy", "puzzled", "panicked"];

let state = {
  avatar: { x: 1150, y: 980, emotion: "neutral", facing: 1 }, // feet position in drawing pixels; facing 1 = right, -1 = left
  pointer: null, // { x, y } the expert is pointing at, or null
  highlighted: null, // id of the hotspot the expert highlighted, or null
  active: { tool: "tool_select", object: "Cube" },
  last_press: null, // { id, n } most recent novice click; n counts up so everyone can flash it
  speech: null, // { text, n } latest thing Cubey said; n counts up so a repeated message shows again
};

// ---- Action handlers (run on the expert's browser only) -----------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

const HANDLERS = {
  move_avatar(role, msg) {
    state.avatar.x = clamp(state.avatar.x + clamp(msg.dx, -60, 60), 100, SCREEN_W - 100);
    state.avatar.y = clamp(state.avatar.y + clamp(msg.dy, -60, 60), 260, SCREEN_H - 5);
    if (msg.dx) state.avatar.facing = Math.sign(msg.dx); // turn to face the way Cubey walks
  },

  point_at(role, msg) {
    // Left-click points; the next left-click puts the arm back down.
    state.pointer = state.pointer ? null : { x: clamp(msg.x, 0, SCREEN_W), y: clamp(msg.y, 0, SCREEN_H) };
  },

  highlight(role, msg) {
    // Right-click on a button toggles its highlight; right-click on nothing clears it.
    const h = hotspotAt(msg.x, msg.y);
    state.highlighted = h && h.id !== state.highlighted ? h.id : null;
  },

  set_emotion(role, msg) {
    if (!EMOTIONS.includes(msg.emotion)) throw new Error(`Unknown emotion ${msg.emotion}`);
    // Pressing the same emotion again goes back to neutral.
    state.avatar.emotion = state.avatar.emotion === msg.emotion ? "neutral" : msg.emotion;
  },

  say(role, msg) {
    const text = String(msg.text ?? "").trim().slice(0, 140);
    if (!text) throw new Error("Type a message first.");
    state.speech = { text, n: (state.speech?.n ?? 0) + 1 };
  },

  press_ui_button(role, msg) {
    const h = HOTSPOT_BY_ID[msg.button_id];
    if (!h) throw new Error(`Unknown button ${msg.button_id}`);
    if (h.group) state.active[h.group] = h.value ?? h.id;
    state.last_press = { id: h.id, n: (state.last_press?.n ?? 0) + 1 };
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

  if (!can(role, msg.action)) {
    return reply(`${role === "expert" ? "An" : "A"} ${role} is not allowed to ${msg.action}.`);
  }
  try {
    HANDLERS[msg.action](role, msg);
    broadcastState();
  } catch (e) {
    reply(e.message);
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

// Close connections cleanly when the tab closes, so the other side finds out right away.
window.addEventListener("pagehide", () => peer?.destroy());

const overlay = document.getElementById("overlay");
const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

// Mouse position in drawing pixels, whatever size the stage is shown at.
function toScreen(event) {
  const pt = overlay.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  return pt.matrixTransform(overlay.getScreenCTM().inverse());
}

function showWorkspace(code) {
  document.body.classList.add(myRole);
  document.getElementById("my-role").textContent = myRole;
  document.getElementById("room-code").textContent = code;
  document.getElementById("role-picker").hidden = true;
  document.getElementById("workspace").hidden = false;
  document.getElementById("help").textContent =
    myRole === "expert"
      ? "WASD / arrows: walk · Left-click: point / stop pointing · Right-click a button: highlight · 1 happy · 2 puzzled · 3 panicked · Enter: talk"
      : "Use the Blender screen like normal. Watch Cubey for hints.";

  const layer = document.getElementById("hotspots");
  for (const h of HOTSPOTS) {
    const r = svg("rect", { class: "hotspot", x: h.x, y: h.y, width: h.w, height: h.h }, layer);
    r.dataset.id = h.id;
    svg("title", {}, r).textContent = h.label;
  }
  buildAvatar();
  if (myRole === "expert") document.getElementById("chat").hidden = false;
  requestAnimationFrame(animate);
}

let lastPressSeen = 0;
let speechSeen = 0;

function render(msg) {
  state = msg.state;

  document.getElementById("online").textContent =
    `Online: ${msg.online.expert} expert, ${msg.online.novice} novice`;

  for (const r of document.querySelectorAll(".hotspot")) {
    const h = HOTSPOT_BY_ID[r.dataset.id];
    r.classList.toggle("active", isActive(h) && !h.noOutline);
  }

  // Flash the button the novice just pressed, on both screens.
  const press = state.last_press;
  if (press && press.n !== lastPressSeen) {
    lastPressSeen = press.n;
    const r = document.querySelector(`.hotspot[data-id="${press.id}"]`);
    r?.classList.remove("pressed");
    void r?.getBBox(); // restart the CSS animation
    r?.classList.add("pressed");
    const hint = press.id === state.highlighted ? " (the highlighted one)" : "";
    document.getElementById("activity").textContent =
      `Novice clicked ${HOTSPOT_BY_ID[press.id].label}${hint}`;
  }

  if (state.speech && state.speech.n !== speechSeen) {
    speechSeen = state.speech.n;
    showSpeech(state.speech.text);
  }

  const hl = document.getElementById("highlight-layer");
  hl.replaceChildren();
  const h = HOTSPOT_BY_ID[state.highlighted];
  if (h) svg("rect", { class: "highlight", x: h.x - 8, y: h.y - 8, width: h.w + 16, height: h.h + 16 }, hl);

  showError("");
}

function showError(text) {
  document.getElementById("error").textContent = text;
}

function showPickerError(text) {
  document.getElementById("picker-error").textContent = text;
}

// ---- Cubey, the expert's avatar -------------------------------------------
// Drawn in local coordinates with (0, 0) at Cubey's feet; the body is a small
// purple box about 160 px tall. Based on the Cubey sketch in our report.

const AVATAR_SCALE = 1.5; // how big Cubey is drawn on the screen
const SHOULDER_L = { x: -40, y: -82 };
const SHOULDER_R = { x: 32, y: -82 };
const ARM_LENGTH = 34;
const POINT_LENGTH = 62;

// Where each hand rests for each emotion (relative to the feet)
const ARM_POSES = {
  neutral: { l: { x: -64, y: -70 }, r: { x: 56, y: -72 } },
  happy: { l: { x: -62, y: -118 }, r: { x: 56, y: -120 } }, // both arms up
  puzzled: { l: { x: -58, y: -56 }, r: { x: 8, y: -50 } }, // hand on chin
  panicked: { l: { x: -70, y: -104 }, r: { x: 64, y: -104 } }, // hands up by the "ears"
};

const BUBBLES = { neutral: "", happy: "♪", puzzled: "?", panicked: "!!" };

const avatar = {};

function buildAvatar() {
  const layer = document.getElementById("avatar-layer");
  const root = svg("g", { class: "avatar" }, layer);
  avatar.root = root;
  avatar.body = svg("g", {}, root); // tilts and bounces

  // Legs (behind the body)
  avatar.legL = svg("rect", { class: "leg", x: -24, y: -44, width: 12, height: 44, rx: 3 }, avatar.body);
  avatar.legR = svg("rect", { class: "leg", x: 10, y: -44, width: 12, height: 44, rx: 3 }, avatar.body);

  // The box: left side, top, and front face, like the sketch
  svg("polygon", { class: "side", points: "-32,-122 -46,-134 -46,-54 -32,-42" }, avatar.body);
  svg("polygon", { class: "top", points: "-32,-122 32,-122 18,-134 -46,-134" }, avatar.body);
  svg("rect", { class: "front", x: -32, y: -122, width: 64, height: 80 }, avatar.body);

  // Arms
  avatar.armL = svg("line", { class: "arm" }, avatar.body);
  avatar.armR = svg("line", { class: "arm" }, avatar.body);

  // One face per emotion; only the current one is shown
  avatar.faces = {};
  const eyes = (g, big) => {
    const rx = big ? 7 : 5;
    const ry = big ? 9 : 7;
    // Eyes sit a little to the right and look right; mirroring Cubey makes them look left.
    svg("ellipse", { class: "eye", cx: -9, cy: -90, rx, ry }, g);
    svg("ellipse", { class: "eye", cx: 13, cy: -90, rx, ry }, g);
    svg("circle", { class: "pupil", cx: -6.5, cy: -89, r: big ? 2 : 2.6 }, g);
    svg("circle", { class: "pupil", cx: 15.5, cy: -89, r: big ? 2 : 2.6 }, g);
  };

  let f = (avatar.faces.neutral = svg("g", { class: "face" }, avatar.body));
  eyes(f);
  svg("path", { d: "M -7 -67 Q 0 -61 7 -67" }, f);

  f = avatar.faces.happy = svg("g", { class: "face" }, avatar.body);
  svg("path", { d: "M -17 -88 Q -11 -97 -5 -88 M 5 -88 Q 11 -97 17 -88" }, f); // ^ ^ eyes
  svg("path", { class: "mouth", d: "M -12 -72 Q 0 -56 12 -72 Z" }, f);

  f = avatar.faces.puzzled = svg("g", { class: "face" }, avatar.body);
  eyes(f);
  svg("path", { d: "M -18 -101 L -5 -99 M 5 -101 L 17 -107" }, f); // one eyebrow raised
  svg("path", { d: "M -9 -65 Q -4 -70 0 -65 Q 4 -60 9 -65" }, f); // wavy mouth

  f = avatar.faces.panicked = svg("g", { class: "face" }, avatar.body);
  eyes(f, true);
  svg("rect", { class: "teeth", x: -13, y: -72, width: 26, height: 12, rx: 2 }, f); // gritted teeth
  svg("path", { d: "M -13 -66 H 13 M -6 -72 V -60 M 0 -72 V -60 M 6 -72 V -60" }, f);
  svg("path", { class: "sweat", d: "M 40 -130 Q 34 -118 40 -114 Q 46 -118 40 -130 Z" }, f);

  avatar.bubble = svg("text", { class: "bubble", x: 0, y: -150 }, root);

  avatar.speech = svg("g", { class: "speech" }, layer);

  // Pointing: a dashed line from Cubey's hand to the target, and a ping there
  const pl = document.getElementById("pointer-layer");
  avatar.pointLine = svg("line", { class: "pointer-line" }, pl);
  avatar.pointDot = svg("circle", { class: "pointer-dot", r: 10 }, pl);
}

// The novice sees Cubey glide toward the latest position instead of jumping.
const shown = { x: null, y: null };
let lastTime = performance.now();
let lastMoveTime = 0;

function animate(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (myRole === "expert") sendHeldKeys(dt, now);

  const a = state.avatar;
  if (shown.x === null) Object.assign(shown, { x: a.x, y: a.y });
  const k = Math.min(1, dt * 15);
  const moved = Math.hypot(a.x - shown.x, a.y - shown.y);
  shown.x += (a.x - shown.x) * k;
  shown.y += (a.y - shown.y) * k;
  if (moved > 1) lastMoveTime = now;
  const walking = now - lastMoveTime < 150;
  const t = now / 1000;

  // Body: bounce when happy, shake when panicked, tilt when puzzled
  let dx = 0, dy = 0, tilt = 0;
  if (a.emotion === "happy") dy = -Math.abs(Math.sin(t * 7)) * 10;
  if (a.emotion === "panicked") dx = Math.sin(t * 60) * 3;
  if (a.emotion === "puzzled") tilt = -8;
  if (walking) dy -= Math.abs(Math.sin(t * 14)) * 5;
  avatar.root.setAttribute("transform", `translate(${shown.x + dx} ${shown.y + dy}) scale(${AVATAR_SCALE})`);
  const f = a.facing ?? 1; // mirror Cubey to face left or right
  avatar.body.setAttribute("transform", `scale(${f} 1) rotate(${tilt} 0 -40)`);

  // Legs step while walking
  const step = walking ? Math.sin(t * 14) * 7 : 0;
  avatar.legL.setAttribute("transform", `translate(0 ${Math.min(0, step)})`);
  avatar.legR.setAttribute("transform", `translate(0 ${Math.min(0, -step)})`);

  // Arms: rest pose for the emotion, except the arm nearest the target points at it.
  // Arm positions are in Cubey's own (unmirrored) coordinates, so on screen
  // an x offset is multiplied by `f`.
  const pose = ARM_POSES[a.emotion];
  let handL = pose.l;
  let handR = pose.r;
  const p = state.pointer;
  if (p) {
    const targetOnRight = p.x >= shown.x;
    const s = (f * SHOULDER_R.x > 0) === targetOnRight ? SHOULDER_R : SHOULDER_L;
    const sx = shown.x + f * s.x * AVATAR_SCALE;
    const sy = shown.y + s.y * AVATAR_SCALE;
    const ang = Math.atan2(p.y - sy, p.x - sx);
    const len = Math.min(POINT_LENGTH, Math.hypot(p.x - sx, p.y - sy) / AVATAR_SCALE);
    const hand = { x: s.x + f * Math.cos(ang) * len, y: s.y + Math.sin(ang) * len };
    if (s === SHOULDER_R) handR = hand;
    else handL = hand;
    const hx = shown.x + f * hand.x * AVATAR_SCALE;
    const hy = shown.y + hand.y * AVATAR_SCALE;
    setLine(avatar.pointLine, hx, hy, p.x, p.y);
    avatar.pointDot.setAttribute("cx", p.x);
    avatar.pointDot.setAttribute("cy", p.y);
  }
  avatar.pointLine.style.display = avatar.pointDot.style.display = p ? "" : "none";
  const swing = walking && !p ? Math.sin(t * 14) * 6 : 0;
  setLine(avatar.armL, SHOULDER_L.x, SHOULDER_L.y, handL.x, handL.y + swing);
  setLine(avatar.armR, SHOULDER_R.x, SHOULDER_R.y, handR.x, handR.y - swing);

  for (const [name, g] of Object.entries(avatar.faces)) {
    g.style.display = name === a.emotion ? "" : "none";
  }
  avatar.bubble.textContent = BUBBLES[a.emotion];
  avatar.bubble.setAttribute("class", `bubble ${a.emotion}`);
  placeSpeech(shown.x, shown.y, a.emotion, now); // ignores bounce/shake so the bubble stays steady

  requestAnimationFrame(animate);
}

// ---- Speech bubble ---------------------------------------------------------
// Drawn above Cubey's head so it doesn't jump around when Cubey turns (or
// under its feet when Cubey is at the very top of the screen). It stays up
// for a few seconds depending on how long the message is.

const SPEECH_CHARS_PER_LINE = 22;
const SPEECH_PAD = 18;
const SPEECH_LINE_HEIGHT = 36;
let speechUntil = 0;

function wrapText(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function showSpeech(text) {
  const g = avatar.speech;
  g.replaceChildren();
  avatar.speechTail = svg("path", {}, g);
  const box = svg("rect", { rx: 18 }, g);
  const label = svg("text", {}, g);
  wrapText(text, SPEECH_CHARS_PER_LINE).forEach((line, i) => {
    const t = svg("tspan", { x: SPEECH_PAD, y: SPEECH_PAD + 26 + i * SPEECH_LINE_HEIGHT }, label);
    t.textContent = line;
  });
  g.style.display = ""; // must be visible to measure the text
  const w = label.getBBox().width + SPEECH_PAD * 2;
  const h = label.getBBox().height + SPEECH_PAD * 2;
  box.setAttribute("width", w);
  box.setAttribute("height", h);
  avatar.speechSize = { w, h };
  speechUntil = performance.now() + 4000 + text.length * 60;
}

function placeSpeech(x, y, emotion, now) {
  const g = avatar.speech;
  const visible = now < speechUntil;
  g.style.display = visible ? "" : "none";
  if (!visible) return;

  // Centred above Cubey's head (and above the emotion symbol), kept on screen
  const { w, h } = avatar.speechSize;
  const tail = 22;
  // Right above Cubey's head, or higher to clear the ♪ / ? / !! symbol when showing an emotion
  const bottom = y - (emotion === "neutral" ? 140 : 200) * AVATAR_SCALE;
  const left = Math.min(SCREEN_W - w - 8, Math.max(8, x - w / 2));
  const tx = Math.min(w - 24, Math.max(24, x - left));
  if (bottom - tail - h >= 8) {
    // Above, with the tail pointing down at Cubey
    g.setAttribute("transform", `translate(${left} ${bottom - tail - h})`);
    avatar.speechTail.setAttribute("d", `M ${tx - 14} ${h - 2} L ${tx} ${h + tail} L ${tx + 14} ${h - 2} Z`);
  } else {
    // No room at the top of the screen: go under Cubey's feet instead
    g.setAttribute("transform", `translate(${left} ${y + tail + 6})`);
    avatar.speechTail.setAttribute("d", `M ${tx - 14} 2 L ${tx} ${-tail} L ${tx + 14} 2 Z`);
  }
}

function setLine(el, x1, y1, x2, y2) {
  el.setAttribute("x1", x1);
  el.setAttribute("y1", y1);
  el.setAttribute("x2", x2);
  el.setAttribute("y2", y2);
}

// ---- Expert controls -------------------------------------------------------

const WALK_SPEED = 420; // drawing pixels per second
const MOVE_KEYS = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};
const EMOTION_KEYS = { 1: "happy", 2: "puzzled", 3: "panicked" };
const held = new Set();
const chatInput = document.getElementById("chat-input");
let pending = { dx: 0, dy: 0 };
let lastSent = 0;

function setUpExpertControls() {
  window.addEventListener("keydown", (e) => {
    if (e.target === chatInput) return; // typing a message, not controlling Cubey
    const key = e.key.toLowerCase();
    if (MOVE_KEYS[key]) {
      held.add(key);
      e.preventDefault(); // stop arrow keys from scrolling the page
    } else if (EMOTION_KEYS[key] && !e.repeat) {
      doAction("set_emotion", { emotion: EMOTION_KEYS[key] });
    } else if (key === "enter") {
      e.preventDefault();
      chatInput.focus(); // jump to the message box
    }
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));

  document.getElementById("chat").addEventListener("submit", (e) => {
    e.preventDefault();
    doAction("say", { text: chatInput.value });
    chatInput.value = "";
    chatInput.blur(); // back to walking with WASD straight away
  });
  window.addEventListener("blur", () => held.clear());

  overlay.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const { x, y } = toScreen(e);
    doAction("point_at", { x, y });
  });
  overlay.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // no browser menu; right-click means "highlight"
    const { x, y } = toScreen(e);
    doAction("highlight", { x, y });
  });
}

// Called every frame. Movement is batched to ~30 updates a second so the
// novice's connection isn't flooded.
function sendHeldKeys(dt, now) {
  let vx = 0, vy = 0;
  for (const key of held) {
    vx += MOVE_KEYS[key][0];
    vy += MOVE_KEYS[key][1];
  }
  const len = Math.hypot(vx, vy);
  if (len) {
    pending.dx += (vx / len) * WALK_SPEED * dt;
    pending.dy += (vy / len) * WALK_SPEED * dt;
  }
  if ((pending.dx || pending.dy) && now - lastSent > 33) {
    doAction("move_avatar", pending);
    pending = { dx: 0, dy: 0 };
    lastSent = now;
  }
}

// ---- Novice controls -------------------------------------------------------

function setUpNoviceControls() {
  overlay.addEventListener("click", (e) => {
    const id = e.target.dataset?.id;
    if (id) doAction("press_ui_button", { button_id: id });
  });
}

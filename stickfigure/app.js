// Expertise-sharing prototype, stick figure version. Same app as the Cubey one
// in the folder above, but the expert's avatar is an animated stick figure
// with a cape, and there are no emotions. Runs entirely in the browser so it
// can be hosted on GitHub Pages (which can't run a server).
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

const ROOM_PREFIX = "cpsc581-stickfigure-"; // keeps our room ids apart from other PeerJS users (and from the Cubey app)
const PEER_OPTIONS = window.PEER_OPTIONS || {}; // e.g. { host, port } for a self-hosted PeerJS server
const SCREEN_W = 1920;
const SCREEN_H = 1080;

// ---- RBAC: which role may do which action ------------------------------

const PERMISSIONS = {
  expert: new Set(["move_avatar", "point_at", "highlight"]),
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

let state = {
  avatar: { x: 1150, y: 980, dir: "down" }, // feet position in drawing pixels; dir = which way it last walked (up/down/left/right)
  pointer: null, // { x, y } the expert is pointing at, or null
  highlighted: null, // id of the hotspot the expert highlighted, or null
  active: { tool: "tool_select", object: "Cube" },
  last_press: null, // { id, n } most recent novice click; n counts up so everyone can flash it
};

// ---- Action handlers (run on the expert's browser only) -----------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

const HANDLERS = {
  move_avatar(role, msg) {
    state.avatar.x = clamp(state.avatar.x + clamp(msg.dx, -60, 60), 100, SCREEN_W - 100);
    state.avatar.y = clamp(state.avatar.y + clamp(msg.dy, -60, 60), 290, SCREEN_H - 5);
    // Face the way it walks. Diagonals count as left/right.
    const dx = Number(msg.dx) || 0;
    const dy = Number(msg.dy) || 0;
    if (dx || dy) {
      state.avatar.dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
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
      ? "WASD / arrows: walk · Left-click: point / stop pointing · Right-click a button: highlight"
      : "Use the Blender screen like normal. Watch the stick figure for hints.";

  const layer = document.getElementById("hotspots");
  for (const h of HOTSPOTS) {
    const r = svg("rect", { class: "hotspot", x: h.x, y: h.y, width: h.w, height: h.h }, layer);
    r.dataset.id = h.id;
    svg("title", {}, r).textContent = h.label;
  }
  buildAvatar();
  requestAnimationFrame(animate);
}

let lastPressSeen = 0;

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

// ---- The stick figure, the expert's avatar ----------------------------------
// Drawn from sprite sheets made from the .mov clips (see tools/make_sprites.py).
// Each sheet is one row of frames, 219 x 320 px each. Everything below is in
// those sprite pixels, with FEET at the figure's feet, and then scaled onto
// the screen.
//
// Walking: the "Going<Dir>" clips turn the figure from standing into a walking
// pose for that direction, and the "Going<Dir>Reverse" clips turn it back.
// `anim.p` runs from 0 (standing) to 1 (in the walking pose).

const FIGURE_SCALE = 0.85; // how big the figure is drawn on the screen
const FRAME_W = 219;
const FRAME_H = 320;
const FEET = { x: 111, y: 299 };
const NECK = { x: 111, y: 108 };
const SHOULDER = { x: 111, y: 133 };
const ARM_LENGTH = 95;
const ARM_WIDTH = 11;
const TURN_TIME = 0.35; // seconds to go from standing to the walking pose (the clips take 0.8)

const DIRS = ["up", "down", "left", "right"];
const SHEETS = {
  ...Object.fromEntries(DIRS.flatMap((d) => [[d, 24], [`${d}_back`, 24]])),
  point: 2, // standing with the left (frame 0) or right (frame 1) arm rubbed out
};

const CAPE = { w: 320, h: 213, frames: 23, fps: 30, neck: { x: 160, y: 8 } };
const CAPE_WIDTH = 190; // in sprite pixels

const avatar = {};
const anim = { dir: "down", p: 0, back: false };

// A sprite sheet shown through a one-frame window. Returns a function that picks the frame.
function sprite(parent, file, frames, w, h) {
  const win = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, parent);
  const img = svg("image", { href: `assets/${file}`, width: w * frames, height: h }, win);
  const show = (frame) => {
    win.style.display = frame === null ? "none" : "";
    if (frame !== null) img.setAttribute("x", -Math.max(0, Math.min(frames - 1, frame)) * w);
  };
  show(null);
  return show;
}

function buildAvatar() {
  const layer = document.getElementById("avatar-layer");
  avatar.root = svg("g", { class: "avatar" }, layer);
  const body = svg("g", { transform: `translate(${-FEET.x} ${-FEET.y})` }, avatar.root);

  // The cape is drawn behind the figure, except when it walks away from us (up).
  const cape = (cls) => {
    const g = svg("g", { class: cls }, body);
    return { g, show: sprite(g, "cape.webp", CAPE.frames, CAPE.w, CAPE.h) };
  };
  avatar.capeBack = cape("cape");
  avatar.sprites = Object.fromEntries(
    Object.entries(SHEETS).map(([name, n]) => [name, sprite(body, `figure-${name}.webp`, n, FRAME_W, FRAME_H)]),
  );
  avatar.arm = svg("line", { class: "arm", "stroke-width": ARM_WIDTH }, body);
  avatar.capeFront = cape("cape");

  // Pointing: a dashed line from the hand to the target, and a ping there
  const pl = document.getElementById("pointer-layer");
  avatar.pointLine = svg("line", { class: "pointer-line" }, pl);
  avatar.pointDot = svg("circle", { class: "pointer-dot", r: 10 }, pl);
}

// The novice sees the figure glide toward the latest position instead of jumping.
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
  const p = state.pointer;

  // Walking pose: ease into the pose for the current direction. To change
  // direction, go back to standing first, then into the new pose.
  const want = walking && !p ? a.dir : null;
  if (want && want === anim.dir) {
    anim.back = false;
    anim.p = Math.min(1, anim.p + dt / TURN_TIME);
  } else if (anim.p > 0) {
    anim.back = true;
    anim.p = Math.max(0, anim.p - dt / (want ? TURN_TIME / 2 : TURN_TIME));
  } else if (want) {
    anim.dir = want;
  }

  // A little bounce in each step while walking
  const dy = walking ? -Math.abs(Math.sin(t * 12)) * 8 * anim.p : 0;
  const x = shown.x;
  const y = shown.y + dy;
  avatar.root.setAttribute("transform", `translate(${x} ${y}) scale(${FIGURE_SCALE})`);

  // Which frame to show
  for (const show of Object.values(avatar.sprites)) show(null);
  const targetOnRight = p && p.x >= x;
  if (p) {
    avatar.sprites.point(targetOnRight ? 1 : 0);
  } else if (anim.back) {
    avatar.sprites[`${anim.dir}_back`](Math.round((1 - anim.p) * (SHEETS[`${anim.dir}_back`] - 1)));
  } else {
    avatar.sprites[anim.dir](Math.round(anim.p * (SHEETS[anim.dir] - 1)));
  }

  // Cape: flutters on a loop. Narrower when walking sideways, since we see it edge on.
  const sideways = (anim.dir === "left" || anim.dir === "right") && !p ? anim.p : 0;
  const away = anim.dir === "up" && anim.p > 0.5 && !p;
  const s = CAPE_WIDTH / CAPE.w;
  const shift = sideways * (anim.dir === "left" ? 18 : -18); // trails a little behind
  const capeTransform =
    `translate(${NECK.x + shift} ${NECK.y}) scale(${s * (1 - 0.4 * sideways)} ${s}) ` +
    `translate(${-CAPE.neck.x} ${-CAPE.neck.y})`;
  const capeFrame = Math.floor(t * CAPE.fps) % CAPE.frames;
  for (const [cape, on] of [[avatar.capeBack, !away], [avatar.capeFront, away]]) {
    cape.g.setAttribute("transform", capeTransform);
    cape.show(on ? capeFrame : null);
  }

  // Pointing arm, drawn from the shoulder toward the target, in sprite pixels
  if (p) {
    const tx = (p.x - x) / FIGURE_SCALE + FEET.x;
    const ty = (p.y - y) / FIGURE_SCALE + FEET.y;
    const ang = Math.atan2(ty - SHOULDER.y, tx - SHOULDER.x);
    const len = Math.min(ARM_LENGTH, Math.hypot(tx - SHOULDER.x, ty - SHOULDER.y));
    const hand = { x: SHOULDER.x + Math.cos(ang) * len, y: SHOULDER.y + Math.sin(ang) * len };
    setLine(avatar.arm, SHOULDER.x, SHOULDER.y, hand.x, hand.y);
    const hx = x + (hand.x - FEET.x) * FIGURE_SCALE;
    const hy = y + (hand.y - FEET.y) * FIGURE_SCALE;
    setLine(avatar.pointLine, hx, hy, p.x, p.y);
    avatar.pointDot.setAttribute("cx", p.x);
    avatar.pointDot.setAttribute("cy", p.y);
  }
  avatar.arm.style.display = avatar.pointLine.style.display = avatar.pointDot.style.display = p ? "" : "none";

  requestAnimationFrame(animate);
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
const held = new Set();
let pending = { dx: 0, dy: 0 };
let lastSent = 0;

function setUpExpertControls() {
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (MOVE_KEYS[key]) {
      held.add(key);
      e.preventDefault(); // stop arrow keys from scrolling the page
    }
  });
  window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
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

# Expertise Sharing Prototype

A proof of concept where an **expert** and a **novice** share one page. Right now
there is a single LED that either of them can switch on and off, and both see the
change instantly. The expert's stick-figure avatar and the novice's fake Blender
buttons are stubbed out with pseudocode.

## How to run it

You need Python 3.9 or newer.

```bash
cd app
pip install -r requirements.txt   # installs the websockets package
python server.py
```

The server prints two addresses:

```
On this computer:      http://localhost:8000
From another laptop:   http://192.168.x.x:8000
```

- **Two tabs on one computer:** open `http://localhost:8000` in two tabs. Pick
  "I'm the Expert" in one and "I'm the Novice" in the other.
- **Two laptops:** both must be on the same Wi-Fi. The laptop running the server
  uses `localhost`, and the other one opens the `192.168.x.x` address. If it won't
  load, your OS firewall may be blocking port 8000, or the network (often campus
  Wi-Fi) may block devices from reaching each other. A phone hotspot usually works.

Press the **Toggle LED** button on either page and the light changes on both.
Stop the server with `Ctrl+C`.

## How it works

```
 Expert browser ──┐                      ┌── state broadcast ──> Expert browser
                  ├── action ──> server.py
 Novice browser ──┘   (checked against   └── state broadcast ──> Novice browser
                       PERMISSIONS)
```

- `server.py` holds the one shared `state` dictionary. It serves the page over
  HTTP and keeps a WebSocket open to every browser at `/ws`.
- A browser never changes state itself. It sends a message like
  `{"type": "action", "action": "toggle_led"}`, and the server checks the sender's
  role against `PERMISSIONS` before running the matching handler. Then it sends the
  new state to everyone.
- **RBAC:** the role table lives at the top of `server.py`:

  | Action            | Expert | Novice |
  |-------------------|:------:|:------:|
  | `toggle_led`      |   ✓    |   ✓    |
  | `move_avatar`     |   ✓    |        |
  | `point_at`        |   ✓    |        |
  | `press_ui_button` |        |   ✓    |

  There is no login. Each user just says which role they are when they join.

## Files

| File | What it does |
|------|--------------|
| `server.py` | HTTP + WebSocket server, RBAC table, shared state, action handlers |
| `static/index.html` | Role picker and the shared workspace |
| `static/app.js` | Sends actions, redraws on state updates, expert/novice skeletons |
| `static/style.css` | Styling, including the LED's on/off look |

## Adding the next features

The stubs to fill in later are marked `NOT IMPLEMENTED YET`:

1. **Fake Blender image:** put the image in `static/` and add it inside `#stage`
   in `index.html`.
2. **Expert avatar:** fill in `setUpExpertControls()` and `drawAvatar()` in
   `app.js`, then `handle_move_avatar()` in `server.py`.
3. **Pointing and highlighting:** `handle_point_at()` and `drawHighlight()`.
4. **Novice buttons:** `setUpNoviceControls()` and `handle_press_ui_button()`.

The pattern is the same for each one: the browser sends an action, the server
updates `state` and broadcasts it, and `render()` draws it.

## Why this isn't on GitHub Pages

GitHub Pages only serves static files, so it can't run `server.py`. Both users
have to reach a computer that is running the server.

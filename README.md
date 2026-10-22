# Expertise Sharing Prototype

A proof of concept where an **expert** and a **novice** share one page. Right now
there is a single LED that either of them can switch on and off, and both see the
change instantly. The expert's stick-figure avatar and the novice's fake Blender
buttons are stubbed out with pseudocode.

**Live site:** https://jaewon-ma.github.io/project-2/

## How to use it

1. The expert opens the site and clicks **I'm the Expert**. A 4-letter room code
   appears at the top of the page.
2. The expert tells the novice the code. The novice opens the site, types the
   code, and clicks **I'm the Novice**.
3. Either person presses **Toggle LED**, and the light changes on both screens.

It works across two tabs, two laptops, or two people in different places. The
expert's tab has to stay open, because it holds the session. If the expert
closes it, the novice sees "The expert left".

## How it works

There is no server of our own. GitHub Pages only serves static files, so the two
browsers talk to each other directly using [PeerJS](https://peerjs.com/), a small
WebRTC library loaded from a CDN.

```
             (1) introduce the two browsers
 Expert  <──────── PeerJS cloud server ────────>  Novice
 browser                                          browser
   │                                                 │
   └──────────── (2) WebRTC data channel ────────────┘
        actions from the novice ──>
        <── new state to the novice
```

- The **expert's browser is the host.** It owns the one shared `state` object,
  the RBAC table, and the action handlers.
- The novice's browser never changes state itself. It sends a message like
  `{ type: "action", action: "toggle_led" }`. The host checks the sender's role
  against `PERMISSIONS`, runs the handler, and sends the new state to everyone.
  The expert's own button presses go through the same check.
- **RBAC:** the role table is at the top of `app.js`:

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
| `index.html` | Role picker and the shared workspace |
| `app.js` | Connection setup, RBAC table, shared state, action handlers, expert/novice skeletons |
| `style.css` | Styling, including the LED's on/off look |

## Running it locally

Any static file server works. For example:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. It still uses the PeerJS cloud server to connect,
so you need internet access.

## Adding the next features

The stubs to fill in later are marked `NOT IMPLEMENTED YET` in `app.js`:

1. **Fake Blender image:** add the image to the repo and put it inside `#stage`
   in `index.html`.
2. **Expert avatar:** `setUpExpertControls()`, `drawAvatar()`, and
   `HANDLERS.move_avatar`.
3. **Pointing and highlighting:** `HANDLERS.point_at` and `drawHighlight()`.
4. **Novice buttons:** `setUpNoviceControls()` and `HANDLERS.press_ui_button`.

The pattern is the same for each one: call `doAction(...)`, have the handler
update `state`, and draw it in `render()`.

## Known limits

- The free PeerJS server is shared and occasionally slow or down. If connecting
  fails, wait a moment and try again.
- A few strict networks (some campus or corporate Wi-Fi) block direct WebRTC
  connections. A phone hotspot usually works.
- The state lives in the expert's tab, so refreshing that tab resets the LED and
  ends the session.

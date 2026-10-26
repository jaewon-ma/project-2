# Expertise Sharing Prototype

A proof of concept where an **expert** and a **novice** share one hand-drawn
Blender screen. The novice clicks buttons on it as if using Blender. The expert
can't press buttons. Instead they guide the novice through **Cubey**, a small
cube-shaped avatar (from our design report) that walks around, points, highlights
buttons, shows emotions, and talks in speech bubbles.

**Live site:** https://jaewon-ma.github.io/project-2/

## How to use it

1. The expert opens the site and clicks **I'm the Expert**. A 4-letter room code
   appears at the top of the page.
2. The expert tells the novice the code. The novice opens the site, types the
   code, and clicks **I'm the Novice**.
3. Both people now see the same Blender screen and Cubey.

**Expert controls**

| Input | What Cubey does |
|-------|-----------------|
| WASD or arrow keys | Walks around the screen, turning to face left or right |
| Left-click anywhere | Points at that spot (dashed line + ping). Left-click again to stop pointing |
| Right-click a button | Highlights it with a yellow glow. Right-click it again, or empty space, to clear |
| `1` / `2` / `3` | Happy / puzzled / panicked. Press the same key again to go back to neutral |
| Message box under the screen (Enter to jump to it) | Cubey says it in a speech bubble above its head for a few seconds. Both users see it |

**Novice controls:** click buttons on the screen. Only a few work, as a proof of
concept: the **Select**, **Move**, and **Rotate** tools; the **Add** menu; **Camera**,
**Cube**, and **Light** in the outliner; and the **cube** in the 3D view. Clicked
buttons flash on both screens, and the selected tool and object get a blue outline.

The novice can also chat back with the same message box (Enter to jump to it, Enter
to send). Their message appears in a blue bubble in the bottom-right corner of the
screen, which both users see.

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
  `{ type: "action", action: "press_ui_button", button_id: "tool_move" }`. The
  host checks the sender's role against `PERMISSIONS`, runs the handler, and sends
  the new state to everyone. The expert's own actions go through the same check.
- **RBAC:** the role table is at the top of `app.js`:

  | Action            | Expert | Novice |
  |-------------------|:------:|:------:|
  | `move_avatar`     |   ✓    |        |
  | `point_at`        |   ✓    |        |
  | `highlight`       |   ✓    |        |
  | `set_emotion`     |   ✓    |        |
  | `say`             |   ✓    |   ✓    |
  | `press_ui_button` |        |   ✓    |

  There is no login. Each user just says which role they are when they join.

## Files

| File | What it does |
|------|--------------|
| `index.html` | Role picker and the shared workspace |
| `app.js` | Connection setup, RBAC table, clickable buttons (`HOTSPOTS`), shared state, action handlers, Cubey drawing and animation, expert/novice controls |
| `style.css` | Styling, including Cubey's colours and the highlight/point effects |
| `assets/blender-background.png` | The hand-drawn Blender screen |

## Running it locally

Any static file server works. For example:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. It still uses the PeerJS cloud server to connect,
so you need internet access.

## Adding more buttons

Add an entry to `HOTSPOTS` in `app.js` with the button's rectangle in drawing
pixels (the image is 1920 x 1080). Give it a `group` if it should stay selected
like a tool or object. Nothing else needs to change.

## If the novice gets stuck on "Connecting"

The page now gives up after 15 seconds and says which step failed:

- **"Can't reach the PeerJS connection server"**: the free PeerJS server is down or
  blocked on that network. Wait a minute and try again, or try another network.
- **"No expert is in room ABCD"**: the code is wrong, or the expert's tab was closed
  or reloaded. The expert gets a new code on every reload, so check the code at the
  top of the expert's page.
- **"Found room ABCD, but couldn't open a direct connection"**: the two browsers
  found each other but the network blocked the direct link. This is common on campus
  or work Wi-Fi. Put both devices on the same Wi-Fi, or use a phone hotspot.

If the expert's laptop sleeps or changes Wi-Fi, the expert's page shows "Lost the
connection server, reconnecting…" and reconnects by itself. A novice can join again
once that message goes away.

A quick check that the site itself is fine: open it in two tabs of the same browser
on one computer and join as expert and novice. If that works, the problem is the
network between the two devices.

## Known limits

- The free PeerJS server is shared and occasionally slow or down. If connecting
  fails, wait a moment and try again.
- A few strict networks (some campus or corporate Wi-Fi) block direct WebRTC
  connections. A phone hotspot usually works.
- The state lives in the expert's tab, so refreshing that tab resets everything and
  ends the session.

"""
Expertise-sharing prototype server.

One process does two jobs on the same port:
  1. Serves the web page (files in ./static) over plain HTTP.
  2. Runs a WebSocket at /ws that keeps every connected browser in sync.

Roles are a tiny RBAC (role-based access control) table: each role has a set
of actions it is allowed to perform. There is no authentication; a user simply
says which role they are when they join. This is a proof of concept.

Run:  python server.py   (then open http://localhost:8000)
"""

import asyncio
import json
import mimetypes
import socket
from http import HTTPStatus
from pathlib import Path

from websockets.asyncio.server import broadcast, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

HOST = "0.0.0.0"  # listen on all interfaces so other laptops on the Wi-Fi can join
PORT = 8000
STATIC_DIR = Path(__file__).parent / "static"


# --------------------------------------------------------------------------
# RBAC: which role may do which action
# --------------------------------------------------------------------------

PERMISSIONS = {
    "expert": {"toggle_led", "move_avatar", "point_at"},
    "novice": {"toggle_led", "press_ui_button"},
}


def can(role, action):
    return action in PERMISSIONS.get(role, set())


# --------------------------------------------------------------------------
# Shared state (the single source of truth both users see)
# --------------------------------------------------------------------------

state = {
    "led_on": False,
    "last_changed_by": None,
    # Placeholders for later features:
    "avatar": {"x": 0, "y": 0},   # expert's stick figure position
    "highlighted": None,          # id of the object the expert is pointing at
}

# websocket connection -> role ("expert" or "novice")
clients = {}


def snapshot():
    """Everything a browser needs to redraw the page."""
    roles = list(clients.values())
    return {
        "type": "state",
        "state": state,
        "online": {"expert": roles.count("expert"), "novice": roles.count("novice")},
    }


def broadcast_state():
    broadcast(clients.keys(), json.dumps(snapshot()))


# --------------------------------------------------------------------------
# Action handlers. Each one receives the role and the message payload,
# changes `state`, and the caller then broadcasts the new state.
# --------------------------------------------------------------------------

def handle_toggle_led(role, msg):
    state["led_on"] = not state["led_on"]
    state["last_changed_by"] = role


def handle_move_avatar(role, msg):
    # NOT IMPLEMENTED YET. Pseudocode:
    #   dx, dy = msg["dx"], msg["dy"]          # e.g. -1/0/1 from WASD/arrows
    #   state["avatar"]["x"] = clamp(x + dx * STEP, 0, SCREEN_WIDTH)
    #   state["avatar"]["y"] = clamp(y + dy * STEP, 0, SCREEN_HEIGHT)
    raise NotImplementedError


def handle_point_at(role, msg):
    # NOT IMPLEMENTED YET. Pseudocode:
    #   target = object on the fake Blender image nearest the avatar's hand
    #            (or msg["object_id"] if the client already worked it out)
    #   state["highlighted"] = target            # everyone sees it glow
    raise NotImplementedError


def handle_press_ui_button(role, msg):
    # NOT IMPLEMENTED YET. Pseudocode:
    #   button_id = msg["button_id"]             # e.g. "add_cube", "extrude"
    #   update the fake Blender scene, e.g. state["scene"].append(...)
    #   maybe clear state["highlighted"] if the novice pressed the right thing
    raise NotImplementedError


HANDLERS = {
    "toggle_led": handle_toggle_led,
    "move_avatar": handle_move_avatar,
    "point_at": handle_point_at,
    "press_ui_button": handle_press_ui_button,
}


# --------------------------------------------------------------------------
# WebSocket connection loop
# --------------------------------------------------------------------------

async def send_error(ws, text):
    await ws.send(json.dumps({"type": "error", "message": text}))


async def handle_connection(ws):
    try:
        async for raw in ws:
            msg = json.loads(raw)

            if msg.get("type") == "join":
                role = msg.get("role")
                if role not in PERMISSIONS:
                    await send_error(ws, f"Unknown role: {role}")
                    continue
                clients[ws] = role
                print(f"{role} joined ({len(clients)} connected)")
                broadcast_state()

            elif msg.get("type") == "action":
                role = clients.get(ws)
                action = msg.get("action")
                if role is None:
                    await send_error(ws, "Pick a role first.")
                elif not can(role, action):
                    await send_error(ws, f"A {role} is not allowed to {action}.")
                else:
                    try:
                        HANDLERS[action](role, msg)
                        broadcast_state()
                    except NotImplementedError:
                        await send_error(ws, f"{action} is not implemented yet.")
    finally:
        role = clients.pop(ws, None)
        if role:
            print(f"{role} left ({len(clients)} connected)")
            broadcast_state()


# --------------------------------------------------------------------------
# Plain HTTP: serve the files in ./static for every non-WebSocket request
# --------------------------------------------------------------------------

def serve_static(connection, request):
    if request.path == "/ws":
        return None  # let the WebSocket handshake continue

    name = request.path.split("?")[0].lstrip("/") or "index.html"
    file = (STATIC_DIR / name).resolve()
    if not file.is_relative_to(STATIC_DIR.resolve()) or not file.is_file():
        return connection.respond(HTTPStatus.NOT_FOUND, "Not found\n")

    body = file.read_bytes()
    content_type = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    headers = Headers({"Content-Type": content_type, "Content-Length": str(len(body))})
    return Response(200, "OK", headers, body)


def lan_ip():
    """Best guess at this machine's address on the local network."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # no packets are actually sent
            return s.getsockname()[0]
    except OSError:
        return "your-ip-address"


async def main():
    async with serve(handle_connection, HOST, PORT, process_request=serve_static) as server:
        print(f"On this computer:      http://localhost:{PORT}")
        print(f"From another laptop:   http://{lan_ip()}:{PORT}")
        print("Press Ctrl+C to stop.")
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

# Expertise Sharing Prototype: Stick Figure version

The same expert/novice app as the one in the folder above, with Cubey swapped
for an animated stick figure wearing a cape. There are no emotions; the expert
can walk, point, and highlight.

**Live site:** https://jaewon-ma.github.io/project-2/stickfigure/

The two apps use different room codes, so a stick figure expert and a Cubey
novice can't end up in the same room by accident.

## Expert controls

| Input | What the stick figure does |
|-------|----------------------------|
| WASD or arrow keys | Turns into the walking pose for that direction and walks. Turns back to standing when you let go |
| Left-click anywhere | Points at that spot with the nearer arm (dashed line + ping). Left-click again to stop pointing |
| Right-click a button | Highlights it with a yellow glow. Right-click it again, or empty space, to clear |
| Type in the box under the screen + Enter | The stick figure says it in a speech bubble, which both people see. It fades after 4 to 12 seconds depending on length. Sending an empty box clears it |

Novice controls, the RBAC table, and how the connection works are the same as in
the [main README](../README.md), except `set_emotion` is gone and there is a
`say` action that only the expert is allowed to do.

## The animations

The clips (`GoingUp.mov`, `GoingUpReverse.mov`, and so on, plus
`CapeAnimationFull.mov`) are drawn on black with no transparency, so
`tools/make_sprites.py` turns them into sprite sheets in `assets/`:

- `figure-<dir>.webp`: the ~0.8 s at the start of `Going<Dir>.mov` where the
  figure turns from standing into the walking pose (24 frames).
- `figure-<dir>_back.webp`: the last ~0.8 s of `Going<Dir>Reverse.mov`, back to standing.
- `figure-point.webp`: the standing pose with one arm rubbed out. The app draws
  the pointing arm itself so it can aim anywhere.
- `cape.webp`: one loop of the cape flutter. It's drawn behind the figure, in
  front when walking up (away from us), and squashed narrower when walking sideways.

Black becomes transparent, and the figure is recoloured to one flat blue so the
edges stay clean. To change the clips, re-run the script (instructions at its top).

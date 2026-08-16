// Central input state. Scenes read this; nothing else touches the DOM events.
//
// Edge state (`clicked`, `pressed`) is valid for exactly one frame and is
// cleared by `endFrame()` at the bottom of the game loop.

export const Input = {
  x: 0,
  y: 0,
  dx: 0,
  dy: 0,
  down: false, // left button held
  clicked: false, // left button went down this frame
  released: false, // left button came up this frame
  rightClicked: false,
  wheel: 0,
  keys: new Set(), // currently held (lowercased key names)
  pressed: new Set(), // went down this frame
  typed: [], // printable characters this frame
  /** Set true by a widget that consumed the click, so nothing behind it fires. */
  clickConsumed: false,
};

let logicalW = 1280;
let logicalH = 720;
let canvasEl = null;

export function attachInput(canvas, width, height) {
  canvasEl = canvas;
  logicalW = width;
  logicalH = height;

  const toLogical = (ev) => {
    const r = canvas.getBoundingClientRect();
    // The canvas is letterboxed by CSS `object-fit: contain`-style sizing, so
    // the rect matches the drawing surface aspect and a plain scale works.
    const sx = logicalW / r.width;
    const sy = logicalH / r.height;
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
  };

  canvas.addEventListener('mousemove', (ev) => {
    const p = toLogical(ev);
    Input.dx += p.x - Input.x;
    Input.dy += p.y - Input.y;
    Input.x = p.x;
    Input.y = p.y;
  });

  canvas.addEventListener('mousedown', (ev) => {
    const p = toLogical(ev);
    Input.x = p.x;
    Input.y = p.y;
    if (ev.button === 0) {
      Input.down = true;
      Input.clicked = true;
    } else if (ev.button === 2) {
      Input.rightClicked = true;
    }
  });

  window.addEventListener('mouseup', (ev) => {
    if (ev.button === 0) {
      Input.down = false;
      Input.released = true;
    }
  });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  canvas.addEventListener(
    'wheel',
    (ev) => {
      Input.wheel += Math.sign(ev.deltaY);
      ev.preventDefault();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (ev) => {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (!Input.keys.has(k)) Input.pressed.add(k);
    Input.keys.add(k);
    if (ev.key.length === 1) Input.typed.push(ev.key);
    // Stop the page scrolling out from under the canvas.
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) {
      ev.preventDefault();
    }
  });

  window.addEventListener('keyup', (ev) => {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    Input.keys.delete(k);
  });

  // Dropping focus while a key is held would otherwise leave it stuck down.
  window.addEventListener('blur', () => {
    Input.keys.clear();
    Input.down = false;
  });
}

export function endFrame() {
  Input.clicked = false;
  Input.released = false;
  Input.rightClicked = false;
  Input.clickConsumed = false;
  Input.wheel = 0;
  Input.dx = 0;
  Input.dy = 0;
  Input.pressed.clear();
  Input.typed.length = 0;
}

export const keyDown = (k) => Input.keys.has(k);
export const keyPressed = (k) => Input.pressed.has(k);

/** Consume the frame's click so overlapping widgets don't both fire. */
export function takeClick() {
  if (Input.clicked && !Input.clickConsumed) {
    Input.clickConsumed = true;
    return true;
  }
  return false;
}

export function setCursor(style) {
  if (canvasEl) canvasEl.style.cursor = style;
}

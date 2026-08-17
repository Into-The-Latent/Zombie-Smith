// Bundle the whole game into one self-contained HTML file.
//
//   node tools/build-single.mjs [outfile]
//
// Useful for sharing a playable build where a static directory is awkward,
// and for publishing the prototype as a single page.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'dist', 'we-are-losing-daylight.html');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
  minify: false,
  legalComments: 'none',
});

const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'styles/main.css'), 'utf8');

// The splash art, inlined. This build is one file with nowhere to keep a
// sibling, so the picture travels as a data URI or it does not travel at all --
// and it is handed in on `window` rather than bundled through an import,
// because the served build has no bundler to rewrite such an import for it.
// The game degrades to its generated backdrop if this is ever missing.
const splash = fs.readFileSync(path.join(root, 'Splash-screen.jpg'));
const splashUrl = `data:image/jpeg;base64,${splash.toString('base64')}`;

// Single-theme on purpose: a game screen is its own world, so the page paints
// the same ground and forge glow the workshop scene does rather than adapting
// to the host. Every colour is stated explicitly for that reason.
const html = `<title>We Are Losing Daylight</title>
<style>
${css}
/* The single-file build owns the whole page. */
html, body { height: 100%; }

#boot {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  gap: 10px;
  align-content: center;
  background: #05070a;
  color: #8e9aac;
  font: 600 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transition: opacity 0.35s ease;
}
#boot.gone { opacity: 0; pointer-events: none; }
#boot b { color: #e8a33d; font-weight: 800; letter-spacing: 0.2em; }
@media (prefers-reduced-motion: reduce) { #boot { transition: none; } }
</style>

<div id="frame">
  <canvas id="game" width="1280" height="720" aria-label="We Are Losing Daylight game canvas"></canvas>
</div>
<div id="boot"><b>We Are Losing Daylight</b><span>lighting the forge</span></div>

<script>window.__SPLASH_URL__ = ${JSON.stringify(splashUrl)};</script>
<script>
${js}
</script>
<script>
  // The canvas paints on the first animation frame; clear the notice then.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const boot = document.getElementById('boot');
    if (boot) {
      boot.classList.add('gone');
      setTimeout(() => boot.remove(), 400);
    }
  }));
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  (${(html.length / 1024).toFixed(0)} KB)`);

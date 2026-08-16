// One place for colours and type, so every screen looks like the same game.

export const Theme = {
  bg: '#0b0e13',
  bgDeep: '#070a0e',
  panel: '#161b24',
  panelLight: '#1e2530',
  panelHi: '#28313f',
  border: '#2f3a49',
  borderHi: '#48566a',

  text: '#dce3ed',
  textDim: '#8e9aac',
  textFaint: '#5c6879',

  accent: '#e8a33d',
  accentDark: '#a8721f',
  good: '#4fb477',
  bad: '#d7443e',
  info: '#4a9fd8',
  warn: '#e0b23c',
  purple: '#a97fae',

  blood: '#8f2a24',
  rot: '#6f8f5f',

  font: (size, weight = 400) =>
    `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  mono: (size, weight = 400) =>
    `${weight} ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
};

export const W = 1280;
export const H = 720;

/* ══════════════════════════════════════════════════════════════════════
   image-editor.js — Callout9 · image editor
   window.createImageEditor(host, {src, onChange, onAI, onSave}) → editor
   ────────────────────────────────────────────────────────────────────
   A Paint-class raster editor.

   View     zoom (wheel · Ctrl+wheel at cursor · slider) · pan (hand tool ·
            space-drag · middle-drag) · pixel grid · status bar
   Canvas   resize (px / %) · skew · rotate 90° · flip · crop ·
            drag the edge handles to grow or shrink the canvas
   Select   rectangle · free-form · resize handles · arrow-key nudge ·
            Ctrl-drag to copy · transparent selection · flip · crop to selection
   Paint    pencil · eraser · flood fill · color picker
   Shapes   line · curve · arrow · rectangle · rounded rectangle · ellipse ·
            triangles · diamond · pentagon · hexagon · star, each editable by
            its handles until committed (Enter / another click)
   Text     multi-line · font family · size · bold · italic · underline ·
            transparent or filled background
   Colors   color 1 (stroke) · color 2 (fill) · 20-swatch palette · recent
            colors · drawing with the right mouse button swaps the two
   History  raw canvas snapshots — no PNG encode per step, no tainted-canvas
            failure mode; bounded by a step count and a pixel budget
   ══════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

const FONT = '"Malgun Gothic","Apple SD Gothic Neo",-apple-system,"Noto Sans KR",sans-serif';
const MAX_HISTORY     = 30;
const MAX_HIST_PIXELS = 40e6;        /* ≈160MB of RGBA backing store */
const ZOOMS = [0.1, 0.15, 0.25, 0.35, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MAX_DIM = 12000;
const HANDLE  = 4;                   /* half-size of a handle, in screen px */
const GRAB    = 7;                   /* handle hit radius, in screen px */

/* The 20 standard Paint swatches */
const PALETTE = [
  '#000000','#7f7f7f','#880015','#ed1c24','#ff7f27','#fff200','#22b14c','#00a2e8','#3f48cc','#a349a4',
  '#ffffff','#c3c3c3','#b97a57','#ffaec9','#ffc90e','#efe4b0','#b5e61d','#99d9ea','#7092be','#c8bfe7'
];

const FONTS = [
  ['"Malgun Gothic",sans-serif', '맑은 고딕'],
  ['"Noto Sans KR",sans-serif',  'Noto Sans KR'],
  ['Gulim,sans-serif',           '굴림'],
  ['Dotum,sans-serif',           '돋움'],
  ['Batang,serif',               '바탕'],
  ['Arial,sans-serif',           'Arial'],
  ['"Times New Roman",serif',    'Times New Roman'],
  ['Georgia,serif',              'Georgia'],
  ['Verdana,sans-serif',         'Verdana'],
  ['Impact,sans-serif',          'Impact'],
  ['Consolas,monospace',         'Consolas']
];

/* Shapes drawn from a drag rectangle. `line` marks the ones edited by their
   end points rather than by a bounding box. */
const SHAPES = {
  line     : { name: '선',           line: true  },
  curve    : { name: '곡선',         line: true  },
  arrow    : { name: '화살표',       line: true  },
  rect     : { name: '직사각형'                  },
  roundrect: { name: '둥근 직사각형'              },
  ellipse  : { name: '타원'                      },
  triangle : { name: '삼각형'                    },
  rtri     : { name: '직각 삼각형'                },
  diamond  : { name: '마름모'                    },
  pentagon : { name: '오각형'                    },
  hexagon  : { name: '육각형'                    },
  star     : { name: '별'                        }
};

/* ──────────────────────────────────────────────────────────
   Styles (injected once per document)
   ────────────────────────────────────────────────────────── */
const CSS = `
.imged{position:relative;z-index:0;height:100%;display:flex;flex-direction:column;min-height:0;background:#f1f4f3}
.imged-tb{display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:6px 8px;background:#fff;
  border-bottom:1px solid #e6eae8;position:relative;z-index:3;flex:0 0 auto}
.imged-tb2{z-index:2;padding:5px 8px;background:#fafbfb}
.imged-b{width:30px;height:28px;display:inline-grid;place-items:center;border:1px solid transparent;
  background:none;border-radius:5px;color:#6c7873;padding:0;cursor:pointer}
.imged-b:hover{background:#f2f5f4;color:#182220;border-color:#e6eae8}
.imged-b.on{background:#e2f0ec;color:#0a4f46;border-color:#cbe4dd}
.imged-b:disabled{opacity:.32;cursor:not-allowed;background:none;border-color:transparent;color:#6c7873}
.imged-b.wide{width:auto;padding:0 8px;font:600 12px/1 ${FONT}}
.imged-sep{width:1px;align-self:stretch;margin:4px 5px;background:#e6eae8;flex:0 0 auto}
.imged-zoom{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#6c7873;min-width:42px;
  text-align:center;font-variant-numeric:tabular-nums;user-select:none}
.imged-color{position:relative;width:30px;height:28px;display:inline-grid;place-items:center;border-radius:5px;
  border:1px solid transparent}
.imged-color:hover{background:#f2f5f4;border-color:#e6eae8}
.imged-color input{position:absolute;inset:0;opacity:0;width:100%;height:100%;padding:0;border:none;cursor:pointer}
.imged-sw{width:16px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,.3);pointer-events:none}
.imged-sw.ring{background:#fff !important;border-width:3.5px;border-style:solid}
.imged-swa{font:800 15px/1 ${FONT};pointer-events:none;border-bottom:3px solid currentColor;padding-bottom:1px}
.imged-off{position:absolute;left:4px;top:4px;right:4px;bottom:4px;pointer-events:none;display:none}
.imged-color.nofill .imged-off{display:block}
.imged-tag{font-size:10.5px;color:#8a9691;user-select:none;margin:0 1px 0 3px}
.imged-pal{display:grid;grid-template-rows:repeat(2,13px);grid-auto-flow:column;gap:2px;align-self:center}
.imged-pal i{width:13px;height:13px;border-radius:3px;border:1px solid rgba(0,0,0,.2);cursor:pointer;display:block}
.imged-pal i:hover{outline:2px solid #0d6b5f;outline-offset:1px}
.imged-pal.rec i{border-style:dashed}
.imged-sel{height:27px;border:1px solid #e6eae8;border-radius:5px;background:#fff;font-size:12px;
  padding:0 3px;color:#41504c;cursor:pointer;max-width:130px}
.imged-sel:focus{outline:none;border-color:#0d6b5f}
.imged-grp{display:flex;align-items:center;gap:2px}
.imged-grp[hidden]{display:none}
.imged-ai{margin-left:auto;background:#0d6b5f;border:1px solid #0a4f46;color:#fff;font-weight:600;
  border-radius:20px;padding:6px 15px;display:inline-flex;align-items:center;gap:6px;font-size:13px;
  cursor:pointer;box-shadow:0 2px 10px rgba(13,107,95,.26);white-space:nowrap}
.imged-ai:hover{background:#0a4f46}
.imged-ai[hidden]{display:none}
.imged-ai.off,.imged-ai.off:hover{background:#e9edec;border-color:#dde3e1;color:#5f6b67;
  box-shadow:none;cursor:not-allowed}

.imged-stage{flex:1 1 auto;min-height:0;overflow:auto;display:grid;place-items:center;padding:22px;
  align-items:safe center;justify-items:safe center}
.imged-stage:focus,.imged-stage:focus-visible{outline:none}
.imged-stage.pan{cursor:grab}
.imged-stage.panning{cursor:grabbing}
.imged-view{position:relative;line-height:0;box-shadow:0 2px 16px rgba(0,0,0,.15);
  background-color:#fff;background-image:
    linear-gradient(45deg,#e9edec 25%,transparent 25%,transparent 75%,#e9edec 75%),
    linear-gradient(45deg,#e9edec 25%,transparent 25%,transparent 75%,#e9edec 75%);
  background-size:16px 16px;background-position:0 0,8px 8px}
.imged-view canvas{width:100%;height:100%;display:block}
.imged-ov{position:absolute;left:0;top:0;touch-action:none}
.imged-gr{position:absolute;inset:0;pointer-events:none;display:none;background-image:
  linear-gradient(to right,rgba(0,0,0,.17) 1px,transparent 1px),
  linear-gradient(to bottom,rgba(0,0,0,.17) 1px,transparent 1px)}
.imged-view.t-draw .imged-ov{cursor:crosshair}
.imged-view.t-text .imged-ov{cursor:text}
.imged-view.t-sel .imged-ov{cursor:crosshair}
.imged-view.t-pick .imged-ov{cursor:cell}
.imged-view.t-fill .imged-ov{cursor:copy}

.imged-ch{position:absolute;width:10px;height:10px;background:#fff;border:1.5px solid #0d6b5f;
  border-radius:2px;z-index:4;touch-action:none}
.imged-ch.e{right:-6px;top:calc(50% - 5px);cursor:ew-resize}
.imged-ch.s{bottom:-6px;left:calc(50% - 5px);cursor:ns-resize}
.imged-ch.se{right:-6px;bottom:-6px;cursor:nwse-resize}
.imged-ghost{position:absolute;left:0;top:0;border:1px dashed #0d6b5f;background:rgba(13,107,95,.07);
  pointer-events:none;z-index:5;display:none}

.imged-tin{position:absolute;background:transparent;border:1px dashed #0d6b5f;outline:none;
  padding:1px 2px;line-height:1.25;white-space:pre;overflow:hidden;resize:none;min-width:26px;
  border-radius:2px;z-index:5;transform:translate(-3px,-3px)}
.imged-ca{position:absolute;display:flex;gap:5px;z-index:6}
.imged-ca[hidden]{display:none}
.imged-ca button{width:28px;height:28px;border-radius:50%;border:1px solid #0a4f46;background:#0d6b5f;
  color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.28);padding:0}
.imged-ca button.no{background:#fff;color:#a8432a;border-color:#d8c3bc}

.imged-sb{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:4px 10px;background:#fff;
  border-top:1px solid #e6eae8;font:11.5px/1 ui-monospace,Consolas,monospace;color:#6c7873;
  font-variant-numeric:tabular-nums;user-select:none}
.imged-sb .gap{margin-left:auto}
.imged-sb input[type=range]{width:110px;accent-color:#0d6b5f}

.imged-pop{position:absolute;top:calc(100% + 4px);left:8px;background:#fff;border:1px solid #d5dbd8;
  border-radius:8px;box-shadow:0 14px 38px rgba(0,0,0,.18);padding:11px;z-index:9;width:224px;
  display:flex;flex-direction:column;gap:8px;font-size:12.5px;color:#182220;line-height:1.4}
.imged-pop[hidden]{display:none}
.imged-pop h4{margin:1px 0 -2px;font-size:11px;font-weight:700;color:#8a9691;letter-spacing:.04em}
.imged-pop .r{display:flex;align-items:center;gap:7px}
.imged-pop .r label{width:30px;color:#6c7873;font-family:ui-monospace,Consolas,monospace;font-size:11px}
.imged-pop input[type=number]{flex:1;min-width:0;border:1px solid #d5dbd8;border-radius:5px;padding:5px 7px;
  font:inherit;color:inherit}
.imged-pop input[type=number]:focus{outline:none;border-color:#0d6b5f;box-shadow:0 0 0 3px #e2f0ec}
.imged-pop .lk{display:flex;align-items:center;gap:6px;color:#6c7873;font-size:11.5px;cursor:pointer}
.imged-pop .ft{display:flex;gap:6px;justify-content:flex-end;margin-top:2px}
.imged-pop .ft button{border:1px solid #d5dbd8;background:#fff;border-radius:5px;padding:5px 11px;
  font:inherit;cursor:pointer}
.imged-pop .ft button.go{background:#0d6b5f;border-color:#0d6b5f;color:#fff;font-weight:600}
.imged-pop .unit{display:flex;gap:4px}
.imged-pop .unit button{flex:1;border:1px solid #d5dbd8;background:#fff;border-radius:5px;padding:4px 0;
  font:inherit;cursor:pointer;color:#6c7873}
.imged-pop .unit button.on{background:#e2f0ec;border-color:#cbe4dd;color:#0a4f46;font-weight:600}

.imged-gal{width:auto;display:grid;grid-template-columns:repeat(4,32px);gap:3px;padding:7px}
.imged-gal button{width:32px;height:30px;display:grid;place-items:center;border:1px solid transparent;
  background:none;border-radius:5px;color:#41504c;cursor:pointer;padding:0}
.imged-gal button:hover{background:#f2f5f4;border-color:#e6eae8}
.imged-gal button.on{background:#e2f0ec;border-color:#cbe4dd;color:#0a4f46}
`;

function injectCSS(){
  if (document.getElementById('imged-css')) return;
  const st = document.createElement('style');
  st.id = 'imged-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ──────────────────────────────────────────────────────────
   Icons (24×24 · stroke)
   ────────────────────────────────────────────────────────── */
const I = {
  hand   : '<path d="M8.4 11.4V5.6a1.55 1.55 0 0 1 3.1 0v5M11.5 10.6V4.6a1.55 1.55 0 0 1 3.1 0v6M14.6 11V6.4a1.55 1.55 0 0 1 3.1 0v7.1c0 4-2.4 7-6.2 7-2 0-3.4-.8-4.6-2.4l-2.6-3.7a1.6 1.6 0 0 1 2.4-2l1.7 1.8"/>',
  zoomIn : '<circle cx="10.5" cy="10.5" r="6.6"/><path d="M15.4 15.4 20.5 20.5M7.7 10.5h5.6M10.5 7.7v5.6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.6"/><path d="M15.4 15.4 20.5 20.5M7.7 10.5h5.6"/>',
  fit    : '<path d="M3.5 9V5.5a2 2 0 0 1 2-2H9M20.5 9V5.5a2 2 0 0 0-2-2H15M3.5 15v3.5a2 2 0 0 0 2 2H9M20.5 15v3.5a2 2 0 0 1-2 2H15"/>',
  resize : '<path d="M3.5 3.5h10v10h-10z"/><path d="M9 20.5h11.5V9M13.5 16 20.5 9"/>',
  /* Rotate: right triangle plus a curved directional arrow (so it is not confused with undo/redo) */
  rotR   : '<path d="M3.4 20.9V12.2l8.7 8.7z" fill="currentColor" stroke-linejoin="round"/>' +
           '<path d="M6.4 7.6A8.8 8.8 0 0 1 20.4 13.4"/>' +
           '<path d="m17 12.4 4.2 2.2 1-4.3z" fill="currentColor" stroke-linejoin="round"/>',
  flipH  : '<path d="M12 2.8v18.4" stroke-dasharray="2.6 2.4"/>' +
           '<path d="M9.4 6.6 4 12l5.4 5.4z"/><path d="M14.6 6.6 20 12l-5.4 5.4z" fill="currentColor"/>',
  flipV  : '<path d="M2.8 12h18.4" stroke-dasharray="2.6 2.4"/>' +
           '<path d="M6.6 9.4 12 4l5.4 5.4z"/><path d="M6.6 14.6 12 20l5.4-5.4z" fill="currentColor"/>',
  crop   : '<path d="M6.6 2.5v15h15"/><path d="M2.5 6.6h15v15"/>',
  select : '<rect x="3.3" y="3.3" width="17.4" height="17.4" rx="1.2" stroke-dasharray="3.4 2.8"/>',
  lasso  : '<path d="M10.6 19.7C6.4 19.1 3.4 16.6 3.4 13.6 3.4 10 7.2 7 12 7s8.6 3 8.6 6.6c0 2.2-1.4 4.2-3.6 5.4" stroke-dasharray="3.2 2.6"/>' +
           '<path d="M10.6 19.7a1.7 1.7 0 1 1-.1 0z"/>',
  pencil : '<path d="M4.4 19.6 8 18.7 20 6.8a1.9 1.9 0 0 0-2.7-2.7L5.3 16z"/><path d="m15.6 5.6 2.8 2.8"/>',
  eraser : '<path d="M4.3 13.6 12.7 5.2a1.8 1.8 0 0 1 2.5 0l4 4a1.8 1.8 0 0 1 0 2.5l-8.4 8.4H7.5L4.3 16.9a1.8 1.8 0 0 1 0-2.5z"/>' +
           '<path d="M9.7 8.2 16.2 14.7"/><path d="M9.6 20.5h10.9"/>',
  bucket : '<path d="M12.4 3.4 5.1 10.7a1.7 1.7 0 0 0 0 2.4l5.5 5.5a1.7 1.7 0 0 0 2.4 0l6.6-6.6z"/>' +
           '<path d="M9.3 6.5 7 4.2"/>' +
           '<path d="M19.7 15.5c.9 1.2 1.4 2.1 1.4 2.7a1.4 1.4 0 0 1-2.8 0c0-.6.5-1.5 1.4-2.7z" fill="currentColor"/>',
  picker : '<path d="M18.3 3a2.7 2.7 0 0 1 2.7 2.7c0 .7-.3 1.4-.8 1.9l-1.6 1.6-3.8-3.8 1.6-1.6c.5-.5 1.2-.8 1.9-.8z" fill="currentColor"/>' +
           '<path d="m14.8 5.4 3.8 3.8"/>' +
           '<path d="m16.1 7.5-9.4 9.4-.9 3.6 3.6-.9 9.4-9.4"/>',
  text   : '<path d="M5 6.4V4.2h14v2.2M12 4.2v15.6M8.8 19.8h6.4"/>',
  nofill : '<rect x="3.6" y="5.4" width="16.8" height="13.2" rx="1.4"/><path d="M5 18 19 6"/>',
  undo   : '<path d="M4 9.5h10.6a5.2 5.2 0 0 1 0 10.4H8.6"/><path d="m4 9.5 4-4M4 9.5l4 4"/>',
  save   : '<path d="M4.5 3.5h11.6l3.9 3.9V20.5h-15.5z"/><path d="M8 3.5v5.6h7.2V3.5"/><path d="M7.4 20.5v-6.4h9.2v6.4"/>',
  open   : '<path d="M3.5 18.6V6.4a1.9 1.9 0 0 1 1.9-1.9h3.4l2.1 2.5h7.7a1.9 1.9 0 0 1 1.9 1.9v1.3"/>' +
           '<path d="M3.5 18.6 6 10.9h15.1l-2.4 7.7a1.4 1.4 0 0 1-1.3 1H4.9a1.4 1.4 0 0 1-1.4-1z"/>',
  down   : '<path d="M12 3.6v11.6"/><path d="m7.5 10.8 4.5 4.4 4.5-4.4"/><path d="M4.4 19.6h15.2"/>',
  ok     : '<path d="M5 12.6 9.7 17 19 6.8" stroke-width="2.4"/>',
  no     : '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" stroke-width="2.4"/>',
  cut    : '<circle cx="6.4" cy="17.6" r="2.7"/><circle cx="17.6" cy="17.6" r="2.7"/>' +
           '<path d="M8.3 15.7 18.4 3.6M15.7 15.7 5.6 3.6"/>',
  copy   : '<rect x="8.4" y="8.4" width="12.1" height="12.1" rx="1.6"/>' +
           '<path d="M15.6 5.4V5a1.6 1.6 0 0 0-1.6-1.5H5a1.6 1.6 0 0 0-1.5 1.5v9a1.6 1.6 0 0 0 1.5 1.6h.4"/>',
  cropSel: '<path d="M6.6 2.5v15h15"/><path d="M2.5 6.6h15v15"/><path d="M9.6 9.6h5v5h-5z" fill="currentColor" stroke="none"/>',
  ghost  : '<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="1.4" stroke-dasharray="3.2 2.6"/>' +
           '<path d="M8.6 15.2 12 9.6l3.4 5.6z" fill="currentColor"/>',
  bold   : '<path d="M6.8 4.2h6a3.9 3.9 0 0 1 0 7.8H6.8zM6.8 12h6.9a3.9 3.9 0 0 1 0 7.8H6.8z" stroke-width="1.9"/>',
  italic : '<path d="M15.4 4.4h-5M13.6 19.6h-5M14.4 4.4 9.6 19.6" stroke-width="1.9"/>',
  under  : '<path d="M6.6 3.8v6.6a5.4 5.4 0 0 0 10.8 0V3.8M5.4 20.2h13.2" stroke-width="1.9"/>',
  tbg    : '<rect x="3.4" y="5.2" width="17.2" height="13.6" rx="1.6" fill="currentColor" opacity=".2" stroke="none"/>' +
           '<rect x="3.4" y="5.2" width="17.2" height="13.6" rx="1.6"/>' +
           '<path d="M8.2 9.4h7.6M12 9.4v5.6"/>'
};
/* Icons derived by mirroring horizontally */
const flipX = d => '<g transform="translate(24,0) scale(-1,1)">' + d + '</g>';
I.redo = flipX(I.undo);
I.rotL = flipX(I.rotR);

/* Shape gallery icons */
const SI = {
  line     : '<path d="M4.2 19.8 19.8 4.2"/>',
  curve    : '<path d="M3.6 18.4c3.4-11.6 13.4-11.6 16.8 0"/>',
  arrow    : '<path d="M4.4 19.6 19 5"/><path d="M11.6 5H19v7.4"/>',
  rect     : '<rect x="3.5" y="5.5" width="17" height="13" rx="1.2"/>',
  roundrect: '<rect x="3.5" y="5.5" width="17" height="13" rx="4.4"/>',
  ellipse  : '<ellipse cx="12" cy="12" rx="8.6" ry="6.8"/>',
  triangle : '<path d="M12 4.2 20.8 19.8H3.2z"/>',
  rtri     : '<path d="M4.2 4.2v15.6h15.6z"/>',
  diamond  : '<path d="M12 3.4 20.6 12 12 20.6 3.4 12z"/>',
  pentagon : '<path d="m12 3.4 8.6 6.2-3.3 10.1H6.7L3.4 9.6z"/>',
  hexagon  : '<path d="M7.9 4.4h8.2l4.1 7.6-4.1 7.6H7.9L3.8 12z"/>',
  star     : '<path d="m12 3.2 2.7 6.1 6.6.6-5 4.4 1.5 6.5L12 17.4l-5.8 3.4 1.5-6.5-5-4.4 6.6-.6z"/>'
};

const svg = (d, sz) =>
  '<svg viewBox="0 0 24 24" width="' + (sz || 16) + '" height="' + (sz || 16) + '" fill="none" ' +
  'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';

/* ──────────────────────────────────────────────────────────
   Small helpers
   ────────────────────────────────────────────────────────── */
function hexRGB(h){
  h = String(h || '').replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbHex(r, g, b){
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
}
function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

/* ──────────────────────────────────────────────────────────
   Main body
   ────────────────────────────────────────────────────────── */
function createImageEditor(host, opts){
  opts = opts || {};
  injectCSS();

  /* ---------- DOM ---------- */
  const root  = el('div', 'imged');
  const tb    = el('div', 'imged-tb');
  const tb2   = el('div', 'imged-tb imged-tb2');
  const stage = el('div', 'imged-stage');
  stage.tabIndex = -1;                 /* click-focusable, but not in the tab order */
  const view  = el('div', 'imged-view');
  const base  = document.createElement('canvas');
  const grid  = el('div', 'imged-gr');
  const ov    = document.createElement('canvas'); ov.className = 'imged-ov';
  const tin   = document.createElement('textarea'); tin.className = 'imged-tin';
  const ca    = el('div', 'imged-ca');
  const ghost = el('div', 'imged-ghost');
  const chE   = el('div', 'imged-ch e'), chS = el('div', 'imged-ch s'), chSE = el('div', 'imged-ch se');
  chE.title = chS.title = chSE.title = '드래그하여 캔버스 크기 변경';
  const sb    = el('div', 'imged-sb');
  tin.hidden = true; tin.spellcheck = false; ca.hidden = true;

  view.append(base, grid, ov, tin, ca, ghost, chE, chS, chSE);
  stage.appendChild(view);
  root.append(tb, tb2, stage, sb);
  host.appendChild(root);

  const ctx  = base.getContext('2d');
  const octx = ov.getContext('2d');

  /* ---------- state ---------- */
  let zoom = 1, fitMode = true, tool = 'pan', dirty = false, ovDpr = 1;
  let fill = '#ffffff', fillOn = false, stroke = '#e5484d', textColor = '#e5484d';
  let lineW = 3, fontSize = 20, fontFam = FONTS[0][0];
  let bold = false, italic = false, underline = false, textBg = false;
  let shapeKind = 'rect', fillTol = 32, transSel = false;
  let hist = [], redoStack = [];
  let drag = null, cropRect = null, textAt = null, pending = null;
  let spaceDown = false, panDrag = null, prevTool = 'pencil';
  const recent = [];
  /* Region selection: `sel` is the marquee (with an optional free-form path),
     `floatSel` holds pixels lifted off the canvas (by a move or a paste) until
     they are committed back, `clip` is the in-editor clipboard used when the
     system clipboard is not readable. */
  let sel = null, floatSel = null, clip = null;

  const fire = () => { dirty = true; if (opts.onChange) opts.onChange(); };

  /* Which pane owns the keyboard? The host page has its own paste and Delete
     handling (paste adds an image node, Delete removes the selected tree node),
     so the selection keys and paste only apply while the editor holds focus. */
  function hasFocus(){
    return root.isConnected && root.contains(document.activeElement);
  }
  function isField(t){
    return t === tin || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || (t && t.isContentEditable);
  }
  /* Canvases cannot hold focus and the overlay swallows the default mousedown
     focus anyway, so hand focus to the stage whenever the editor is clicked. */
  root.addEventListener('pointerdown', e => {
    if (isField(e.target) || hasFocus()) return;
    try { stage.focus({ preventScroll: true }); } catch(_){ stage.focus(); }
  }, true);

  /* ══════ toolbar · row 1 ══════ */
  const btnZoomOut = iconBtn(I.zoomOut, '축소 (Ctrl+휠 아래)', () => stepZoom(-1));
  const zoomLabel  = el('span', 'imged-zoom'); zoomLabel.textContent = '100%';
  const btnZoomIn  = iconBtn(I.zoomIn, '확대 (Ctrl+휠 위)', () => stepZoom(1));
  const btnFit     = iconBtn(I.fit, '화면 맞춤 ↔ 실제 크기(100%)', toggleFit);
  tb.append(btnZoomOut, zoomLabel, btnZoomIn, btnFit);

  const btnResize = iconBtn(I.resize, '크기 조정 및 기울이기', togglePop);
  const btnRotL   = iconBtn(I.rotL, '왼쪽으로 90° 회전', () => rotate(-1));
  const btnRotR   = iconBtn(I.rotR, '오른쪽으로 90° 회전', () => rotate(1));
  const btnFlipH  = iconBtn(I.flipH, '좌우 대칭 (선택 영역이 있으면 그 안에서)', () => flip('h'));
  const btnFlipV  = iconBtn(I.flipV, '상하 대칭 (선택 영역이 있으면 그 안에서)', () => flip('v'));
  tb.append(sep(), btnResize, btnRotL, btnRotR, btnFlipH, btnFlipV);

  const btnPan  = iconBtn(I.hand, '이동(팬) — 스페이스+드래그 또는 휠 클릭으로도 가능', () => setTool('pan'));
  const btnSel  = iconBtn(I.select,
    '사각형 선택 — 드래그로 선택 · Del 삭제 · Ctrl+C/X/V · 안쪽 드래그로 이동 · Ctrl+드래그로 복사',
    () => setTool('sel'));
  const btnLasso = iconBtn(I.lasso, '자유형 선택 — 원하는 모양으로 감싸기', () => setTool('selfree'));
  const btnCrop = iconBtn(I.crop, '자르기 — 영역을 끌고 ✓ (Enter)', () => setTool('crop'));
  tb.append(sep(), btnPan, btnSel, btnLasso, btnCrop);

  const btnPencil = iconBtn(I.pencil, '연필 — 자유롭게 그리기 (오른쪽 버튼: 색 2)', () => setTool('pencil'));
  const btnErase  = iconBtn(I.eraser, '지우개 — 투명하게 지우기 (오른쪽 버튼: 색 2로 칠하기)', () => setTool('eraser'));
  const btnFill   = iconBtn(I.bucket, '색 채우기 (오른쪽 버튼: 색 2)', () => setTool('fill'));
  const btnPick   = iconBtn(I.picker, '색 선택 — 캔버스에서 색 추출 (오른쪽 버튼: 색 2로)', () => setTool('picker'));
  tb.append(sep(), btnPencil, btnErase, btnFill, btnPick);

  const btnShape = iconBtn(SI[shapeKind], '도형 — 클릭하여 모양 선택', onShapeBtn);
  const btnText  = iconBtn(I.text, '텍스트 — 위치를 클릭하고 입력 (Ctrl+Enter로 확정)', () => setTool('text'));
  tb.append(sep(), btnShape, btnText);

  const btnUndo = iconBtn(I.undo, '실행 취소 (Ctrl+Z)', undo);
  const btnRedo = iconBtn(I.redo, '다시 실행 (Ctrl+Y)', redo);
  tb.append(sep(), btnUndo, btnRedo);

  const btnOpen = iconBtn(I.open, '이미지 열기 — 현재 그림을 교체', openFile);
  const btnDown = iconBtn(I.down, '파일로 내보내기', toggleExp);
  const btnSave = iconBtn(I.save, '편집 내용 저장 (Ctrl+S)', () => { if (opts.onSave) opts.onSave(); });
  tb.append(sep(), btnOpen, btnDown, btnSave);

  /* AI button — the only text button rather than an icon.
     When disabled it stays clickable on purpose so the host can explain why. */
  const aiBtn = document.createElement('button');
  aiBtn.type = 'button';
  aiBtn.className = 'imged-ai';
  aiBtn.textContent = '✦ Generate with AI';
  aiBtn.addEventListener('click', () => { if (opts.onAI) opts.onAI(); });
  tb.appendChild(aiBtn);
  setAIEnabled(opts.aiEnabled !== false);

  /* ══════ toolbar · row 2 (contextual options) ══════ */
  const cStroke = colorBtn(stroke, '색 1 — 선 · 연필 · 텍스트', v => { stroke = v; addRecent(v); syncColors(); }, 'ring');
  const cFill   = colorBtn(fill, '색 2 — 채우기 · 오른쪽 버튼 그리기', v => { fill = v; fillOn = true; addRecent(v); syncColors(); });
  const btnFillOff = iconBtn(I.nofill, '채우기 없음 ↔ 채우기 사용', () => { fillOn = !fillOn; syncColors(); });
  tb2.append(tag('색1'), cStroke.wrap, tag('색2'), cFill.wrap, btnFillOff);

  const pal = el('div', 'imged-pal');
  for (const c of PALETTE) pal.appendChild(swatch(c));
  const palRec = el('div', 'imged-pal rec');
  tb2.append(sep(), pal, palRec);

  const selW = mkSelect(
    [['1','1px'],['2','2px'],['3','3px'],['5','5px'],['8','8px'],['12','12px'],['18','18px'],['26','26px'],['40','40px']],
    String(lineW), '선 두께', v => { lineW = +v; drawOverlay(); });
  tb2.append(sep(), selW);

  /* fill-tool options */
  const grpFill = el('div', 'imged-grp'); grpFill.hidden = true;
  const selTol = mkSelect([['0','정확히'],['16','낮음'],['32','보통'],['64','높음'],['110','매우 높음']],
                          String(fillTol), '색 채우기 허용 오차', v => { fillTol = +v; });
  grpFill.append(tag('허용'), selTol);
  tb2.append(grpFill);

  /* selection options */
  const grpSel = el('div', 'imged-grp'); grpSel.hidden = true;
  const btnTrans = iconBtn(I.ghost, '투명 선택 — 선택 영역에서 색 2를 투명하게', () => {
    transSel = !transSel; btnTrans.classList.toggle('on', transSel);
  });
  const btnCopyS = iconBtn(I.copy, '복사 (Ctrl+C)', () => copySel());
  const btnCutS  = iconBtn(I.cut, '잘라내기 (Ctrl+X)', () => { if (copySel()) deleteSel(); });
  const btnCropS = iconBtn(I.cropSel, '선택 영역으로 자르기', cropToSel);
  grpSel.append(sep(), btnTrans, btnCopyS, btnCutS, btnCropS);
  tb2.append(grpSel);

  /* text options */
  const grpText = el('div', 'imged-grp'); grpText.hidden = true;
  const selFam = mkSelect(FONTS, fontFam, '글꼴', v => { fontFam = v; placeTextInput(); });
  const selF   = mkSelect([['10','10'],['12','12'],['14','14'],['16','16'],['20','20'],['24','24'],
                           ['28','28'],['36','36'],['48','48'],['64','64'],['96','96']],
                          String(fontSize), '글자 크기', v => { fontSize = +v; placeTextInput(); });
  const btnB = iconBtn(I.bold,   '굵게',   () => { bold = !bold; btnB.classList.toggle('on', bold); placeTextInput(); });
  const btnI = iconBtn(I.italic, '기울임', () => { italic = !italic; btnI.classList.toggle('on', italic); placeTextInput(); });
  const btnU = iconBtn(I.under,  '밑줄',   () => { underline = !underline; btnU.classList.toggle('on', underline); });
  const cText = colorBtn(textColor, '글자 색', v => { textColor = v; addRecent(v); syncColors(); }, 'text');
  const btnTBg = iconBtn(I.tbg, '글자 배경 — 투명 ↔ 색 2로 채움', () => {
    textBg = !textBg; btnTBg.classList.toggle('on', textBg); placeTextInput();
  });
  grpText.append(sep(), selFam, selF, btnB, btnI, btnU, cText.wrap, btnTBg);
  tb2.append(grpText);

  /* ---------- resize / skew popover ---------- */
  const pop = el('div', 'imged-pop'); pop.hidden = true;
  pop.innerHTML =
    '<h4>크기 조정</h4>' +
    '<div class="unit"><button type="button" data-u="px" class="on">픽셀</button>' +
    '<button type="button" data-u="pc">백분율</button></div>' +
    '<div class="r"><label>가로</label><input type="number" min="1" max="' + MAX_DIM + '" data-w></div>' +
    '<div class="r"><label>세로</label><input type="number" min="1" max="' + MAX_DIM + '" data-h></div>' +
    '<label class="lk"><input type="checkbox" data-lock checked>가로 세로 비율 유지</label>' +
    '<h4>기울이기 (도)</h4>' +
    '<div class="r"><label>가로</label><input type="number" min="-80" max="80" step="1" data-sh value="0"></div>' +
    '<div class="r"><label>세로</label><input type="number" min="-80" max="80" step="1" data-sv value="0"></div>' +
    '<div class="ft"><button type="button" data-cancel>취소</button>' +
    '<button type="button" class="go" data-apply>적용</button></div>';
  tb.appendChild(pop);
  const popW = pop.querySelector('[data-w]'),
        popH = pop.querySelector('[data-h]'),
        popSH = pop.querySelector('[data-sh]'),
        popSV = pop.querySelector('[data-sv]'),
        popLock = pop.querySelector('[data-lock]');
  let popUnit = 'px';
  pop.querySelectorAll('.unit button').forEach(b => b.addEventListener('click', () => {
    popUnit = b.dataset.u;
    pop.querySelectorAll('.unit button').forEach(x => x.classList.toggle('on', x === b));
    if (popUnit === 'pc'){ popW.value = 100; popH.value = 100; popW.max = 2000; popH.max = 2000; }
    else { popW.value = base.width; popH.value = base.height; popW.max = MAX_DIM; popH.max = MAX_DIM; }
  }));
  popW.addEventListener('input', () => {
    if (!popLock.checked) return;
    if (popUnit === 'pc') popH.value = popW.value;
    else if (base.width) popH.value = Math.max(1, Math.round(+popW.value * base.height / base.width));
  });
  popH.addEventListener('input', () => {
    if (!popLock.checked) return;
    if (popUnit === 'pc') popW.value = popH.value;
    else if (base.height) popW.value = Math.max(1, Math.round(+popH.value * base.width / base.height));
  });
  pop.querySelector('[data-cancel]').addEventListener('click', closePop);
  pop.querySelector('[data-apply]').addEventListener('click', applyResize);

  /* ---------- shape gallery popover ---------- */
  const gal = el('div', 'imged-pop imged-gal'); gal.hidden = true;
  for (const k in SHAPES){
    const b = document.createElement('button');
    b.type = 'button'; b.title = SHAPES[k].name; b.dataset.k = k;
    b.innerHTML = svg(SI[k], 18);
    b.addEventListener('click', () => { pickShape(k); gal.hidden = true; });
    gal.appendChild(b);
  }
  tb.appendChild(gal);

  /* ---------- export popover ---------- */
  const exp = el('div', 'imged-pop'); exp.hidden = true;
  exp.style.width = '150px';
  exp.innerHTML = '<h4>파일로 내보내기</h4>' +
    '<div class="ft" style="flex-direction:column;gap:5px">' +
    '<button type="button" data-x="image/png">PNG</button>' +
    '<button type="button" data-x="image/jpeg">JPEG</button>' +
    '<button type="button" data-x="image/webp">WebP</button></div>';
  exp.querySelectorAll('[data-x]').forEach(b =>
    b.addEventListener('click', () => { exportAs(b.dataset.x); exp.hidden = true; }));
  tb.appendChild(exp);

  /* ---------- hidden file input ---------- */
  const fileIn = document.createElement('input');
  fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.hidden = true;
  fileIn.addEventListener('change', onFilePicked);
  root.appendChild(fileIn);

  /* ---------- crop confirm buttons ---------- */
  ca.innerHTML =
    '<button type="button" data-ok title="자르기 적용 (Enter)">' + svg(I.ok) + '</button>' +
    '<button type="button" class="no" data-no title="취소 (Esc)">' + svg(I.no) + '</button>';
  ca.querySelector('[data-ok]').addEventListener('click', applyCrop);
  ca.querySelector('[data-no]').addEventListener('click', clearCrop);

  /* ---------- status bar ---------- */
  const sbPos  = el('span'), sbSel = el('span'), sbSize = el('span'), sbHint = el('span');
  const sbGap  = el('span', 'gap');
  const zSlide = document.createElement('input');
  zSlide.type = 'range'; zSlide.min = '0'; zSlide.max = String(ZOOMS.length - 1); zSlide.step = '1';
  zSlide.title = '확대/축소';
  zSlide.addEventListener('input', () => {
    fitMode = false; btnFit.classList.remove('on');
    zoom = ZOOMS[+zSlide.value]; applyZoom();
  });
  const zLabel2 = el('span');
  sb.append(sbPos, sbSel, sbSize, sbHint, sbGap, zSlide, zLabel2);

  syncColors();
  renderRecent();
  btnFit.classList.add('on');
  /* setTool() runs at the end of the body — it reads TOOLBTN, declared below. */

  /* ══════ toolbar helpers ══════ */
  function setAIEnabled(on){
    aiBtn.classList.toggle('off', !on);
    aiBtn.setAttribute('aria-disabled', on ? 'false' : 'true');
    aiBtn.title = on ? '' : 'An AI API must be registered first';
  }
  function el(t, c){ const d = document.createElement(t); if (c) d.className = c; return d; }
  function sep(){ return el('span', 'imged-sep'); }
  function tag(s){ const d = el('span', 'imged-tag'); d.textContent = s; return d; }

  function iconBtn(d, title, fn){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'imged-b'; b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg(d);
    b.addEventListener('click', fn);
    return b;
  }
  function colorBtn(val, title, fn, kind){
    const wrap = el('span', 'imged-color'); wrap.title = title;
    let sw;
    if (kind === 'text'){ sw = el('span', 'imged-swa'); sw.textContent = 'A'; sw.style.color = val; }
    else { sw = el('span', 'imged-sw' + (kind === 'ring' ? ' ring' : '')); sw.style.background = val; }
    const off = el('span', 'imged-off');
    off.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="none">' +
                    '<path d="M1 23 23 1" stroke="#a8432a" stroke-width="2.6"/></svg>';
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = val;
    inp.setAttribute('aria-label', title);
    inp.addEventListener('input', () => fn(inp.value));
    wrap.append(sw, off, inp);
    return { wrap, sw, inp };
  }
  function mkSelect(items, val, title, fn){
    const s = document.createElement('select');
    s.className = 'imged-sel'; s.title = title;
    s.setAttribute('aria-label', title);
    for (const it of items){
      const o = document.createElement('option');
      o.value = it[0]; o.textContent = it[1];
      s.appendChild(o);
    }
    s.value = val;
    s.addEventListener('change', () => fn(s.value));
    return s;
  }
  /* A palette chip: left click sets color 1, right click sets color 2. */
  function swatch(c){
    const b = el('i');
    b.style.background = c;
    b.title = c + ' — 클릭: 색 1 · 오른쪽 클릭: 색 2';
    b.addEventListener('click', () => { stroke = c; syncColors(); });
    b.addEventListener('contextmenu', e => { e.preventDefault(); fill = c; fillOn = true; syncColors(); });
    return b;
  }
  function addRecent(c){
    const i = recent.indexOf(c);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(c);
    if (recent.length > 10) recent.length = 10;
    renderRecent();
  }
  function renderRecent(){
    palRec.textContent = '';
    for (const c of recent) palRec.appendChild(swatch(c));
  }
  function syncColors(){
    cFill.sw.style.background = fill;
    cFill.inp.value = fill;
    cFill.wrap.classList.toggle('nofill', !fillOn);
    btnFillOff.classList.toggle('on', !fillOn);
    cStroke.sw.style.borderColor = stroke;
    cStroke.inp.value = stroke;
    cText.sw.style.color = textColor;
    cText.inp.value = textColor;
    drawOverlay();
  }
  function syncHistBtns(){
    btnUndo.disabled = !hist.length;
    btnRedo.disabled = !redoStack.length;
  }

  /* ══════ status bar ══════ */
  function syncStatus(p){
    if (p) sbPos.textContent = Math.floor(p.x) + ', ' + Math.floor(p.y) + ' px';
    const b = selBounds();
    sbSel.textContent  = b ? '· 선택 ' + Math.round(b.w) + ' × ' + Math.round(b.h) : '';
    sbSize.textContent = '· 캔버스 ' + base.width + ' × ' + base.height + ' px';
    sbHint.textContent = pending ? '· 도형 편집 중 — Enter로 확정, Esc로 취소' : '';
    zLabel2.textContent = Math.round(zoom * 100) + '%';
  }

  /* ══════ load · size · zoom ══════ */
  function loadURL(url){
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        base.width  = im.naturalWidth  || im.width;
        base.height = im.naturalHeight || im.height;
        ctx.clearRect(0, 0, base.width, base.height);
        ctx.drawImage(im, 0, 0);
        syncSize();
        res();
      };
      im.onerror = () => rej(new Error('이미지를 불러올 수 없습니다.'));
      im.src = url;
    });
  }
  function syncSize(){
    if (fitMode) zoom = fitZoom();
    applyZoom();
  }
  function fitZoom(){
    if (!base.width || !base.height) return 1;
    const w = Math.max(80, stage.clientWidth  - 48);
    const h = Math.max(80, stage.clientHeight - 48);
    /* Only images bigger than the stage are shrunk; smaller ones stay at 100% */
    return clamp(Math.min(w / base.width, h / base.height, 1) || 1, 0.02, 1);
  }
  function nearestZoomIdx(){
    let bi = 0, bd = Infinity;
    ZOOMS.forEach((z, i) => { const d = Math.abs(z - zoom); if (d < bd){ bd = d; bi = i; } });
    return bi;
  }
  function applyZoom(){
    const vw = Math.max(1, Math.round(base.width  * zoom));
    const vh = Math.max(1, Math.round(base.height * zoom));
    view.style.width  = vw + 'px';
    view.style.height = vh + 'px';
    ovDpr = global.devicePixelRatio || 1;
    const bw = Math.round(vw * ovDpr), bh = Math.round(vh * ovDpr);
    if (ov.width !== bw || ov.height !== bh){ ov.width = bw; ov.height = bh; }
    base.style.imageRendering = zoom >= 3 ? 'pixelated' : '';
    grid.style.display = zoom >= 8 ? 'block' : 'none';
    grid.style.backgroundSize = zoom + 'px ' + zoom + 'px';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    zSlide.value = String(nearestZoomIdx());
    drawOverlay();
    if (!tin.hidden && textAt) placeTextInput();
    if (cropRect) placeCropActions();
    syncStatus();
  }
  function stepZoom(dir){
    fitMode = false; btnFit.classList.remove('on');
    let i;
    if (dir > 0){
      i = ZOOMS.findIndex(z => z > zoom + 1e-6);
      if (i < 0) i = ZOOMS.length - 1;
    } else {
      i = ZOOMS.filter(z => z < zoom - 1e-6).length - 1;
      if (i < 0) i = 0;
    }
    zoom = ZOOMS[clamp(i, 0, ZOOMS.length - 1)];
    applyZoom();
  }
  function toggleFit(){
    fitMode = !fitMode;
    zoom = fitMode ? fitZoom() : 1;
    btnFit.classList.toggle('on', fitMode);
    applyZoom();
  }
  /* Zoom keeping the image point under the cursor pinned to the cursor. */
  function zoomAt(nz, cx, cy){
    const before = ptc(cx, cy);
    fitMode = false; btnFit.classList.remove('on');
    zoom = clamp(nz, ZOOMS[0], ZOOMS[ZOOMS.length - 1]);
    applyZoom();
    const r = base.getBoundingClientRect();
    stage.scrollLeft += (r.left + before.x * zoom) - cx;
    stage.scrollTop  += (r.top  + before.y * zoom) - cy;
  }
  stage.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;      /* plain wheel keeps scrolling */
    e.preventDefault();
    const i = nearestZoomIdx();
    const ni = clamp(i + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1);
    if (ZOOMS[ni] !== zoom) zoomAt(ZOOMS[ni], e.clientX, e.clientY);
  }, { passive: false });

  /* ══════ pan ══════ */
  function beginPan(e){
    panDrag = { sx: stage.scrollLeft, sy: stage.scrollTop, cx: e.clientX, cy: e.clientY, id: e.pointerId };
    stage.classList.add('panning');
    try { stage.setPointerCapture(e.pointerId); } catch(_){}
  }
  stage.addEventListener('pointerdown', e => {
    /* the canvas-resize handles own their own drag */
    if (e.target && e.target.classList && e.target.classList.contains('imged-ch')) return;
    const wants = e.button === 1 || (e.button === 0 && (tool === 'pan' || spaceDown));
    if (!wants) return;
    e.preventDefault();
    e.stopPropagation();
    beginPan(e);
  }, true);
  stage.addEventListener('pointermove', e => {
    if (!panDrag) return;
    stage.scrollLeft = panDrag.sx - (e.clientX - panDrag.cx);
    stage.scrollTop  = panDrag.sy - (e.clientY - panDrag.cy);
  });
  const endPan = e => {
    if (!panDrag) return;
    try { stage.releasePointerCapture(panDrag.id); } catch(_){}
    panDrag = null;
    stage.classList.remove('panning');
    if (e) e.stopPropagation();
  };
  stage.addEventListener('pointerup', endPan, true);
  stage.addEventListener('pointercancel', endPan, true);

  /* ══════ history ══════ */
  function snapCanvas(){
    const cv = document.createElement('canvas');
    cv.width = base.width; cv.height = base.height;
    cv.getContext('2d').drawImage(base, 0, 0);
    return cv;
  }
  function trim(stack){
    while (stack.length > MAX_HISTORY) stack.shift();
    let px = 0;
    for (const c of stack) px += c.width * c.height;
    while (stack.length > 1 && px > MAX_HIST_PIXELS){
      const c = stack.shift();
      px -= c.width * c.height;
    }
  }
  function snapshot(){
    if (!base.width || !base.height) return;
    hist.push(snapCanvas());
    trim(hist);
    redoStack.length = 0;
    syncHistBtns();
  }
  function restore(cv){
    base.width = cv.width; base.height = cv.height;
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(cv, 0, 0);
    syncSize();
  }
  function undo(){
    if (!hist.length) return;
    const cur = snapCanvas();
    dropPending(); clearCrop(); dropSel();
    redoStack.push(cur); trim(redoStack);
    restore(hist.pop());
    fire(); syncHistBtns();
  }
  function redo(){
    if (!redoStack.length) return;
    const cur = snapCanvas();
    dropPending(); clearCrop(); dropSel();
    hist.push(cur); trim(hist);
    restore(redoStack.pop());
    fire(); syncHistBtns();
  }

  /* ══════ whole-canvas transforms ══════ */
  function settle(){ commitText(); commitPending(); commitFloat(); }

  function rotate(dir){
    if (!base.width) return;
    settle();
    snapshot();
    const w = base.width, h = base.height;
    const tmp = document.createElement('canvas');
    tmp.width = h; tmp.height = w;
    const c = tmp.getContext('2d');
    if (dir > 0){ c.translate(h, 0); c.rotate(Math.PI / 2); }
    else { c.translate(0, w); c.rotate(-Math.PI / 2); }
    c.drawImage(base, 0, 0);
    base.width = h; base.height = w;
    ctx.drawImage(tmp, 0, 0);
    cropRect = null; ca.hidden = true; dropSel();
    syncSize(); fire();
  }

  /* Flip the whole canvas, or just the selection when there is one. */
  function flip(axis){
    if (!base.width) return;
    commitText(); commitPending();
    const b = selBounds();
    if (b){
      if (!floatSel && !liftSel(false)) return;
      const f = floatSel;
      const tmp = document.createElement('canvas');
      tmp.width = f.canvas.width; tmp.height = f.canvas.height;
      const c = tmp.getContext('2d');
      if (axis === 'h'){ c.translate(tmp.width, 0); c.scale(-1, 1); }
      else { c.translate(0, tmp.height); c.scale(1, -1); }
      c.drawImage(f.canvas, 0, 0);
      f.canvas = tmp;
      drawOverlay(); fire();
      return;
    }
    commitFloat();
    snapshot();
    const tmp = document.createElement('canvas');
    tmp.width = base.width; tmp.height = base.height;
    const c = tmp.getContext('2d');
    if (axis === 'h'){ c.translate(tmp.width, 0); c.scale(-1, 1); }
    else { c.translate(0, tmp.height); c.scale(1, -1); }
    c.drawImage(base, 0, 0);
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(tmp, 0, 0);
    drawOverlay(); fire();
  }

  /* ══════ resize · skew ══════ */
  function togglePop(){
    if (!pop.hidden){ closePop(); return; }
    gal.hidden = true; exp.hidden = true;
    pop.hidden = false;
    btnResize.classList.add('on');
    popUnit = 'px';
    pop.querySelectorAll('.unit button').forEach(x => x.classList.toggle('on', x.dataset.u === 'px'));
    popW.max = MAX_DIM; popH.max = MAX_DIM;
    popW.value = base.width; popH.value = base.height;
    popSH.value = 0; popSV.value = 0;
    popW.focus(); popW.select();
  }
  function closePop(){ pop.hidden = true; btnResize.classList.remove('on'); }
  function applyResize(){
    let w, h;
    if (popUnit === 'pc'){
      w = Math.round(base.width  * (+popW.value || 100) / 100);
      h = Math.round(base.height * (+popH.value || 100) / 100);
    } else {
      w = Math.round(+popW.value || 0);
      h = Math.round(+popH.value || 0);
    }
    w = clamp(w, 1, MAX_DIM); h = clamp(h, 1, MAX_DIM);
    const sh = Math.tan(clamp(+popSH.value || 0, -80, 80) * Math.PI / 180);
    const sv = Math.tan(clamp(+popSV.value || 0, -80, 80) * Math.PI / 180);
    if (w === base.width && h === base.height && !sh && !sv){ closePop(); return; }
    settle();
    snapshot();

    /* 1 — scale */
    const scaled = document.createElement('canvas');
    scaled.width = w; scaled.height = h;
    const sc = scaled.getContext('2d');
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(base, 0, 0, w, h);

    /* 2 — skew: (x,y) → (x + y·sh, y + x·sv) */
    let outW = w, outH = h, offX = 0, offY = 0;
    if (sh || sv){
      const xs = [0, w * 1, h * sh, w + h * sh];
      const ys = [0, h * 1, w * sv, h + w * sv];
      const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      outW = clamp(Math.round(maxX - minX), 1, MAX_DIM);
      outH = clamp(Math.round(maxY - minY), 1, MAX_DIM);
      offX = -minX; offY = -minY;
    }
    base.width = outW; base.height = outH;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(1, sv, sh, 1, offX, offY);
    ctx.drawImage(scaled, 0, 0);
    ctx.restore();

    closePop();
    cropRect = null; ca.hidden = true; dropSel();
    syncSize(); fire();
  }

  /* ══════ canvas edge handles (grow / shrink the canvas) ══════ */
  let chDrag = null;
  function onChDown(e, mode){
    e.preventDefault(); e.stopPropagation();
    settle();
    chDrag = { mode, w: base.width, h: base.height, cx: e.clientX, cy: e.clientY, id: e.pointerId };
    ghost.style.display = 'block';
    ghost.style.width  = Math.round(base.width  * zoom) + 'px';
    ghost.style.height = Math.round(base.height * zoom) + 'px';
    try { e.target.setPointerCapture(e.pointerId); } catch(_){}
  }
  function onChMove(e){
    if (!chDrag) return;
    const d = chSize(e);
    ghost.style.width  = Math.round(d.w * zoom) + 'px';
    ghost.style.height = Math.round(d.h * zoom) + 'px';
    sbSize.textContent = '· 캔버스 ' + d.w + ' × ' + d.h + ' px';
  }
  function chSize(e){
    const w = chDrag.mode === 's' ? chDrag.w
            : clamp(Math.round(chDrag.w + (e.clientX - chDrag.cx) / zoom), 1, MAX_DIM);
    const h = chDrag.mode === 'e' ? chDrag.h
            : clamp(Math.round(chDrag.h + (e.clientY - chDrag.cy) / zoom), 1, MAX_DIM);
    return { w, h };
  }
  function onChUp(e){
    if (!chDrag) return;
    const d = chSize(e);
    const was = chDrag; chDrag = null;
    ghost.style.display = 'none';
    try { e.target.releasePointerCapture(was.id); } catch(_){}
    if (d.w === was.w && d.h === was.h){ syncStatus(); return; }
    snapshot();
    const tmp = snapCanvas();
    base.width = d.w; base.height = d.h;
    ctx.clearRect(0, 0, d.w, d.h);
    ctx.drawImage(tmp, 0, 0);            /* grown area stays transparent */
    dropSel(); cropRect = null; ca.hidden = true;
    syncSize(); fire();
  }
  [[chE, 'e'], [chS, 's'], [chSE, 'se']].forEach(([node, mode]) => {
    node.addEventListener('pointerdown', e => onChDown(e, mode));
    node.addEventListener('pointermove', onChMove);
    node.addEventListener('pointerup', onChUp);
    node.addEventListener('pointercancel', () => { chDrag = null; ghost.style.display = 'none'; });
  });

  /* ══════ crop ══════ */
  function applyCrop(){
    if (!cropRect) return;
    const r = clampRect(normRect(cropRect));
    if (r.w < 2 || r.h < 2){ clearCrop(); return; }
    cropTo(r);
  }
  function cropToSel(){
    const b = selBounds();
    if (!b) return;
    commitFloat();
    cropTo(clampRect(b));
  }
  function cropTo(r){
    if (r.w < 1 || r.h < 1) return;
    settle();
    snapshot();
    const tmp = document.createElement('canvas');
    tmp.width = r.w; tmp.height = r.h;
    tmp.getContext('2d').drawImage(base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    base.width = r.w; base.height = r.h;
    ctx.drawImage(tmp, 0, 0);
    cropRect = null; ca.hidden = true; dropSel();
    syncSize(); fire();
  }
  function clearCrop(){ cropRect = null; ca.hidden = true; drawOverlay(); }
  function placeCropActions(){
    if (!cropRect) return;
    const r = normRect(cropRect);
    ca.hidden = false;
    let left = (r.x + r.w) * zoom - 61;
    let top  = (r.y + r.h) * zoom + 6;
    if (top + 30 > base.height * zoom) top = (r.y + r.h) * zoom - 34;
    ca.style.left = Math.max(2, left) + 'px';
    ca.style.top  = Math.max(2, top) + 'px';
  }

  /* ══════ coordinates ══════ */
  function ptc(cx, cy){
    const r = base.getBoundingClientRect();
    const sx = base.width / (r.width || 1), sy = base.height / (r.height || 1);
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
  }
  function pt(e){ return ptc(e.clientX, e.clientY); }
  function normRect(r){
    return {
      x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1),
      w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0)
    };
  }
  function clampRect(r){
    const x = clamp(Math.round(r.x), 0, base.width), y = clamp(Math.round(r.y), 0, base.height);
    return { x, y,
      w: clamp(Math.round(r.w), 0, base.width  - x),
      h: clamp(Math.round(r.h), 0, base.height - y) };
  }
  function inRect(r, p){ return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  function constrain(a, b, shift, kind){
    if (!shift) return b;
    if (kind === 'line'){
      const dx = b.x - a.x, dy = b.y - a.y;
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    }
    const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return { x: a.x + (b.x < a.x ? -s : s), y: a.y + (b.y < a.y ? -s : s) };
  }

  /* Eight-way handle positions for a rectangle, and the resize they imply. */
  function rectHandles(r){
    return [
      { id:'nw', x:r.x,         y:r.y },
      { id:'n',  x:r.x+r.w/2,   y:r.y },
      { id:'ne', x:r.x+r.w,     y:r.y },
      { id:'e',  x:r.x+r.w,     y:r.y+r.h/2 },
      { id:'se', x:r.x+r.w,     y:r.y+r.h },
      { id:'s',  x:r.x+r.w/2,   y:r.y+r.h },
      { id:'sw', x:r.x,         y:r.y+r.h },
      { id:'w',  x:r.x,         y:r.y+r.h/2 }
    ];
  }
  function hitHandle(hs, p){
    const tol = GRAB / zoom;
    for (const h of hs) if (Math.abs(h.x - p.x) <= tol && Math.abs(h.y - p.y) <= tol) return h.id;
    return null;
  }
  function resizeRect(r0, id, p){
    let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
    if (id.indexOf('w') >= 0) x1 = p.x;
    if (id.indexOf('e') >= 0) x2 = p.x;
    if (id.indexOf('n') >= 0) y1 = p.y;
    if (id.indexOf('s') >= 0) y2 = p.y;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2),
             w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) };
  }
  const CURSORS = { nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize',
                    n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize' };

  /* ══════ region selection ══════ */
  function tracePath(c, pts, dx, dy){
    c.beginPath();
    c.moveTo(pts[0].x + dx, pts[0].y + dy);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x + dx, pts[i].y + dy);
    c.closePath();
  }
  function pathBBox(pts){
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of pts){
      if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
      if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function selBounds(){
    if (floatSel) return { x: floatSel.x, y: floatSel.y, w: floatSel.w, h: floatSel.h };
    return sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : null;
  }
  function syncSelToFloat(){
    sel = { x: floatSel.x, y: floatSel.y, w: floatSel.w, h: floatSel.h, path: null };
  }
  /* Forget the selection without writing anything back — for the operations
     that replace the canvas outright (undo, rotate, resize, crop). */
  function dropSel(){ sel = null; floatSel = null; syncStatus(); }
  function clearSel(){ commitFloat(); sel = null; drawOverlay(); }
  function selectAll(){
    if (!base.width) return;
    commitFloat();
    if (tool !== 'sel' && tool !== 'selfree') setTool('sel');
    sel = { x: 0, y: 0, w: base.width, h: base.height, path: null };
    drawOverlay();
  }
  function extractSel(){
    const r = sel;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, r.w); cv.height = Math.max(1, r.h);
    const c = cv.getContext('2d');
    if (r.path){ c.save(); tracePath(c, r.path, -r.x, -r.y); c.clip(); }
    c.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (r.path) c.restore();
    if (transSel) knockout(cv, fill);
    return cv;
  }
  function eraseSel(){
    if (sel.path){
      ctx.save();
      tracePath(ctx, sel.path, 0, 0);
      ctx.clip();
      ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    } else {
      ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
    }
  }
  /* "Transparent selection": knock the secondary color out of a lifted region. */
  function knockout(cv, hex){
    let img;
    const c = cv.getContext('2d');
    try { img = c.getImageData(0, 0, cv.width, cv.height); } catch(_){ return; }
    const t = hexRGB(hex), d = img.data, tol = 40 * 40 * 3;
    for (let i = 0; i < d.length; i += 4){
      if (!d[i + 3]) continue;
      const dr = d[i] - t.r, dg = d[i + 1] - t.g, db = d[i + 2] - t.b;
      if (dr * dr + dg * dg + db * db <= tol) d[i + 3] = 0;
    }
    c.putImageData(img, 0, 0);
  }

  /* Lift the selected pixels off the canvas so they can be dragged. The snapshot
     taken here also covers the later commit, so a move is a single undo step.
     `copy` keeps the source pixels in place (Ctrl-drag). */
  function liftSel(copy){
    if (floatSel) return true;
    if (!sel) return false;
    sel = Object.assign(clampRect(sel), { path: sel.path });
    if (sel.w < 1 || sel.h < 1){ sel = null; return false; }
    snapshot();
    const cv = extractSel();
    if (!copy) eraseSel();
    floatSel = { canvas: cv, x: sel.x, y: sel.y, w: sel.w, h: sel.h, lifted: true };
    fire();
    return true;
  }
  function commitFloat(){
    if (!floatSel) return;
    const f = floatSel; floatSel = null;
    if (!f.lifted) snapshot();          /* a pasted region has no history entry yet */
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.canvas, f.x, f.y, f.w, f.h);
    ctx.restore();
    fire();
    drawOverlay();
  }
  function deleteSel(){
    if (floatSel){                      /* lifted pixels are already off the canvas */
      const lifted = floatSel.lifted;
      floatSel = null; sel = null;
      drawOverlay();
      if (lifted) fire();
      return true;
    }
    if (!sel) return false;
    sel = Object.assign(clampRect(sel), { path: sel.path });
    if (sel.w < 1 || sel.h < 1){ sel = null; return false; }
    snapshot();
    eraseSel();                          /* the erased area becomes transparent */
    sel = null;                          /* nothing is selected once it is gone */
    drawOverlay(); fire();
    return true;
  }
  function nudge(dx, dy){
    if (!floatSel && !liftSel(false)) return;
    floatSel.x += dx; floatSel.y += dy;
    syncSelToFloat();
    drawOverlay(); syncStatus();
  }
  function copySel(){
    let cv = null;
    if (floatSel){
      cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(floatSel.w)); cv.height = Math.max(1, Math.round(floatSel.h));
      cv.getContext('2d').drawImage(floatSel.canvas, 0, 0, cv.width, cv.height);
    } else if (sel){
      sel = Object.assign(clampRect(sel), { path: sel.path });
      if (sel.w >= 1 && sel.h >= 1) cv = extractSel();
    }
    if (!cv) return false;
    clip = cv;
    toSystemClipboard(cv);
    return true;
  }
  /* Best effort: the system clipboard is unavailable or blocked in some contexts,
     and the in-editor clip above keeps copy/paste working regardless. */
  function toSystemClipboard(cv){
    if (!global.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) return;
    try {
      cv.toBlob(b => {
        if (!b) return;
        try { navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {}); }
        catch(_){}
      }, 'image/png');
    } catch(_){}
  }
  /* Paste any canvas or image as a floating selection the user can drag into place. */
  function pasteSrc(src, w, h){
    if (!w || !h || !base.width) return;
    settle();
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0);
    if (transSel) knockout(cv, fill);
    const at = sel;
    const x = at ? Math.round(at.x) : Math.round((base.width  - w) / 2);
    const y = at ? Math.round(at.y) : Math.round((base.height - h) / 2);
    setTool('sel');
    floatSel = { canvas: cv, x: Math.max(0, x), y: Math.max(0, y), w, h, lifted: false };
    syncSelToFloat();
    drawOverlay(); syncStatus();
  }

  /* ══════ pencil · eraser ══════ */
  function strokeStyleFor(alt){
    if (tool === 'eraser' && !alt) return null;      /* null → erase to transparent */
    return alt ? fill : stroke;
  }
  function beginStroke(c, alt){
    c.save();
    if (tool === 'eraser' && !alt){
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = c.fillStyle = '#000';
    } else {
      const col = strokeStyleFor(alt) || stroke;
      c.strokeStyle = c.fillStyle = col;
    }
    c.lineWidth = lineW;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  function strokeDot(p, alt){
    beginStroke(ctx, alt);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, lineW / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function strokeSeg(a, b, alt){
    beginStroke(ctx, alt);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  /* ══════ flood fill ══════ */
  function floodFill(p, hex){
    const sx = Math.floor(p.x), sy = Math.floor(p.y);
    const W = base.width, H = base.height;
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    let img;
    try { img = ctx.getImageData(0, 0, W, H); } catch(_){ return; }
    const d = img.data;
    const i0 = (sy * W + sx) * 4;
    const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
    const nc = hexRGB(hex);
    if (ta === 255 && nc.r === tr && nc.g === tg && nc.b === tb) return;
    const tol2 = fillTol * fillTol * 4;
    const match = i => {
      const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb, da = d[i + 3] - ta;
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    };
    if (!match(i0)) return;

    snapshot();
    const seen = new Uint8Array(W * H);
    const stack = [sy * W + sx];
    while (stack.length){
      const q = stack.pop();
      if (seen[q]) continue;
      const y = (q / W) | 0;
      const row = y * W;
      let xl = q - row, xr = xl;
      while (xl > 0 && !seen[row + xl - 1] && match((row + xl - 1) * 4)) xl--;
      while (xr < W - 1 && !seen[row + xr + 1] && match((row + xr + 1) * 4)) xr++;
      for (let x = xl; x <= xr; x++){
        const k = row + x;
        seen[k] = 1;
        const j = k * 4;
        d[j] = nc.r; d[j + 1] = nc.g; d[j + 2] = nc.b; d[j + 3] = 255;
        if (y > 0){ const u = k - W; if (!seen[u] && match(u * 4)) stack.push(u); }
        if (y < H - 1){ const v = k + W; if (!seen[v] && match(v * 4)) stack.push(v); }
      }
    }
    ctx.putImageData(img, 0, 0);
    fire();
  }

  /* ══════ color picker ══════ */
  function pick(p, alt){
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= base.width || y >= base.height) return;
    let d;
    try { d = ctx.getImageData(x, y, 1, 1).data; } catch(_){ return; }
    if (!d[3]) return;                                 /* transparent: nothing to pick */
    const hex = rgbHex(d[0], d[1], d[2]);
    if (alt){ fill = hex; fillOn = true; } else { stroke = hex; }
    addRecent(hex);
    syncColors();
    setTool(prevTool === 'picker' ? 'pencil' : prevTool);  /* Paint returns to the last tool */
  }

  /* ══════ shapes ══════ */
  function polyPts(kind, r){
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
    const reg = (n, rot) => {
      const out = [];
      for (let i = 0; i < n; i++){
        const t = rot + i * 2 * Math.PI / n;
        out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
      }
      return out;
    };
    switch (kind){
      case 'triangle': return [{x:cx, y:r.y}, {x:r.x+r.w, y:r.y+r.h}, {x:r.x, y:r.y+r.h}];
      case 'rtri':     return [{x:r.x, y:r.y}, {x:r.x+r.w, y:r.y+r.h}, {x:r.x, y:r.y+r.h}];
      case 'diamond':  return [{x:cx, y:r.y}, {x:r.x+r.w, y:cy}, {x:cx, y:r.y+r.h}, {x:r.x, y:cy}];
      case 'pentagon': return reg(5, -Math.PI / 2);
      case 'hexagon':  return reg(6, 0);
      case 'star': {
        const out = [];
        for (let i = 0; i < 10; i++){
          const t = -Math.PI / 2 + i * Math.PI / 5;
          const k = i % 2 ? 0.42 : 1;
          out.push({ x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k });
        }
        return out;
      }
    }
    return null;
  }
  function roundRectPath(c, r, rad){
    const k = Math.min(rad, r.w / 2, r.h / 2);
    c.beginPath();
    c.moveTo(r.x + k, r.y);
    c.lineTo(r.x + r.w - k, r.y);      c.quadraticCurveTo(r.x + r.w, r.y, r.x + r.w, r.y + k);
    c.lineTo(r.x + r.w, r.y + r.h - k);c.quadraticCurveTo(r.x + r.w, r.y + r.h, r.x + r.w - k, r.y + r.h);
    c.lineTo(r.x + k, r.y + r.h);      c.quadraticCurveTo(r.x, r.y + r.h, r.x, r.y + r.h - k);
    c.lineTo(r.x, r.y + k);            c.quadraticCurveTo(r.x, r.y, r.x + k, r.y);
    c.closePath();
  }
  function ctrlOf(sp){
    return sp.ctrl || { x: (sp.a.x + sp.b.x) / 2, y: (sp.a.y + sp.b.y) / 2 };
  }
  function paintShape(c, sp){
    const a = sp.a, b = sp.b, kind = sp.kind, alt = sp.alt;
    const sCol = alt ? fill : stroke, fCol = alt ? stroke : fill;
    c.save();
    c.lineWidth = Math.max(0.4, lineW);
    c.strokeStyle = sCol;
    c.fillStyle = fCol;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (kind === 'line'){
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    } else if (kind === 'curve'){
      const m = ctrlOf(sp);
      c.beginPath(); c.moveTo(a.x, a.y);
      c.quadraticCurveTo(2 * m.x - (a.x + b.x) / 2, 2 * m.y - (a.y + b.y) / 2, b.x, b.y);
      c.stroke();
    } else if (kind === 'arrow'){
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const hl = Math.max(9, lineW * 3.4);
      const tip = { x: b.x, y: b.y };
      const back = { x: b.x - Math.cos(ang) * hl * 0.78, y: b.y - Math.sin(ang) * hl * 0.78 };
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(back.x, back.y); c.stroke();
      c.beginPath();
      c.moveTo(tip.x, tip.y);
      c.lineTo(tip.x - Math.cos(ang - 0.42) * hl, tip.y - Math.sin(ang - 0.42) * hl);
      c.lineTo(tip.x - Math.cos(ang + 0.42) * hl, tip.y - Math.sin(ang + 0.42) * hl);
      c.closePath();
      c.fillStyle = sCol; c.fill();
    } else {
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
                  w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      if (kind === 'rect'){
        c.beginPath(); c.rect(r.x, r.y, r.w, r.h);
      } else if (kind === 'roundrect'){
        roundRectPath(c, r, Math.min(r.w, r.h) * 0.22 + 4);
      } else if (kind === 'ellipse'){
        c.beginPath();
        c.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.5, r.w / 2), Math.max(0.5, r.h / 2), 0, 0, Math.PI * 2);
      } else {
        const pts = polyPts(kind, r);
        if (!pts){ c.restore(); return; }
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.closePath();
      }
      if (fillOn) c.fill();
      if (lineW > 0) c.stroke();
    }
    c.restore();
  }
  function isLinear(k){ return !!(SHAPES[k] && SHAPES[k].line); }
  function shapeBBox(sp){
    const pts = [sp.a, sp.b];
    if (sp.kind === 'curve') pts.push(ctrlOf(sp));
    return pathBBox(pts);
  }
  function pendingHandles(){
    if (isLinear(pending.kind)){
      const hs = [{ id:'a', x:pending.a.x, y:pending.a.y }, { id:'b', x:pending.b.x, y:pending.b.y }];
      if (pending.kind === 'curve'){ const m = ctrlOf(pending); hs.push({ id:'c', x:m.x, y:m.y }); }
      return hs;
    }
    return rectHandles(shapeBBox(pending));
  }
  function pickShape(k){
    if (k !== shapeKind) commitPending();   /* the shape on screen keeps its own kind */
    shapeKind = k;
    btnShape.innerHTML = svg(SI[k]);
    btnShape.title = '도형: ' + SHAPES[k].name + ' — 클릭하여 모양 변경';
    gal.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    setTool('shape');
  }
  function onShapeBtn(){
    if (tool !== 'shape'){ setTool('shape'); return; }
    pop.hidden = true; btnResize.classList.remove('on'); exp.hidden = true;
    gal.hidden = !gal.hidden;
    if (!gal.hidden){
      const r = btnShape.getBoundingClientRect(), t = tb.getBoundingClientRect();
      gal.style.left = Math.max(4, r.left - t.left) + 'px';
    }
  }
  function commitPending(){
    if (!pending) return;
    const sp = pending; pending = null;
    const span = Math.hypot(sp.b.x - sp.a.x, sp.b.y - sp.a.y);
    if (span < 1.5){ drawOverlay(); syncStatus(); return; }
    snapshot();
    paintShape(ctx, sp);
    fire();
    drawOverlay(); syncStatus();
  }
  function dropPending(){ pending = null; drawOverlay(); syncStatus(); }

  /* ══════ overlay ══════ */
  function drawOverlay(){
    if (!ov.width || !ov.height) return;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, ov.width, ov.height);
    octx.setTransform(ovDpr, 0, 0, ovDpr, 0, 0);

    /* --- image-space layer (scales with the zoom) --- */
    octx.save();
    octx.scale(zoom, zoom);
    octx.imageSmoothingEnabled = zoom < 3;
    if (drag && drag.kind === 'shape') paintShape(octx, drag.sp);
    if (pending) paintShape(octx, pending);
    if (floatSel) octx.drawImage(floatSel.canvas, floatSel.x, floatSel.y, floatSel.w, floatSel.h);
    octx.restore();

    /* --- screen-space chrome (constant thickness at any zoom) --- */
    const Z = v => v * zoom;

    /* free-form marquee in progress */
    if (drag && drag.kind === 'selfree' && drag.pts.length > 1){
      octx.save();
      octx.lineWidth = 1;
      octx.strokeStyle = 'rgba(255,255,255,.95)';
      octx.beginPath();
      octx.moveTo(Z(drag.pts[0].x), Z(drag.pts[0].y));
      for (const p of drag.pts) octx.lineTo(Z(p.x), Z(p.y));
      octx.stroke();
      octx.setLineDash([5, 4]);
      octx.strokeStyle = '#0d6b5f';
      octx.stroke();
      octx.restore();
    }

    /* selection marquee */
    const s = (drag && drag.kind === 'sel')
      ? normRect({ x0: drag.a.x, y0: drag.a.y, x1: drag.b.x, y1: drag.b.y })
      : selBounds();
    if (s && s.w >= 0.5 && s.h >= 0.5){
      octx.save();
      if (sel && sel.path && !floatSel){
        octx.lineWidth = 1;
        octx.strokeStyle = 'rgba(255,255,255,.95)';
        octx.beginPath();
        octx.moveTo(Z(sel.path[0].x), Z(sel.path[0].y));
        for (const p of sel.path) octx.lineTo(Z(p.x), Z(p.y));
        octx.closePath();
        octx.stroke();
        octx.setLineDash([5, 4]);
        octx.strokeStyle = '#0d6b5f';
        octx.stroke();
      } else {
        dashRect(Z(s.x), Z(s.y), Z(s.w), Z(s.h));
      }
      octx.restore();
      if (!drag || drag.kind !== 'sel') drawHandles(rectHandles(s), Z);
    }

    /* pending shape handles */
    if (pending) drawHandles(pendingHandles(), Z);

    /* crop mask */
    const r = (drag && drag.kind === 'crop')
      ? normRect({ x0: drag.a.x, y0: drag.a.y, x1: drag.b.x, y1: drag.b.y })
      : (cropRect ? normRect(cropRect) : null);
    if (r){
      octx.save();
      octx.fillStyle = 'rgba(18,30,28,.44)';
      octx.beginPath();
      octx.rect(0, 0, Z(base.width), Z(base.height));
      octx.rect(Z(r.x), Z(r.y), Z(r.w), Z(r.h));
      octx.fill('evenodd');
      octx.setLineDash([6, 4]);
      octx.lineWidth = 1;
      octx.strokeStyle = '#fff';
      octx.strokeRect(Z(r.x), Z(r.y), Z(r.w), Z(r.h));
      octx.restore();
      if (cropRect && (!drag || drag.kind !== 'crop')) drawHandles(rectHandles(r), Z);
    }
  }
  function dashRect(x, y, w, h){
    octx.lineWidth = 1;
    octx.strokeStyle = 'rgba(255,255,255,.95)';
    octx.setLineDash([]);
    octx.strokeRect(x, y, w, h);
    octx.setLineDash([5, 4]);
    octx.strokeStyle = '#0d6b5f';
    octx.strokeRect(x, y, w, h);
  }
  function drawHandles(hs, Z){
    octx.save();
    octx.setLineDash([]);
    octx.lineWidth = 1.4;
    octx.strokeStyle = '#0d6b5f';
    octx.fillStyle = '#fff';
    for (const h of hs){
      const x = Z(h.x) - HANDLE, y = Z(h.y) - HANDLE, d = HANDLE * 2;
      if (h.id === 'c'){
        octx.beginPath(); octx.arc(Z(h.x), Z(h.y), HANDLE + .6, 0, Math.PI * 2);
        octx.fill(); octx.stroke();
      } else {
        octx.fillRect(x, y, d, d);
        octx.strokeRect(x, y, d, d);
      }
    }
    octx.restore();
  }

  /* ══════ pointer ══════ */
  ov.addEventListener('contextmenu', e => { if (tool !== 'pan') e.preventDefault(); });

  ov.addEventListener('pointerdown', e => {
    if (tool === 'pan' || spaceDown || panDrag) return;
    if (e.button !== 0 && e.button !== 2) return;
    const alt = e.button === 2;                     /* right button → color 2 */
    if (alt && (tool === 'sel' || tool === 'selfree' || tool === 'crop' || tool === 'text')) return;
    e.preventDefault();
    const a = pt(e);

    if (tool === 'text'){ openTextInput(a); return; }
    commitText();

    if (tool === 'picker'){ pick(a, alt); return; }
    if (tool === 'fill'){ settle(); floodFill(a, alt ? fill : stroke); return; }

    if (tool === 'pencil' || tool === 'eraser'){
      settle();
      snapshot();
      drag = { kind: 'free', a, b: a, last: a, alt, id: e.pointerId };
      strokeDot(a, alt);
      capture(e);
      return;
    }

    if (tool === 'shape'){
      /* An uncommitted shape stays editable: grab a handle, drag its body,
         or start a new shape by pressing outside it. */
      if (pending){
        const hid = hitHandle(pendingHandles(), a);
        if (hid){
          drag = { kind: 'p-size', hid, a, id: e.pointerId,
                   box: shapeBBox(pending), a0: { x: pending.a.x, y: pending.a.y },
                   b0: { x: pending.b.x, y: pending.b.y }, c0: Object.assign({}, ctrlOf(pending)) };
          capture(e);
          return;
        }
        const bb = shapeBBox(pending);
        if (inRect({ x: bb.x - 3, y: bb.y - 3, w: bb.w + 6, h: bb.h + 6 }, a)){
          drag = { kind: 'p-move', a, id: e.pointerId,
                   a0: { x: pending.a.x, y: pending.a.y }, b0: { x: pending.b.x, y: pending.b.y },
                   c0: pending.ctrl ? Object.assign({}, pending.ctrl) : null };
          capture(e);
          return;
        }
        commitPending();
      }
      settle();
      drag = { kind: 'shape', id: e.pointerId, sp: { kind: shapeKind, a, b: a, ctrl: null, alt } };
      capture(e);
      drawOverlay();
      return;
    }

    if (tool === 'sel' || tool === 'selfree'){
      const b = selBounds();
      if (b){
        const hid = hitHandle(rectHandles(b), a);
        if (hid){
          drag = { kind: 'sel-size', hid, r0: b, id: e.pointerId };
          capture(e);
          return;
        }
        if (inRect(b, a)){
          /* pressed inside the selection → move it. The pixels are lifted lazily,
             on the first real movement, so a plain click costs no history step. */
          drag = { kind: floatSel ? 'move' : 'lift', a, b: a, id: e.pointerId,
                   copy: e.ctrlKey || e.metaKey, ox: b.x - a.x, oy: b.y - a.y };
          capture(e);
          return;
        }
      }
      commitFloat();
      sel = null;
      if (tool === 'selfree') drag = { kind: 'selfree', pts: [a], a, b: a, id: e.pointerId };
      else drag = { kind: 'sel', a, b: a, id: e.pointerId };
      capture(e);
      drawOverlay();
      return;
    }

    if (tool === 'crop'){
      if (cropRect){
        const hid = hitHandle(rectHandles(normRect(cropRect)), a);
        if (hid){
          drag = { kind: 'crop-size', hid, r0: normRect(cropRect), id: e.pointerId };
          capture(e);
          return;
        }
      }
      settle();
      cropRect = null; ca.hidden = true;
      drag = { kind: 'crop', a, b: a, id: e.pointerId };
      capture(e);
      drawOverlay();
    }
  });

  function capture(e){ try { ov.setPointerCapture(e.pointerId); } catch(_){} }

  ov.addEventListener('pointermove', e => {
    const p = pt(e);
    syncStatus(p);
    if (!drag){
      hoverCursor(p);
      return;
    }
    if (drag.kind === 'free'){
      strokeSeg(drag.last, p, drag.alt);
      drag.last = p; drag.b = p;
      return;
    }
    if (drag.kind === 'lift'){
      if (Math.hypot(p.x - drag.a.x, p.y - drag.a.y) <= 2) return;
      if (!liftSel(drag.copy)){ drag = null; return; }
      drag.kind = 'move';
    }
    if (drag.kind === 'move'){
      floatSel.x = Math.round(p.x + drag.ox);
      floatSel.y = Math.round(p.y + drag.oy);
      syncSelToFloat();
      drawOverlay();
      return;
    }
    if (drag.kind === 'sel-size'){
      if (!floatSel && !liftSel(false)){ drag = null; return; }
      const r = resizeRect(drag.r0, drag.hid, p);
      floatSel.x = Math.round(r.x); floatSel.y = Math.round(r.y);
      floatSel.w = Math.max(1, Math.round(r.w)); floatSel.h = Math.max(1, Math.round(r.h));
      syncSelToFloat();
      drawOverlay();
      return;
    }
    if (drag.kind === 'crop-size'){
      const r = resizeRect(drag.r0, drag.hid, p);
      cropRect = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
      placeCropActions(); drawOverlay();
      return;
    }
    if (drag.kind === 'selfree'){
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) drag.pts.push(p);
      drag.b = p;
      drawOverlay();
      return;
    }
    if (drag.kind === 'p-move'){
      const dx = p.x - drag.a.x, dy = p.y - drag.a.y;
      pending.a = { x: drag.a0.x + dx, y: drag.a0.y + dy };
      pending.b = { x: drag.b0.x + dx, y: drag.b0.y + dy };
      if (drag.c0) pending.ctrl = { x: drag.c0.x + dx, y: drag.c0.y + dy };
      drawOverlay();
      return;
    }
    if (drag.kind === 'p-size'){
      if (isLinear(pending.kind)){
        if (drag.hid === 'a') pending.a = constrain(pending.b, p, e.shiftKey, 'line');
        else if (drag.hid === 'b') pending.b = constrain(pending.a, p, e.shiftKey, 'line');
        else pending.ctrl = p;
      } else {
        const r = resizeRect(drag.box, drag.hid, p);
        pending.a = { x: r.x, y: r.y };
        pending.b = { x: r.x + r.w, y: r.y + r.h };
      }
      drawOverlay();
      return;
    }
    if (drag.kind === 'shape'){
      drag.sp.b = constrain(drag.sp.a, p, e.shiftKey, isLinear(drag.sp.kind) ? 'line' : 'box');
      drawOverlay();
      return;
    }
    drag.b = constrain(drag.a, p, e.shiftKey, 'box');
    if (drag.kind === 'crop') placeCropActions();
    drawOverlay();
  });

  function hoverCursor(p){
    if (tool === 'sel' || tool === 'selfree'){
      const b = selBounds();
      if (b){
        const hid = hitHandle(rectHandles(b), p);
        ov.style.cursor = hid ? CURSORS[hid] : (inRect(b, p) ? 'move' : '');
        return;
      }
      ov.style.cursor = '';
      return;
    }
    if (tool === 'shape' && pending){
      const hid = hitHandle(pendingHandles(), p);
      if (hid){ ov.style.cursor = CURSORS[hid] || 'crosshair'; return; }
      const bb = shapeBBox(pending);
      ov.style.cursor = inRect(bb, p) ? 'move' : '';
      return;
    }
    if (tool === 'crop' && cropRect){
      const hid = hitHandle(rectHandles(normRect(cropRect)), p);
      ov.style.cursor = hid ? CURSORS[hid] : '';
      return;
    }
    ov.style.cursor = '';
  }

  ov.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    try { ov.releasePointerCapture(d.id); } catch(_){}

    if (d.kind === 'free'){ fire(); syncStatus(); return; }
    if (d.kind === 'move' || d.kind === 'lift' || d.kind === 'sel-size' ||
        d.kind === 'p-move' || d.kind === 'p-size' || d.kind === 'crop-size'){
      drawOverlay(); syncStatus(); return;
    }
    if (d.kind === 'shape'){
      const span = Math.hypot(d.sp.b.x - d.sp.a.x, d.sp.b.y - d.sp.a.y);
      if (span > 2){
        if (!isLinear(d.sp.kind)){
          const r = { x: Math.min(d.sp.a.x, d.sp.b.x), y: Math.min(d.sp.a.y, d.sp.b.y),
                      w: Math.abs(d.sp.b.x - d.sp.a.x), h: Math.abs(d.sp.b.y - d.sp.a.y) };
          d.sp.a = { x: r.x, y: r.y };
          d.sp.b = { x: r.x + r.w, y: r.y + r.h };
        }
        pending = d.sp;                 /* stays editable until committed */
      }
      drawOverlay(); syncStatus();
      return;
    }
    if (d.kind === 'sel'){
      const r = normRect({ x0: d.a.x, y0: d.a.y, x1: d.b.x, y1: d.b.y });
      sel = (r.w > 2 && r.h > 2) ? Object.assign(clampRect(r), { path: null }) : null;
      drawOverlay(); syncStatus();
      return;
    }
    if (d.kind === 'selfree'){
      if (d.pts.length > 3){
        const bb = clampRect(pathBBox(d.pts));
        sel = (bb.w > 2 && bb.h > 2) ? Object.assign(bb, { path: d.pts }) : null;
      } else sel = null;
      drawOverlay(); syncStatus();
      return;
    }
    if (d.kind === 'crop'){
      const r = normRect({ x0: d.a.x, y0: d.a.y, x1: d.b.x, y1: d.b.y });
      if (r.w > 2 && r.h > 2){ cropRect = { x0: d.a.x, y0: d.a.y, x1: d.b.x, y1: d.b.y }; placeCropActions(); }
      drawOverlay();
    }
  });
  ov.addEventListener('pointercancel', () => { drag = null; drawOverlay(); });

  /* ══════ text ══════ */
  function fontSpec(px){
    return (italic ? 'italic ' : '') + (bold ? '700 ' : '') + (px || fontSize) + 'px ' + fontFam;
  }
  function openTextInput(p){
    commitText();
    textAt = p;
    tin.value = '';
    tin.hidden = false;
    placeTextInput();
    tin.focus();
  }
  function placeTextInput(){
    if (tin.hidden || !textAt) return;
    tin.style.left = (textAt.x * zoom) + 'px';
    tin.style.top  = (textAt.y * zoom) + 'px';
    tin.style.font = fontSpec(Math.max(6, fontSize * zoom));
    tin.style.color = textColor;
    tin.style.background = textBg ? fill : 'transparent';
    tin.style.textDecoration = underline ? 'underline' : 'none';
    /* auto-size to the content */
    tin.style.width = '10px'; tin.style.height = '10px';
    tin.style.width  = Math.max(30, tin.scrollWidth + 6) + 'px';
    tin.style.height = (tin.scrollHeight + 2) + 'px';
  }
  function commitText(){
    if (tin.hidden) return;
    const v = tin.value, at = textAt;
    tin.hidden = true; textAt = null;
    if (!v.replace(/\s/g, '') || !at) return;
    snapshot();
    const lines = v.split('\n');
    const lh = Math.round(fontSize * 1.25);
    ctx.save();
    ctx.font = fontSpec();
    ctx.textBaseline = 'top';
    if (textBg){
      let mw = 0;
      for (const L of lines) mw = Math.max(mw, ctx.measureText(L).width);
      ctx.fillStyle = fill;
      ctx.fillRect(at.x - 2, at.y - 2, mw + 5, lh * lines.length + 4);
    }
    ctx.fillStyle = textColor;
    lines.forEach((L, i) => {
      const y = at.y + i * lh;
      ctx.fillText(L, at.x, y);
      if (underline && L){
        const w = ctx.measureText(L).width;
        ctx.fillRect(at.x, y + fontSize * 1.08, w, Math.max(1, Math.round(fontSize / 14)));
      }
    });
    ctx.restore();
    fire();
  }
  tin.addEventListener('input', placeTextInput);
  tin.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); commitText(); }
    else if (e.key === 'Escape'){ e.preventDefault(); tin.hidden = true; textAt = null; }
  });
  /* Reaching for the font or colour controls must not end the text box — only a
     click away from the toolbars (the canvas, say) commits it. */
  tin.addEventListener('blur', e => {
    const to = e.relatedTarget;
    if (to && (tb.contains(to) || tb2.contains(to))){
      setTimeout(() => { if (!tin.hidden) tin.focus(); }, 0);
      return;
    }
    commitText();
  });

  /* ══════ tools ══════ */
  const TOOLBTN = { pan: btnPan, sel: btnSel, selfree: btnLasso, crop: btnCrop, pencil: btnPencil,
                    eraser: btnErase, fill: btnFill, picker: btnPick, shape: btnShape, text: btnText };
  function setTool(t){
    if (t !== 'text')  commitText();
    if (t !== 'shape') commitPending();
    if (t !== 'crop')  clearCrop();
    if (t !== 'sel' && t !== 'selfree') clearSel();
    if (tool !== 'picker') prevTool = tool;
    tool = t;
    for (const k in TOOLBTN) TOOLBTN[k].classList.toggle('on', k === t);
    view.classList.toggle('t-draw', t === 'crop' || t === 'shape' || t === 'pencil' || t === 'eraser');
    view.classList.toggle('t-text', t === 'text');
    view.classList.toggle('t-sel',  t === 'sel' || t === 'selfree');
    view.classList.toggle('t-pick', t === 'picker');
    view.classList.toggle('t-fill', t === 'fill');
    stage.classList.toggle('pan', t === 'pan');
    ov.style.cursor = '';
    ov.style.pointerEvents = (t === 'pan') ? 'none' : 'auto';
    grpText.hidden = t !== 'text';
    grpSel.hidden  = t !== 'sel' && t !== 'selfree';
    grpFill.hidden = t !== 'fill';
    if (t !== 'shape') gal.hidden = true;
    syncStatus();
  }

  /* ══════ file ══════ */
  function openFile(){ fileIn.value = ''; fileIn.click(); }
  function onFilePicked(){
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      settle();
      snapshot();
      base.width  = im.naturalWidth  || im.width;
      base.height = im.naturalHeight || im.height;
      ctx.clearRect(0, 0, base.width, base.height);
      ctx.drawImage(im, 0, 0);
      dropSel(); cropRect = null; ca.hidden = true;
      syncSize(); fire();
      URL.revokeObjectURL(url);
    };
    im.onerror = () => URL.revokeObjectURL(url);
    im.src = url;
  }
  function toggleExp(){
    pop.hidden = true; btnResize.classList.remove('on'); gal.hidden = true;
    exp.hidden = !exp.hidden;
    if (!exp.hidden){
      const r = btnDown.getBoundingClientRect(), t = tb.getBoundingClientRect();
      exp.style.left = Math.max(4, Math.min(r.left - t.left, t.width - 160)) + 'px';
    }
  }
  function exportAs(mime){
    settle();
    let url;
    if (mime !== 'image/png'){
      /* JPEG and WebP have no alpha — flatten onto white first */
      const tmp = document.createElement('canvas');
      tmp.width = base.width; tmp.height = base.height;
      const c = tmp.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, tmp.width, tmp.height);
      c.drawImage(base, 0, 0);
      url = tmp.toDataURL(mime, 0.92);
    } else {
      url = base.toDataURL('image/png');
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = 'image.' + (mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ══════ keyboard ══════ */
  function onKey(e){
    if (!root.isConnected) return;
    if (e.key === ' ' && !isField(e.target) && hasFocus()){
      if (!spaceDown){ spaceDown = true; stage.classList.add('pan'); }
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape'){
      if (!tin.hidden){ tin.hidden = true; textAt = null; return; }
      if (pending){ dropPending(); return; }
      if (!gal.hidden){ gal.hidden = true; return; }
      if (!exp.hidden){ exp.hidden = true; return; }
      if (hasFocus() && (floatSel || sel)){ clearSel(); return; }
      if (cropRect){ clearCrop(); return; }
      if (!pop.hidden){ closePop(); return; }
      return;
    }
    const t = e.target;
    if (isField(t)) return;
    const mine = hasFocus();

    if (mine && (floatSel || sel) && e.key.indexOf('Arrow') === 0){
      const step = e.shiftKey ? 10 : 1;
      e.preventDefault();
      nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
            e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && mine && (floatSel || sel)){
      e.preventDefault(); deleteSel(); return;
    }
    if (e.key === 'Enter' && mine && pending){ e.preventDefault(); commitPending(); return; }
    if (e.key === 'Enter' && mine && (floatSel || sel)){ e.preventDefault(); clearSel(); return; }
    if (e.key === 'Enter' && cropRect){ e.preventDefault(); applyCrop(); return; }

    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z'){ e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y'){ e.preventDefault(); redo(); }
    else if (k === 's'){ e.preventDefault(); if (opts.onSave) opts.onSave(); }
    else if (k === '0' && mine){ e.preventDefault(); fitMode = false; btnFit.classList.remove('on'); zoom = 1; applyZoom(); }
    else if (k === 'a' && mine){ e.preventDefault(); selectAll(); }
    else if (k === 'c' && mine && (floatSel || sel)){ e.preventDefault(); copySel(); }
    else if (k === 'x' && mine && (floatSel || sel)){ e.preventDefault(); if (copySel()) deleteSel(); }
    /* Ctrl+V is deliberately left alone so the browser fires a paste event —
       onPaste handles it, which also picks up images copied from other apps. */
  }
  function onKeyUp(e){
    if (e.key === ' ' && spaceDown){
      spaceDown = false;
      stage.classList.toggle('pan', tool === 'pan');
    }
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);

  /* The editor listens in the capture phase, so stopping propagation here keeps the
     host page from also handling the paste (it would add a whole new image node). */
  function claimPaste(e){
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }
  function onPaste(e){
    if (!hasFocus() || isField(e.target)) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    let file = null;
    for (const it of items){
      if (it.kind === 'file' && it.type && it.type.indexOf('image/') === 0){ file = it.getAsFile(); break; }
    }
    if (file){
      claimPaste(e);
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        pasteSrc(im, im.naturalWidth || im.width, im.naturalHeight || im.height);
        URL.revokeObjectURL(url);
      };
      im.onerror = () => URL.revokeObjectURL(url);
      im.src = url;
      return;
    }
    if (clip){ claimPaste(e); pasteSrc(clip, clip.width, clip.height); }
  }
  document.addEventListener('paste', onPaste, true);

  /* Stage resize -> refresh the fit zoom */
  const ro = ('ResizeObserver' in global)
    ? new ResizeObserver(() => { if (fitMode){ zoom = fitZoom(); applyZoom(); } })
    : null;
  if (ro) ro.observe(stage);

  /* Click outside -> close the popovers */
  function onDocDown(e){
    if (!pop.hidden && !pop.contains(e.target) && !btnResize.contains(e.target)) closePop();
    if (!gal.hidden && !gal.contains(e.target) && !btnShape.contains(e.target)) gal.hidden = true;
    if (!exp.hidden && !exp.contains(e.target) && !btnDown.contains(e.target)) exp.hidden = true;
  }
  document.addEventListener('pointerdown', onDocDown, true);

  /* ---------- initial load ---------- */
  pickShape(shapeKind);
  setTool('pan');
  const ready = loadURL(opts.src).then(() => { syncHistBtns(); syncStatus(); }).catch(err => {
    stage.textContent = err.message || 'Image error';
    stage.style.color = '#a8432a';
    stage.style.fontSize = '13px';
  });

  /* ══════ public API ══════ */
  return {
    root, aiButton: aiBtn, ready,
    setAIEnabled,
    isDirty(){ return dirty; },
    markSaved(){ dirty = false; },
    size(){ return { w: base.width, h: base.height }; },
    toDataURL(mime){
      settle();
      return base.toDataURL(mime || 'image/png');
    },
    destroy(){
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('pointerdown', onDocDown, true);
      if (ro) ro.disconnect();
      root.remove();
    }
  };
}

global.createImageEditor = createImageEditor;
})(window);

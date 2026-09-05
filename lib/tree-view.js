/* ══════════════════════════════════════════════════════════════════════
   tree-view.js — Callout9 · node tree
   window.createTreeView(treeEl, opts) → tree
   ────────────────────────────────────────────────────────────────────
   opts:
     state     shared state — { nodes, selectedId } is read and written here.
     countEl   element that displays the node count
     tools     { del, rename, merge, fold } tree toolbar buttons (optional)
               `merge` is only enabled while the selected node is a text node; its click
               handler lives in the caller (the tree only keeps the button's state)
     toast     (msg, isErr) shows a notification
     onSelect  (id)   node selection request — the caller updates selectedId then calls render()
     onRenamed (node) right after a rename (to refresh the editor title)
     onRemoved ()     right after a node is deleted (to refresh the editor)
     onChange  ()     right after the tree structure or a name changes (for autosave)
   Returned API: render() · findNode(id) · countNodes() ·
             expandAncestors(id) · startRename(id) · removeNode(id) ·
             insertAfter(id, node)
   Features: rendering · collapse/expand · keyboard navigation (↑↓←→ F2 Delete) ·
         rename · delete · drag to reorder/move · toolbar state
   ══════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

/* ──────────────────────────────────────────────────────────
   Styles (injected once per document) — reuses the color/font variables from :root
   ────────────────────────────────────────────────────────── */
const CSS = `
.tree{--rowh:30px;--guide:#c9d2ce;flex:1 1 auto;overflow:auto;padding:6px 8px 16px}
.tree:focus{outline:none}
.tree:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--accent-soft)}

/* ── branches (guide lines) ── */
.branch{position:relative}
.children{margin-left:13px}
.children > .branch{padding-left:17px}
.children > .branch::before{            /* vertical line */
  content:'';position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--guide);
}
.children > .branch:last-child::before{ /* last sibling stops at the elbow */
  bottom:auto;height:calc(var(--rowh)/2);
}
.children > .branch::after{             /* horizontal elbow */
  content:'';position:absolute;left:0;top:calc(var(--rowh)/2);width:13px;height:1px;background:var(--guide);
}

/* ── node row ── */
.node{
  display:flex;align-items:center;gap:6px;padding:4px 6px;min-height:var(--rowh);
  border-radius:6px;cursor:pointer;user-select:none;position:relative;
}
.node:hover{background:#f1f5f4}
.node.sel{background:var(--accent-soft);box-shadow:inset 0 0 0 1px #bfded6}
.node.sel .n-name{color:var(--accent-ink);font-weight:600}

/* expand arrow */
.n-cav{width:15px;height:22px;flex:0 0 auto;display:grid;place-items:center;padding:0;
  border:none;background:none;border-radius:4px;color:#8a9793}
.n-cav i{display:block;width:0;height:0;
  border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;
  transition:transform .13s ease}
.n-cav.open i{transform:rotate(90deg)}
.n-cav:hover{background:#dfe7e4;color:var(--ink)}
.n-cav.leaf{visibility:hidden;pointer-events:none}

/* icon / thumbnail */
.n-thumb{width:26px;height:20px;flex:0 0 auto;border-radius:3px;border:1px solid var(--line);
  object-fit:cover;background:#f2f4f3}
.n-doc{width:26px;height:20px;flex:0 0 auto;display:grid;place-items:center;color:#8a9793}
.node.sel .n-doc{color:var(--accent)}
.n-doc svg{display:block}

.n-name{font-family:var(--mono);font-size:12.5px;flex:1 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n-name input{font-family:var(--mono);font-size:12.5px;width:100%;border:1px solid var(--accent);
  border-radius:3px;padding:1px 4px;background:#fff}
.n-kids{flex:0 0 auto;font-family:var(--mono);font-size:10px;color:var(--muted);
  background:#eef2f1;border-radius:9px;padding:0 5px;line-height:15px}
.node.sel .n-kids{background:#cfe6df;color:var(--accent-ink)}
.n-del{flex:0 0 auto;opacity:0;border:none;background:none;color:var(--muted);padding:2px 4px;
  border-radius:4px;line-height:1;font-size:15px}
.node:hover .n-del,.node.sel .n-del{opacity:1}
.n-del:hover{background:#f2dcd6;color:var(--danger)}

.tree-empty{padding:26px 16px;color:var(--muted);font-size:12.5px;text-align:center;line-height:1.9}
.tree-empty kbd{font-family:var(--mono);font-size:11px;border:1px solid var(--line);border-bottom-width:2px;
  border-radius:4px;padding:1px 5px;background:#f7f9f8}

/* drag & drop */
.node[draggable="true"]{cursor:grab}
.node.dragging{opacity:.4}
.node.drop-in{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)}
.node.drop-before::before,.node.drop-after::after{
  content:'';position:absolute;left:2px;right:2px;height:2px;background:var(--accent);border-radius:2px}
.node.drop-before::before{top:-2px}
.node.drop-after::after{bottom:-2px}
.tree.drop-root{box-shadow:inset 0 0 0 2px var(--accent-soft)}
`;

function injectCss(){
  if (document.getElementById('treeview-css')) return;
  const s = document.createElement('style');
  s.id = 'treeview-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const DOC_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4.2 1.7h4.6L12 4.9v9.4H4.2z"/><path d="M8.7 1.9v3.1h3.1"/>' +
  '<path d="M6 8.4h4M6 10.7h2.6"/></svg>';

global.createTreeView = function createTreeView(treeEl, opts){
  injectCss();
  const state   = opts.state;
  const countEl = opts.countEl || null;
  const tools   = opts.tools || {};
  const toast     = opts.toast     || function(){};
  const onSelect  = opts.onSelect  || function(){};
  const onRenamed = opts.onRenamed || function(){};
  const onRemoved = opts.onRemoved || function(){};
  const onChange  = opts.onChange  || function(){};

  /* ── traversal helpers ── */
  function walk(list, fn, parent = null){
    for (const n of list){ if (fn(n, parent, list) === false) return true; if (n.children && walk(n.children, fn, n)) return true; }
    return false;
  }
  function findNode(id){ let hit = null; walk(state.nodes, n => { if (n.id === id){ hit = n; return false; } }); return hit; }
  function findParentList(id){
    let res = state.nodes;
    walk(state.nodes, (n,p,list) => { if (n.id === id){ res = list; return false; } });
    return res;
  }
  function countNodes(){ let c = 0; walk(state.nodes, () => { c++; }); return c; }

  /* ── rendering ── */
  function render(){
    treeEl.innerHTML = '';
    if (countEl) countEl.textContent = countNodes();
    updateTools();
    if (!state.nodes.length){
      treeEl.innerHTML = '<div class="tree-empty">No nodes yet.<br>Paste an image with <kbd>Ctrl</kbd> + <kbd>V</kbd><br>or create a Text node with the <kbd>＋</kbd> button above.</div>';
      return;
    }
    treeEl.appendChild(buildList(state.nodes));
  }

  function buildList(list){
    const frag = document.createDocumentFragment();
    for (const n of list){
      const wrap = document.createElement('div');
      wrap.className = 'branch';

      const row = document.createElement('div');
      row.className = 'node' + (n.id === state.selectedId ? ' sel' : '');
      row.dataset.id = n.id;

      const hasKids = !!(n.children && n.children.length);
      const cav = document.createElement('button');
      cav.className = 'n-cav' + (hasKids ? (n.collapsed ? '' : ' open') : ' leaf');
      cav.tabIndex = -1;
      cav.innerHTML = '<i></i>';
      if (hasKids){
        cav.title = n.collapsed ? 'Expand' : 'Collapse';
        cav.addEventListener('click', e => { e.stopPropagation(); toggleCollapse(n); });
      }
      row.appendChild(cav);

      if (n.type === 'image'){
        const img = document.createElement('img');
        img.className = 'n-thumb'; img.src = n.image; img.alt = '';
        row.appendChild(img);
      } else {
        const d = document.createElement('div');
        d.className = 'n-doc'; d.innerHTML = DOC_ICON;
        row.appendChild(d);
      }

      const name = document.createElement('div');
      name.className = 'n-name'; name.textContent = n.name; name.title = n.name;
      row.appendChild(name);

      if (hasKids && n.collapsed){                     // show how many children a collapsed node hides
        const badge = document.createElement('span');
        badge.className = 'n-kids'; badge.textContent = n.children.length;
        row.appendChild(badge);
      }

      const del = document.createElement('button');
      del.className = 'n-del'; del.textContent = '×'; del.title = 'Delete node'; del.tabIndex = -1;
      del.addEventListener('click', e => { e.stopPropagation(); removeNode(n.id); });
      row.appendChild(del);

      row.addEventListener('click', () => onSelect(n.id));
      row.addEventListener('dblclick', e => { e.stopPropagation(); renameNode(n, name); });
      attachDnD(row, n);

      wrap.appendChild(row);
      if (hasKids && !n.collapsed){
        const kids = document.createElement('div');
        kids.className = 'children';
        kids.appendChild(buildList(n.children));
        wrap.appendChild(kids);
      }
      frag.appendChild(wrap);
    }
    return frag;
  }

  /* ── collapse / expand ── */
  function toggleCollapse(node){
    node.collapsed = !node.collapsed;
    render(); onChange();
  }
  function expandAncestors(id){
    return (function rec(list, chain){
      for (const n of list){
        if (n.id === id){ chain.forEach(a => a.collapsed = false); return true; }
        if (n.children && rec(n.children, chain.concat(n))) return true;
      }
      return false;
    })(state.nodes, []);
  }
  function visibleNodes(){                       // flatten in the order shown on screen
    const out = [];
    (function rec(list){
      for (const n of list){ out.push(n); if (n.children?.length && !n.collapsed) rec(n.children); }
    })(state.nodes);
    return out;
  }
  function setFoldAll(collapsed){
    walk(state.nodes, n => { if (n.children?.length) n.collapsed = collapsed; });
    render(); onChange();
  }
  function hasOpenBranch(){
    let open = false;
    walk(state.nodes, n => { if (n.children?.length && !n.collapsed) open = true; });
    return open;
  }

  /* ── keyboard navigation (↑ ↓ ← → Enter F2 Delete) ── */
  treeEl.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const rows = visibleNodes();
    if (!rows.length) return;
    const cur = rows.findIndex(n => n.id === state.selectedId);
    const go = i => {
      const t = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (t) { onSelect(t.id); treeEl.querySelector('.node.sel')?.scrollIntoView({block:'nearest'}); }
    };
    switch (e.key){
      case 'ArrowDown': e.preventDefault(); go(cur < 0 ? 0 : cur + 1); break;
      case 'ArrowUp':   e.preventDefault(); go(cur < 0 ? 0 : cur - 1); break;
      case 'ArrowRight': {
        e.preventDefault();
        const n = rows[cur]; if (!n) return;
        if (n.children?.length && n.collapsed) toggleCollapse(n);
        else if (n.children?.length) go(cur + 1);
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const n = rows[cur]; if (!n) return;
        if (n.children?.length && !n.collapsed) toggleCollapse(n);
        else {                                   // move to the parent
          let parent = null;
          walk(state.nodes, (x, p) => { if (x.id === n.id){ parent = p; return false; } });
          if (parent) onSelect(parent.id);
        }
        break;
      }
      case 'F2': e.preventDefault(); if (state.selectedId) startRename(state.selectedId); break;
      case 'Delete': e.preventDefault(); if (state.selectedId) removeNode(state.selectedId); break;
    }
  });

  /* ── rename ── */
  function renameNode(node, nameEl){
    const row = nameEl.closest('.node');
    if (row) row.draggable = false;                 // block dragging while editing
    const input = document.createElement('input');
    input.value = node.name;
    nameEl.textContent = ''; nameEl.appendChild(input);
    input.focus(); input.select();
    const done = ok => {
      if (ok && input.value.trim()) node.name = input.value.trim();
      render(); if (node.id === state.selectedId) onRenamed(node); onChange();
    };
    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); input.blur(); }
      if (e.key === 'Escape'){ e.preventDefault(); done(false); }
    });
  }
  function startRename(id){
    const node = findNode(id);
    if (!node) return;
    const nameEl = treeEl.querySelector('.node[data-id="' + CSS_escape(id) + '"] .n-name');
    if (nameEl) renameNode(node, nameEl);
  }
  /* The module-level CSS constant (the style string) shadows the global CSS object, so reach it via window */
  function CSS_escape(v){ return window.CSS?.escape ? window.CSS.escape(v) : String(v); }

  /* ── tree toolbar buttons ── */
  function updateTools(){
    const sel = findNode(state.selectedId);
    const has = !!sel;
    if (tools.del) tools.del.disabled = !has;
    if (tools.rename) tools.rename.disabled = !has;
    /* merging folds one text node's body into another, so only a text node can be merged */
    if (tools.merge) tools.merge.disabled = !sel || sel.type !== 'text';
    if (tools.fold){
      let branch = false, open = false;
      walk(state.nodes, n => { if (n.children?.length){ branch = true; if (!n.collapsed) open = true; } });
      tools.fold.disabled = !branch;
      tools.fold.textContent = open ? '⊟' : '⊞';
      tools.fold.title = open ? 'Collapse all' : 'Expand all';
    }
  }
  tools.del?.addEventListener('click', () => { if (state.selectedId) removeNode(state.selectedId); });
  tools.rename?.addEventListener('click', () => { if (state.selectedId) startRename(state.selectedId); });
  tools.fold?.addEventListener('click', () => setFoldAll(hasOpenBranch()));

  /* ── drag to reorder / move (children move along with the node) ── */
  let dragId = null;
  const DROP_CLASSES = ['drop-before','drop-after','drop-in'];
  function clearDropMarks(){
    treeEl.querySelectorAll('.node').forEach(el => el.classList.remove(...DROP_CLASSES));
    treeEl.classList.remove('drop-root');
  }
  function isDescendant(ancestorId, id){
    const a = findNode(ancestorId);
    if (!a || !a.children) return false;
    let hit = false;
    walk(a.children, n => { if (n.id === id){ hit = true; return false; } });
    return hit;
  }
  function detachNode(id){
    const list = findParentList(id);
    const i = list.findIndex(n => n.id === id);
    return i < 0 ? null : list.splice(i, 1)[0];
  }
  function moveNode(srcId, targetId, pos){        // pos: 'before' | 'after' | 'inside' | null (end of the top level)
    if (!srcId || !findNode(srcId)) return;
    if (srcId === targetId) return;
    if (targetId && isDescendant(srcId, targetId)){
      toast('A node cannot be moved into its own descendant.', true); return;
    }
    const node = detachNode(srcId);
    if (!node) return;
    if (!targetId){
      state.nodes.push(node);
    } else if (pos === 'inside'){
      const t = findNode(targetId);
      if (t){ (t.children ||= []).push(node); t.collapsed = false; } else state.nodes.push(node);
    } else {
      const list = findParentList(targetId);
      const idx = list.findIndex(n => n.id === targetId);
      if (idx < 0) state.nodes.push(node);
      else list.splice(pos === 'after' ? idx + 1 : idx, 0, node);
    }
    render(); onChange();
  }
  function attachDnD(row, n){
    row.draggable = true;
    row.addEventListener('dragstart', e => {
      dragId = n.id;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', n.id); } catch(_){}
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); clearDropMarks(); });
    row.addEventListener('dragover', e => {
      if (!dragId || dragId === n.id) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const r = row.getBoundingClientRect();
      const p = (e.clientY - r.top) / (r.height || 1);
      clearDropMarks();
      row.classList.add(p < 0.28 ? 'drop-before' : p > 0.72 ? 'drop-after' : 'drop-in');
    });
    row.addEventListener('dragleave', () => row.classList.remove(...DROP_CLASSES));
    row.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      const pos = row.classList.contains('drop-before') ? 'before'
                : row.classList.contains('drop-after')  ? 'after' : 'inside';
      const src = dragId || e.dataTransfer.getData('text/plain');
      clearDropMarks(); dragId = null;
      moveNode(src, n.id, pos);
    });
  }
  treeEl.addEventListener('dragover', e => {                 // empty area -> move to the end of the top level
    if (!dragId) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    clearDropMarks(); treeEl.classList.add('drop-root');
  });
  treeEl.addEventListener('drop', e => {
    if (!dragId && !e.dataTransfer.getData('text/plain')) return;
    e.preventDefault();
    const src = dragId || e.dataTransfer.getData('text/plain');
    clearDropMarks(); dragId = null;
    moveNode(src, null, null);
  });

  /* ── insert ── */
  /* Puts a ready-made node right after another one, as its sibling (used when the
     editor splits a text node in two). Falls back to the end of the top level. */
  function insertAfter(id, node){
    const list = findParentList(id);
    const i = list.findIndex(n => n.id === id);
    if (i < 0) state.nodes.push(node); else list.splice(i + 1, 0, node);
    render(); onChange();
    return node;
  }

  /* ── delete ── */
  function removeNode(id){
    const node = findNode(id);
    if (!node) return;
    const kids = node.children?.length ? ` Its ${node.children.length} child node(s) will be deleted too.` : '';
    if (!confirm(`Delete the "${node.name}" node?${kids}`)) return;
    const list = findParentList(id);
    list.splice(list.findIndex(n => n.id === id), 1);
    if (state.selectedId === id || !findNode(state.selectedId)) state.selectedId = null;
    render(); onRemoved(); onChange();
  }

  return { render, findNode, countNodes, expandAncestors, startRename, removeNode, insertAfter };
};

})(window);

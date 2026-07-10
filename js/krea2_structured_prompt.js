import { app } from "../../../scripts/app.js";

// ===========================================================================
// Krea2 Structured Prompt - frontend extension
// ===========================================================================
// Two pieces of custom UI live here:
//   1. A preset COMBO above each fixed field (scene / composition / lighting /
//      style / technical_details). Picking a preset fills the paired multiline
//      text widget (with a confirm-before-overwrite guard if the user has
//      typed their own content), then snaps the combo back to "Custom". The
//      text widget is the only value Python reads - the combo is a convenience
//      filler, never a separate data path, so these combos are serialize:false
//      and are never sent to the backend.
//   2. A dynamic character list rendered as a DOM widget, serialised into the
//      hidden "characters_data" STRING widget as a JSON array of
//      {description, pose_action, clothing_props}. Add / remove / drag-reorder
//      blocks; each sub-field has its own preset <select> + textarea. Same
//      loras_data-style JSON-blob pattern as the Ultimate Lora Loader.
//
// CSS prefix for everything in here: k2sp-  (krea2 structured prompt)
// ===========================================================================

// ---------------------------------------------------------------------------
// Preset content (single source of truth, frontend-only - Python never needs
// these since assembly reads whatever ended up in the text boxes). Expand or
// edit freely; the "Custom" sentinel is added at build time, not stored here.
// ---------------------------------------------------------------------------

const CUSTOM = "Custom";

const FIELD_PRESETS = {
  scene: [
    "A sun-drenched Mediterranean coastal town at golden hour, whitewashed buildings and narrow cobblestone streets",
    "A neon-lit cyberpunk alley at night, rain-slicked pavement reflecting signage",
    "A quiet minimalist studio with a seamless white backdrop",
    "A dense misty forest at dawn, shafts of light breaking through the canopy",
    "An abandoned industrial warehouse, dusty light streaming through broken windows",
  ],
  composition: [
    "Medium shot, eye-level, shallow depth of field",
    "Low-angle wide shot emphasizing scale and grandeur",
    "Extreme close-up, sharp focus on texture and detail",
    "Symmetrical centered composition, wide shot",
    "Dutch tilt, dynamic diagonal framing",
  ],
  lighting: [
    "Soft diffused window light, gentle shadows",
    "Golden hour side lighting, warm glow",
    "Harsh overhead studio lighting, high contrast",
    "Dramatic cinematic rim light against a dark background",
    "Even soft studio lighting, minimal shadow, high-key",
  ],
  style: [
    "Photorealistic photography, cinematic color grading",
    "Digital painting, visible brushwork, painterly",
    "Editorial fashion photography, high-contrast",
    "Moody concept art, atmospheric",
    "Film grain, analog texture, raw aesthetic",
  ],
  technical_details: [
    "Shot on 35mm film, subtle grain",
    "Wide-angle lens, slight perspective distortion",
    "Shallow depth of field, bokeh background",
    "Long exposure, motion blur on moving elements",
    "High dynamic range, crisp detail throughout",
  ],
};

// Generic per-character sub-field presets - one list per sub-field, reused for
// every character regardless of role (the who / doing-what / wearing-what
// split already separates concerns well enough that generic presets
// mix-and-match freely).
const CHAR_PRESETS = {
  description: [
    "A woman in her 30s with short dark hair and sharp features",
    "An elderly man with weathered skin and a thick white beard",
    "A young androgynous figure with an undercut and freckles",
    "A muscular man in his 40s with a shaved head and a stern expression",
    "A slight, wide-eyed teenager with curly red hair",
  ],
  pose_action: [
    "Standing confidently, arms crossed, gazing directly at camera",
    "Mid-stride, walking away, glancing back over one shoulder",
    "Seated, leaning forward, hands clasped in thought",
    "Reaching upward, caught mid-motion",
    "Crouched low, alert and watchful",
  ],
  clothing_props: [
    "Tailored charcoal wool coat, leather gloves",
    "Flowing linen dress, bare feet, straw sun hat",
    "Distressed denim jacket, band t-shirt, combat boots",
    "Formal black suit, no tie, top button undone",
    "Worn leather satchel slung across the chest, fingerless gloves",
  ],
};

// Human-readable labels + storage keys for the three character sub-fields, in
// the order they appear in a block (and in the assembled sentence).
const CHAR_SUBFIELDS = [
  { key: "description", label: "Who / appearance" },
  { key: "pose_action", label: "Pose / action" },
  { key: "clothing_props", label: "Clothing / props" },
];

// Soft (non-blocking) nudge threshold. Krea-2 starts dropping fine-grained
// per-character attributes as subject count rises; past this we show a muted
// notice, never an error or a hard cap.
const SOFT_CHAR_LIMIT = 5;

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = "krea2-structured-prompt-styles";
if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .k2sp-container {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 6px;
      gap: 8px;
      overflow: hidden;
    }

    .k2sp-section-label {
      font-size: 11px;
      color: #9a8fc7;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      user-select: none;
      padding: 0 2px;
    }

    .k2sp-char-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #2a2a2e;
      border: 1px solid #3a3a40;
      border-radius: 8px;
      padding: 8px;
      box-sizing: border-box;
      width: 100%;
    }
    .k2sp-char-block.dragging { opacity: 0.4; }
    .k2sp-char-block.drop-target-above { border-top: 2px solid #a78bfa; }
    .k2sp-char-block.drop-target-below { border-bottom: 2px solid #a78bfa; }

    .k2sp-char-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .k2sp-drag-handle {
      flex: 0 0 16px;
      width: 16px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #777;
      cursor: grab;
      user-select: none;
    }
    .k2sp-drag-handle:active { cursor: grabbing; }
    .k2sp-drag-handle svg { width: 10px; height: 14px; fill: currentColor; }

    .k2sp-char-title {
      flex: 1 1 auto;
      color: #ddd;
      font-size: 12px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .k2sp-remove {
      flex: 0 0 20px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #999;
      cursor: pointer;
      border-radius: 4px;
    }
    .k2sp-remove:hover { background: #3a3a3e; color: #f87171; }
    .k2sp-remove svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.6; }

    .k2sp-subfield { display: flex; flex-direction: column; gap: 3px; }
    .k2sp-subfield-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .k2sp-subfield-label {
      flex: 1 1 auto;
      font-size: 10px;
      color: #888;
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .k2sp-preset {
      flex: 0 0 108px;
      max-width: 108px;
      background: #1c1c1f;
      border: 1px solid #444;
      border-radius: 4px;
      color: #bbb;
      font-size: 10px;
      padding: 2px 4px;
      box-sizing: border-box;
      cursor: pointer;
    }
    .k2sp-preset:focus { outline: none; border-color: #6d5aa8; color: #ddd; }

    .k2sp-textarea {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      min-height: 44px;
      background: #1c1c1f;
      border: 1px solid #444;
      border-radius: 4px;
      color: #ddd;
      font-size: 11px;
      line-height: 1.35;
      padding: 4px 6px;
      font-family: inherit;
    }
    .k2sp-textarea:focus { outline: none; border-color: #6d5aa8; }

    .k2sp-add-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 6px 0;
      background: #333338;
      border: 1px solid #46464c;
      border-radius: 6px;
      color: #ccc;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    }
    .k2sp-add-btn:hover { background: #3d3d43; border-color: #5a5a62; }

    .k2sp-nudge {
      font-size: 10px;
      color: #c9a227;
      padding: 2px 4px;
      user-select: none;
      line-height: 1.3;
    }
    .k2sp-empty {
      font-size: 11px;
      color: #888;
      text-align: center;
      padding: 8px 4px;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 7h16" stroke-linecap="round"/>
  <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6 7l1 13.2A1.8 1.8 0 0 0 8.8 22h6.4a1.8 1.8 0 0 0 1.8-1.8L18 7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10 11v6M14 11v6" stroke-linecap="round"/>
</svg>`;

const DRAG_ICON_SVG = `<svg viewBox="0 0 10 16" xmlns="http://www.w3.org/2000/svg">
  <circle cx="2" cy="2" r="1.4"/><circle cx="8" cy="2" r="1.4"/>
  <circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/>
  <circle cx="2" cy="14" r="1.4"/><circle cx="8" cy="14" r="1.4"/>
</svg>`;

// ---------------------------------------------------------------------------
// Preset-fill helper (shared by fixed-field combos and character <select>s)
// ---------------------------------------------------------------------------
// Overwrite policy: if the target text is empty, or exactly matches one of the
// known preset strings for that field (i.e. it hasn't been hand-edited since a
// preset was applied), overwrite silently. Otherwise the user has typed their
// own content - ask before clobbering it. Cancel leaves the text untouched.
// Returns true if the text was replaced, false otherwise.

function isKnownPresetOrEmpty(currentValue, presetList) {
  const cur = (currentValue || "").trim();
  if (cur === "") return true;
  return presetList.some((p) => p.trim() === cur);
}

function confirmOverwrite() {
  return window.confirm(
    "Replace your current text with this preset?\n\n" +
      "You've typed something here that isn't one of the presets."
  );
}

// ---------------------------------------------------------------------------
// Fixed-field preset combos
// ---------------------------------------------------------------------------
// Insert a COMBO widget directly above the named text widget. Selecting a
// preset fills the text widget, then the combo snaps back to "Custom" so it
// always reads as a momentary picker rather than displaying a long preset
// string as its own value.

function attachFieldPresetCombo(node, fieldName, presetList) {
  const textWidget = node.widgets?.find((w) => w.name === fieldName);
  if (!textWidget) return;

  const options = [CUSTOM, ...presetList];
  const combo = node.addWidget(
    "combo",
    `${fieldName}_preset`,
    CUSTOM,
    () => {}, // real handler assigned below
    { values: options }
  );
  // Never serialise into the workflow or send to Python - it's pure UI sugar
  // and always resets to "Custom" anyway.
  combo.serialize = false;

  combo.callback = (value) => {
    if (value && value !== CUSTOM) {
      const ok =
        isKnownPresetOrEmpty(textWidget.value, presetList) || confirmOverwrite();
      if (ok) {
        textWidget.value = value;
        // Fire the text widget's own callback if it has one, so anything
        // listening for edits sees the change.
        textWidget.callback?.(textWidget.value);
      }
    }
    // Always snap back to the picker's neutral state.
    combo.value = CUSTOM;
    node.setDirtyCanvas(true, true);
  };

  // Move the combo to sit immediately above its text widget.
  const ci = node.widgets.indexOf(combo);
  if (ci !== -1) node.widgets.splice(ci, 1);
  const ti = node.widgets.indexOf(textWidget);
  node.widgets.splice(ti === -1 ? node.widgets.length : ti, 0, combo);
}

// ---------------------------------------------------------------------------
// Character sub-field preset <select>
// ---------------------------------------------------------------------------

function makePresetSelect(presetList, getCurrentText, onApply) {
  const select = document.createElement("select");
  select.className = "k2sp-preset";

  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "Preset…";
  select.appendChild(customOpt);

  presetList.forEach((preset, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    // Keep the dropdown readable - the full string is the title/tooltip.
    opt.textContent = preset.length > 40 ? preset.slice(0, 39) + "…" : preset;
    opt.title = preset;
    select.appendChild(opt);
  });

  select.onchange = () => {
    const idx = parseInt(select.value, 10);
    if (!isNaN(idx) && idx >= 0 && idx < presetList.length) {
      const preset = presetList[idx];
      const ok =
        isKnownPresetOrEmpty(getCurrentText(), presetList) || confirmOverwrite();
      if (ok) onApply(preset);
    }
    // Reset back to the neutral "Preset…" label.
    select.value = "__custom__";
  };

  return select;
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

app.registerExtension({
  name: "krea2.structured.prompt",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "Krea2StructuredPrompt") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      const node = this;

      // Give the node a bit more width by default - three sub-field textareas
      // per character read cramped at the stock width. Only nudged once at
      // creation, so a user's later manual resize isn't fought.
      if (node.size && node.size[0] && node.size[0] < 340) {
        node.setSize([Math.max(node.size[0], 340), node.size[1]]);
      }

      // --- Fixed-field preset combos ---
      attachFieldPresetCombo(node, "scene", FIELD_PRESETS.scene);
      attachFieldPresetCombo(node, "composition", FIELD_PRESETS.composition);
      attachFieldPresetCombo(node, "lighting", FIELD_PRESETS.lighting);
      attachFieldPresetCombo(node, "style", FIELD_PRESETS.style);
      attachFieldPresetCombo(node, "technical_details", FIELD_PRESETS.technical_details);

      // --- Hidden characters_data widget (the JSON data channel) ---
      // Must stay in node.widgets so ComfyUI serialises it and sends it to
      // Python, but it should never render - the DOM widget below is the real
      // UI. Neutralise its canvas draw + hide any DOM element it may spawn.
      const dataWidget = node.widgets?.find((w) => w.name === "characters_data");
      if (dataWidget) {
        dataWidget.computeSize = () => [0, 0];
        dataWidget.draw = () => {};
        dataWidget.mouse = () => false;
      }

      let entries = [];
      try {
        entries = dataWidget?.value ? JSON.parse(dataWidget.value) : [];
      } catch (e) {
        entries = [];
      }
      if (!Array.isArray(entries)) entries = [];

      // --- Character list DOM widget ---
      const container = document.createElement("div");
      container.className = "k2sp-container";

      const sectionLabel = document.createElement("div");
      sectionLabel.className = "k2sp-section-label";
      sectionLabel.textContent = "Characters";

      const blocksWrap = document.createElement("div");
      blocksWrap.style.display = "flex";
      blocksWrap.style.flexDirection = "column";
      blocksWrap.style.gap = "8px";
      blocksWrap.style.boxSizing = "border-box";

      const nudge = document.createElement("div");
      nudge.className = "k2sp-nudge";
      nudge.style.display = "none";
      nudge.textContent =
        "⚠ Krea-2 attribute fidelity drops past ~5 characters — detail on later characters may be dropped.";

      const addBtn = document.createElement("div");
      addBtn.className = "k2sp-add-btn";
      addBtn.innerHTML = `<span>+ Add character</span>`;

      function persist() {
        if (dataWidget) dataWidget.value = JSON.stringify(entries);
        node.setDirtyCanvas(true, true);
      }

      function hideDataWidgetDom() {
        if (!dataWidget) return;
        const el =
          dataWidget.element ||
          dataWidget.inputEl ||
          dataWidget.textEl ||
          dataWidget.domElement;
        if (el && el.style) el.style.display = "none";
      }

      let draggedIndex = null;

      function makeCharBlock(entry, idx) {
        const block = document.createElement("div");
        block.className = "k2sp-char-block";

        // Only dragover/drop live on the block; dragstart is on the handle so
        // clicking a textarea/select never starts a drag.
        block.ondragover = (e) => {
          if (draggedIndex === null || draggedIndex === idx) return;
          e.preventDefault();
          const rect = block.getBoundingClientRect();
          const above = e.clientY - rect.top < rect.height / 2;
          block.classList.toggle("drop-target-above", above);
          block.classList.toggle("drop-target-below", !above);
        };
        block.ondrop = (e) => {
          if (draggedIndex === null || draggedIndex === idx) return;
          e.preventDefault();
          const rect = block.getBoundingClientRect();
          const above = e.clientY - rect.top < rect.height / 2;
          let target = above ? idx : idx + 1;
          if (draggedIndex < target) target -= 1;
          const [moved] = entries.splice(draggedIndex, 1);
          entries.splice(target, 0, moved);
          draggedIndex = null;
          persist();
          render();
        };

        // Header: drag handle + title + remove
        const head = document.createElement("div");
        head.className = "k2sp-char-head";

        const handle = document.createElement("div");
        handle.className = "k2sp-drag-handle";
        handle.innerHTML = DRAG_ICON_SVG;
        handle.draggable = true;
        handle.ondragstart = (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", ""); // Firefox needs this
          draggedIndex = idx;
          block.classList.add("dragging");
        };
        handle.ondragend = () => {
          draggedIndex = null;
          blocksWrap.querySelectorAll(".k2sp-char-block").forEach((b) => {
            b.classList.remove("dragging", "drop-target-above", "drop-target-below");
          });
        };

        const title = document.createElement("div");
        title.className = "k2sp-char-title";
        title.textContent = `Character ${idx + 1}`;

        const remove = document.createElement("div");
        remove.className = "k2sp-remove";
        remove.innerHTML = TRASH_ICON_SVG;
        remove.title = "Remove this character";
        remove.onclick = () => {
          entries.splice(idx, 1);
          persist();
          render();
          resizeNode();
        };

        head.appendChild(handle);
        head.appendChild(title);
        head.appendChild(remove);
        block.appendChild(head);

        // Three sub-fields
        for (const { key, label } of CHAR_SUBFIELDS) {
          const sub = document.createElement("div");
          sub.className = "k2sp-subfield";

          const subHead = document.createElement("div");
          subHead.className = "k2sp-subfield-head";

          const lbl = document.createElement("span");
          lbl.className = "k2sp-subfield-label";
          lbl.textContent = label;

          const textarea = document.createElement("textarea");
          textarea.className = "k2sp-textarea";
          textarea.rows = 2;
          textarea.value = entry[key] || "";
          textarea.placeholder = label + "…";
          textarea.oninput = () => {
            entry[key] = textarea.value;
            persist();
          };

          const select = makePresetSelect(
            CHAR_PRESETS[key],
            () => textarea.value,
            (preset) => {
              textarea.value = preset;
              entry[key] = preset;
              persist();
            }
          );

          subHead.appendChild(lbl);
          subHead.appendChild(select);
          sub.appendChild(subHead);
          sub.appendChild(textarea);
          block.appendChild(sub);
        }

        return block;
      }

      function render() {
        blocksWrap.innerHTML = "";
        if (entries.length === 0) {
          const empty = document.createElement("div");
          empty.className = "k2sp-empty";
          empty.textContent = "No characters yet — add one to describe a subject.";
          blocksWrap.appendChild(empty);
        } else {
          entries.forEach((entry, idx) => {
            blocksWrap.appendChild(makeCharBlock(entry, idx));
          });
        }
        nudge.style.display = entries.length > SOFT_CHAR_LIMIT ? "block" : "none";
      }

      addBtn.onclick = (e) => {
        e.stopPropagation();
        entries.push({ description: "", pose_action: "", clothing_props: "" });
        persist();
        render();
        resizeNode();
      };

      container.appendChild(sectionLabel);
      container.appendChild(blocksWrap);
      container.appendChild(nudge);
      container.appendChild(addBtn);

      node.addDOMWidget("krea2_characters_ui", "div", container, {
        serialize: false,
        hideOnZoom: false,
      });

      // --- Sizing ---
      // Arithmetic, not measured (measuring container height then feeding that
      // back into constraining it is a feedback trap - same lesson as the
      // Ultimate Lora Loader). Grow-to-fit only: the node gets tall with many
      // characters, which is fine and predictable.
      const BLOCK_BASE = 34; // header + block padding + borders
      const SUBFIELD_HEIGHT = 74; // label row + 44px textarea + gaps, per sub-field
      const BLOCK_GAP = 8;
      const SECTION_LABEL_H = 20;
      const ADD_BTN_H = 30;
      const CONTAINER_PAD_V = 12;
      const NUDGE_H = 22;
      const EMPTY_H = 30;

      function computeCharsUiHeight() {
        const n = entries.length;
        let blocksH;
        if (n === 0) {
          blocksH = EMPTY_H;
        } else {
          const per = BLOCK_BASE + CHAR_SUBFIELDS.length * SUBFIELD_HEIGHT;
          blocksH = n * per + (n - 1) * BLOCK_GAP;
        }
        const nudgeH = n > SOFT_CHAR_LIMIT ? NUDGE_H : 0;
        return (
          CONTAINER_PAD_V + SECTION_LABEL_H + blocksH + nudgeH + ADD_BTN_H + 8 * 3
        );
      }

      function resizeNode() {
        hideDataWidgetDom();
        // Let LiteGraph recompute the height needed for all the native widgets
        // (the text boxes + combos) and add our DOM widget's required height on
        // top, so the node grows to fit everything without clipping.
        const needed = node.computeSize();
        const target = Math.max(node.size[1], needed[1]);
        if (target > node.size[1]) {
          node.setSize([node.size[0], target]);
        }
        node.setDirtyCanvas(true, true);
      }

      // Report the DOM widget's own height so node.computeSize() accounts for
      // it (ComfyUI calls each widget's computeSize when sizing the node).
      const domWidget = node.widgets?.find((w) => w.name === "krea2_characters_ui");
      if (domWidget) {
        domWidget.computeSize = () => [node.size?.[0] || 340, computeCharsUiHeight()];
      }

      // Re-load characters + re-hide the data widget after a workflow
      // load/paste, since onConfigure rebuilds widget state from serialised
      // values.
      const onConfigure = node.onConfigure;
      node.onConfigure = function () {
        const r3 = onConfigure ? onConfigure.apply(this, arguments) : undefined;
        const w = node.widgets?.find((w2) => w2.name === "characters_data");
        if (w) {
          w.computeSize = () => [0, 0];
          w.draw = () => {};
          w.mouse = () => false;
        }
        try {
          entries = w?.value ? JSON.parse(w.value) : [];
        } catch (e) {
          entries = [];
        }
        if (!Array.isArray(entries)) entries = [];
        render();
        resizeNode();
        hideDataWidgetDom();
        return r3;
      };

      render();

      // Initial layout may not be final at widget-creation time; nudge it on
      // the next tick, and retry the data-widget hide a few times in case its
      // DOM node mounts asynchronously.
      setTimeout(() => {
        resizeNode();
        hideDataWidgetDom();
      }, 0);
      [50, 150, 400].forEach((d) => setTimeout(hideDataWidgetDom, d));

      return r;
    };
  },
});

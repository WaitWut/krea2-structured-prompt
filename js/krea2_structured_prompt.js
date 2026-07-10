import { app } from "../../../scripts/app.js";

// ===========================================================================
// Krea2 Structured Prompt - frontend extension
// ===========================================================================
// The entire node UI is drawn in a single DOM widget so every text field -
// the five fixed fields (scene / composition / lighting / style /
// technical_details) AND the three sub-fields inside each character block -
// is the same custom, vertically-resizable textarea with a matching preset
// dropdown. Grab any textarea's bottom-right corner to drag it taller; the
// node grows to fit.
//
// Data path:
//   * Each fixed field is backed by its native STRING widget (declared in
//     INPUT_TYPES). That native widget is hidden but kept in node.widgets so
//     ComfyUI still serialises it and sends its value to Python; our visible
//     textarea just writes into it. The preset dropdown is pure UI sugar and
//     is never sent to the backend.
//   * The dynamic character list is serialised into the hidden
//     "characters_data" STRING widget as a JSON array of {description,
//     pose_action, clothing_props} - the loras_data blob pattern from the
//     Ultimate Lora Loader.
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

// The five fixed fields, in on-node display order. `key` matches the native
// STRING widget name declared in INPUT_TYPES.
const FIXED_FIELDS = [
  { key: "scene", label: "Scene" },
  { key: "composition", label: "Composition" },
  { key: "lighting", label: "Lighting" },
  { key: "style", label: "Style" },
  { key: "technical_details", label: "Technical details" },
];

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
      gap: 10px;
      overflow: visible;
      width: 100%;
    }

    .k2sp-section-label {
      font-size: 11px;
      color: #9a8fc7;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      user-select: none;
      padding: 2px 2px 0 2px;
    }

    /* --- A labelled field: header (label + preset select) + textarea. Used
       for both the fixed fields and the character sub-fields. --- */
    .k2sp-field { display: flex; flex-direction: column; gap: 3px; }
    .k2sp-field-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .k2sp-field-label {
      flex: 1 1 auto;
      font-size: 11px;
      color: #cfcfd6;
      font-weight: 600;
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .k2sp-subfield-label {
      flex: 1 1 auto;
      font-size: 10px;
      color: #888;
      font-weight: 500;
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .k2sp-preset {
      flex: 0 0 112px;
      max-width: 112px;
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
      resize: vertical;            /* the drag-to-resize handle the user wants */
      min-height: 44px;
      background: #1c1c1f;
      border: 1px solid #444;
      border-radius: 4px;
      color: #ddd;
      font-size: 11px;
      line-height: 1.4;
      padding: 5px 7px;
      font-family: inherit;
    }
    .k2sp-textarea:focus { outline: none; border-color: #6d5aa8; }
    .k2sp-field .k2sp-textarea { min-height: 52px; }

    /* --- Character block --- */
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

    .k2sp-char-head { display: flex; align-items: center; gap: 6px; }
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
    .k2sp-divider {
      height: 1px;
      background: #3a3a40;
      margin: 2px 0;
      border: none;
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
// Preset-fill helpers (shared by fixed fields and character sub-fields)
// ---------------------------------------------------------------------------
// Overwrite policy: if the target text is empty, or exactly matches one of the
// known preset strings for that field (i.e. it hasn't been hand-edited since a
// preset was applied), overwrite silently. Otherwise the user has typed their
// own content - ask before clobbering it.

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
    opt.textContent = preset.length > 42 ? preset.slice(0, 41) + "…" : preset;
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
    select.value = "__custom__"; // snap back to the neutral label
  };

  return select;
}

// Build a labelled field: header (label + preset select) + resizable textarea.
// `getValue`/`setValue` bind it to wherever the value actually lives (a native
// widget for fixed fields, an entry object for character sub-fields).
function makeField({ label, labelClass, presetList, getValue, setValue, onResize }) {
  const field = document.createElement("div");
  field.className = "k2sp-field";

  const head = document.createElement("div");
  head.className = "k2sp-field-head";

  const lbl = document.createElement("span");
  lbl.className = labelClass || "k2sp-field-label";
  lbl.textContent = label;

  const textarea = document.createElement("textarea");
  textarea.className = "k2sp-textarea";
  textarea.rows = 2;
  textarea.value = getValue() || "";
  textarea.placeholder = label + "…";
  textarea.oninput = () => setValue(textarea.value);
  // A manual drag-resize doesn't fire input, so nudge the node to re-fit when
  // the textarea's box changes size.
  if (onResize && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => onResize()).observe(textarea);
  }

  const select = makePresetSelect(
    presetList,
    () => textarea.value,
    (preset) => {
      textarea.value = preset;
      setValue(preset);
    }
  );

  head.appendChild(lbl);
  head.appendChild(select);
  field.appendChild(head);
  field.appendChild(textarea);
  return field;
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

      // Wider default - resizable textareas and preset dropdowns read cramped
      // at the stock width. Only nudged once at creation.
      if (node.size && node.size[0] && node.size[0] < 360) {
        node.setSize([Math.max(node.size[0], 360), node.size[1]]);
      }

      // --- Hide the native widgets that carry data ---
      // The five fixed-field STRING widgets and the characters_data blob must
      // stay in node.widgets so ComfyUI serialises them and hands them to
      // Python, but none of them should render - our DOM widget below is the
      // real UI. Neutralise each one's canvas footprint + hide any DOM node it
      // spawns.
      const hiddenWidgetNames = [
        ...FIXED_FIELDS.map((f) => f.key),
        "characters_data",
      ];

      function neutralise(w) {
        if (!w) return;
        w.computeSize = () => [0, 0];
        w.draw = () => {};
        w.mouse = () => false;
      }
      function hideNativeDom(w) {
        if (!w) return;
        const el = w.inputEl || w.element || w.textEl || w.domElement;
        if (el && el.style) {
          el.style.display = "none";
          // multiline widgets often wrap their textarea in a positioned div;
          // collapse that too so it leaves no gap.
          const parent = el.parentElement;
          if (parent && parent !== node.domElement && parent.childElementCount === 1) {
            parent.style.display = "none";
          }
        }
      }
      function hideAllNative() {
        for (const name of hiddenWidgetNames) {
          const w = node.widgets?.find((x) => x.name === name);
          hideNativeDom(w);
        }
      }

      const fixedWidgets = {};
      for (const f of FIXED_FIELDS) {
        const w = node.widgets?.find((x) => x.name === f.key);
        fixedWidgets[f.key] = w || null;
        neutralise(w);
      }
      const dataWidget = node.widgets?.find((w) => w.name === "characters_data");
      neutralise(dataWidget);

      // Character entries (parsed from the hidden blob).
      let entries = [];
      try {
        entries = dataWidget?.value ? JSON.parse(dataWidget.value) : [];
      } catch (e) {
        entries = [];
      }
      if (!Array.isArray(entries)) entries = [];

      function persistCharacters() {
        if (dataWidget) dataWidget.value = JSON.stringify(entries);
        node.setDirtyCanvas(true, true);
      }

      // --- Build the single DOM widget ---
      const container = document.createElement("div"); // registered element
      container.style.width = "100%";
      container.style.boxSizing = "border-box";

      const content = document.createElement("div"); // measured, natural-height
      content.className = "k2sp-container";
      container.appendChild(content);

      // Sizing: report the natural content height so ComfyUI lays the node out
      // to fit it, and grow the node when a textarea is dragged taller or a
      // character is added. Height is *measured* from `content` (which ComfyUI
      // never sizes) rather than computed arithmetically, so it stays correct
      // no matter how tall the user drags a box. Measuring the inner content
      // div - not the widget's own registered element - avoids the feedback
      // loop that measuring a ComfyUI-sized element would create.
      let lastContentH = 0;

      function fitNode() {
        const need = node.computeSize();
        if (need[1] > node.size[1]) {
          node.setSize([node.size[0], need[1]]);
        }
        node.setDirtyCanvas(true, true);
      }

      function remeasure() {
        const h = content.scrollHeight;
        if (h && Math.abs(h - lastContentH) > 1) {
          lastContentH = h;
          fitNode();
        }
      }

      const scheduleRemeasure = () => requestAnimationFrame(remeasure);

      // --- Fixed fields section ---
      for (const f of FIXED_FIELDS) {
        content.appendChild(
          makeField({
            label: f.label,
            labelClass: "k2sp-field-label",
            presetList: FIELD_PRESETS[f.key],
            getValue: () => fixedWidgets[f.key]?.value ?? "",
            setValue: (v) => {
              const w = fixedWidgets[f.key];
              if (w) {
                w.value = v;
                w.callback?.(w.value);
              }
              node.setDirtyCanvas(true, true);
            },
            onResize: scheduleRemeasure,
          })
        );
      }

      const divider = document.createElement("hr");
      divider.className = "k2sp-divider";
      content.appendChild(divider);

      // --- Characters section ---
      const sectionLabel = document.createElement("div");
      sectionLabel.className = "k2sp-section-label";
      sectionLabel.textContent = "Characters";
      content.appendChild(sectionLabel);

      const blocksWrap = document.createElement("div");
      blocksWrap.style.display = "flex";
      blocksWrap.style.flexDirection = "column";
      blocksWrap.style.gap = "8px";
      blocksWrap.style.boxSizing = "border-box";
      content.appendChild(blocksWrap);

      const nudge = document.createElement("div");
      nudge.className = "k2sp-nudge";
      nudge.style.display = "none";
      nudge.textContent =
        "⚠ Krea-2 attribute fidelity drops past ~5 characters — detail on later characters may be dropped.";
      content.appendChild(nudge);

      const addBtn = document.createElement("div");
      addBtn.className = "k2sp-add-btn";
      addBtn.innerHTML = `<span>+ Add character</span>`;
      content.appendChild(addBtn);

      let draggedIndex = null;

      function makeCharBlock(entry, idx) {
        const block = document.createElement("div");
        block.className = "k2sp-char-block";

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
          persistCharacters();
          render();
        };

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
          persistCharacters();
          render();
        };

        head.appendChild(handle);
        head.appendChild(title);
        head.appendChild(remove);
        block.appendChild(head);

        for (const { key, label } of CHAR_SUBFIELDS) {
          block.appendChild(
            makeField({
              label,
              labelClass: "k2sp-subfield-label",
              presetList: CHAR_PRESETS[key],
              getValue: () => entry[key] || "",
              setValue: (v) => {
                entry[key] = v;
                persistCharacters();
              },
              onResize: scheduleRemeasure,
            })
          );
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
        scheduleRemeasure();
      }

      addBtn.onclick = (e) => {
        e.stopPropagation();
        entries.push({ description: "", pose_action: "", clothing_props: "" });
        persistCharacters();
        render();
      };

      node.addDOMWidget("krea2_ui", "div", container, {
        serialize: false,
        hideOnZoom: false,
      });

      const domWidget = node.widgets?.find((w) => w.name === "krea2_ui");
      if (domWidget) {
        domWidget.computeSize = () => [
          node.size?.[0] || 360,
          Math.max(lastContentH, 60),
        ];
      }

      // Watch the natural content height for changes (textarea drags, add/
      // remove) and keep the node sized to fit.
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => scheduleRemeasure());
        ro.observe(content);
        const onRemoved = node.onRemoved;
        node.onRemoved = function () {
          ro.disconnect();
          return onRemoved ? onRemoved.apply(this, arguments) : undefined;
        };
      }

      // After a workflow load/paste, onConfigure rebuilds the native widget
      // values from serialised data - re-sync our textareas + character list
      // to match, and re-hide the native widgets.
      const onConfigure = node.onConfigure;
      node.onConfigure = function () {
        const r3 = onConfigure ? onConfigure.apply(this, arguments) : undefined;
        for (const f of FIXED_FIELDS) {
          const w = node.widgets?.find((x) => x.name === f.key);
          fixedWidgets[f.key] = w || null;
          neutralise(w);
        }
        const dw = node.widgets?.find((w2) => w2.name === "characters_data");
        neutralise(dw);
        try {
          entries = dw?.value ? JSON.parse(dw.value) : [];
        } catch (e) {
          entries = [];
        }
        if (!Array.isArray(entries)) entries = [];
        // Re-sync fixed-field textareas from the restored native values.
        const fieldEls = content.querySelectorAll(".k2sp-field > .k2sp-textarea");
        FIXED_FIELDS.forEach((f, i) => {
          const ta = fieldEls[i];
          if (ta) ta.value = fixedWidgets[f.key]?.value ?? "";
        });
        render();
        hideAllNative();
        scheduleRemeasure();
        return r3;
      };

      render();

      // Initial layout may not be final at widget-creation time; measure +
      // re-hide the native widgets on the next ticks (their DOM nodes can
      // mount asynchronously).
      setTimeout(() => {
        hideAllNative();
        remeasure();
      }, 0);
      [50, 150, 400].forEach((d) =>
        setTimeout(() => {
          hideAllNative();
          remeasure();
        }, d)
      );

      return r;
    };
  },
});

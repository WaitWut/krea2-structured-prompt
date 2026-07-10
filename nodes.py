"""
Krea2 Structured Prompt for ComfyUI
-----------------------------------
Builds a Krea-2 / K2 native flowing-prose prompt from structured fields
(scene, N characters, composition, lighting, style, technical details) and
outputs a single STRING suitable for wiring straight into the
`Text Encode (Krea2)` node's `prompt` input
(ethanfel/ComfyUI-Krea2TextEncoder). This node does not re-implement that
encoder - it only builds the string that feeds into it.

Design notes:
  * The fixed fields (scene / composition / lighting / style /
    technical_details) are ordinary multiline STRING widgets. Each gets a
    preset picker (a COMBO) on the JS side that just fills the text box - the
    text box is the only thing read at execution time, so the combo is a
    convenience filler, not a separate data path.
  * The character list is dynamic (1 -> N, no hard cap). The JS frontend owns
    that UI entirely and serialises it into a single hidden `characters_data`
    STRING widget as a JSON array of {description, pose_action,
    clothing_props}. Python just parses that JSON and assembles.
  * Assembly follows Krea-2's trained caption ordering: two flowing
    paragraphs - subjects (sequential description) + scene backdrop first,
    visual treatment second. No labelled sections, no keyword lists: the
    output must read as prose.

Files:
  nodes.py                      <- this file (assembly logic + node)
  js/krea2_structured_prompt.js <- frontend (preset combos + dynamic character list)
"""

import json
import re


# ---------------------------------------------------------------------------
# Text hygiene helpers
# ---------------------------------------------------------------------------
# Lifted-pattern (not code) from artokun's ComfyUI-Photoreal-Prompt-Builder:
# presence-gated fragment append -> join -> cleanup, plus preposition-aware
# scene weaving. Reimplemented locally; nothing imported from that package.

# When a scene fragment already opens with one of these, we must NOT prepend
# "In " (avoids "In on a rain-slicked street"). Matched against the first word
# only, lowercased.
_LEADING_PREPOSITIONS = {
    "in", "on", "at", "inside", "within", "into", "near", "by", "beside",
    "behind", "beneath", "below", "under", "underneath", "above", "over",
    "atop", "amid", "amidst", "among", "amongst", "against", "around",
    "outside", "across", "beyond", "through", "throughout", "before",
    "between", "along", "surrounded",
}

# Articles are safe to lowercase after prepending "In " ("In a sun-drenched..."
# reads better than "In A sun-drenched..."). Proper nouns are left untouched so
# we never produce "In paris at night".
_ARTICLES = {"a", "an", "the"}


def _clean(text):
    """Collapse whitespace and double-periods, ensure a single trailing
    period, and sentence-case the result. Safe on empty input (returns "")."""
    if not text:
        return ""
    t = text.strip()
    if not t:
        return ""
    # collapse internal runs of whitespace to single spaces
    t = re.sub(r"\s+", " ", t)
    # tidy space-before-punctuation ("word ," -> "word,")
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    # collapse runs of periods (possibly space-separated) into one
    t = re.sub(r"\.(\s*\.)+", ".", t)
    # drop any stray leading punctuation left over from an empty first fragment
    t = t.lstrip(" .,;:")
    if not t:
        return ""
    # ensure exactly one trailing sentence terminator
    if t[-1] not in ".!?":
        t += "."
    # capitalise the first letter of every sentence (start of string, or the
    # first letter following a sentence terminator + space)
    t = re.sub(
        r"(^\s*|[.!?]\s+)([a-z])",
        lambda m: m.group(1) + m.group(2).upper(),
        t,
    )
    return t


def _lower_first(s):
    """Lowercase the first alphabetical character of a fragment so it reads as
    a mid-sentence continuation rather than a new sentence. Leaves the standalone
    pronoun "I" and obvious acronyms (a capitalised first word that is ALL-caps,
    e.g. "DSLR") alone."""
    for i, ch in enumerate(s):
        if ch.isalpha():
            first_word = s[i:].split(" ", 1)[0].strip(".,;:")
            if first_word == "I" or first_word.isupper():
                return s
            return s[:i] + ch.lower() + s[i + 1:]
        if ch.isspace():
            continue
        # first meaningful char isn't a letter (a digit, quote, etc.) - leave it
        return s
    return s


def _join_fragments(fragments):
    """Comma-join one character's sub-fields (who / doing-what / wearing-what)
    into a single flowing clause. Fragments are already non-empty stripped
    strings. Trailing periods on individual fragments are stripped so the join
    reads as one sentence; `_clean` re-adds the final period downstream. Every
    fragment after the first is lowercased at its first letter so preset text
    (which is written as standalone capitalised phrases) doesn't produce
    mid-sentence capitals like "...features, Standing confidently...".."""
    parts = []
    for f in fragments:
        f = f.strip().rstrip(".").strip()
        if f:
            parts.append(f)
    if not parts:
        return ""
    return ", ".join([parts[0]] + [_lower_first(p) for p in parts[1:]])


def _weave_scene(scene):
    """Emit the scene/environment text as its own sentence, prepending "In "
    unless it already opens with a preposition (so we never produce "In on a
    beach..."). When it opens with an article, the article is lowercased so the
    weave reads naturally ("In a sun-drenched town...")."""
    s = scene.strip()
    if not s:
        return ""
    first = re.split(r"[\s,]+", s, 1)[0].lower().strip(".,")
    if first in _LEADING_PREPOSITIONS:
        return s
    if first in _ARTICLES:
        return "In " + s[0].lower() + s[1:]
    return "In " + s


def assemble_prompt(scene, characters, composition, lighting, style, technical_details):
    """Assemble the two-paragraph Krea-2 prose prompt.

    Paragraph 1: each character as one sequential-description sentence
    (description -> pose/action -> clothing/props), then the scene woven in.
    Paragraph 2: visual treatment (composition -> lighting -> style ->
    technical details). Empty fields disappear silently; an entirely empty
    paragraph is dropped rather than emitting a leading blank line."""
    # --- Paragraph 1: subjects + scene backdrop ---
    p1 = []
    for char in characters:
        if not isinstance(char, dict):
            continue
        frags = []
        for key in ("description", "pose_action", "clothing_props"):
            val = (char.get(key) or "").strip()
            if val:
                frags.append(val)
        if frags:
            p1.append(_join_fragments(frags))

    if scene and scene.strip():
        woven = _weave_scene(scene)
        if woven:
            p1.append(woven)

    paragraph_1 = _clean(". ".join(p1))

    # --- Paragraph 2: visual treatment ---
    p2 = []
    for field in (composition, lighting, style, technical_details):
        if field and field.strip():
            p2.append(field.strip().rstrip(".").strip())

    paragraph_2 = _clean(". ".join(p2))

    return "\n\n".join(p for p in (paragraph_1, paragraph_2) if p)


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class Krea2StructuredPrompt:
    """Structured prompt builder for Krea-2 / K2.

    The dynamic character list is stored as a single JSON-serialised widget
    value ("characters_data") that the JS frontend manages entirely
    (add/remove/reorder + per-sub-field preset pickers). Python just reads that
    JSON and assembles the prose prompt.
    """

    NODE_NAME = "Krea2 Structured Prompt"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "scene": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "Environment / background. Woven into paragraph 1 as the scene backdrop.",
                }),
                "composition": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "Shot type, angle, framing, depth of field. Paragraph 2.",
                }),
                "lighting": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "Light quality, direction, colour / mood. Paragraph 2.",
                }),
                "style": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "Medium and overall aesthetic. Paragraph 2.",
                }),
                # Hidden data channel for the dynamic character list. The JS
                # frontend draws the real UI (add/remove/reorder blocks, preset
                # pickers) and keeps this JSON array in sync. Empty default is
                # a JSON empty array so a bare node with no characters is valid.
                "characters_data": ("STRING", {"default": "[]", "multiline": False}),
            },
            "optional": {
                "technical_details": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "Camera / lens language, grain, etc. Optional. Paragraph 2.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt", "prompt_json")
    FUNCTION = "build"
    CATEGORY = "conditioning/krea2"
    DESCRIPTION = (
        "Fill structured fields (scene, N characters, composition, lighting, "
        "style) and assemble them into Krea-2-native flowing prose. Wire "
        "'prompt' into Text Encode (Krea2)'s prompt input."
    )

    def build(self, scene, composition, lighting, style, characters_data, technical_details=""):
        try:
            characters = json.loads(characters_data) if characters_data else []
        except Exception:
            characters = []
        if not isinstance(characters, list):
            characters = []

        prompt = assemble_prompt(
            scene, characters, composition, lighting, style, technical_details
        )

        # Raw field dump for debugging / downstream reuse (borrowed from the
        # Photoreal Prompt Builder's prompt_json side-output).
        raw = {
            "scene": scene,
            "characters": characters,
            "composition": composition,
            "lighting": lighting,
            "style": style,
            "technical_details": technical_details,
        }
        prompt_json = json.dumps(raw, indent=2, ensure_ascii=False)

        return (prompt, prompt_json)


NODE_CLASS_MAPPINGS = {
    "Krea2StructuredPrompt": Krea2StructuredPrompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Krea2StructuredPrompt": "Krea2 Structured Prompt",
}

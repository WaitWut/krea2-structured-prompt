"""
Preset loading for the Krea2 Structured Prompt node.
----------------------------------------------------
Every preset dropdown is backed by a plain-text file, one preset per line
(wildcard-style). Blank lines and lines starting with `#` are ignored.

  * <this package>/presets/<name>.txt
      Bundled defaults. Replaced whenever the node is updated.
  * <ComfyUI user directory>/krea2-structured-prompt/presets/<name>.txt
      Your own copy (usually ComfyUI/user/krea2-structured-prompt/presets/).
      On startup, any file missing here is created from the bundled one, so
      the defaults double as examples. Edit freely: when a file exists here it
      replaces the bundled list, and node updates never touch this folder.
      Delete a file to get the defaults back on the next start.

Files are re-read on every request, so edits show up after a browser refresh -
no ComfyUI restart needed.

The frontend fetches everything once from GET /krea2_structured_prompt/presets.
"""

import os

from aiohttp import web

import folder_paths
from server import PromptServer

# File name (without .txt) for every preset dropdown. Fixed fields use the
# STRING widget name; character sub-fields are prefixed with "character_".
FIELD_KEYS = ("scene", "composition", "lighting", "style", "technical_details")
CHARACTER_KEYS = ("description", "pose_action", "clothing_props")
ALL_NAMES = FIELD_KEYS + tuple("character_" + key for key in CHARACTER_KEYS)

BUNDLED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presets")

USER_FILE_HEADER = (
    "# Krea2 Structured Prompt - {name} presets\n"
    "# One preset per line. Blank lines and lines starting with # are ignored.\n"
    "# Edit freely: this file replaces the bundled list and survives node updates.\n"
    "# Delete it to get the defaults back on the next ComfyUI start.\n"
    "\n"
)


def user_presets_dir():
    return os.path.join(folder_paths.get_user_directory(), "krea2-structured-prompt", "presets")


def seed_user_presets():
    """Create any missing user preset file from the bundled defaults."""
    user_dir = user_presets_dir()
    try:
        os.makedirs(user_dir, exist_ok=True)
        for name in ALL_NAMES:
            target = os.path.join(user_dir, name + ".txt")
            source = os.path.join(BUNDLED_DIR, name + ".txt")
            if os.path.exists(target) or not os.path.isfile(source):
                continue
            with open(source, "r", encoding="utf-8") as f:
                defaults = f.read()
            with open(target, "w", encoding="utf-8", newline="\n") as f:
                f.write(USER_FILE_HEADER.format(name=name) + defaults)
    except OSError as e:
        print(f"[Krea2 Structured Prompt] Could not create user presets in {user_dir}: {e}")


def read_preset_file(path):
    """Return the non-empty, non-comment lines of a preset file."""
    try:
        # utf-8-sig swallows the BOM Windows Notepad sometimes adds.
        with open(path, "r", encoding="utf-8-sig") as f:
            lines = [line.strip() for line in f]
    except (OSError, UnicodeDecodeError) as e:
        print(f"[Krea2 Structured Prompt] Could not read presets from {path}: {e}")
        return []
    presets = []
    for line in lines:
        if line and not line.startswith("#") and line not in presets:
            presets.append(line)
    return presets


def load_presets(name):
    """The user's file if there is one, otherwise the bundled defaults."""
    for folder in (user_presets_dir(), BUNDLED_DIR):
        path = os.path.join(folder, name + ".txt")
        if os.path.isfile(path):
            return read_preset_file(path)
    return []


def load_all_presets():
    return {
        "fields": {key: load_presets(key) for key in FIELD_KEYS},
        "characters": {key: load_presets("character_" + key) for key in CHARACTER_KEYS},
    }


@PromptServer.instance.routes.get("/krea2_structured_prompt/presets")
async def get_presets(request):
    return web.json_response(load_all_presets())


seed_user_presets()

#!/usr/bin/env python3
"""
Generate per-device ESPHome YAML files from devices.yaml.

Usage:
    python3 generate-devices.py

To add a new node:
  1. Add an entry to devices.yaml
  2. Run this script
  3. Commit devices.yaml + the new <name>.yaml
"""

import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML not found. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
DEVICES_FILE = SCRIPT_DIR / "devices.yaml"
HEADER = "# GENERATED — do not edit. Edit devices.yaml and run generate-devices.py\n"

TEMPLATE = """\
{header}
substitutions:
  name: {name}
  friendly_name: {friendly_name}

esphome:
  name: ${{name}}
  friendly_name: ${{friendly_name}}

esp32:
  board: {board}{minimum_chip_revision}
  framework:
    type: arduino

packages:
  common: !include packages/triang-common.yaml
"""


def main():
    with open(DEVICES_FILE) as f:
        config = yaml.safe_load(f) or {}

    if not isinstance(config, dict):
        print("devices.yaml must contain a top-level mapping", file=sys.stderr)
        sys.exit(1)

    devices = config.get("devices", [])
    if not isinstance(devices, list) or not devices:
        print("devices.yaml must contain a non-empty 'devices' list", file=sys.stderr)
        sys.exit(1)

    # --- Pre-write validation pass ---
    # Check all required keys exist and no duplicate names before writing any files.
    REQUIRED_KEYS = ("name", "friendly_name", "board")
    seen_names: set[str] = set()
    errors: list[str] = []

    for idx, device in enumerate(devices):
        if not isinstance(device, dict):
            errors.append(f"Device at index {idx} is not a mapping (got {type(device).__name__})")
            continue
        for key in REQUIRED_KEYS:
            if key not in device:
                errors.append(f"  device[{idx}]: missing required key '{key}'")

        name = device.get("name")
        if name is not None:
            if name in seen_names:
                errors.append(f"  device[{idx}]: duplicate name '{name}'")
            else:
                seen_names.add(name)

    if errors:
        print("Validation failed — fix devices.yaml before regenerating:", file=sys.stderr)
        for err in errors:
            print(err, file=sys.stderr)
        sys.exit(1)

    # --- File-writing pass ---
    for device in devices:
        name = device["name"]
        friendly_name = device["friendly_name"]
        board = device["board"]

        # yaml.dump({'v': ...}) produces a properly-escaped/quoted scalar (e.g.
        # wraps in quotes when the value contains special characters) without
        # emitting a YAML document-end marker ("...") that yaml.dump() adds
        # when dumping a bare scalar with default_flow_style=True.
        friendly_name_yaml = yaml.dump({"v": friendly_name})[3:].rstrip()

        # Only emit minimum_chip_revision when the device entry explicitly
        # specifies it.  Omitting it is safe (ESPHome defaults to 0.0) and
        # prevents blocking older ESP32 chips (e.g. esp32dev rev 0.0–3.0).
        if "minimum_chip_revision" in device:
            min_rev = device["minimum_chip_revision"]
            minimum_chip_revision_block = f"\n  minimum_chip_revision: \"{min_rev}\""
        else:
            minimum_chip_revision_block = ""

        content = TEMPLATE.format(
            header=HEADER.rstrip(),
            name=name,
            friendly_name=friendly_name_yaml,
            board=board,
            minimum_chip_revision=minimum_chip_revision_block,
        )

        out_path = SCRIPT_DIR / f"{name}.yaml"
        out_path.write_text(content)
        print(f"  wrote {out_path.name}")

    print(f"\nGenerated {len(devices)} device file(s).")


if __name__ == "__main__":
    main()

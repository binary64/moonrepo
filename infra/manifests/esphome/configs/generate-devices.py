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
  friendly_name: "{friendly_name}"

esphome:
  name: ${{name}}
  friendly_name: ${{friendly_name}}

esp32:
  board: {board}
  minimum_chip_revision: "3.1"
  framework:
    type: arduino

packages:
  common: !include packages/triang-common.yaml
"""


def main():
    with open(DEVICES_FILE) as f:
        config = yaml.safe_load(f)

    devices = config.get("devices", [])
    if not devices:
        print("No devices found in devices.yaml", file=sys.stderr)
        sys.exit(1)

    for device in devices:
        name = device["name"]
        friendly_name = device["friendly_name"]
        board = device["board"]

        content = TEMPLATE.format(
            header=HEADER.rstrip(),
            name=name,
            friendly_name=friendly_name,
            board=board,
        )

        out_path = SCRIPT_DIR / f"{name}.yaml"
        out_path.write_text(content)
        print(f"  wrote {out_path.name}")

    print(f"\nGenerated {len(devices)} device file(s).")


if __name__ == "__main__":
    main()

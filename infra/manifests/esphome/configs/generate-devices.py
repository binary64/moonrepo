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

import re
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


def validate_devices(devices: list) -> None:
    """Validate all device entries. Prints errors and raises SystemExit on failure."""
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
        name_valid = True
        if not isinstance(name, str) or not name.strip() or name != name.strip():
            errors.append(f"  device[{idx}]: name must be a non-empty string without leading/trailing whitespace")
            name_valid = False

        if name_valid and ("/" in name or "\\" in name or ".." in name):
            errors.append(f"  device[{idx}]: invalid path-like name '{name}'")
            name_valid = False

        # ESPHome device names must be lowercase alphanumeric + hyphens/underscores.
        # This also ensures the name is safe to embed in YAML without quoting.
        if name_valid and not re.fullmatch(r"[a-z0-9_-]+", name):
            errors.append(
                f"  device[{idx}]: name '{name}' contains invalid characters "
                f"(only a-z, 0-9, _ and - are allowed)"
            )
            name_valid = False

        if name_valid:
            candidate = (SCRIPT_DIR / f"{name}.yaml").resolve()
            if candidate.parent != SCRIPT_DIR.resolve():
                errors.append(f"  device[{idx}]: invalid path-like name '{name}'")
                name_valid = False

        if name_valid:
            if name in seen_names:
                errors.append(f"  device[{idx}]: duplicate name '{name}'")
            else:
                seen_names.add(name)

        friendly_name = device.get("friendly_name")
        if not isinstance(friendly_name, str) or not friendly_name.strip():
            errors.append(f"  device[{idx}]: friendly_name must be a non-empty string")

        board = device.get("board")
        if not isinstance(board, str) or not board.strip() or board != board.strip():
            errors.append(f"  device[{idx}]: board must be a non-empty string without leading/trailing whitespace")

        if "minimum_chip_revision" in device:
            min_rev = device.get("minimum_chip_revision")
            if not (isinstance(min_rev, (str, int, float)) and not isinstance(min_rev, bool)) or (isinstance(min_rev, str) and not min_rev.strip()):
                errors.append(
                    f"  device[{idx}]: minimum_chip_revision must be a non-empty scalar (str/int/float)"
                )

    if errors:
        print("Validation failed — fix devices.yaml before regenerating:", file=sys.stderr)
        for err in errors:
            print(err, file=sys.stderr)
        sys.exit(1)


def generate_files(devices: list) -> None:
    """Write per-device ESPHome YAML files for all validated device entries."""
    for device in devices:
        name = device["name"]
        friendly_name = device["friendly_name"]
        board = device["board"]

        # yaml.dump({'v': ...}) produces a properly-escaped/quoted scalar (e.g.
        # wraps in quotes when the value contains special characters) without
        # emitting a YAML document-end marker ("...") that yaml.dump() adds
        # when dumping a bare scalar with default_flow_style=True.
        name_yaml = yaml.dump({"v": name})[3:].rstrip()
        friendly_name_yaml = yaml.dump({"v": friendly_name})[3:].rstrip()
        board_yaml = yaml.dump({"v": board})[3:].rstrip()

        # Only emit minimum_chip_revision when the device entry explicitly
        # specifies it.  Omitting it is safe (ESPHome defaults to 0.0) and
        # prevents blocking older ESP32 chips (e.g. esp32dev rev 0.0-3.0).
        if "minimum_chip_revision" in device:
            min_rev = device["minimum_chip_revision"]
            min_rev_yaml = yaml.dump({"v": min_rev})[3:].rstrip()
            minimum_chip_revision_block = f"\n  minimum_chip_revision: {min_rev_yaml}"
        else:
            minimum_chip_revision_block = ""

        content = TEMPLATE.format(
            header=HEADER.rstrip(),
            name=name_yaml,
            friendly_name=friendly_name_yaml,
            board=board_yaml,
            minimum_chip_revision=minimum_chip_revision_block,
        )

        out_path = SCRIPT_DIR / f"{name}.yaml"
        out_path.write_text(content, encoding="utf-8")
        print(f"  wrote {out_path.name}")

    print(f"\nGenerated {len(devices)} device file(s).")


def main():
    try:
        with open(DEVICES_FILE, encoding="utf-8") as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"Missing file: {DEVICES_FILE}", file=sys.stderr)
        sys.exit(1)
    except yaml.YAMLError as exc:
        print(f"Invalid YAML in {DEVICES_FILE}: {exc}", file=sys.stderr)
        sys.exit(1)
    except OSError as exc:
        print(f"Unable to read {DEVICES_FILE}: {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(config, dict):
        print("devices.yaml must contain a top-level mapping", file=sys.stderr)
        sys.exit(1)

    devices = config.get("devices", [])
    if not isinstance(devices, list) or not devices:
        print("devices.yaml must contain a non-empty 'devices' list", file=sys.stderr)
        sys.exit(1)

    validate_devices(devices)
    generate_files(devices)


if __name__ == "__main__":
    main()

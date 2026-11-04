#!/usr/bin/env python3
"""Edit a DevStack service's config files for logs-record.sh, and read the journal.

Three small jobs, each of which a shell one-liner gets wrong on a real file:

    logs-configure.py ini-set FILE SECTION KEY VALUE
    logs-configure.py ini-delete FILE SECTION KEY
    logs-configure.py paste-audit FILE MAP_FILE
    journalctl -o json ... | logs-configure.py journal-lines > journal.jsonl

ini-set keeps everything else in the file exactly as it is: a service's config holds
values with % and = in them, and repeated keys, which configparser would refuse or
rewrite.

paste-audit puts keystonemiddleware's audit filter into a service's paste pipelines,
after auth_token as its documentation asks, right before the application at the end.

journal-lines keeps the fields a recording reads, and turns a MESSAGE journalctl wrote
as a list of bytes back into text: it does that for any line holding a control
character, and DevStack colours its lines.

Standard library only, so it runs with `python3 -I` on any runner.
"""
import json
import sys

AUDIT_FILTER = "audit"

JOURNAL_FIELDS = (
    "__REALTIME_TIMESTAMP",
    "_SYSTEMD_UNIT",
    "_HOSTNAME",
    "_PID",
    "PRIORITY",
    "SYSLOG_IDENTIFIER",
    "MESSAGE",
    # What oslo.log's own journal handler adds when use_journal is on.
    "LOGGER_NAME",
    "LOGGER_LEVEL",
    "REQUEST_ID",
    "GLOBAL_REQUEST_ID",
    "PROJECT_NAME",
    "PROJECT_ID",
    "USER_NAME",
    "USER_ID",
    "EXCEPTION_INFO",
)


def section_header(line):
    stripped = line.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        return stripped[1:-1]
    return None


def read_lines(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read().split("\n")


def write_lines(path, lines):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def key_of(line):
    if line.lstrip().startswith(("#", ";")) or "=" not in line:
        return None
    return line.split("=", 1)[0].strip()


def ini_set(path, section, key, value):
    """Set one key, replacing it where it stands, or add it to its section."""
    lines = read_lines(path)
    current = None
    section_end = None
    for index, line in enumerate(lines):
        header = section_header(line)
        if header is not None:
            if current == section:
                section_end = index
                break
            current = header
            continue
        if current == section and key_of(line) == key:
            lines[index] = f"{key} = {value}"
            write_lines(path, lines)
            return
    if current == section and section_end is None:
        section_end = len(lines)
    if section_end is None:
        lines.extend(["", f"[{section}]", f"{key} = {value}", ""])
    else:
        lines.insert(section_end, f"{key} = {value}")
    write_lines(path, lines)


def ini_delete(path, section, key):
    lines = read_lines(path)
    kept = []
    current = None
    for line in lines:
        header = section_header(line)
        if header is not None:
            current = header
        if current == section and key_of(line) == key:
            continue
        kept.append(line)
    write_lines(path, kept)


def paste_audit(path, map_file):
    """Returns how many pipelines now run the filter: none means nothing changed."""
    lines = read_lines(path)
    changed = 0
    for index, line in enumerate(lines):
        key = key_of(line)
        if key is None:
            continue
        name, value = line.split("=", 1)
        words = value.split()
        if "authtoken" not in words or AUDIT_FILTER in words or len(words) < 2:
            continue
        words.insert(len(words) - 1, AUDIT_FILTER)
        lines[index] = f"{name.rstrip()} = {' '.join(words)}"
        changed += 1
    if changed and not any(section_header(line) == "filter:audit" for line in lines):
        lines.extend(
            [
                "",
                "[filter:audit]",
                "paste.filter_factory = keystonemiddleware.audit:filter_factory",
                f"audit_map_file = {map_file}",
                "",
            ]
        )
    write_lines(path, lines)
    return changed


def journal_lines(source, sink):
    for raw in source:
        raw = raw.strip()
        if not raw:
            continue
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        kept = {}
        for field in JOURNAL_FIELDS:
            value = entry.get(field)
            if isinstance(value, list):
                # journalctl writes a field holding a control character as its bytes.
                value = bytes(
                    byte for byte in value if isinstance(byte, int) and 0 <= byte < 256
                ).decode("utf-8", "replace")
                if field == "MESSAGE":
                    kept["MESSAGE_WAS_BYTES"] = True
            if value is not None:
                kept[field] = value
        sink.write(json.dumps(kept, ensure_ascii=False) + "\n")


def main(arguments):
    if not arguments:
        raise SystemExit(__doc__)
    command = arguments[0]
    if command == "ini-set" and len(arguments) == 5:
        ini_set(arguments[1], arguments[2], arguments[3], arguments[4])
    elif command == "ini-delete" and len(arguments) == 4:
        ini_delete(arguments[1], arguments[2], arguments[3])
    elif command == "paste-audit" and len(arguments) == 3:
        print(paste_audit(arguments[1], arguments[2]))
    elif command == "journal-lines" and len(arguments) == 1:
        journal_lines(sys.stdin, sys.stdout)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])

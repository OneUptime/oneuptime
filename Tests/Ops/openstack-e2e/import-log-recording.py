#!/usr/bin/env python3
"""Keep a small true part of what logs-record.sh recorded, as test fixtures.

    python3 -I import-log-recording.py <release> <recording folder> [<fixtures root>]

<recording folder> is an artifact's service-logs folder. What lands, in
packages/Common/Tests/Fixtures/OpenStack/service-logs/<release>/, is a folder of its own
because import-recording.py rewrites <release>/ whole:

    lines/<phase>.txt            one record per line as the service wrote it (JSON-escaped text)
    journal/<phase>.jsonl        the journal's own fields for those records
    otlp/<phase>.json            what a real collector sent, cut to the same scenes
    notifications/<phase>.jsonl  each notification's line, as written
    api/                         Nova's instance actions as the API answered them
    audit-filter.txt             the keystonemiddleware filter as a real service loaded it
    ids.json                     which instance is which, with no secret in it

Nothing goes in unread. A recording is what a real cloud wrote, passwords and tokens included
(logs-record.sh scrubs nothing, on purpose), and a fixture lives in a public repository. So every
value in it goes through replace_secrets below, whatever it is, and the import stops if anything
that looks like a secret survives. What it keeps of a secret is its shape, because that is what a
scrubber has to find: the fake token has the real one's length and prefix, and the fake password
sits where the real one did. So a scrub test on these fixtures still means something.

Only the standard library, because it runs on what a runner has. Run it with `-I`: what it reads
was downloaded, and that keeps the folder out of Python's import path.
"""

import gzip
import json
import os
import re
import sys

# The passwords logs-record.sh and estate.sh give the rig, which a line may hold anywhere.
RIG_SECRETS = {
    "ou-log-admin-password": "fake-admin-password",
    "ou-log-user-password": "fake-user-password",
    "ou-wrong-password": "fake-wrong-password",
    "secretadmin": "fakeadmin00",
    "secretdatabase": "fakedatabase00",
    "secretrabbit": "fakerabbit00",
    "secretservice": "fakeservice00",
    "secretmysql": "fakemysql00",
    "demo-password": "fake-demo-password",
}

# A Fernet token is 183 or more URL-safe characters, and starts gAAAAA.
FERNET = re.compile(r"gAAAAA[A-Za-z0-9_\-=]{20,4096}")
JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{5,2048}\.[A-Za-z0-9_\-]{5,4096}\.[A-Za-z0-9_\-]{0,4096}")
URL_PASSWORD = re.compile(r"(://[^:/@\s]{1,128}:)[^@/\s]{1,256}(@)")
# A key or secret by its name, in the forms oslo.log, oslo.messaging and JSON write them.
NAMED = re.compile(
    r"""(?ix)
    (['"]?(?:password|passwd|admin_pass|secret|auth_token|x-auth-token|x-subject-token|
    token_id|credential_blob|blob|partial_password_hash|private_key)['"]?\s*[:=]\s*b?['"]?)
    ([^'"\s,}\]]{1,1024})
    """
)
FAKE_FERNET_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
PRIVATE_IP = re.compile(r"\b(?:(?:10|127)\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
HOSTNAME_IN_RUNNER = re.compile(r"\b(?:fv-az|runner-|ip-\d)[A-Za-z0-9\-]{0,64}\b")

# What stays that looks like a secret and is not: the masking itself, and words about them.
ALLOWED_AFTER_NAME = ("***", "<", "fake", "None", "null", "true", "false", "[REDACTED]", "%(", "{")


def fake_of(value):
    """The same length and first characters, and nothing else of it."""
    prefix = value[:6]
    body = "".join(
        FAKE_FERNET_ALPHABET[(index * 7 + 11) % len(FAKE_FERNET_ALPHABET)]
        for index in range(len(value) - len(prefix))
    )
    return prefix + body


def replace_secrets(text):
    for secret, fake in RIG_SECRETS.items():
        text = text.replace(secret, fake)

    text = FERNET.sub(lambda match: fake_of(match.group(0)), text)
    text = JWT.sub(lambda match: fake_of(match.group(0)), text)
    text = URL_PASSWORD.sub(r"\1fake-url-password\2", text)

    def named(match):
        value = match.group(2)
        if value.startswith(ALLOWED_AFTER_NAME):
            return match.group(0)
        return match.group(1) + "fake-secret-value"

    text = NAMED.sub(named, text)

    # A runner's addresses say nothing a test needs, and are nobody's to publish.
    text = PRIVATE_IP.sub("192.0.2.10", text)
    return HOSTNAME_IN_RUNNER.sub("devstack-host", text)


def assert_clean(text, where):
    for secret in RIG_SECRETS:
        if secret in text:
            sys.exit(f"{where}: still holds a rig password. Nothing was written past this.")


def read_jsonl_gz(path):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue


def message_of(entry):
    """journalctl writes a line holding a control character as a list of bytes."""
    message = entry.get("MESSAGE", "")
    if isinstance(message, list):
        return bytes(value & 0xFF for value in message if isinstance(value, int)).decode(
            "utf-8", "replace"
        )
    return message if isinstance(message, str) else ""


# How many of each kind of line a release's fixture keeps, so a test reads a good spread and a
# pull request stays readable. Tracebacks and notifications are what is hard; INFO is not.
KEEP = {
    "traceback": 400,
    "notification": 400,
    "error": 200,
    "warning": 60,
    "info": 120,
    "debug": 40,
}

# Worth keeping whatever their level: what the alerts and the event parser look for.
WANTED_WORDS = (
    "No valid host",
    "NoValidHost",
    "AMQP server",
    "MessagingTimeout",
    "DBConnectionError",
    "OperationalError",
    "Lost connection to MySQL",
    "Can't connect to MySQL",
    "Invalid fernet",
    "Could not validate",
    "Authorization failed",
    "oslo.messaging.notification.",
)


def classify(message):
    if "oslo.messaging.notification." in message:
        return "notification"
    if "Traceback" in message or "  File \"" in message:
        return "traceback"
    head = message[:200]
    for level, key in (
        ("ERROR", "error"),
        ("CRITICAL", "error"),
        ("WARNING", "warning"),
        ("DEBUG", "debug"),
    ):
        if level in head:
            return key
    return "info"


def select_entries(entries):
    counts = {}
    for entry in entries:
        message = message_of(entry)
        if not message:
            continue
        wanted = any(word in message for word in WANTED_WORDS)
        kind = classify(message)
        counts[kind] = counts.get(kind, 0) + 1
        if wanted or counts[kind] <= KEEP.get(kind, 0):
            yield entry, message


# The journal's fields a test or the agent's config reads, and none of the rest of a machine.
JOURNAL_FIELDS = (
    "_SYSTEMD_UNIT",
    "SYSLOG_IDENTIFIER",
    "_HOSTNAME",
    "PRIORITY",
    "_PID",
    "__REALTIME_TIMESTAMP",
    "LOGGER_NAME",
    "LOGGER_LEVEL",
    "REQUEST_ID",
    "GLOBAL_REQUEST_ID",
    "PROJECT_ID",
    "PROJECT_NAME",
    "USER_ID",
    "USER_NAME",
    "EXCEPTION_INFO",
)


def write_lines(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line + "\n")


def import_journal(phase_dir, phase, out):
    source = os.path.join(phase_dir, "journal.jsonl.gz")
    if not os.path.isfile(source):
        return 0

    kept_lines = []
    kept_journal = []
    notifications = []

    for entry, message in select_entries(read_jsonl_gz(source)):
        clean = replace_secrets(message)
        assert_clean(clean, f"{phase} journal")
        kept_lines.append(json.dumps(clean))
        if "oslo.messaging.notification." in clean:
            notifications.append(json.dumps(clean))
        fields = {
            key: replace_secrets(str(entry[key]))
            for key in JOURNAL_FIELDS
            if key in entry and isinstance(entry[key], (str, int))
        }
        fields["MESSAGE"] = clean
        kept_journal.append(json.dumps(fields, sort_keys=True))

    write_lines(os.path.join(out, "lines", f"{phase}.txt"), kept_lines)
    write_lines(os.path.join(out, "journal", f"{phase}.jsonl"), kept_journal)
    write_lines(os.path.join(out, "notifications", f"{phase}.jsonl"), notifications)
    return len(kept_lines)


def import_files(phase_dir, phase, out):
    """The oslo-default phase's service log files, copied gzipped by logs-record.sh."""
    root = os.path.join(phase_dir, "files")
    if not os.path.isdir(root):
        return 0

    kept = []
    notifications = []
    for folder, _sub, names in sorted(os.walk(root)):
        for name in sorted(names):
            if not name.endswith(".gz"):
                continue
            service = os.path.relpath(os.path.join(folder, name), root)
            with gzip.open(
                os.path.join(folder, name), "rt", encoding="utf-8", errors="replace"
            ) as handle:
                counts = {}
                for raw in handle:
                    line = raw.rstrip("\n")
                    if not line:
                        continue
                    kind = classify(line)
                    counts[kind] = counts.get(kind, 0) + 1
                    wanted = any(word in line for word in WANTED_WORDS)
                    if not wanted and counts[kind] > KEEP.get(kind, 0):
                        continue
                    clean = replace_secrets(line)
                    assert_clean(clean, f"{phase} {service}")
                    kept.append(json.dumps({"file": service, "line": clean}))
                    if "oslo.messaging.notification." in clean:
                        notifications.append(json.dumps(clean))

    write_lines(os.path.join(out, "files", f"{phase}.jsonl"), kept)
    if notifications:
        write_lines(os.path.join(out, "notifications", f"{phase}.jsonl"), notifications)
    return len(kept)


def import_otlp(phase_dir, phase, out):
    """What a real collector sent: cut, because a test reads its shape and not its volume."""
    source = os.path.join(phase_dir, "otlp-logs.json")
    if not os.path.isfile(source):
        return 0

    kept = 0
    written = []
    with open(source, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            raw = raw.strip()
            if not raw:
                continue
            try:
                batch = json.loads(raw)
            except ValueError:
                continue
            for resource in batch.get("resourceLogs", []):
                for scope in resource.get("scopeLogs", []):
                    records = scope.get("logRecords", [])
                    interesting = [
                        record
                        for record in records
                        if "Traceback" in json.dumps(record.get("body", {}))
                        or "oslo.messaging.notification"
                        in json.dumps(record.get("body", {}))
                    ]
                    scope["logRecords"] = (interesting + records)[:20]
                    kept += len(scope["logRecords"])
            written.append(replace_secrets(json.dumps(batch)))
            if kept >= 200:
                break

    for line in written:
        assert_clean(line, f"{phase} otlp")

    if written:
        write_lines(os.path.join(out, "otlp", f"{phase}.jsonl"), written)
    return kept


def import_api(phase_dir, phase, out):
    source = os.path.join(phase_dir, "api")
    if not os.path.isdir(source):
        return 0

    target = os.path.join(out, "api", phase)
    count = 0
    for name in sorted(os.listdir(source)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(source, name), encoding="utf-8", errors="replace") as handle:
            clean = replace_secrets(handle.read())
        assert_clean(clean, f"{phase} api {name}")
        os.makedirs(target, exist_ok=True)
        with open(os.path.join(target, name), "w", encoding="utf-8") as handle:
            handle.write(clean)
        count += 1
    return count


def read_ids(phase_dir):
    path = os.path.join(phase_dir, "ids.env")
    ids = {}
    if not os.path.isfile(path):
        return ids
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                key, _sep, value = line.partition("=")
                ids[key.strip()] = replace_secrets(value.strip().strip("'\""))
    return ids


def read_scenes(phase_dir):
    path = os.path.join(phase_dir, "scenes.jsonl")
    scenes = []
    if not os.path.isfile(path):
        return scenes
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if line:
                try:
                    scenes.append(json.loads(replace_secrets(line)))
                except ValueError:
                    continue
    return scenes


def main(arguments):
    if len(arguments) < 2:
        sys.exit(__doc__)

    release = arguments[0]
    recording = arguments[1]
    root = (
        arguments[2]
        if len(arguments) > 2
        else os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "..",
            "..",
            "packages",
            "Common",
            "Tests",
            "Fixtures",
            "OpenStack",
        )
    )

    if not re.fullmatch(r"[a-z0-9\-]{1,40}", release):
        sys.exit(f"{release}: not a release name")

    out = os.path.join(root, "service-logs", release)
    ids = {}
    scenes = {}
    summary = {}

    for phase in sorted(os.listdir(recording)):
        phase_dir = os.path.join(recording, phase)
        if not os.path.isdir(phase_dir):
            continue
        counts = {
            "journal": import_journal(phase_dir, phase, out),
            "files": import_files(phase_dir, phase, out),
            "otlp": import_otlp(phase_dir, phase, out),
            "api": import_api(phase_dir, phase, out),
        }
        summary[phase] = counts
        ids[phase] = read_ids(phase_dir)
        scenes[phase] = read_scenes(phase_dir)

    audit = os.path.join(recording, "audit-filter.txt")
    if os.path.isfile(audit):
        with open(audit, encoding="utf-8", errors="replace") as handle:
            clean = replace_secrets(handle.read())
        assert_clean(clean, "audit-filter.txt")
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "audit-filter.txt"), "w", encoding="utf-8") as handle:
            handle.write(clean)

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "ids.json"), "w", encoding="utf-8") as handle:
        json.dump({"ids": ids, "scenes": scenes}, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(json.dumps({"release": release, "out": out, "phases": summary}, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])

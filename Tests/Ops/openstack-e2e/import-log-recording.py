#!/usr/bin/env python3
"""Keep a small true part of what logs-record.sh recorded, as test fixtures.

    python3 -I import-log-recording.py <release> <recording folder> [<fixtures root>]

<recording folder> is an artifact's service-logs folder. What lands, in
packages/Common/Tests/Fixtures/OpenStack/service-logs/<release>/, is a folder of its own
because import-recording.py rewrites <release>/ whole:

    journal/<phase>.jsonl        each kept line the journal held, with its fields, as written
    files/<phase>.jsonl          each kept line of a service's log file, in the order written
    notifications/<phase>.jsonl  each kept notification's whole line, as written (JSON text)
    otlp/<phase>.jsonl           records a real collector sent, one to a line, in OTLP's shape
    failures/<phase>.jsonl       every record a real collector sent saying something failed
    api/<phase>/                 Nova's instance actions as the API answered them
    audit-filter.txt             the keystonemiddleware filter as a real service loaded it
    ids.json                     which instance is which, and when each scene ran

What is kept is chosen, so a test reads a good spread and a pull request stays readable:

  - every line of the requests that built the instances the scenes broke, and every line naming
    them, so a test can follow a failure across services as a person would, with DEBUG lines
    only a few at a time because they are dropped by default;
  - every failure that an alert reads, in failures/, so a test can replay an outage in time;
  - a few notifications of each kind, kept by what kind says apart: an event's type, and for an
    audit event its outcome and what it was about;
  - a few of every other kind of line.

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
    "ou-log-credential-blob": "fake-credential-blob",
    "ou-log-hash-secret": "fake-hash-secret",
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
# A hosted runner's own names, in both the forms Nova uses for a machine: a test reads the two.
RUNNER_FULL_NAME = re.compile(r"\brunnervm[a-z0-9]{1,64}\.[a-z0-9.\-]{1,128}\.cloudapp\.net\b")
HOSTNAME_IN_RUNNER = re.compile(r"\b(?:fv-az|runner-|runnervm|ip-\d)[A-Za-z0-9\-]{0,64}\b")

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
    text = RUNNER_FULL_NAME.sub("devstack-host.example.internal", text)
    return HOSTNAME_IN_RUNNER.sub("devstack-host", text)


# What a real token looks like past the fake's alphabet: fake_of writes a stretch that repeats.
FAKE_BODY = "".join(
    FAKE_FERNET_ALPHABET[(index * 7 + 11) % len(FAKE_FERNET_ALPHABET)] for index in range(32)
)


def assert_clean(text, where):
    for secret in RIG_SECRETS:
        if secret in text:
            sys.exit(f"{where}: still holds a rig password. Nothing was written past this.")
    for match in FERNET.finditer(text):
        if FAKE_BODY[:20] not in match.group(0):
            sys.exit(f"{where}: still holds a token. Nothing was written past this.")
    if RUNNER_FULL_NAME.search(text):
        sys.exit(f"{where}: still holds a runner's name. Nothing was written past this.")


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


# How many of each kind of line a phase keeps. Tracebacks are what is hard, and INFO is not.
KEEP = {
    "traceback": 120,
    "error": 60,
    "warning": 40,
    "info": 60,
    "debug": 30,
}

# How many lines at DEBUG a traced request keeps: they are dropped by default, so few are read.
KEEP_TRACED_DEBUG = 30

# How many notifications of one kind a phase keeps.
KEEP_NOTIFICATION = 3
KEEP_IDENTITY_NOTIFICATION = 14

# Worth keeping whatever their level: what the alerts look for.
WANTED_WORDS = (
    "No valid host",
    "NoValidHost",
    "no allocation candidates",
    "Filtering removed all hosts",
    "AMQP server",
    "MessagingTimeout",
    "DBConnectionError",
    "OperationalError",
    "Lost connection to MySQL",
    "Can't connect to MySQL",
    "ernet token",
    "Could not validate",
    "Failed to validate",
    "validate token",
    "Authorization failed",
    "Identity response",
    "Failed to fetch token",
)
KEEP_WANTED = 40

# The ids.env keys of what a scene broke, whose requests a test follows.
TRACED_KEYS = (
    "instance_no_valid_host",
    "instance_spawn_failed",
    "instance_rebuild_failed",
    "volume_failed",
)

REQUEST_ID = re.compile(r"req-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
NOTIFICATION_LOGGER = "oslo.messaging.notification."
LEVELS = ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG")


def is_traceback_line(message):
    return "Traceback (most recent call last)" in message or '  File "' in message


def level_of(message):
    """The level at the start of a line, past its time and process if it has them."""
    head = ANSI.sub("", message[:200])
    for level in LEVELS:
        if head.startswith(level + " ") or f" {level} " in head[:45]:
            return level
    return ""


def notification_kind(message):
    """What tells one notification from another: its type, and an audit event's own words."""
    at = message.find(NOTIFICATION_LOGGER)
    if at == -1:
        return None
    rest = message[at + len(NOTIFICATION_LOGGER) :]
    event = rest.split(" ", 1)[0]
    if event.startswith("audit.") or event.startswith("identity."):
        words = []
        for name in ('"outcome": "', '"action": "', '"typeURI": "'):
            found = message.rfind(name)
            words.append(message[found + len(name) : found + len(name) + 40].split('"')[0] if found != -1 else "")
        return "/".join([event] + words)
    return event


class Chooser:
    """Decides which lines of one phase stay, reading them all first."""

    def __init__(self, messages, traced_ids):
        self.counts = {}
        self.traced_ids = traced_ids
        self.requests = set()
        for message in messages:
            if any(one in message for one in traced_ids):
                self.requests.update(REQUEST_ID.findall(message[:400]))

    def count(self, key, limit):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key] <= limit

    def keeps(self, message):
        kind = notification_kind(message)
        if kind is not None:
            limit = KEEP_IDENTITY_NOTIFICATION if kind.startswith("identity.") else KEEP_NOTIFICATION
            traced = any(one in message for one in self.traced_ids)
            return self.count(("notification", kind), 12 if traced else limit)

        level = level_of(message)
        if any(one in message for one in self.traced_ids):
            return level != "DEBUG" or self.count("traced debug", KEEP_TRACED_DEBUG)
        if self.requests and set(REQUEST_ID.findall(message[:400])) & self.requests:
            return level != "DEBUG" or self.count("traced debug", KEEP_TRACED_DEBUG)
        for word in WANTED_WORDS:
            if word in message and level != "DEBUG":
                return self.count(("wanted", word), KEEP_WANTED)
        if is_traceback_line(message) or (level == "ERROR" and "[" not in message[:90]):
            return self.count("traceback", KEEP["traceback"])
        return self.count(level.lower() or "other", KEEP.get(level.lower(), 20))


def traced_ids_of(phase_dir):
    ids = read_ids(phase_dir)
    return [ids[key] for key in TRACED_KEYS if ids.get(key)]


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

    entries = [
        (entry, message_of(entry)) for entry in read_jsonl_gz(source) if message_of(entry)
    ]
    chooser = Chooser([message for _entry, message in entries], traced_ids_of(phase_dir))
    kept_journal = []
    notifications = []

    for entry, message in entries:
        if not chooser.keeps(message):
            continue
        clean = replace_secrets(message)
        assert_clean(clean, f"{phase} journal")
        if NOTIFICATION_LOGGER in clean:
            notifications.append(json.dumps(clean))
            continue
        fields = {
            key: replace_secrets(str(entry[key]))
            for key in JOURNAL_FIELDS
            if key in entry and isinstance(entry[key], (str, int))
        }
        for value in fields.values():
            assert_clean(value, f"{phase} journal field")
        fields["MESSAGE"] = clean
        kept_journal.append(json.dumps(fields, sort_keys=True))

    write_lines(os.path.join(out, "journal", f"{phase}.jsonl"), kept_journal)
    write_lines(os.path.join(out, "notifications", f"{phase}.jsonl"), notifications)
    return len(kept_journal) + len(notifications)


def import_files(phase_dir, phase, out):
    """The oslo-default phase's service log files, copied gzipped by logs-record.sh."""
    root = os.path.join(phase_dir, "files")
    if not os.path.isdir(root):
        return 0

    every = []
    for folder, _sub, names in sorted(os.walk(root)):
        for name in sorted(names):
            if not name.endswith(".gz"):
                continue
            service = os.path.relpath(os.path.join(folder, name), root)
            with gzip.open(
                os.path.join(folder, name), "rt", encoding="utf-8", errors="replace"
            ) as handle:
                for raw in handle:
                    line = raw.rstrip("\n")
                    if line:
                        every.append((service, line))

    chooser = Chooser([line for _service, line in every], traced_ids_of(phase_dir))
    kept = []
    notifications = []
    for service, line in every:
        if not chooser.keeps(line):
            continue
        clean = replace_secrets(line)
        assert_clean(clean, f"{phase} {service}")
        if NOTIFICATION_LOGGER in clean:
            notifications.append(json.dumps({"file": service, "line": clean}))
        else:
            kept.append(json.dumps({"file": service, "line": clean}))

    write_lines(os.path.join(out, "files", f"{phase}.jsonl"), kept)
    if notifications:
        write_lines(os.path.join(out, "notifications", f"{phase}-files.jsonl"), notifications)
    return len(kept) + len(notifications)


# How much of a failure's record a replay keeps: a failure says what it is on its first line.
FAILURE_BODY_LENGTH = 640


def attributes_of(items):
    found = {}
    for item in items or []:
        value = item.get("value", {})
        for kind in ("stringValue", "intValue"):
            if kind in value:
                found[item.get("key", "")] = str(value[kind])
    return found


def import_otlp(phase_dir, phase, out):
    """What a real collector sent: its shape, and for a replay every failure it said, in time."""
    source = os.path.join(phase_dir, "otlp-logs.json")
    if not os.path.isfile(source):
        return 0

    samples = []
    failures = []
    counts = {}

    def sample(key, limit):
        counts[key] = counts.get(key, 0) + 1
        return counts[key] <= limit

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
                    for record in scope.get("logRecords", []):
                        body = record.get("body", {}).get("stringValue", "")
                        level = level_of(body)
                        if level in ("ERROR", "CRITICAL") or (
                            level == "WARNING" and any(word in body for word in WANTED_WORDS)
                        ):
                            failures.append(
                                {
                                    "time": record.get("timeUnixNano", ""),
                                    "attributes": attributes_of(record.get("attributes")),
                                    "body": body[:FAILURE_BODY_LENGTH],
                                }
                            )
                        if "Traceback (most recent call last)" in body:
                            keep = sample("traceback", 8)
                        elif NOTIFICATION_LOGGER in body:
                            kind = body[body.find(NOTIFICATION_LOGGER) :].split(" ", 1)[0]
                            keep = (
                                not kind.endswith(("audit.http.request", "audit.http.response"))
                                and sample(kind, 1)
                                and sample("notification", 12)
                            )
                        else:
                            keep = sample(level or "other", 8)
                        if keep:
                            samples.append(
                                {
                                    "resource": {"attributes": resource.get("resource", {}).get("attributes", [])},
                                    "record": record,
                                }
                            )

    lines = [replace_secrets(json.dumps(sample_line)) for sample_line in samples]
    for line in lines:
        assert_clean(line, f"{phase} otlp")
    if lines:
        write_lines(os.path.join(out, "otlp", f"{phase}.jsonl"), lines)

    # An outage is told by the phase that broke things on purpose.
    if phase == "devstack":
        failure_lines = [replace_secrets(json.dumps(failure)) for failure in failures]
        for line in failure_lines:
            assert_clean(line, f"{phase} failures")
        write_lines(os.path.join(out, "failures", f"{phase}.jsonl"), failure_lines)

    return len(lines)


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

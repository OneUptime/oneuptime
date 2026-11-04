#!/usr/bin/env python3
"""Keep a small true part of what traces-record.sh recorded, as test fixtures.

    python3 -I import-trace-recording.py <release> <recording folder> [<fixtures root>]

<recording folder> is an artifact's traces folder. What lands, in
packages/Common/Tests/Fixtures/OpenStack/traces/<release>/, is a folder of its own because
import-recording.py rewrites <release>/ whole:

    driver/<scene>.json     what the driver sent for that scene's traces, as OTLP
    agent/<scene>.json      what the agent's traces profile would have sent for them
    journal/<scene>.jsonl   what the services logged while that scene ran
    scenes.json             every scene: how long it took, its exit code, its Trace IDs, its spans
    summary.json            each scene's trace, service by service, with its spans and bytes
    context/                what the cloud says each instance is, and its request IDs
    versions.txt            what this release runs
    profiler-conf.txt       the [profiler] section, without the key
    key-check.txt           how many times the key was found in each recorded file
    driver-log-lines.txt    every line a service logged about OSProfiler or its driver

Nothing goes in unread. A span holds what a traced call was handed, written out as Python
would print it, and a fixture lives in a public repository. So every string in it goes through
import-log-recording.py's replace_secrets, and what a call was handed is also cut short: a test
needs to see that those attributes come off, and their shape, and not a whole Instance's repr.
It stops if the HMAC key's own check says a key survived.

Only the standard library. Run it with `-I`: what it reads was downloaded, and that keeps the
folder out of Python's import path.
"""

import gzip
import importlib.util
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FIXTURES = os.path.join(HERE, "..", "..", "..", "packages", "Common", "Tests", "Fixtures", "OpenStack")

# The scenes a test reads whole. A boot with every SQL statement in it says what it costs in
# its summary, and a sample of it says what a statement's span looks like.
WHOLE_SCENES = (
    "signed-list",
    "signed-boot",
    "signed-show",
    "signed-boot-failed",
    "signed-volume",
    "signed-network",
    "signed-image",
    "signed-token",
    "signed-delete",
    "signed-boot-requests",
)
SAMPLED_SCENES = {"signed-boot-sql": 60}
AGENT_SCENES = ("signed-boot", "signed-boot-failed")
JOURNAL_SCENES = ("signed-boot", "signed-boot-failed")

# What a call was handed, cut to this. Its shape is what a test reads.
HANDED_ATTRIBUTES = ("args", "kwargs", "result", "db.params")
HANDED_KEPT_CHARACTERS = 300

MAX_JOURNAL_LINE_CHARACTERS = 2000
DRIVER_LOG_WORDS = ("osprofiler", "OSProfiler", "profiler", "opentelemetry", "OTLP", "otlp")


def load_replace_secrets():
    """The same scrubbing the logs' fixtures get, so there is one list of what a secret is."""
    path = os.path.join(HERE, "import-log-recording.py")
    spec = importlib.util.spec_from_file_location("import_log_recording", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.replace_secrets, module.read_jsonl_gz, module.message_of


REPLACE_SECRETS, READ_JSONL_GZ, MESSAGE_OF = load_replace_secrets()


def scrubbed(value):
    if isinstance(value, str):
        return REPLACE_SECRETS(value)
    if isinstance(value, list):
        return [scrubbed(item) for item in value]
    if isinstance(value, dict):
        return {key: scrubbed(item) for key, item in value.items()}
    return value


def read_exports(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                continue


def recording(folder, name):
    plain = os.path.join(folder, name)
    return plain if os.path.exists(plain) else plain + ".gz"


def cut_handed(span):
    """What a call was handed keeps its key and its first words."""
    for attribute in span.get("attributes", []):
        if attribute.get("key") in HANDED_ATTRIBUTES:
            value = attribute.get("value", {})
            text = value.get("stringValue")
            if isinstance(text, str) and len(text) > HANDED_KEPT_CHARACTERS:
                value["stringValue"] = text[:HANDED_KEPT_CHARACTERS] + "… (cut by import-trace-recording.py)"


def spans_of_traces(path, trace_ids, limit=None):
    """The exports' resource blocks, holding only these traces' spans, with what they say scrubbed."""
    blocks = []
    kept = 0
    for export in read_exports(path):
        for block in export.get("resourceSpans", []):
            scope_blocks = []
            for scope_block in block.get("scopeSpans", []):
                spans = [
                    span
                    for span in scope_block.get("spans", [])
                    if span.get("traceId") in trace_ids
                ]
                if limit is not None:
                    spans = spans[: max(0, limit - kept)]
                if not spans:
                    continue
                kept += len(spans)
                for span in spans:
                    cut_handed(span)
                scope_blocks.append({**scope_block, "spans": spans})
            if scope_blocks:
                blocks.append({**block, "scopeSpans": scope_blocks})
    return {"resourceSpans": scrubbed(blocks)}, kept


def trace_hex(trace_id):
    return trace_id.replace("-", "").lower()


def journal_lines(folder, started_at, ended_at):
    """What each unit wrote while a scene ran, by the journal's own time."""
    path = os.path.join(folder, "journal.jsonl.gz")
    if not os.path.exists(path):
        return
    for entry in READ_JSONL_GZ(path):
        at = int(entry.get("__REALTIME_TIMESTAMP", 0) or 0) / 1e6
        if started_at <= at <= ended_at:
            message = MESSAGE_OF(entry)[:MAX_JOURNAL_LINE_CHARACTERS]
            yield {
                "time": at,
                "unit": entry.get("_SYSTEMD_UNIT", ""),
                "message": REPLACE_SECRETS(message),
            }


def epoch(iso_time):
    import datetime

    return datetime.datetime.strptime(iso_time, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=datetime.timezone.utc
    ).timestamp()


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    release = sys.argv[1]
    folder = sys.argv[2]
    root = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_FIXTURES
    out = os.path.join(root, "traces", release)

    key_check = os.path.join(folder, "key-check.txt")
    if not os.path.exists(key_check):
        sys.exit(f"{key_check} is not there: the rig did not finish removing its key.")

    shutil.rmtree(out, ignore_errors=True)
    for name in ("driver", "agent", "journal", "context"):
        os.makedirs(os.path.join(out, name))

    with open(os.path.join(folder, "scenes.jsonl"), encoding="utf-8") as handle:
        scenes = [json.loads(line) for line in handle if line.strip()]
    with open(os.path.join(out, "scenes.json"), "w", encoding="utf-8") as handle:
        json.dump(scenes, handle, indent=1, sort_keys=True)
        handle.write("\n")

    by_name = {scene["scene"]: scene for scene in scenes}
    driver_path = recording(folder, "otlp-driver.json")
    agent_path = recording(folder, "otlp-agent.json")

    for name in list(WHOLE_SCENES) + list(SAMPLED_SCENES):
        scene = by_name.get(name)
        if not scene:
            print(f"{release}: no scene {name}")
            continue
        trace_ids = {trace_hex(trace) for trace in scene.get("traceIds", [])}
        document, kept = spans_of_traces(driver_path, trace_ids, SAMPLED_SCENES.get(name))
        with open(os.path.join(out, "driver", f"{name}.json"), "w", encoding="utf-8") as handle:
            json.dump(document, handle)
            handle.write("\n")
        print(f"{release}: {name}: {kept} spans")
        if name in AGENT_SCENES:
            document, _ = spans_of_traces(agent_path, trace_ids)
            with open(os.path.join(out, "agent", f"{name}.json"), "w", encoding="utf-8") as handle:
                json.dump(document, handle)
                handle.write("\n")

    for name in JOURNAL_SCENES:
        scene = by_name.get(name)
        if not scene:
            continue
        # A service logs a call as it ends, so a few seconds past the scene's own end.
        lines = journal_lines(folder, epoch(scene["startedAt"]) - 1, epoch(scene["endedAt"]) + 5)
        with open(os.path.join(out, "journal", f"{name}.jsonl"), "w", encoding="utf-8") as handle:
            for line in lines:
                handle.write(json.dumps(line) + "\n")

    with open(os.path.join(out, "driver-log-lines.txt"), "w", encoding="utf-8") as handle:
        path = os.path.join(folder, "journal.jsonl.gz")
        seen = set()
        if os.path.exists(path):
            for entry in READ_JSONL_GZ(path):
                message = MESSAGE_OF(entry)
                if any(word in message for word in DRIVER_LOG_WORDS) and "connection_string" not in message:
                    text = REPLACE_SECRETS(message)[:400]
                    if text not in seen:
                        seen.add(text)
                        handle.write(f"{entry.get('_SYSTEMD_UNIT', '')}: {text}\n")

    for name in ("summary.json", "versions.txt", "profiler-conf.txt", "key-check.txt", "check.txt"):
        source = os.path.join(folder, name)
        if os.path.exists(source):
            with open(source, encoding="utf-8", errors="replace") as handle:
                text = REPLACE_SECRETS(handle.read())
            with open(os.path.join(out, name), "w", encoding="utf-8") as handle:
                handle.write(text)

    context = os.path.join(folder, "context")
    if os.path.isdir(context):
        for name in sorted(os.listdir(context)):
            with open(os.path.join(context, name), encoding="utf-8", errors="replace") as handle:
                text = REPLACE_SECRETS(handle.read())
            with open(os.path.join(out, "context", name), "w", encoding="utf-8") as handle:
                handle.write(text)

    print(f"{release}: wrote {out}")


if __name__ == "__main__":
    main()

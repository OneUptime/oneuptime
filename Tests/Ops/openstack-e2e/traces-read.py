#!/usr/bin/env python3
"""Read what traces-record.sh recorded, on the runner, with the standard library alone.

    traces-read.py count FILE
    traces-read.py summary TRACES_DIR
    traces-read.py check TRACES_DIR
    traces-read.py native TRACES_DIR
    OU_TRACES_KEY=... traces-read.py remove-key TRACES_DIR

count says how many spans a recording file holds so far, so a scene can say whether it
made any. A file that is not there yet holds none: the collector only makes one when the
first span arrives, which is the point of the scenes that expect none.

summary writes summary.json: what each scene's trace held, service by service. Its span
counts and bytes are what the guide's costs are read from.

check is the issue's "done when", on this run: a signed boot made one trace across Nova's API
and compute service, Neutron, Keystone and Glance, tied to the instance it made, and the
scenes that should have made no spans made none. Stock Placement sends nothing, and a release
where it does fails this on purpose, because the guide then says something untrue. Placement
is in the trace once the guide's one line is applied, and Nova's conductor and scheduler are
once they run one worker each, and that is held too. It exits non-zero when any of that is
not so, which fails the step without costing the steps after it.

native writes native-summary.json: what the scenes with nothing signed made of OpenStack's own
OpenTelemetry tracing, where a release ships it. They print no Trace ID, so they are read by
their moments.

remove-key replaces the HMAC key wherever it turned up in the recording, so it never
leaves the runner, and writes down how many times it was found in each file. A count over
zero is a finding, not a failure: it says what the key can reach.
"""
import datetime
import gzip
import json
import os
import sys

DRIVER_SCOPE = "osprofiler.drivers.otlp"
# What a stock boot crosses, by the driver's own service.name: every service that answers one
# of a boot's HTTP calls from a process that made its driver itself, and nova-compute.
BOOT_MUST_CROSS = (
    "nova-osapi_compute",
    "nova-nova-compute",
    "neutron-neutron-server",
    "keystone-public",
    "glance-api",
)
PLACEMENT = "placement-placement"
CONDUCTOR = "nova-nova-conductor"
SCHEDULER = "nova-nova-scheduler"
# What each scene with something changed has to add to that, once it has run. The scenes come
# and go with what a release can do, so only one that ran is held to anything.
SCENE_MUST_CROSS = {
    "signed-boot-placement": (PLACEMENT,),
    "signed-boot-whole": (PLACEMENT, CONDUCTOR, SCHEDULER),
    "signed-boot-failed-whole": (CONDUCTOR, SCHEDULER),
    "signed-boot-osprofiler-fix": (PLACEMENT,),
}
# How long past a scene's end its spans are still arriving: the driver sends in batches.
NATIVE_SCENE_MARGIN_SECONDS = 15


def read_recording(path):
    """Each line the file exporter wrote is one OTLP export, as JSON."""
    if not os.path.exists(path):
        return
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                # The last line of a file the collector is still writing.
                continue


def attribute_value(value):
    for key in ("stringValue", "intValue", "doubleValue", "boolValue"):
        if key in value:
            return value[key]
    return None


def attributes_of(item):
    return {a["key"]: attribute_value(a.get("value", {})) for a in item.get("attributes", [])}


def spans_in(path):
    """(service.name, scope name, span) for every span in a recording file."""
    for export in read_recording(path):
        for resource_spans in export.get("resourceSpans", []):
            service = attributes_of(resource_spans.get("resource", {})).get("service.name", "")
            for scope_spans in resource_spans.get("scopeSpans", []):
                scope = scope_spans.get("scope", {}).get("name", "")
                for span in scope_spans.get("spans", []):
                    yield service, scope, span


def recording_path(traces_dir, name):
    plain = os.path.join(traces_dir, name)
    return plain if os.path.exists(plain) else plain + ".gz"


def read_scenes(traces_dir):
    path = os.path.join(traces_dir, "scenes.jsonl")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def read_ids(traces_dir):
    ids = {}
    path = os.path.join(traces_dir, "ids.env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                if "=" in line:
                    key, value = line.strip().split("=", 1)
                    ids[key] = value
    return ids


def trace_hex(trace_id):
    return trace_id.replace("-", "").lower()


def spans_by_trace(path):
    traces = {}
    for service, scope, span in spans_in(path):
        traces.setdefault(span.get("traceId", ""), []).append((service, scope, span))
    return traces


def describe_trace(spans):
    services = {}
    ids = {span.get("spanId") for _, _, span in spans}
    roots = 0
    dangling = 0
    starts = []
    ends = []
    for service, _, span in spans:
        services[service] = services.get(service, 0) + 1
        parent = span.get("parentSpanId", "")
        if not parent:
            roots += 1
        elif parent not in ids:
            dangling += 1
        starts.append(int(span.get("startTimeUnixNano", 0)))
        ends.append(int(span.get("endTimeUnixNano", 0)))
    return {
        "spans": len(spans),
        "bytes": sum(len(json.dumps(span)) for _, _, span in spans),
        "services": dict(sorted(services.items())),
        "spansWithNoParent": roots,
        "spansWhoseParentIsNotInTheTrace": dangling,
        "seconds": round((max(ends) - min(starts)) / 1e9, 3) if spans else 0,
    }


def summary(traces_dir):
    driver = spans_by_trace(recording_path(traces_dir, "otlp-driver.json"))
    agent = spans_by_trace(recording_path(traces_dir, "otlp-agent.json"))
    out = {"scenes": [], "tracesNoSceneNamed": []}
    named = set()
    for scene in read_scenes(traces_dir):
        row = dict(scene)
        row["traces"] = []
        for trace_id in scene.get("traceIds", []):
            key = trace_hex(trace_id)
            named.add(key)
            row["traces"].append(
                {
                    "traceId": key,
                    "driver": describe_trace(driver.get(key, [])),
                    "agentBytes": sum(len(json.dumps(s)) for _, _, s in agent.get(key, [])),
                }
            )
        out["scenes"].append(row)
    for key, spans in driver.items():
        if key not in named:
            out["tracesNoSceneNamed"].append({"traceId": key, "driver": describe_trace(spans)})
    with open(os.path.join(traces_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=2, sort_keys=True)
        handle.write("\n")
    for scene in out["scenes"]:
        for trace in scene["traces"]:
            described = trace["driver"]
            print(
                f"{scene['scene']}: {described['spans']} spans, {described['bytes']} bytes, "
                f"{described['seconds']}s, across {', '.join(described['services']) or 'nothing'}"
            )


def check(traces_dir):
    problems = []
    scenes = {scene["scene"]: scene for scene in read_scenes(traces_dir)}
    driver = spans_by_trace(recording_path(traces_dir, "otlp-driver.json"))
    ids = read_ids(traces_dir)

    boot = scenes.get("signed-boot")
    if not boot:
        problems.append("There is no signed-boot scene.")
    elif boot.get("exitCode") != 0:
        problems.append(f"The signed boot exited {boot.get('exitCode')}.")
    elif not boot.get("traceIds"):
        problems.append("The signed boot printed no Trace ID.")
    else:
        key = trace_hex(boot["traceIds"][-1])
        spans = driver.get(key, [])
        if not spans:
            problems.append(f"The signed boot's trace {key} has no spans.")
        services = {service for service, _, _ in spans}
        for name in BOOT_MUST_CROSS:
            if name not in services:
                problems.append(f"The signed boot's trace has no {name} span: {sorted(services)}.")
        if PLACEMENT in services:
            problems.append(
                "Stock Placement sent spans, so the guide's line about it is out of date on this release."
            )
        for name in (CONDUCTOR, SCHEDULER):
            print(f"Stock {name}: {'in' if name in services else 'not in'} the signed boot's trace.")
        instance = ids.get("instance_booted", "")
        if not instance:
            problems.append("No instance id was remembered for the signed boot.")
        else:
            mentions = 0
            for _, _, span in spans:
                attributes = attributes_of(span)
                for name in ("http.path", "http.query"):
                    if instance in str(attributes.get(name, "")):
                        mentions += 1
                        break
            print(f"The boot's trace names its instance in the path or query of {mentions} spans.")
            if mentions == 0:
                problems.append("The boot's trace never names its instance in a path or query.")
        wrong_scope = {scope for _, scope, _ in spans if scope != DRIVER_SCOPE}
        if wrong_scope:
            problems.append(f"Spans from another scope than the driver's: {sorted(wrong_scope)}.")

    for name, wanted in SCENE_MUST_CROSS.items():
        scene = scenes.get(name)
        if not scene:
            continue
        if scene.get("exitCode") != 0:
            problems.append(f"{name} exited {scene.get('exitCode')}.")
        if not scene.get("traceIds"):
            problems.append(f"{name} printed no Trace ID.")
            continue
        services = {service for service, _, _ in driver.get(trace_hex(scene["traceIds"][0]), [])}
        for service in wanted:
            if service not in services:
                problems.append(f"{name}'s trace has no {service} span: {sorted(services)}.")

    for name, scene in scenes.items():
        if scene.get("expectsNoSpans") and scene.get("spansMade", 0) != 0:
            problems.append(f"{name} should have made no spans, and made {scene.get('spansMade')}.")
        if scene.get("mustSucceed") and scene.get("exitCode") != 0:
            problems.append(f"{name} should have succeeded, and exited {scene.get('exitCode')}.")

    with open(os.path.join(traces_dir, "check.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(problems) + "\n" if problems else "Everything held.\n")
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


def epoch_of(iso_time):
    return (
        datetime.datetime.strptime(iso_time, "%Y-%m-%dT%H:%M:%SZ")
        .replace(tzinfo=datetime.timezone.utc)
        .timestamp()
    )


def word_without_ids(name):
    """A span's name, the same each time: an id in it would make every one its own."""
    words = []
    for word in name.split("/"):
        if len(word) == 36 and word.count("-") == 4:
            words.append("{id}")
        elif len(word) == 32 and all(c in "0123456789abcdefABCDEF" for c in word):
            words.append("{id}")
        else:
            words.append(word)
    return "/".join(words)


def native(traces_dir):
    """What each native scene made, read by its moments."""
    path = recording_path(traces_dir, "otlp-driver.json")
    spans = list(spans_in(path))
    out = {}
    for scene in read_scenes(traces_dir):
        name = scene.get("scene", "")
        if not name.startswith("native-"):
            continue
        since = epoch_of(scene["startedAt"]) - 1
        until = epoch_of(scene["endedAt"]) + NATIVE_SCENE_MARGIN_SECONDS
        names = {}
        scopes = {}
        attribute_keys = {}
        traces = {}
        request_ids = set()
        for service, scope, span in spans:
            at = int(span.get("startTimeUnixNano", 0)) / 1e9
            if at < since or at > until:
                continue
            attributes = attributes_of(span)
            row = f"{scope} | {service} | {span.get('kind')} | {word_without_ids(span.get('name', ''))}"
            names[row] = names.get(row, 0) + 1
            scopes[scope] = scopes.get(scope, 0) + 1
            for key in attributes:
                scoped = f"{scope} | {key}"
                attribute_keys[scoped] = attribute_keys.get(scoped, 0) + 1
            traces.setdefault(span.get("traceId", ""), set()).add(service)
            for key in ("openstack.request_id", "openstack.global_request_id"):
                if attributes.get(key):
                    request_ids.add(str(attributes[key]))
        out[name] = {
            "seconds": scene.get("seconds"),
            "exitCode": scene.get("exitCode"),
            "spans": sum(scopes.values()),
            "spansByScope": dict(sorted(scopes.items())),
            "traces": len(traces),
            "tracesAcrossServices": sum(1 for services in traces.values() if len(services) > 1),
            "servicesInOneTrace": max((len(services) for services in traces.values()), default=0),
            "requestIdsOnSpans": sorted(request_ids)[:50],
            "attributeKeys": dict(sorted(attribute_keys.items())),
            "names": dict(sorted(names.items(), key=lambda item: -item[1])[:120]),
        }
    with open(os.path.join(traces_dir, "native-summary.json"), "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=2, sort_keys=True)
        handle.write("\n")
    for name, summary_of_scene in out.items():
        print(
            f"{name}: {summary_of_scene['spans']} spans, {summary_of_scene['traces']} traces, "
            f"{summary_of_scene['tracesAcrossServices']} across services, {summary_of_scene['spansByScope']}"
        )


def remove_key(traces_dir):
    key = os.environ.get("OU_TRACES_KEY", "")
    if not key:
        print("No key to look for.", file=sys.stderr)
        return 1
    needle = key.encode()
    found = {}
    for folder, _, names in os.walk(traces_dir):
        for name in names:
            path = os.path.join(folder, name)
            compressed = name.endswith(".gz")
            opener = gzip.open if compressed else open
            with opener(path, "rb") as handle:
                data = handle.read()
            count = data.count(needle)
            found[os.path.relpath(path, traces_dir)] = count
            if count:
                with opener(path, "wb") as handle:
                    handle.write(data.replace(needle, b"<hmac-key>"))
    with open(os.path.join(traces_dir, "key-check.txt"), "w", encoding="utf-8") as handle:
        handle.write("How many times the HMAC key was found in each recorded file, before it was removed.\n")
        for path, count in sorted(found.items()):
            handle.write(f"{count} {path}\n")
    print(f"The key turned up in {sum(1 for c in found.values() if c)} of {len(found)} files.")
    return 0


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "count":
        print(sum(1 for _ in spans_in(sys.argv[2])))
        return 0
    if command == "summary":
        summary(sys.argv[2])
        return 0
    if command == "check":
        return check(sys.argv[2])
    if command == "native":
        native(sys.argv[2])
        return 0
    if command == "remove-key":
        return remove_key(sys.argv[2])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

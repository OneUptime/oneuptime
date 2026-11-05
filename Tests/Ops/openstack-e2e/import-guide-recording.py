#!/usr/bin/env python3
"""Keep what the tests replay of a guide followed on a real deployment.

    gh run download <run id> --name openstack-recording-kolla-aio --dir /tmp/kolla
    python3 -I import-guide-recording.py kolla-aio /tmp/kolla

Writes packages/Common/Tests/Fixtures/OpenStack/<name>/:

    healthy/exporter/          what the agent's exporter said about this cloud, per service
    healthy/exporter-stable/   the same from exporter 1.7.0, with --multi-cloud
    healthy/exporter-kolla/    what the exporter the tool runs itself said, on /metrics
    otlp/<part>.json           what the agent really sent, per way of running it: each series
                               once, as of the last scrape the recording holds
    deployment/                the tool's own files, how long each step took, and what the
                               guide's commands printed
    logs/<part>.json           the first records each logs profile really sent

and, because the Alertmanager flow test reads every folder there,
Fixtures/OpenStack/alertmanager/<name>-<alert>/{firing,resolved}.json: each kept as it arrived
but for the runner's name.

A recording names its own runner and its own IDs. This gives the runner one stable name, as
import-recording.py does, so a refresh is not a diff of the whole folder. Standard library only,
and it reads a recording as data: nothing in one is run.
"""
import importlib.util
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "..", "..", "..", "packages", "Common", "Tests", "Fixtures", "OpenStack")

spec = importlib.util.spec_from_file_location("import_recording", os.path.join(HERE, "import-recording.py"))
recording_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recording_tools)

SERVICES = recording_tools.SERVICES
rename = recording_tools.rename
copy_text = recording_tools.copy_text

# The tool's own files that say what a guide's claims were checked against. Each only if there.
DEPLOYMENT_FILES = (
    "control-plane-targets.txt",
    "containers.txt",
    "docker-daemon.json",
    "endpoints.txt",
    "exporter-config.json",
    "exporter-env.txt",
    "globals-rig.yml",
    "images.txt",
    "prometheus-after-rules.yml",
    "prometheus-alertmanager.yml",
    "prometheus.yml",
    "service-types.txt",
    "timings.txt",
    "user_variables.yml",
    "versions.txt",
)

# How many of each logs profile's records to keep: enough to see every shape it sends.
LOG_RECORDS_TO_KEEP = 40


def series_key(datapoint):
    return json.dumps(sorted((item["key"], json.dumps(item["value"], sort_keys=True)) for item in datapoint.get("attributes", [])))


def distilled_otlp(path):
    """Each series once, as of the last time the recording holds it, in one export."""
    resource = None
    scope = None
    metrics = {}
    with open(path, errors="replace") as handle:
        for line in handle:
            try:
                export = json.loads(line)
            except ValueError:
                continue
            for resource_metrics in export.get("resourceMetrics", []):
                resource = resource_metrics.get("resource", resource)
                for scope_metrics in resource_metrics.get("scopeMetrics", []):
                    scope = scope_metrics.get("scope", scope)
                    for metric in scope_metrics.get("metrics", []):
                        kept = metrics.setdefault(
                            metric["name"],
                            {"metric": {k: v for k, v in metric.items() if k not in ("gauge", "sum", "histogram", "summary")}, "kind": None, "extra": {}, "points": {}},
                        )
                        for kind in ("gauge", "sum"):
                            if kind in metric:
                                kept["kind"] = kind
                                kept["extra"] = {k: v for k, v in metric[kind].items() if k != "dataPoints"}
                                for point in metric[kind].get("dataPoints", []):
                                    kept["points"][series_key(point)] = point
    out = []
    for name in sorted(metrics):
        kept = metrics[name]
        if not kept["kind"]:
            continue
        metric = dict(kept["metric"])
        metric[kept["kind"]] = dict(kept["extra"], dataPoints=[kept["points"][key] for key in sorted(kept["points"])])
        out.append(metric)
    return {"resourceMetrics": [{"resource": resource or {}, "scopeMetrics": [{"scope": scope or {}, "metrics": out}]}]}


def write_renamed(path, text, short, full):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(rename(text, short, full))


def import_exporters(folder, target, short, full):
    for name in ("exporter", "exporter-stable"):
        source = os.path.join(folder, "healthy", name)
        if not os.path.isdir(source):
            continue
        for service in SERVICES:
            path = os.path.join(source, f"{service}.prom")
            if os.path.isfile(path):
                copy_text(path, os.path.join(target, "healthy", name, f"{service}.prom"), short, full)
    source = os.path.join(folder, "healthy", "exporter-kolla")
    for name in ("all.prom", "status.txt"):
        path = os.path.join(source, name)
        if os.path.isfile(path):
            copy_text(path, os.path.join(target, "healthy", "exporter-kolla", name), short, full)


def import_otlp(folder, target, short, full):
    guide = os.path.join(folder, "guide")
    for part in sorted(os.listdir(guide)) if os.path.isdir(guide) else []:
        path = os.path.join(guide, part, "otlp", "metrics.json")
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            text = json.dumps(distilled_otlp(path), indent=0)
            write_renamed(os.path.join(target, "otlp", f"{part}.json"), text, short, full)


def import_logs(folder, target, short, full):
    guide = os.path.join(folder, "guide")
    for part in sorted(os.listdir(guide)) if os.path.isdir(guide) else []:
        path = os.path.join(guide, part, "otlp", "logs.json")
        if not (os.path.isfile(path) and os.path.getsize(path) > 0):
            continue
        records, resource = [], None
        with open(path, errors="replace") as handle:
            for line in handle:
                try:
                    export = json.loads(line)
                except ValueError:
                    continue
                for resource_logs in export.get("resourceLogs", []):
                    resource = resource_logs.get("resource", resource)
                    for scope in resource_logs.get("scopeLogs", []):
                        records.extend(scope.get("logRecords", []))
        text = json.dumps({"resource": resource, "logRecords": records[:LOG_RECORDS_TO_KEEP], "total": len(records)}, indent=0)
        write_renamed(os.path.join(target, "logs", f"{part}.json"), text, short, full)


def commands_alone(text):
    """Each command a guide says and how it exited, without what it printed, which is half a megabyte."""
    kept, inside = [], False
    for line in text.split("\n"):
        if line.startswith("$ "):
            inside = True
        if line.startswith("[exit "):
            kept += [line, ""]
            inside = False
        elif inside and not line.strip():
            # A command is its lines up to the first blank one, or to what it prints.
            inside = False
        elif inside and (line.startswith("$ ") or line.startswith((" ", "curl ", "openstack ", "sudo ", "kolla-ansible ", "docker ", "OPENSTACK_", "bash ", "cd ", "python3 "))):
            kept.append(line)
        else:
            inside = False
    return "\n".join(kept) + "\n"


def import_deployment(folder, tool_folder, target, short, full):
    source = os.path.join(folder, tool_folder)
    for name in DEPLOYMENT_FILES:
        path = os.path.join(source, name)
        if os.path.isfile(path):
            copy_text(path, os.path.join(target, "deployment", name), short, full)
    path = os.path.join(folder, "guide", "problems.txt")
    if os.path.isfile(path):
        copy_text(path, os.path.join(target, "deployment", "problems.txt"), short, full)
    path = os.path.join(folder, "guide", "commands.log")
    if os.path.isfile(path):
        with open(path, errors="replace") as handle:
            write_renamed(os.path.join(target, "deployment", "commands.log"), commands_alone(handle.read()), short, full)
    path = os.path.join(folder, "guide", "utility-has.txt")
    if os.path.isfile(path):
        copy_text(path, os.path.join(target, "deployment", "utility-has.txt"), short, full)
    path = os.path.join(folder, "control-plane", "status.txt")
    if os.path.isfile(path):
        copy_text(path, os.path.join(target, "deployment", "control-plane-status.txt"), short, full)
    for part_file in ("logs/reach.txt",):
        path = os.path.join(folder, "guide", part_file)
        if os.path.isfile(path):
            copy_text(path, os.path.join(target, "deployment", part_file.replace("/", "-")), short, full)


def import_webhooks(name, folder, short, full):
    source = os.path.join(folder, "alertmanager")
    if not os.path.isdir(source):
        return
    kept = {}
    for file in sorted(os.listdir(source)):
        if not file.startswith("webhook-"):
            continue
        with open(os.path.join(source, file), errors="replace") as handle:
            text = handle.read()
        notification = json.loads(text)
        if len(notification.get("alerts", [])) != 1:
            continue
        alert = notification["commonLabels"].get("alertname", "alert")
        kept.setdefault(alert, {}).setdefault(notification["status"], text)
    for alert, by_status in kept.items():
        if {"firing", "resolved"} <= set(by_status):
            folder_name = f"{name}-{alert.lower()}"
            for status in ("firing", "resolved"):
                write_renamed(os.path.join(FIXTURES, "alertmanager", folder_name, f"{status}.json"), by_status[status], short, full)


def main():
    name, folder = sys.argv[1], sys.argv[2]
    tool_folder = "kolla" if name.startswith("kolla") else "osa"
    short, full = recording_tools.runner_names(folder)
    if not short and not os.path.isdir(os.path.join(folder, tool_folder)):
        print(f"{name}: no scene with Nova's services in it, and nothing of the deployment", file=sys.stderr)
        sys.exit(1)
    target = os.path.join(FIXTURES, name)
    shutil.rmtree(target, ignore_errors=True)
    import_exporters(folder, target, short, full)
    import_otlp(folder, target, short, full)
    import_logs(folder, target, short, full)
    import_deployment(folder, tool_folder, target, short, full)
    import_webhooks(name, folder, short, full)
    total = sum(os.path.getsize(os.path.join(root, item)) for root, _, items in os.walk(target) for item in items)
    print(f"{name}: {total // 1024} KiB, on the runner {short} ({full})")


if __name__ == "__main__":
    main()

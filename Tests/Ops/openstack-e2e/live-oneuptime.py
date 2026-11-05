#!/usr/bin/env python3
"""A live OneUptime, sent what real deployments sent: does it do what the guides say?

The replay tests in packages/Common/Tests run the real evaluator over a database in memory. This
runs nothing in memory: a OneUptime already started from its release images, through its own
HTTP API, as a person's browser and a real Alertmanager would reach it.

  - Each cloud is registered the way the guides say, by its first data: an OTLP export a real
    agent sent, posted to /otlp/v1/metrics under that cloud's name.
  - Each cloud gets the monitor integrations/prometheus-alertmanager.md describes, linked to it
    under Linked Resources.
  - What a real Alertmanager posted goes to one monitor's /heartbeat address.

Then it reads the incident back from the API, as the cloud's own Incidents page asks for it, and
says whether it is on the right cloud, on no other, and resolved by the recovery.

    ONEUPTIME_URL=http://localhost OUTPUT_DIR=out python3 -I live-oneuptime.py

Only standard library, because this runs on a bare runner.
"""
import copy
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("ONEUPTIME_URL", "http://localhost").rstrip("/")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "out")
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "..", "..", "..", "packages", "Common", "Tests", "Fixtures", "OpenStack")

EMAIL = f"openstack-live-{int(time.time())}@test.oneuptime.com"
PASSWORD = "TestPassword123!"

COOKIES = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIES))
PROJECT_ID = None
FAILURES = []
RESULTS = {}


def say(line):
    print(line, flush=True)


def check(what, passed, detail=""):
    say(f"{'ok' if passed else 'FAILED'}: {what}{(' (' + str(detail) + ')') if detail != '' else ''}")
    if not passed:
        FAILURES.append(what)
    RESULTS.setdefault("checks", []).append({"what": what, "passed": bool(passed), "detail": str(detail)})


def request(method, path, body=None, headers=None, raw=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    wanted = {"Content-Type": "application/json", "Accept": "application/json"}
    if PROJECT_ID:
        wanted["tenantid"] = PROJECT_ID
        wanted["projectid"] = PROJECT_ID
    wanted.update(headers or {})
    call = urllib.request.Request(BASE + path, data=data, method=method, headers=wanted)
    try:
        with OPENER.open(call, timeout=120) as answer:
            text = answer.read().decode(errors="replace")
            status = answer.status
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="replace")
        status = error.code
    try:
        parsed = json.loads(text) if text else {}
    except ValueError:
        parsed = {"raw": text[:2000]}
    return status, parsed


def api(method, path, body=None):
    status, parsed = request(method, "/api" + path, body)
    if status == 401:
        # A session lasts 15 minutes, and a browser renews its own. A wait here can outlast one.
        log_in()
        status, parsed = request(method, "/api" + path, body)
    if status >= 300:
        raise RuntimeError(f"{method} {path} answered {status}: {json.dumps(parsed)[:1500]}")
    return parsed


def value_of(field):
    return field.get("value") if isinstance(field, dict) and "value" in field else field


def log_in():
    status, parsed = request(
        "POST",
        "/api/identity/login",
        {
            "data": {
                "email": {"_type": "Email", "value": EMAIL},
                "password": {"_type": "HashedString", "value": PASSWORD},
            }
        },
    )
    if status >= 300:
        raise RuntimeError(f"Sign in answered {status}: {json.dumps(parsed)[:1500]}")


def sign_in():
    global PROJECT_ID
    status, parsed = request(
        "POST",
        "/api/identity/signup",
        {
            "data": {
                "email": {"_type": "Email", "value": EMAIL},
                "password": {"_type": "HashedString", "value": PASSWORD},
                "name": {"_type": "Name", "value": "OpenStack Live Check"},
                "companyName": "OpenStack Live Check",
                "companyPhoneNumber": {"_type": "Phone", "value": "+15551234567"},
            }
        },
    )
    if status >= 300:
        raise RuntimeError(f"Sign up answered {status}: {json.dumps(parsed)[:1500]}")
    log_in()

    for _ in range(30):
        found = api("POST", "/project/get-list", {"query": {}, "select": {"_id": True, "name": True}, "limit": 1})
        if found.get("data"):
            PROJECT_ID = found["data"][0]["_id"]
            break
        time.sleep(2)
    if not PROJECT_ID:
        created = api("POST", "/project", {"data": {"name": "OpenStack Live Check"}})
        PROJECT_ID = created.get("_id") or created["data"]["_id"]
    say(f"Signed in, in project {PROJECT_ID}")


def rows(path, query, select, limit=100):
    answer = api("POST", f"{path}/get-list", {"query": query, "select": select, "limit": limit})
    return answer.get("data", [])


def statuses_and_severity():
    found = rows(
        "/monitor-status",
        {"projectId": PROJECT_ID},
        {"_id": True, "name": True, "isOperationalState": True, "isOfflineState": True},
    )
    online = next(status["_id"] for status in found if status.get("isOperationalState"))
    offline = next(status["_id"] for status in found if status.get("isOfflineState"))
    severity = rows("/incident-severity", {"projectId": PROJECT_ID}, {"_id": True, "name": True, "order": True})[0]["_id"]
    return online, offline, severity


# The criteria integrations/prometheus-alertmanager.md tells a person to set, setting by setting.
def alertmanager_monitor_steps(online, offline, severity):
    def request_body_contains(text):
        return {"checkOn": "Request Body", "filterType": "Contains", "value": text}

    firing = {
        "_type": "MonitorCriteriaInstance",
        "value": {
            "id": str(uuid.uuid4()),
            "monitorStatusId": offline,
            "filterCondition": "All",
            "filters": [request_body_contains('"status":"firing"')],
            "incidents": [
                {
                    "id": str(uuid.uuid4()),
                    "title": "{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}",
                    "description": "{{requestBody.commonAnnotations.summary}}",
                    "incidentSeverityId": severity,
                    "autoResolveIncident": True,
                }
            ],
            "alerts": [],
            "createIncidents": True,
            "createAlerts": False,
            "changeMonitorStatus": True,
            "isEnabled": True,
            "name": "Firing",
            "description": "An alert is firing",
            "incidentGrouping": {
                "groupByJSONPath": "requestBody.alerts[*].fingerprint",
                "resolvedWhenJSONPath": "requestBody.alerts[*].status",
                "resolvedWhenValue": "resolved",
            },
        },
    }
    resolved = {
        "_type": "MonitorCriteriaInstance",
        "value": {
            "id": str(uuid.uuid4()),
            "monitorStatusId": online,
            "filterCondition": "All",
            "filters": [request_body_contains('"status":"resolved"')],
            "incidents": [],
            "alerts": [],
            "createIncidents": False,
            "createAlerts": False,
            "changeMonitorStatus": True,
            "isEnabled": True,
            "name": "Resolved",
            "description": "Every alert recovered",
        },
    }
    return {
        "_type": "MonitorSteps",
        "value": {
            "defaultMonitorStatusId": online,
            "monitorStepsInstanceArray": [
                {
                    "_type": "MonitorStep",
                    "value": {
                        "id": str(uuid.uuid4()),
                        "monitorCriteria": {
                            "_type": "MonitorCriteria",
                            "value": {"monitorCriteriaInstanceArray": [firing, resolved]},
                        },
                    },
                }
            ],
        },
    }


# What the recording holds, under a cloud's name, as of now: a sample's age decides what it says.
def export_under_name(export, cloud_name):
    moved = copy.deepcopy(export)
    now = str(time.time_ns())

    def visit(node):
        if isinstance(node, dict):
            for key in ("timeUnixNano", "startTimeUnixNano"):
                if key in node:
                    node[key] = now
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(moved)
    for resource_metrics in moved.get("resourceMetrics", []):
        attributes = resource_metrics.setdefault("resource", {}).setdefault("attributes", [])
        attributes[:] = [item for item in attributes if item.get("key") != "openstack.cloud.name"]
        attributes.append({"key": "openstack.cloud.name", "value": {"stringValue": cloud_name}})
    return moved


def send_export(export, cloud_name, token):
    status, parsed = request(
        "POST",
        "/otlp/v1/metrics",
        raw=json.dumps(export_under_name(export, cloud_name)).encode(),
        headers={"x-oneuptime-token": token},
    )
    if status >= 300:
        raise RuntimeError(f"OTLP answered {status}: {json.dumps(parsed)[:800]}")


def wait_for_cloud(name, attempts=60):
    for _ in range(attempts):
        found = rows("/openstack-cloud", {"name": name}, {"_id": True, "name": True, "otelCollectorStatus": True})
        if found:
            return found[0]
        time.sleep(5)
    raise RuntimeError(f"The cloud {name} never appeared under OpenStack: nothing registered it")


def inventory_of(cloud_id):
    return rows(
        "/openstack-resource",
        {"openStackCloudId": cloud_id},
        {"kind": True, "externalId": True, "name": True, "status": True, "regionName": True},
        limit=1000,
    )


def make_monitor(name, cloud, steps):
    created = api("POST", "/monitor", {"data": {"name": name, "monitorType": "Incoming Request", "monitorSteps": steps}})
    monitor_id = created.get("_id") or created["data"]["_id"]
    # The monitor's Overview > Linked Resources, as its form saves it.
    api("PUT", f"/monitor/{monitor_id}", {"data": {"openStackClouds": [{"_id": cloud["_id"]}]}})
    item = api("POST", f"/monitor/{monitor_id}/get-item", {"select": {"_id": True, "incomingRequestSecretKey": True}})
    return {"id": monitor_id, "secret": value_of(item.get("incomingRequestSecretKey") or item["data"]["incomingRequestSecretKey"])}


def post_webhook(monitor, body):
    status, parsed = request("POST", f"/heartbeat/{monitor['secret']}", raw=body)
    if status >= 300:
        raise RuntimeError(f"/heartbeat answered {status}: {json.dumps(parsed)[:800]}")


# What the cloud's Incidents page asks for: Pages/OpenStack/View/Incidents.tsx.
def incidents_on_cloud(cloud):
    return rows(
        "/incident",
        {"projectId": PROJECT_ID, "openStackClouds": {"_type": "Includes", "value": [cloud["_id"]]}},
        {
            "_id": True,
            "title": True,
            "description": True,
            "currentIncidentState": {"name": True, "isResolvedState": True},
            "openStackClouds": {"_id": True, "name": True},
        },
    )


def wait_until(what, test, attempts=60, gap=5):
    for _ in range(attempts):
        result = test()
        if result:
            return result
        time.sleep(gap)
    raise RuntimeError(f"Waited for {what}, and it never happened")


def read_json(*parts):
    with open(os.path.join(*parts), "rb") as handle:
        return handle.read()


def alertmanager_recordings():
    folder = os.path.join(FIXTURES, "alertmanager")
    return [
        (name, read_json(folder, name, "firing.json"), read_json(folder, name, "resolved.json"))
        for name in sorted(os.listdir(folder))
    ]


def main():
    sign_in()
    online, offline, severity = statuses_and_severity()

    key = api("POST", "/telemetry-ingestion-key", {"data": {"name": "OpenStack live", "description": "Live check", "projectId": PROJECT_ID}})
    token = value_of(key.get("secretKey") or key["data"]["secretKey"])
    if not token:
        fetched = rows("/telemetry-ingestion-key", {"projectId": PROJECT_ID}, {"secretKey": True}, limit=1)
        token = value_of(fetched[0]["secretKey"])

    export_file = os.environ.get("OTLP_FIXTURE") or os.path.join(FIXTURES, "gazpacho-ovs", "otlp.json")
    export = json.loads(read_json(export_file))
    say(f"Registering two clouds from what a real agent sent: {export_file}")

    for name in ("live-kolla-production", "live-kolla-staging"):
        send_export(export, name, token)
    the_cloud = wait_for_cloud("live-kolla-production")
    other_cloud = wait_for_cloud("live-kolla-staging")
    check("the first data registers each cloud", the_cloud["_id"] != other_cloud["_id"])

    inventory = wait_until("the inventory of the cloud", lambda: inventory_of(the_cloud["_id"]))
    kinds = sorted({row.get("kind") for row in inventory})
    check("the agent's export fills the inventory", len(inventory) > 0, f"{len(inventory)} rows, of {kinds}")
    RESULTS["inventory"] = {"rows": len(inventory), "kinds": kinds}

    steps = alertmanager_monitor_steps(online, offline, severity)
    for recording, firing, resolved in alertmanager_recordings():
        say(f"\nWhat Alertmanager posted, in {recording}")
        notification = json.loads(firing)
        expected = notification["commonLabels"]
        # The page's template, and what tells this alert's incident from another's.
        title = f"{expected['alertname']} on {expected['instance']} - Fingerprint: {notification['alerts'][0]['fingerprint']}"
        monitor = make_monitor(f"Alertmanager {recording}", the_cloud, steps)
        make_monitor(f"Alertmanager {recording}, staging", other_cloud, steps)

        before = len(incidents_on_cloud(the_cloud))
        before_other = len(incidents_on_cloud(other_cloud))
        post_webhook(monitor, firing)
        found = wait_until("the incident", lambda: [i for i in incidents_on_cloud(the_cloud) if i.get("title") == title])
        check("the firing webhook opens an incident on the cloud's page", len(found) == 1, title)
        check(
            "that incident is on that cloud",
            [cloud["_id"] for cloud in found[0].get("openStackClouds", [])] == [the_cloud["_id"]],
        )
        check("and on no other", len(incidents_on_cloud(other_cloud)) == before_other)
        check("nothing else opened", len(incidents_on_cloud(the_cloud)) == before + 1)

        # Alertmanager repeats itself every repeat_interval while an alert fires.
        post_webhook(monitor, firing)
        time.sleep(20)
        check(
            "the same notification again opens nothing new",
            len([i for i in incidents_on_cloud(the_cloud) if i.get("title") == title]) == 1,
        )

        post_webhook(monitor, resolved)
        settled = wait_until(
            "the incident to resolve",
            lambda: [
                i
                for i in incidents_on_cloud(the_cloud)
                if i.get("title") == title and (i.get("currentIncidentState") or {}).get("isResolvedState")
            ],
        )
        check("the resolved webhook resolves it", len(settled) == 1, settled[0]["currentIncidentState"].get("name"))
        RESULTS.setdefault("incidents", []).append({"recording": recording, "title": title})


if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    try:
        main()
    except Exception as error:  # What went wrong is the report, whatever it was.
        check("the walk finished", False, error)
    with open(os.path.join(OUTPUT_DIR, "live-oneuptime.json"), "w") as handle:
        json.dump(RESULTS, handle, indent=2)
    if FAILURES:
        say(f"\n{len(FAILURES)} checks failed")
        sys.exit(1)
    say("\nEvery check passed, on a live OneUptime")

#!/usr/bin/env python3
"""Status pages and project notices, on a real cloud, in a running OneUptime.

whole-path.py joins a real DevStack to a OneUptime built from this branch. This goes on from there and
asks what #5750 asks of them, with nothing stood in for but the webhook's receiver, which is a small
server here that keeps what it is sent:

  page       What making a status page would make is read, and makes nothing. A make holding the wrong
             key is refused. The right one makes a page: a group for the region, a row per service.
  notices    Two projects with a notice. One is turned on from its preview, and turning on without one
             is refused. The other stays off.
  break      nova-compute really stopped. One incident opens, naming both projects, and the one notice
             turned on is told, once, about its own instances and nobody else's, with no host's name
             in it. Started again: it is told once that it is over, and the other project never hears.
  planned    A maintenance event on that host names who it reaches and tells the project once. While it
             is on, nova-compute stopped opens nothing and moves no status, and a disable reads as
             expected. Ended, the same disable pages.

Every check says what it found, in $OUTPUT_DIR/whole-path.json, beside what whole-path.py would write.
Exits 1 when a check failed, having named each one last.

    ONEUPTIME_URL=http://localhost:8880 OUTPUT_DIR=out python3 -I status-pages-live.py

It stops and restarts real services and makes accounts, so never point it at a cloud that matters. Email
needs a mail server, which this runner hasn't got: a webhook is what is proved here, and tests hold what
an email says. Only standard library, because this runs on a bare runner.
"""
import http.server
import importlib.util
import json
import os
import socketserver
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))

# -I leaves this folder off the path, and its name is no module's, so it is loaded by where it is.
_spec = importlib.util.spec_from_file_location("whole_path", os.path.join(HERE, "whole-path.py"))
whole = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(whole)

live = whole.live
check = whole.check
found = whole.found
say = whole.say
stage = whole.stage
wait_for = whole.wait_for
STATE = whole.STATE
RESULTS = whole.RESULTS

SINK_PORT = 18950
RECEIVED = []
NOTICE_API = "/openstack-project-notice"
PAID = "ou-payments"
OTHER = "ou-research"
COMPUTE_UNIT = whole.COMPUTE_UNIT
# The longest a template's window and a collection can take to say something happened, or didn't.
QUIET_FOR_SECONDS = 900


class Sink(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # pylint: disable=invalid-name
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        RECEIVED.append({"path": self.path, "headers": dict(self.headers), "body": body})
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *_args):
        return


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def bodies(path):
    return [json.loads(item["body"]) for item in RECEIVED if item["path"] == path]


def post(path, body=None):
    return live.api("POST", path, body or {})


def refused(path, body=None):
    """A route's refusal, or None when it took it."""
    try:
        post(path, body)
        return None
    except RuntimeError as error:
        return str(error)


def monitor_count():
    return len(live.rows("/monitor", {"projectId": live.PROJECT_ID}, {"_id": True}, limit=1000))


def project_row(cloud_id, name):
    return next((row for row in whole.rows_of(cloud_id, "Project") if row.get("name") == name), None)


def part_page():
    cloud_id = STATE["agent cloud"]
    STATE["cloud"] = cloud_id
    before = monitor_count()
    answer = post(f"{NOTICE_API}/status-page-plan/{cloud_id}")
    plan, key = answer["plan"], answer["planKey"]
    found("the plan", plan)
    groups = plan.get("groups") or []
    check("the plan has a group for the region", [group.get("name") for group in groups] == [whole.REGION], [group.get("name") for group in groups])
    rows = [row.get("service") for row in (groups[0].get("rows") if groups else [])]
    for service in ["Compute", "Networking", "Block Storage", "Images", "Identity"]:
        check(f"and a row for {service}", service in rows, rows)
    check("Load Balancing shows no trace: this DevStack doesn't run it", "Load Balancing" not in rows, rows)
    check("the plan says what it will make", plan.get("monitorsToMake", 0) > 0, plan.get("monitorsToMake"))
    check("reading it makes nothing", monitor_count() == before, f"{before} before, {monitor_count()} after")

    refusal = refused(f"{NOTICE_API}/make-status-page/{cloud_id}", {"planKey": "not what you were shown", "isPublic": False})
    check("a make holding the wrong key is refused", bool(refusal), refusal)
    check("and makes nothing", monitor_count() == before, monitor_count())

    made = post(f"{NOTICE_API}/make-status-page/{cloud_id}", {"planKey": key, "name": "The cloud's status", "isPublic": False})
    found("what it made", made)
    page_id = made.get("statusPageId")
    STATE["page"] = page_id
    check("one step makes a status page", bool(page_id), made)
    check("with the monitors it said it would", made.get("monitorsMade") == plan.get("monitorsToMake"), made)

    resources = live.rows(
        "/status-page-resource",
        {"statusPageId": whole.typed_id(page_id)},
        {"displayName": True, "monitorId": True, "monitorGroupId": True, "statusPageGroupId": True},
    )
    found("its rows", resources)
    check("its rows are the plan's", sorted(row.get("displayName") or "" for row in resources) == sorted(rows), resources)
    check("each is backed by a monitor or a group of them", all(row.get("monitorId") or row.get("monitorGroupId") for row in resources), resources)

    answer = post(f"{NOTICE_API}/status-page-plan/{cloud_id}")
    check("asked again, it has nothing left to make", answer["plan"].get("monitorsToMake") == 0, answer["plan"].get("monitorsToMake"))
    status, _ = live.request("POST", f"/api/status-page/overview/{page_id}", {})
    check("nobody signed in reads a private page", status >= 400, status)

    # The same monitors, on a page anyone can read: what a failure shows the public is read from this.
    public = post(f"{NOTICE_API}/make-status-page/{cloud_id}", {"planKey": answer["planKey"], "name": "For everyone", "isPublic": True})
    check("a second page makes no second monitor", public.get("monitorsMade") == 0, public)
    STATE["public page"] = public.get("statusPageId")
    status, overview = live.request("POST", f"/api/status-page/overview/{STATE['public page']}", {})
    check("anyone reads the public one", status < 300, status)
    found("the public page, healthy", overview)


def part_notices():
    cloud_id = STATE["cloud"]
    paid = project_row(cloud_id, PAID)
    other = project_row(cloud_id, OTHER)
    check("the estate's two projects are in the inventory", bool(paid and other), whole.short(whole.rows_of(cloud_id, "Project")))
    STATE["paid project"] = paid["externalId"]
    STATE["other project"] = other["externalId"]

    url = f"http://{STATE['host ip']}:{SINK_PORT}"

    def notice_for(project_id, path):
        created = post(
            NOTICE_API,
            {"data": {"openStackCloudId": whole.typed_id(cloud_id), "openStackProjectId": project_id, "webhookUrl": {"_type": "URL", "value": f"{url}/{path}"}, "projectId": live.PROJECT_ID}},
        )
        return whole.id_of(created)

    teams = live.rows("/team", {"projectId": live.PROJECT_ID}, {"_id": True, "name": True}, limit=1)
    STATE["team"] = teams[0]["_id"]
    post(
        "/openstack-cloud-owner-rule",
        {
            "data": {
                "projectId": live.PROJECT_ID,
                "openStackCloudId": whole.typed_id(cloud_id),
                "name": f"{PAID} owners",
                "openStackProjectId": paid["externalId"],
                "ownerTeams": [{"_id": STATE["team"]}],
                "notifyOwners": False,
            }
        },
    )
    post(
        "/openstack-cloud-owner-rule",
        {
            "data": {
                "projectId": live.PROJECT_ID,
                "openStackCloudId": whole.typed_id(cloud_id),
                "name": "A rule on a project nobody has",
                "openStackProjectId": "no-such-project",
                "ownerTeams": [{"_id": STATE["team"]}],
                "notifyOwners": False,
            }
        },
    )

    STATE["paid notice"] = notice_for(paid["externalId"], "paid")
    STATE["other notice"] = notice_for(other["externalId"], "other")

    def is_on(notice_id):
        return whole.item_of(post(f"{NOTICE_API}/{notice_id}/get-item", {"select": {"isEnabled": True}})).get("isEnabled")

    check("a notice starts off", not is_on(STATE["paid notice"]), is_on(STATE["paid notice"]))

    refusal = refused(f"{NOTICE_API}/turn-on/{STATE['paid notice']}", {"previewToken": "made up"})
    check("turning one on without its preview is refused", bool(refusal), refusal)
    check("and leaves it off", not is_on(STATE["paid notice"]))

    preview = post(f"{NOTICE_API}/preview/{STATE['paid notice']}")
    found("its preview", {key: value for key, value in preview.items() if key != "previewToken"})
    check("the preview says who is told", preview.get("address", "").endswith("/paid"), preview.get("address"))
    check("and about which project", preview.get("projectName") == PAID, preview.get("projectName"))
    check("and that nothing has been sent", not RECEIVED, RECEIVED)
    check("looking at it doesn't turn it on", not is_on(STATE["paid notice"]))
    post(f"{NOTICE_API}/turn-on/{STATE['paid notice']}", {"previewToken": preview.get("previewToken")})
    check("turned on from its preview, it is on", bool(is_on(STATE["paid notice"])))
    check("and the other stays off", not is_on(STATE["other notice"]))

    told = post(
        f"{NOTICE_API}/who-would-be-told/{cloud_id}",
        {"kind": "Hypervisor", "externalId": next(row["externalId"] for row in whole.rows_of(cloud_id, "Hypervisor"))},
    )
    found("who the host would tell", told)
    check("the preview of the host tells only the one turned on", [row.get("name") for row in told.get("told", [])] == [PAID], told.get("told"))


def incidents_about(words):
    rows = live.rows("/incident", {"projectId": live.PROJECT_ID}, whole.INCIDENT_SELECT, limit=200)
    return [row for row in rows if words in (row.get("title") or "")]


def part_break():
    stopped_at = time.time()
    whole.must("break", f"sudo systemctl stop {COMPUTE_UNIT}")
    say(f"{COMPUTE_UNIT} stopped")
    try:
        opened, waited = wait_for(lambda: incidents_about("Compute Service Down"), 1500, gap=20)
        check("the monitor the page made opens an incident", bool(opened), f"{round(time.time() - stopped_at)}s after the stop, having waited {waited}s")
        if opened:
            check("exactly one", len(opened) == 1, [row.get("title") for row in opened])
            description = opened[0].get("description") or ""
            found("what it says", description)
            check(f"it names {PAID}", PAID in description, description[:800])
            check(f"and {OTHER}", OTHER in description, description[:800])

            def owners():
                rows = live.rows(
                    "/incident-owner-team",
                    {"incidentId": whole.typed_id(opened[0]["_id"])},
                    {"teamId": True},
                    limit=10,
                )
                return rows or None

            added, _ = wait_for(owners, 120, gap=10)
            check("and adds the team that owns the project", bool(added) and len(added) == 1 and added[0].get("teamId") == STATE["team"], added)

            status, shown = live.request("POST", f"/api/status-page/overview/{STATE['public page']}", {})
            found("the public page, while it is down", shown)
            text = json.dumps(shown)
            check("the public page shows the incident", status < 300 and "Compute Service Down" in text, status)
            check("and names no project", PAID not in text and OTHER not in text and STATE["paid project"] not in text, text[:1200])
        told, waited = wait_for(lambda: bodies("/paid"), 300, gap=10)
        check("the project turned on is told", bool(told), f"after {waited}s; {RECEIVED}")
        if told:
            notice = told[0]
            found("what it was told", notice)
            text = json.dumps(notice)
            check("as an incident opening", notice.get("event") == "Incident Opened", notice.get("event"))
            check("about itself", (notice.get("project") or {}).get("name") == PAID, notice.get("project"))
            check("with what it holds there", (notice.get("holdings") or {}).get("instanceCount", 0) > 0, notice.get("holdings"))
            check("and nothing of the other project", OTHER not in text and STATE["other project"] not in text, text[:800])
            check("and no host's name", STATE["host"] not in text, text[:800])
            delivered = [item for item in RECEIVED if item["path"] == "/paid"]
            check("with an id a receiver can act on once", delivered[0]["headers"].get("Idempotency-Key") == notice.get("id"), delivered[0]["headers"])
        # Long enough for the incident to be seen again and again by the monitor and the job.
        time.sleep(300)
        check("told once, however long it lasts", len(bodies("/paid")) == 1, len(bodies("/paid")))
        check("the project turned off is told nothing", not bodies("/other"), bodies("/other"))
        check("still one incident", len(incidents_about("Compute Service Down")) == 1)
    finally:
        started_at = time.time()
        whole.must("break", f"sudo systemctl start {COMPUTE_UNIT}")
        say(f"{COMPUTE_UNIT} started")

    def over():
        rows = incidents_about("Compute Service Down")
        return rows if rows and all((row.get("currentIncidentState") or {}).get("isResolvedState") for row in rows) else None

    resolved, waited = wait_for(over, 1500, gap=20)
    check("the incident resolves on its own", bool(resolved), f"{round(time.time() - started_at)}s after the start, having waited {waited}s")

    def told_over():
        rows = bodies("/paid")
        return rows if len(rows) > 1 else None

    rows, waited = wait_for(told_over, 300, gap=10)
    check("the project is told it is over", bool(rows), f"after {waited}s; {bodies('/paid')}")
    if rows:
        check("as resolved", rows[-1].get("event") == "Incident Resolved", rows[-1].get("event"))
    time.sleep(120)
    check("told that once too", len(bodies("/paid")) == 2, len(bodies("/paid")))
    check("the project turned off still heard nothing", not bodies("/other"), bodies("/other"))


def move_event(event_id, state):
    post(
        "/scheduled-maintenance-state-timeline",
        {
            "data": {
                "projectId": live.PROJECT_ID,
                "scheduledMaintenanceId": whole.typed_id(event_id),
                "scheduledMaintenanceStateId": whole.typed_id(state),
            }
        },
    )


def part_planned():
    cloud_id = STATE["cloud"]
    told_before = len(bodies("/paid"))
    states = live.rows(
        "/scheduled-maintenance-state",
        {"projectId": live.PROJECT_ID},
        {"_id": True, "name": True, "isOngoingState": True, "isEndedState": True},
    )
    ongoing = next(state["_id"] for state in states if state.get("isOngoingState"))
    ended = next(state["_id"] for state in states if state.get("isEndedState"))

    hypervisor = next(row for row in whole.rows_of(cloud_id, "Hypervisor"))
    now = time.time()

    def at(seconds):
        return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now + seconds))

    created = post(
        "/scheduled-maintenance",
        {
            "data": {
                "projectId": live.PROJECT_ID,
                "title": "A kernel upgrade",
                "startsAt": {"_type": "DateTime", "value": at(60)},
                "endsAt": {"_type": "DateTime", "value": at(7200)},
                "openStackParts": [
                    {
                        "openStackCloudId": cloud_id,
                        "kind": "Hypervisor",
                        "name": hypervisor.get("hypervisorName") or hypervisor.get("name"),
                        "regionName": hypervisor.get("regionName"),
                    }
                ],
                "openStackClouds": [{"_id": cloud_id}],
            }
        },
    )
    event_id = whole.id_of(created)
    check("a maintenance event is made on the host", bool(event_id), event_id)

    def feed():
        rows = live.rows(
            "/scheduled-maintenance-feed",
            {"scheduledMaintenanceId": whole.typed_id(event_id)},
            {"feedInfoInMarkdown": True},
            limit=50,
        )
        text = " ".join(row.get("feedInfoInMarkdown") or "" for row in rows)
        return text if PAID in text else None

    text, _ = wait_for(feed, 180, gap=10)
    found("its feed", text)
    check("it names who it reaches when it is made", bool(text), text)

    def told_planned():
        rows = bodies("/paid")
        return rows if len(rows) > told_before else None

    rows, waited = wait_for(told_planned, 300, gap=10)
    check("the project is told it is planned", bool(rows), f"after {waited}s; {bodies('/paid')}")
    if rows:
        check("as planned", rows[-1].get("event") == "Maintenance Planned", rows[-1].get("event"))
        found("what it was told", rows[-1])
    check("the project turned off hears nothing of it", not bodies("/other"), bodies("/other"))

    # It starts by itself at its time, as any event does: the worker moves it, and this only waits.
    def is_on():
        event = whole.item_of(
            post(
                f"/scheduled-maintenance/{event_id}/get-item",
                {"select": {"currentScheduledMaintenanceState": {"isOngoingState": True}}},
            )
        )
        return (event.get("currentScheduledMaintenanceState") or {}).get("isOngoingState")

    started, _ = wait_for(is_on, 240, gap=10)
    if not started:
        move_event(event_id, ongoing)
    time.sleep(60)
    check("the event is on", bool(is_on()), started)
    incidents_before = len(incidents_about("Compute Service Down"))
    whole.must("break", f"sudo systemctl stop {COMPUTE_UNIT}")
    say(f"{COMPUTE_UNIT} stopped, with the event on")
    try:
        time.sleep(QUIET_FOR_SECONDS)
        check(
            "while it is on, nova-compute stopped opens nothing",
            len(incidents_about("Compute Service Down")) == incidents_before,
            [row.get("title") for row in incidents_about("Compute Service Down")],
        )
        check("and tells nobody", len(bodies("/paid")) == told_before + 1, len(bodies("/paid")))
        watching = live.rows(
            "/monitor",
            {"projectId": live.PROJECT_ID},
            {"name": True, "currentMonitorStatus": {"name": True, "isOperationalState": True}},
            limit=200,
        )
        down = [row.get("name") for row in watching if "Compute Service Down" in (row.get("name") or "") and not (row.get("currentMonitorStatus") or {}).get("isOperationalState")]
        check("and its status page row stays as it was", not down, down)
    finally:
        whole.must("break", f"sudo systemctl start {COMPUTE_UNIT}")
        say(f"{COMPUTE_UNIT} started")

    # What a host disabled by hand is, in the window and out of it.
    time.sleep(240)
    whole.TEMPLATE_ID = "openstack-compute-service-disabled"
    monitor_id, monitor_name = whole.template_monitor(whole.AGENT_CLOUD)
    STATE["disabled monitor"] = monitor_id
    check(f"a monitor is made from the real {monitor_name} template", bool(monitor_id), monitor_id)
    host = STATE["host"]
    whole.must("break", f"openstack compute service set --disable --disable-reason 'OneUptime: planned' {host} nova-compute")
    try:
        time.sleep(QUIET_FOR_SECONDS)
        check(
            "a disable during the event on that host reads as expected: nothing opens",
            not incidents_about("Compute Service Disabled"),
            [row.get("title") for row in incidents_about("Compute Service Disabled")],
        )
        status = whole.monitor_status(monitor_id)
        check("and its monitor stays as it was", bool(status.get("isOperationalState")), status)

        move_event(event_id, ended)

        def told_ended():
            rows = bodies("/paid")
            return rows if rows and rows[-1].get("event") == "Maintenance Ended" else None

        rows, waited = wait_for(told_ended, 300, gap=10)
        check("the project is told the maintenance ended", bool(rows), f"after {waited}s; {bodies('/paid')}")

        opened, waited = wait_for(lambda: incidents_about("Compute Service Disabled"), 1500, gap=20)
        check("the same disable with no event on pages", bool(opened), f"after {waited}s")
        if opened:
            check("once", len(opened) == 1, [row.get("title") for row in opened])
            found("the incident", opened[0])
    finally:
        whole.must("break", f"openstack compute service set --enable {host} nova-compute")


def main():
    os.makedirs(whole.LOGS, exist_ok=True)
    RESULTS["started"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    server = ThreadingServer(("0.0.0.0", SINK_PORT), Sink)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # OneUptime is in a container, and DevStack can leave this machine's firewall closed to it.
    whole.run("sink", f"sudo iptables -I INPUT -p tcp --dport {SINK_PORT} -j ACCEPT")

    whole.part("oneuptime", "a person signs up, and makes an ingestion key", whole.part_oneuptime)
    whole.part("agent", "the agent, installed as the docs say", whole.part_agent, needs=["oneuptime"])
    whole.part("page", "a status page for the cloud, in one step", part_page, needs=["agent"])
    whole.part("notices", "a notice on one project, off on another", part_notices, needs=["page"])
    whole.part("break", "nova-compute really stopped, and who hears", part_break, needs=["notices"])
    whole.part("planned", "a maintenance event on the host, and a disable", part_planned, needs=["break"])

    found("everything the webhook received", RECEIVED)
    RESULTS["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    whole.save()

    failed = [item for item in RESULTS.get("checks", []) if not item.get("passed")]
    passed = len(RESULTS.get("checks", [])) - len(failed)
    say(f"\n{passed} checks passed, and {len(failed)} failed")
    for item in failed:
        say(f"  FAILED: {item['what']} ({item['detail'][:400]})")
    if failed:
        sys.exit(1)
    say("Every check passed, on a real cloud and a running OneUptime")


if __name__ == "__main__":
    main()

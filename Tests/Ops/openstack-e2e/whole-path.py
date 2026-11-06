#!/usr/bin/env python3
"""The whole path: a real cloud, through a real agent and a real probe, into a running OneUptime.

live-oneuptime.py sends a running OneUptime what was recorded. agent-install.sh runs the real agent
against a stand-in. This is the two joined, on one runner, with nothing recorded and nothing stood in
for: the DevStack beside it is the cloud, and the OneUptime beside it is the one the app and the
probe were built for, from this branch.

  oneuptime  A person signs up, and makes a project's ingestion key.
  agent      The agent installed as telemetry/openstack.md says: its commands lifted off the page,
             its level 1 credential, its answers typed on stdin. The cloud then has to register
             itself, and hold the names estate.sh gave its instances, volumes, networks and the
             rest, each with the status the cloud itself gives it.
  break      nova-compute really stopped. The same OneUptime has to say so: its row on the Services
             page goes down, and a monitor made from the real Compute Service Down template opens
             an incident naming the host, after waiting out its whole window, not a shorter one.
             Started again, the row comes back and the incident resolves.
  probe      The same cloud through a project's own probe, as a person does it from the dashboard:
             the same routes, a connection test that finds the cloud's certificate, the certificate
             trusted, the cloud connected. Its rows have to come back from that probe's collection.
  traces     A signed boot, through the agent's traces profile, as far as its spans read back.

Every check says what it found, in $OUTPUT_DIR/whole-path.json, and a part that fails costs only what
needs it. No secret is kept by value, there or in logs/. Exits 1 when a check failed, having named
each one last.

    ONEUPTIME_URL=http://localhost:8880 OUTPUT_DIR=out python3 -I whole-path.py

It stops and restarts real services, makes accounts and rewrites configs, so never point it at a
cloud that matters. Only standard library, because this runs on a bare runner.
"""
import importlib.util
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPOSITORY = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUTPUT_DIR = os.path.abspath(os.environ.get("OUTPUT_DIR", "out"))
LOGS = os.path.join(OUTPUT_DIR, "logs")

os.environ.setdefault("ONEUPTIME_URL", "http://localhost:8880")
os.environ.setdefault("OS_CLOUD", "devstack-admin")

# -I leaves this folder off the path, and its name is no module's, so it is loaded by where it is.
_spec = importlib.util.spec_from_file_location("live_oneuptime", os.path.join(HERE, "live-oneuptime.py"))
live = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(live)

# install.sh takes ONEUPTIME_URL from its environment as an answer, and this one is this machine's
# own name for OneUptime, which a container on Docker's network could not use.
API_URL = os.environ.pop("ONEUPTIME_URL").rstrip("/")
PORT = urllib.parse.urlsplit(API_URL).port or 80

# The name the docs' examples give a cloud, because the screenshots of these pages go in the docs.
AGENT_CLOUD = "prod-eu"
PROBE_CLOUD = "prod-eu-probe"
REGION = "RegionOne"
ACCOUNT = "oneuptime-monitoring"
DOCS_PAGE = os.path.join(REPOSITORY, "packages/App/FeatureSet/Docs/Content/en/telemetry/openstack.md")
CATALOG = os.path.join(REPOSITORY, "packages/Common/Types/InstallScripts/InstallScripts.ts")
TEMPLATE_ID = "openstack-compute-service-down"
COMPUTE_UNIT = "devstack@n-cpu.service"
VENV = os.environ.get("DEVSTACK_VENV", "/opt/stack/data/venv")
# The browser, in the image the browser jobs run in, at the Playwright packages/E2E locks.
PLAYWRIGHT_IMAGE = os.environ.get("PLAYWRIGHT_IMAGE", "")
SCREENSHOTS = os.path.join(OUTPUT_DIR, "screenshots")
PROJECTS_ON_THE_HOST = ("ou-payments", "ou-research")
# Which parts a dispatch asked for, by name, when it did not want them all: what each needs too.
WANTED_PARTS = os.environ.get("WHOLE_PATH_PARTS", "").split()
TRACED_CONFS = (
    "/etc/nova/nova.conf",
    "/etc/nova/nova_cell1.conf",
    "/etc/nova/nova-cpu.conf",
    "/etc/neutron/neutron.conf",
    "/etc/cinder/cinder.conf",
    "/etc/glance/glance-api.conf",
    "/etc/keystone/keystone.conf",
)
# Every page of a cloud with no id of its own in its address, for what a browser says of each.
CLOUD_PAGES = (
    "networks routers floating-ips bare-metal volumes storage-pools images flavors availability-zones aggregates "
    "subnets network-agents snapshots stacks kubernetes-clusters shares dns-zones databases projects domains "
    "control-plane insights recommendations capacity spend ai/insights ai/logs ai/agent metrics logs traces checks "
    "incidents alerts scheduled-maintenance owners feed audit-logs settings documentation"
).split()

# What estate.sh makes, by name. Service rows are held to what the cloud itself lists, as well.
ESTATE = {
    "Instance": {"ou-running": "ACTIVE", "ou-stopped": "SHUTOFF", "ou-failed": "ERROR", "ou-research-1": "ACTIVE"},
    "Volume": {"ou-vol-free": "available", "ou-vol-used": "in-use", "ou-vol-bad": "error", "ou-vol-stuck": "attaching"},
    "Network": {"ou-net": None, "ou-research-net": None},
    "Router": {"ou-router": None},
    "Project": {"ou-payments": None, "ou-research": None},
    "Flavor": {"ou.tiny": None, "ou.impossible": None},
    "Image": {"ou-image-stuck": None},
}

STATE = {}
SECRETS = set()
DONE = set()
PART = "setup"
WORK = tempfile.mkdtemp(prefix="whole-path-")
RESULTS = live.RESULTS


def say(line):
    print(scrub(str(line)), flush=True)


def secret(value):
    """A value nothing kept may hold, and the job's log masks."""
    if value:
        SECRETS.add(str(value))
        print(f"::add-mask::{value}", flush=True)
    return value


def scrub(text):
    for value in SECRETS:
        text = text.replace(value, "<secret>")
    return text


def save():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(os.path.join(OUTPUT_DIR, "whole-path.json"), "w", encoding="utf-8") as handle:
        handle.write(scrub(json.dumps(RESULTS, indent=2, default=str, sort_keys=True)))


def check(what, passed, detail=""):
    """One finding, named for its part: a failure says which, in the job's log and in the artifact."""
    named = f"{PART}: {what}"
    detail = scrub(str(detail))
    live.check(named, passed, detail)
    if not passed:
        print(f"::error title=whole path, {PART}::{scrub(what)}: {detail[:600]}", flush=True)
    save()
    return bool(passed)


def found(key, value):
    """What this part read, with its real values."""
    RESULTS.setdefault("found", {}).setdefault(PART, {})[key] = value
    save()


class Ran:
    def __init__(self, status, out, err):
        self.status = status
        self.out = out
        self.err = err
        self.text = out + err

    def __bool__(self):
        return self.status == 0


def run(name, command, stdin=None, env=None, cwd=None, timeout=600, keep_output=True):
    """A shell line: what it printed goes in logs/<name>.log, without a secret, and a failure is returned.

    In env, None takes a variable away. keep_output=False is for what prints a secret nothing here
    knows yet, such as a credential being made.
    """
    environment = dict(os.environ)
    for key, value in (env or {}).items():
        if value is None:
            environment.pop(key, None)
        else:
            environment[key] = value
    started = time.time()
    try:
        done = subprocess.run(
            ["bash", "-o", "pipefail", "-c", command],
            input=stdin,
            env=environment,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            timeout=timeout,
        )
        result = Ran(done.returncode, done.stdout or "", done.stderr or "")
    except subprocess.TimeoutExpired as expired:
        def text_of(part):
            return part.decode(errors="replace") if isinstance(part, bytes) else (part or "")

        result = Ran(124, text_of(expired.stdout), text_of(expired.stderr) + f"\nStopped after {timeout}s\n")
    os.makedirs(LOGS, exist_ok=True)
    with open(os.path.join(LOGS, f"{name}.log"), "a", encoding="utf-8") as handle:
        printed = result.text if keep_output or result.status else "(what it printed is not kept)"
        handle.write(scrub(f"$ {command}\n{printed}\n[exit {result.status}, {round(time.time() - started)}s]\n\n"))
    return result


def must(name, command, **options):
    result = run(name, command, **options)
    if not result:
        raise RuntimeError(f"{name} exited {result.status}: {scrub(result.text[-1500:])}")
    return result


def first_line(ran):
    lines = ran.out.split("\n")
    return lines[0].strip()


def cloud_json(arguments, env=None):
    """What the real cloud says, from its own command line, as a list of rows."""
    return json.loads(must("openstack", f"openstack {arguments} -f json", env=env).out or "[]")


def wait_for(test, seconds, gap=15):
    """The first true answer and how long it took, or None. An API can be restarting, so an error is a no."""
    started = time.time()
    while True:
        try:
            answer = test()
        except Exception as error:  # pylint: disable=broad-except
            STATE["last error"] = f"{type(error).__name__}: {error}"
            answer = None
        if answer:
            return answer, round(time.time() - started)
        if time.time() - started >= seconds:
            return None, round(time.time() - started)
        time.sleep(gap)


def item_of(answer):
    data = answer.get("data")
    return data if isinstance(data, dict) else answer


def id_of(answer):
    return item_of(answer)["_id"]


def typed_id(value):
    return {"_type": "ObjectID", "value": value}


def memory(note):
    say(f"--- {note}")
    say(run("memory", "free -m; df -h / | tail -1; docker stats --no-stream --format '{{.Name}} {{.MemUsage}}'").text)


def part(name, about, body, needs=()):
    global PART
    PART = name
    if WANTED_PARTS and name not in WANTED_PARTS:
        say(f"\n======== {name}: not asked for on this dispatch")
        return
    say(f"\n======== {name}: {about}")
    started = time.time()
    missing = [wanted for wanted in needs if wanted not in DONE]
    if missing:
        check("this part did not run", False, f"it needs {', '.join(missing)}, which did not finish")
        return
    try:
        body()
        DONE.add(name)
    except Exception as error:  # pylint: disable=broad-except
        check("this part finished", False, f"{type(error).__name__}: {error}")
    RESULTS.setdefault("seconds", {})[name] = round(time.time() - started)
    memory(f"after {name}")
    save()


# ----------------------------------------------------------------------------------------------
# What a person sees
# ----------------------------------------------------------------------------------------------
def cloud_path(cloud_id, page=""):
    return f"/dashboard/{live.PROJECT_ID}/openstack/{cloud_id}" + (f"/{page}" if page else "")


def named_page(name, file, path_of_page, **wanted):
    """A page the docs show: it has to hold what the cloud holds, and draw no empty state."""
    return {"name": name, "file": file, "path": path_of_page, "isNamed": True, **wanted}


def sweep_of(cloud_id, label):
    """Every other page of a cloud: one that throws or draws an error fails, and the rest is reported."""
    return [
        {
            "name": f"{label}: {page}",
            "file": f"sweep/{label}-{page.replace('/', '-')}.png",
            "path": cloud_path(cloud_id, page),
            "isGuide": page == "documentation",
        }
        for page in CLOUD_PAGES
    ]


def look_at(stage, pages):
    """Real pages in a real browser, at the size the docs' screenshots are. Each fails by its own name."""
    os.makedirs(SCREENSHOTS, exist_ok=True)
    spec_file = f"spec-{stage}.json"
    report_file = f"report-{stage}.json"
    with open(os.path.join(SCREENSHOTS, spec_file), "w", encoding="utf-8") as handle:
        json.dump({"baseUrl": API_URL, "email": live.EMAIL, "pages": pages}, handle)
    ran = run(
        f"pages-{stage}",
        f"docker run --rm --network host --ipc=host -v {shlex.quote(REPOSITORY)}:/repo:ro "
        f"-v {shlex.quote(SCREENSHOTS)}:/shots -w /repo -e WALK_PASSWORD -e NODE_PATH=/repo/packages/E2E/node_modules "
        f"{shlex.quote(PLAYWRIGHT_IMAGE)} node Tests/Ops/openstack-e2e/whole-path-pages.cjs "
        f"/shots/{spec_file} /shots/{report_file}",
        env={"WALK_PASSWORD": live.PASSWORD},
        timeout=1500,
    )
    check(f"a browser reads the pages, {stage}", ran.status == 0, f"exit {ran.status}: {ran.text[-600:] if ran.status else ''}")
    try:
        with open(os.path.join(SCREENSHOTS, report_file), encoding="utf-8") as handle:
            reports = json.load(handle)
    except (OSError, ValueError) as error:
        check(f"it reports on them, {stage}", False, error)
        return
    all_console_errors = RESULTS.setdefault("console errors", {})
    for report in reports:
        told = report.get("consoleErrors") or []
        if told:
            all_console_errors[report["name"]] = told
            say(f"  console, {report['name']}: {told[:4]}")
        if report.get("failedRequests"):
            RESULTS.setdefault("failed requests", {})[report["name"]] = report["failedRequests"]
        if report.get("emptyStates"):
            RESULTS.setdefault("empty states", {})[report["name"]] = report["emptyStates"]
        problems = report.get("problems") or []
        check(
            f"{report['name']} shows what the cloud holds, and draws no error"
            if report.get("isNamed")
            else f"{report['name']} throws nothing and draws no error",
            not problems,
            "; ".join(problems)[:900] if problems else report.get("file"),
        )


# ----------------------------------------------------------------------------------------------
# What a page reads
# ----------------------------------------------------------------------------------------------
def rows_of(cloud_id, kind):
    """The route the cloud's pages read a kind through, all of it."""
    rows, after = [], None
    while True:
        body = {"kind": kind, "limit": 500}
        if after:
            body["afterExternalId"] = after
        page = live.api("POST", f"/openstack-resource/rows/{cloud_id}", body)
        rows += page.get("rows", [])
        after = page.get("nextExternalId")
        if not after:
            return rows


def service_rows(cloud_id):
    """The cloud's Services page."""
    return live.api("POST", f"/openstack-resource/services/{cloud_id}", {}).get("workers", [])


def inventory_of(cloud_id):
    inventory = {kind: rows_of(cloud_id, kind) for kind in list(ESTATE) + ["Hypervisor"]}
    inventory["Service"] = service_rows(cloud_id)
    return inventory


def cloud_row(cloud_id):
    return item_of(
        live.api(
            "POST",
            f"/openstack-cloud/{cloud_id}/get-item",
            {
                "select": {
                    "name": True,
                    "agentVersion": True,
                    "otelCollectorStatus": True,
                    "lastSeenAt": True,
                    "regionCount": True,
                    "hypervisorCount": True,
                    "instanceCount": True,
                    "activeInstanceCount": True,
                    "volumeCount": True,
                    "networkCount": True,
                    "routerCount": True,
                    "projectCount": True,
                    "serviceCount": True,
                    "downServiceCount": True,
                    "collectionMethod": True,
                    "collectionStatus": True,
                    "collectionErrorCode": True,
                    "collectionError": True,
                    "lastCollectionAt": True,
                }
            },
        )
    )


def counts_of(cloud_id):
    """The cloud's row, once a whole collection has been added up on it."""
    row = cloud_row(cloud_id)
    return row if row.get("hypervisorCount") and row.get("instanceCount") else None


def short(rows):
    """A row, as the artifact keeps it."""
    keep = ("name", "status", "regionName", "hypervisorName", "adminState", "vcpuCapacity", "memoryCapacityBytes")
    return [{key: row.get(key) for key in keep if row.get(key) is not None} for row in rows]


def real_cloud():
    """What the cloud itself says right now, which every row is held to."""
    services = [row["Binary"] for row in cloud_json("compute service list")]
    services += [row["Binary"] for row in cloud_json("volume service list")]
    services += [row["Binary"] for row in cloud_json("network agent list")]
    return {
        "Instance": {row["Name"]: row["Status"] for row in cloud_json("server list --all-projects") if row.get("Name")},
        "Volume": {row["Name"]: row["Status"] for row in cloud_json("volume list --all-projects") if row.get("Name")},
        "Hypervisor": {row["Hypervisor Hostname"]: row.get("State") for row in cloud_json("hypervisor list")},
        "Service": sorted(set(services)),
    }


def missing_from(inventory, real):
    gone = []
    for kind, names in ESTATE.items():
        have = {row.get("name") for row in inventory[kind]}
        gone += [f"{kind} {name}" for name in names if name not in have]
    have = {row.get("name") for row in inventory["Instance"]}
    gone += [f"Instance {name}" for name in real["Instance"] if name not in have]
    have = {row.get("name") for row in inventory["Volume"]}
    gone += [f"Volume {name}" for name in real["Volume"] if name not in have]
    have = {row.get("name") for row in inventory["Hypervisor"]}
    gone += [f"Hypervisor {name}" for name in real["Hypervisor"] if name not in have]
    have = {row.get("name") for row in inventory["Service"]}
    gone += [f"Service {name}" for name in real["Service"] if name not in have]
    return sorted(set(gone))


def expect_the_cloud(cloud_id, seconds):
    """Wait for every name the cloud holds, then hold each to what the cloud itself says of it."""
    real = real_cloud()
    found("what the cloud itself says", real)
    latest = {}

    def complete():
        latest["inventory"] = inventory_of(cloud_id)
        latest["missing"] = missing_from(latest["inventory"], real)
        return not latest["missing"]

    done, waited = wait_for(complete, seconds, gap=20)
    inventory = latest.get("inventory") or {}
    found("rows", {kind: short(rows) for kind, rows in inventory.items()})
    found("seconds until every name was there", waited)
    check(
        "every name the cloud holds has a row",
        bool(done),
        f"after {waited}s" if done else f"after {waited}s, still no {latest.get('missing')}; {STATE.get('last error', '')}",
    )
    if not inventory:
        return real, inventory

    for kind, names in ESTATE.items():
        by_name = {row.get("name"): row for row in inventory[kind]}
        for name, wanted in names.items():
            row = by_name.get(name)
            if not row:
                check(f"{kind} {name} has a row", False, f"its rows are {sorted(by_name, key=str)}")
                continue
            if wanted is None:
                check(f"{kind} {name} has a row", True, row.get("status") or "")
                continue
            told = real.get(kind, {}).get(name)
            check(
                f"{kind} {name} reads what the cloud says",
                str(row.get("status")).lower() == wanted.lower() and str(told).lower() == wanted.lower(),
                f"row {row.get('status')}, cloud {told}, estate.sh left it {wanted}",
            )
    hypervisors = {row.get("name"): row for row in inventory["Hypervisor"]}
    for name in real["Hypervisor"]:
        row = hypervisors.get(name)
        check(
            f"hypervisor {name} has a row, with its capacity",
            bool(row and row.get("vcpuCapacity")),
            f"{row.get('vcpuCapacity')} vCPUs, {row.get('memoryCapacityBytes')} bytes, {row.get('status')}" if row else "no row",
        )
    services = {row.get("name") for row in inventory["Service"]}
    for binary in real["Service"]:
        check(f"service {binary} has a row", binary in services, sorted(services, key=str) if binary not in services else "")
    return real, inventory


# ----------------------------------------------------------------------------------------------
# oneuptime
# ----------------------------------------------------------------------------------------------
def part_oneuptime():
    live.sign_in()
    check("a person signs up, and has a project", bool(live.PROJECT_ID), live.PROJECT_ID)
    answer = live.api(
        "POST",
        "/telemetry-ingestion-key",
        {"data": {"name": "The whole path", "description": "The agent's key", "projectId": live.PROJECT_ID}},
    )
    token = live.value_of(item_of(answer).get("secretKey"))
    if not token:
        token = live.value_of(live.rows("/telemetry-ingestion-key", {"projectId": live.PROJECT_ID}, {"secretKey": True}, limit=1)[0]["secretKey"])
    STATE["ingestion key"] = secret(token)
    check("the project has an ingestion key", bool(token), "kept out of this file")

    STATE["auth url"] = first_line(must("endpoints", "openstack endpoint list --service identity --interface public -f value -c URL"))
    STATE["host ip"] = urllib.parse.urlsplit(STATE["auth url"]).hostname
    STATE["url"] = f"http://{STATE['host ip']}:{PORT}"
    STATE["host"] = first_line(must("endpoints", "openstack compute service list --service nova-compute -f value -c Host"))
    clouds = must("clouds-yaml", "sudo cat /etc/openstack/clouds.yaml", timeout=30, keep_output=False).out
    match = re.search(r"cacert:\s*['\"]?([^'\"\s]+)", clouds)
    STATE["ca file"] = match.group(1) if match else "/opt/stack/data/ca-bundle.pem"
    found(
        "where everything is",
        {
            "keystone": STATE["auth url"],
            "oneuptime, from the agent": STATE["url"],
            "compute host": STATE["host"],
            "the cloud's CA": STATE["ca file"],
        },
    )
    check("Keystone speaks https, or no probe would read it", STATE["auth url"].startswith("https://"), STATE["auth url"])
    answered = run(
        "served", f"curl -fsS -o /dev/null -w '%{{http_code}} %{{content_type}}' {shlex.quote(STATE['url'])}/install/openstack-agent"
    )
    check(
        "this OneUptime serves the agent's install script, as plain text, at the address the agent gets",
        answered.status == 0 and answered.out.startswith("200 text/plain"),
        answered.text,
    )


# ----------------------------------------------------------------------------------------------
# agent
# ----------------------------------------------------------------------------------------------
def as_account_env():
    return {
        "OS_CLOUD": None,
        "OS_AUTH_URL": STATE["auth url"],
        "OS_IDENTITY_API_VERSION": "3",
        "OS_USERNAME": ACCOUNT,
        "OS_PASSWORD": STATE["account password"],
        "OS_PROJECT_NAME": ACCOUNT,
        "OS_USER_DOMAIN_NAME": "Default",
        "OS_PROJECT_DOMAIN_NAME": "Default",
        "OS_CACERT": STATE["ca file"],
    }


def make_credential(name):
    """telemetry/openstack.md's level 1: limited by rules fitted to this cloud, and given an expiry."""
    answer = json.loads(
        must(
            "credential",
            f"openstack application credential create {name} --role admin "
            f'--access-rules "$(cat {shlex.quote(os.path.join(WORK, "access-rules-for-this-cloud.json"))})" '
            "--expiration 2030-11-01T00:00:00 -f json",
            env=as_account_env(),
            keep_output=False,
        ).out
    )
    # The client's words differ by release: id or ID, secret or Secret.
    fields = {key.lower(): value for key, value in answer.items()}
    return secret(fields["id"]), secret(fields["secret"])


def level_one_credential():
    """As the docs say. The password is the rig's own, because the docs' asks a terminal for it."""
    url = STATE["url"]
    STATE["account password"] = secret(secrets.token_hex(16))
    must(
        "credential",
        f"openstack project show {ACCOUNT} >/dev/null 2>&1 || openstack project create --domain default {ACCOUNT}; "
        f"openstack user create --domain default --password {shlex.quote(STATE['account password'])} {ACCOUNT}; "
        f"openstack role add --project {ACCOUNT} --user {ACCOUNT} admin",
    )
    must(
        "credential",
        f"curl -fsSLO {url}/install/openstack-agent/access/application-credential-access-rules.json && "
        f"curl -fsSLO {url}/install/openstack-agent/access/access-rules-for-cloud.py && "
        "openstack catalog list -f json | python3 access-rules-for-cloud.py "
        "application-credential-access-rules.json > access-rules-for-this-cloud.json",
        env=as_account_env(),
        cwd=WORK,
    )
    # Its table of service_type settings, without which each service refuses the rules with a 401.
    for conf, kind in (
        ("/etc/nova/nova.conf", "compute"),
        ("/etc/neutron/neutron.conf", "network"),
        ("/etc/cinder/cinder.conf", "block-storage"),
        ("/etc/glance/glance-api.conf", "image"),
        ("/etc/placement/placement.conf", "placement"),
    ):
        must(
            "service-type",
            f"! sudo test -f {conf} || sudo grep -q '^service_type = {kind}' {conf} || "
            f"sudo sed -i '/^\\[keystone_authtoken\\]/a service_type = {kind}' {conf}",
        )
    for unit in (
        "devstack@n-api.service",
        "devstack@q-svc.service",
        "devstack@neutron-api.service",
        "devstack@c-api.service",
        "devstack@g-api.service",
        "devstack@placement-api.service",
    ):
        must("service-type", f"if systemctl cat {unit} >/dev/null 2>&1; then sudo systemctl restart {unit}; fi")

    def answers():
        return bool(
            run(
                "service-type",
                "openstack compute service list && openstack network agent list && "
                "openstack image list && openstack volume service list",
            )
        )

    _, waited = wait_for(answers, 240, gap=10)
    check("the APIs answer again, with service_type set", answers(), f"after {waited}s")


def part_agent():
    level_one_credential()
    STATE["agent credential"] = make_credential("oneuptime-agent")
    check("the docs' level 1 credential is made, limited by access rules", True, "kept out of this file")

    docs = os.path.join(WORK, "docs")
    os.makedirs(docs, exist_ok=True)
    must(
        "docs",
        f"python3 -I {shlex.quote(os.path.join(HERE, 'agent-install-docs.py'))} {shlex.quote(DOCS_PAGE)} "
        f"{shlex.quote(docs)} {shlex.quote(STATE['url'])} {shlex.quote(CATALOG)}",
    )
    STATE["docs"] = docs
    with open(os.path.join(docs, "install-docker.sh"), encoding="utf-8") as handle:
        block = handle.read()
    found("the docs' commands, as run", block)

    # In the order install.sh asks: its URL, the key, the cloud's name, Keystone, the regions (the
    # default), yes to an application credential, its ID and secret, and this cloud's own CA.
    app_id, app_secret = STATE["agent credential"]
    answers = "\n".join(
        [STATE["url"], STATE["ingestion key"], AGENT_CLOUD, STATE["auth url"], "", "", app_id, app_secret, STATE["ca file"]]
    )
    folder = tempfile.mkdtemp(prefix="agent-", dir=WORK)
    installed = run(
        "agent-install",
        f"sudo bash -euo pipefail -c {shlex.quote('cd ' + folder + '; ' + block)}",
        stdin=answers + "\n",
        timeout=1200,
    )
    check("the docs' install commands exit 0", installed.status == 0, f"exit {installed.status}: {installed.text[-1500:] if installed.status else ''}")
    for words in ("Keystone accepted the credential.", "OneUptime OpenStack Agent is running!"):
        check(f"install.sh says: {words}", words in installed.text)
    STATE["agent folder"] = folder

    def registered():
        return live.rows("/openstack-cloud", {"name": AGENT_CLOUD}, {"_id": True, "name": True})

    clouds, waited = wait_for(registered, 480)
    check(
        "the cloud registers itself, from its first real data",
        bool(clouds),
        f"after {waited}s" if clouds else f"nothing after {waited}s; {STATE.get('last error', '')}",
    )
    if not clouds:
        raise RuntimeError("The cloud never registered, so there is nothing to read")
    STATE["agent cloud"] = clouds[0]["_id"]

    real, inventory = expect_the_cloud(STATE["agent cloud"], 780)
    STATE["agent inventory"] = inventory
    STATE["real"] = real
    counted, _ = wait_for(lambda: counts_of(STATE["agent cloud"]), 240)
    found("the cloud's row", counted or cloud_row(STATE["agent cloud"]))
    check("the cloud's own row counts its hypervisors and instances", bool(counted), counted or cloud_row(STATE["agent cloud"]))

    # What the docs say to run when nothing shows up, on an agent that works.
    with open(os.path.join(docs, "troubleshoot.sh"), encoding="utf-8") as handle:
        doctor = handle.read()
    told = run("agent-doctor", f"bash -euo pipefail -c {shlex.quote(doctor)}", cwd=folder, stdin="", timeout=300)
    check(
        "troubleshoot.sh calls it healthy",
        told.status == 0 and "The agent looks healthy and OneUptime accepts the token." in told.text,
        f"exit {told.status}: {told.text[-1200:] if told.status else ''}",
    )

    cloud_id = STATE["agent cloud"]
    look_at(
        "healthy",
        [
            named_page("The cloud's Overview", "OpenStackCloudOverview.png", cloud_path(cloud_id), text=[AGENT_CLOUD]),
            named_page("Hypervisors", "OpenStackHypervisors.png", cloud_path(cloud_id, "hypervisors"), text=[STATE["host"]]),
            named_page("Instances", "OpenStackInstances.png", cloud_path(cloud_id, "instances"), text=["ou-running", "ou-research-1"]),
            named_page(
                "Topology",
                "OpenStackTopology.png",
                cloud_path(cloud_id, "topology"),
                marks=[{"selector": '[data-testid="resource-topology-card-cloud"]'}],
            ),
            *sweep_of(cloud_id, "agent"),
        ],
    )


# ----------------------------------------------------------------------------------------------
# break
# ----------------------------------------------------------------------------------------------
def nova_compute_row(cloud_id):
    for row in service_rows(cloud_id):
        if row.get("name") == "nova-compute" and row.get("hypervisorName") == STATE["host"]:
            return row
    return None


def nova_compute_state():
    rows = cloud_json(f"compute service list --service nova-compute --host {shlex.quote(STATE['host'])}")
    return rows[0]["State"] if rows else None


def monitor_status(monitor_id):
    answer = item_of(
        live.api(
            "POST",
            f"/monitor/{monitor_id}/get-item",
            {"select": {"name": True, "currentMonitorStatus": {"name": True, "isOperationalState": True, "isOfflineState": True}}},
        )
    )
    return answer.get("currentMonitorStatus") or {}


def template_monitor(cloud_name):
    """What the dashboard's picker saves: its monitor steps come out of the template's own code."""
    online, offline, incident_severity = live.statuses_and_severity()
    alert_severity = live.rows("/alert-severity", {"projectId": live.PROJECT_ID}, {"_id": True, "name": True, "order": True})[0]["_id"]
    bundle = os.path.join(WORK, "template.cjs")
    must(
        "template",
        f"packages/Common/node_modules/.bin/esbuild Tests/Ops/openstack-e2e/whole-path-template.ts --bundle --platform=node "
        f"--log-level=warning --outfile={shlex.quote(bundle)}",
        cwd=REPOSITORY,
    )
    printed = must(
        "template",
        " ".join(shlex.quote(word) for word in ["node", bundle, TEMPLATE_ID, cloud_name, online, offline, incident_severity, alert_severity]),
    ).out
    template = json.loads(printed)
    found("the template's monitor steps", template["monitorSteps"])
    created = live.api(
        "POST",
        "/monitor",
        {"data": {"name": template["name"], "monitorType": "OpenStack", "monitorSteps": template["monitorSteps"]}},
    )
    return id_of(created), template["name"]


INCIDENT_SELECT = {
    "_id": True,
    "title": True,
    "description": True,
    "createdAt": True,
    "rootCause": True,
    "currentIncidentState": {"name": True, "isResolvedState": True},
    "openStackClouds": {"_id": True, "name": True},
}


def compute_down_incidents():
    rows = live.rows("/incident", {"projectId": live.PROJECT_ID}, INCIDENT_SELECT, limit=200)
    return [row for row in rows if "Compute Service Down" in (row.get("title") or "")]


def compute_down_alerts():
    rows = live.rows(
        "/alert",
        {"projectId": live.PROJECT_ID},
        {"_id": True, "title": True, "description": True, "createdAt": True, "currentAlertState": {"name": True, "isResolvedState": True}},
        limit=200,
    )
    return [row for row in rows if "Compute Service Down" in (row.get("title") or "")]


def instances_on_the_host():
    """What Nova itself has on the host, by project, which the incident is held to."""
    return {
        project: sorted(row["Name"] for row in cloud_json(f"server list --host {shlex.quote(STATE['host'])} --project {project}"))
        for project in PROJECTS_ON_THE_HOST
    }


def blast_radius_read(text, on_host):
    """What is wrong with what a notification says it affects, or nothing. #5730's "Done when"."""
    wrong = []
    holding = {project: names for project, names in on_host.items() if names}
    total = sum(len(names) for names in holding.values())
    match = re.search(r"What this affects:\**\s*(\d+) instances? in (\d+) projects?", text or "")
    if not match:
        return [f'no "What this affects" line in: {(text or "")[:300]}']
    if (int(match.group(1)), int(match.group(2))) != (total, len(holding)):
        wrong.append(f"it says {match.group(0)}, and Nova has {total} in {len(holding)}")
    for project, names in holding.items():
        if not re.search(rf"{re.escape(project)}: {len(names)} instances?\b", text):
            wrong.append(f"it does not say {project}: {len(names)} instances")
    return wrong


def said(read):
    """What a read says, for a finding's detail. One that fails says so, and costs no finding."""
    try:
        return read()
    except Exception as error:  # pylint: disable=broad-except
        return f"(could not read it: {type(error).__name__}: {error})"


def status_timeline(monitor_id):
    rows = live.rows(
        "/monitor-status-timeline",
        {"monitorId": typed_id(monitor_id)},
        {"createdAt": True, "startsAt": True, "monitorStatus": {"name": True}},
        limit=50,
    )
    return [{"at": row.get("startsAt") or row.get("createdAt"), "status": (row.get("monitorStatus") or {}).get("name")} for row in rows]


def stage(name, body):
    """What can fail in one stage of a part costs that stage: firing and recovering are read apart."""
    try:
        body()
    except Exception as error:  # pylint: disable=broad-except
        check(f"{name} was read to its end", False, f"{type(error).__name__}: {error}")


def while_stopped(cloud_id, monitor_id, stopped_at):
    down, waited = wait_for(lambda: nova_compute_state() == "down", 300, gap=5)
    check("the cloud itself says nova-compute is down", bool(down), f"after {waited}s")

    def row_down():
        row = nova_compute_row(cloud_id)
        return row if row and row.get("status") == "down" else None

    row, waited = wait_for(row_down, 480)
    check(
        "nova-compute's row on the Services page goes down",
        bool(row),
        f"{round(time.time() - stopped_at)}s after the stop: {row}" if row else f"still {said(lambda: nova_compute_row(cloud_id))} after {waited}s",
    )
    found("the row while it was down", row)
    found("the hypervisor while it was down", said(lambda: short(rows_of(cloud_id, "Hypervisor"))))
    counted, _ = wait_for(lambda: cloud_row(cloud_id).get("downServiceCount"), 240)
    found("the cloud's row while it was down", said(lambda: cloud_row(cloud_id)))
    check("the cloud's row counts it as a down service", bool(counted), counted)

    # The template's whole window, ten minutes, as a person waits it: nothing here shortens it.
    opened, waited = wait_for(compute_down_incidents, 1500, gap=20)
    check(
        "the monitor opens an incident, having waited its whole window",
        bool(opened),
        f"{round(time.time() - stopped_at)}s after the stop"
        if opened
        else f"nothing {waited}s on; the monitor reads {said(lambda: monitor_status(monitor_id))}; {STATE.get('last error', '')}",
    )
    found("the monitor's status timeline, while it was down", said(lambda: status_timeline(monitor_id)))
    if not opened:
        return
    incident = opened[0]
    found("the incident", incident)
    found("seconds from the stop to the incident", round(time.time() - stopped_at))
    title = incident.get("title") or ""
    check("its title names the template", "[OpenStack] Compute Service Down" in title, title)
    check(f"and the host, {STATE['host']}", f"Host: {STATE['host']}" in title, title)
    check("exactly one incident opened", len(opened) == 1, [row.get("title") for row in opened])
    clouds = [cloud.get("_id") for cloud in incident.get("openStackClouds") or []]
    check("the incident is on that cloud's Incidents page", clouds == [cloud_id], incident.get("openStackClouds"))
    status, _ = wait_for(lambda: monitor_status(monitor_id).get("isOfflineState"), 120, gap=10)
    check("the monitor reads offline", bool(status), said(lambda: monitor_status(monitor_id)))
    alerts, _ = wait_for(compute_down_alerts, 120, gap=10)
    found("the alert", alerts)
    check("its alert opened with it", bool(alerts) and len(alerts) == 1, [row.get("title") for row in alerts or []])

    # #5730's "Done when": how many instances in which projects, held to what Nova itself has there.
    on_host = instances_on_the_host()
    found("what Nova has on the host", on_host)
    wrong = blast_radius_read(incident.get("description"), on_host)
    check("the incident says how many instances in which projects are affected", not wrong, wrong or on_host)
    wrong = blast_radius_read((alerts or [{}])[0].get("description"), on_host)
    check("the alert says how many instances in which projects are affected", not wrong, wrong or on_host)

    states = {row["Name"]: row["Status"] for row in cloud_json("server list --all-projects")}
    awake = [name for names in on_host.values() for name in names if states.get(name) != "SHUTOFF"]
    host_card = f'[data-testid="resource-topology-card-hypervisor:{REGION}/{STATE["host"]}"]'
    look_at(
        "broken",
        [
            named_page(
                "Services, with nova-compute down",
                "OpenStackServicesComputeDown.png",
                cloud_path(cloud_id, "services"),
                marks=[
                    {
                        "selector": '[data-testid="openstack-service-worker"][data-name="nova-compute"]',
                        "attribute": "data-status",
                        "value": "down",
                        "scrollTo": True,
                    }
                ],
            ),
            named_page(
                "Topology, with that host red and its instances beneath it",
                "OpenStackTopologyComputeDown.png",
                cloud_path(cloud_id, "topology"),
                clicks=["resource-topology-filter-attention"],
                marks=[
                    {"selector": host_card, "attribute": "data-health", "value": "critical"},
                    {"selector": host_card, "hasText": "Down"},
                    *[{"selector": '[data-testid^="resource-topology-chip-instance:"]', "hasText": name} for name in awake],
                ],
            ),
            named_page(
                "The incident",
                "OpenStackIncidentComputeDown.png",
                f"/dashboard/{live.PROJECT_ID}/incidents/{incident['_id']}",
                text=["Compute Service Down", "What this affects"],
                # Nobody has asked OneUptime AI anything or started a call: both are honest about it.
                allowEmpty=["investigation-conversation-empty", "event-video-calls-empty"],
            ),
        ],
    )


def once_started(cloud_id, monitor_id, started_at):
    up, waited = wait_for(lambda: nova_compute_state() == "up", 300, gap=5)
    check("the cloud itself says nova-compute is up again", bool(up), f"after {waited}s")

    def row_up():
        row = nova_compute_row(cloud_id)
        return row if row and row.get("status") == "up" else None

    row, waited = wait_for(row_up, 480)
    check(
        "nova-compute's row comes back up",
        bool(row),
        f"{round(time.time() - started_at)}s after the start" if row else f"still {said(lambda: nova_compute_row(cloud_id))} after {waited}s",
    )

    def settled():
        rows = compute_down_incidents()
        return rows if rows and all((row.get("currentIncidentState") or {}).get("isResolvedState") for row in rows) else None

    resolved, waited = wait_for(settled, 1500, gap=20)
    check(
        "the incident resolves on its own",
        bool(resolved),
        f"{round(time.time() - started_at)}s after the start"
        if resolved
        else f"{said(compute_down_incidents)} after {waited}s; the monitor reads {said(lambda: monitor_status(monitor_id))}; {STATE.get('last error', '')}",
    )
    found("the monitor's status timeline, at the end", said(lambda: status_timeline(monitor_id)))
    if resolved:
        found("the incident, resolved", resolved)
        found("seconds from the start to the resolve", round(time.time() - started_at))
        check("nothing else opened", len(resolved) == 1, [row.get("title") for row in resolved])
    status, _ = wait_for(lambda: monitor_status(monitor_id).get("isOperationalState"), 120, gap=10)
    check("the monitor reads online again", bool(status), said(lambda: monitor_status(monitor_id)))

    def alerts_settled():
        rows = compute_down_alerts()
        return rows if rows and all((row.get("currentAlertState") or {}).get("isResolvedState") for row in rows) else None

    alerts, _ = wait_for(alerts_settled, 180, gap=10)
    found("the alert, afterwards", alerts or said(compute_down_alerts))
    check("its alert resolved with it", bool(alerts), said(compute_down_alerts))


def part_break():
    cloud_id = STATE["agent cloud"]
    monitor_id, monitor_name = template_monitor(AGENT_CLOUD)
    STATE["monitor"] = monitor_id
    check(f"a monitor is made from the real {monitor_name} template", True, monitor_id)
    before = nova_compute_row(cloud_id)
    check("nova-compute's row reads up before anything is stopped", bool(before) and before.get("status") == "up", before)
    # A healthy cloud opens nothing, however many times the monitor is read: its first reads, before the break.
    time.sleep(150)
    status = monitor_status(monitor_id)
    found("the monitor on a healthy cloud", status)
    check("the monitor reads online on a healthy cloud", bool(status.get("isOperationalState")), status.get("name"))
    check("and has opened nothing", not compute_down_incidents())

    stopped_at = time.time()
    must("break", f"sudo systemctl stop {COMPUTE_UNIT}")
    say(f"{COMPUTE_UNIT} stopped")
    try:
        stage("the time it was stopped", lambda: while_stopped(cloud_id, monitor_id, stopped_at))
    finally:
        started_at = time.time()
        must("break", f"sudo systemctl start {COMPUTE_UNIT}")
        say(f"{COMPUTE_UNIT} started")
    stage("the time after it started", lambda: once_started(cloud_id, monitor_id, started_at))


# ----------------------------------------------------------------------------------------------
# probe
# ----------------------------------------------------------------------------------------------
def connection_test(probe_id, credential, fingerprints):
    """The dashboard's Test connection: OpenStackConnectionTestPanel.tsx makes this row and reads it."""
    app_id, app_secret = credential
    created = live.api(
        "POST",
        "/openstack-cloud-connection-test",
        {
            "data": {
                "authUrl": STATE["auth url"],
                "endpointInterface": "public",
                "collectionRegions": [REGION],
                "probeId": typed_id(probe_id),
                "trustedCertificateFingerprints": fingerprints,
                "applicationCredentialId": app_id,
                "credentialSecret": app_secret,
            }
        },
    )
    test_id = id_of(created)

    def settled():
        row = item_of(
            live.api(
                "POST",
                f"/openstack-cloud-connection-test/{test_id}/get-item",
                {"select": {"status": True, "errorCode": True, "errorMessage": True, "presentedCertificate": True, "summary": True}},
            )
        )
        STATE["last test"] = row
        return row if row.get("status") in ("Succeeded", "Failed") else None

    row, waited = wait_for(settled, 240, gap=5)
    return row or STATE.get("last test") or {"status": f"nothing after {waited}s"}, waited


def part_probe():
    answer = live.api("POST", "/probe", {"data": {"name": "whole-path-probe", "description": "On the cloud's own machine"}})
    probe_id = id_of(answer)
    key = live.value_of(item_of(live.api("POST", f"/probe/{probe_id}/get-item", {"select": {"key": True}})).get("key"))
    secret(key)
    check("the project has a probe of its own, as custom-probe.md makes one", bool(probe_id and key), probe_id)

    # custom-probe.md's command, with the image built from this branch, and its values in its
    # environment to keep the key off a command line.
    started = run(
        "probe-start",
        "docker run --name oneuptime-probe --network host -e PROBE_KEY -e PROBE_ID -e ONEUPTIME_URL -d oneuptime/probe:test",
        env={"PROBE_KEY": key, "PROBE_ID": probe_id, "ONEUPTIME_URL": API_URL},
    )
    check("the probe starts, from the image built from this branch", started.status == 0, started.text[-800:])

    def connected():
        row = item_of(live.api("POST", f"/probe/{probe_id}/get-item", {"select": {"connectionStatus": True, "lastAlive": True}}))
        STATE["probe row"] = row
        return row if str(row.get("connectionStatus")).lower() == "connected" else None

    row, waited = wait_for(connected, 300, gap=10)
    found("the probe's row", STATE.get("probe row"))
    check("OneUptime sees it connect", bool(row), f"after {waited}s" if row else f"{STATE.get('probe row')} after {waited}s")

    credential = make_credential("oneuptime-probe")
    check("a credential of the docs' level 1 is made for it", True, "kept out of this file")

    fingerprints = []
    tests = []
    last = {}
    for _ in range(4):
        last, waited = connection_test(probe_id, credential, fingerprints)
        presented = live.value_of(last.get("presentedCertificate")) or {}
        tests.append(
            {
                "status": last.get("status"),
                "errorCode": last.get("errorCode"),
                "errorMessage": last.get("errorMessage"),
                "presentedCertificate": presented,
                "summary": live.value_of(last.get("summary")),
                "seconds": waited,
            }
        )
        found("each connection test", tests)
        fingerprint = presented.get("fingerprint256")
        if last.get("status") == "Failed" and fingerprint and fingerprint not in fingerprints:
            # Trust this certificate, on the test's own card.
            fingerprints.append(fingerprint)
            continue
        break
    check("the connection test finds the certificate of the cloud's own CA", bool(fingerprints), fingerprints)
    check(
        "with it trusted, the connection test succeeds",
        last.get("status") == "Succeeded",
        f"{last.get('status')}: {last.get('errorCode')} {last.get('errorMessage')}",
    )
    summary = live.value_of(last.get("summary")) or {}
    check("the test lists the cloud's region", REGION in (summary.get("regionsInCatalog") or []), summary.get("regionsInCatalog"))
    check("and calls the credential limited by rules", bool(summary.get("hasAccessRules")), summary.get("accessLevel"))

    # Connect Cloud, as OpenStackConnectCloudModal saves it.
    app_id, app_secret = credential
    created = live.api(
        "POST",
        "/openstack-cloud",
        {
            "data": {
                "name": PROBE_CLOUD,
                "collectionMethod": "Probe",
                "authUrl": STATE["auth url"],
                "endpointInterface": "public",
                "collectionRegions": [REGION],
                "credentialKind": "applicationCredential",
                "applicationCredentialId": app_id,
                "credentialSecret": app_secret,
                "collectionProbeId": typed_id(probe_id),
                "trustedCertificateFingerprints": fingerprints,
            }
        },
    )
    cloud_id = id_of(created)
    STATE["probe cloud"] = cloud_id
    check("Connect Cloud saves the cloud", bool(cloud_id), cloud_id)

    def collected():
        row = cloud_row(cloud_id)
        STATE["probe cloud row"] = row
        return row if row.get("collectionStatus") in ("Succeeded", "PartiallySucceeded", "Failed") else None

    row, waited = wait_for(collected, 480)
    found("the cloud's row, after its first collection", STATE.get("probe cloud row"))
    check(
        "the probe's first collection succeeds",
        bool(row) and row.get("collectionStatus") == "Succeeded",
        f"{(row or STATE.get('probe cloud row') or {}).get('collectionStatus')} after {waited}s: "
        f"{(row or STATE.get('probe cloud row') or {}).get('collectionErrorCode')} {(row or STATE.get('probe cloud row') or {}).get('collectionError')}",
    )

    _, inventory = expect_the_cloud(cloud_id, 480)
    agent_inventory = STATE.get("agent inventory") or {}
    differences = {}
    for kind, rows in inventory.items():
        through_probe = {row.get("name") for row in rows}
        through_agent = {row.get("name") for row in agent_inventory.get(kind, [])}
        if through_probe != through_agent:
            differences[kind] = {
                "only through the probe": sorted(through_probe - through_agent, key=str),
                "only through the agent": sorted(through_agent - through_probe, key=str),
            }
    found("how its rows differ from the agent's", differences)
    check(
        "the probe and the agent name the same instances, hypervisors and volumes",
        not any(kind in differences for kind in ("Instance", "Hypervisor", "Volume")),
        {kind: differences[kind] for kind in differences if kind in ("Instance", "Hypervisor", "Volume")},
    )
    counted, _ = wait_for(lambda: counts_of(cloud_id), 240)
    found("the cloud's row, at the end", counted or cloud_row(cloud_id))
    check("the cloud's own row counts what the probe found", bool(counted), counted or cloud_row(cloud_id))
    run("probe-logs", "docker logs --tail 400 oneuptime-probe")

    look_at(
        "probe",
        [
            named_page(
                "The probe's Data Collection",
                "OpenStackDataCollection.png",
                cloud_path(cloud_id, "settings"),
                marks=[{"selector": '[data-testid="openstack-data-collection"]', "hasText": "whole-path-probe", "scrollTo": True}],
                # The same page's cards for rules on a project or domain, and there are none.
                allowEmpty=["openstack-scoped-rules-empty"],
            ),
            named_page("The probe's cloud's Overview", "sweep/probe-overview.png", cloud_path(cloud_id), text=[PROBE_CLOUD]),
            named_page("The probe's cloud's Instances", "sweep/probe-instances.png", cloud_path(cloud_id, "instances"), text=["ou-running"]),
            *sweep_of(cloud_id, "probe"),
        ],
    )


# ----------------------------------------------------------------------------------------------
# traces
# ----------------------------------------------------------------------------------------------
def part_traces():
    key = secret(secrets.token_hex(32))
    with open(DOCS_PAGE, encoding="utf-8") as handle:
        page = handle.read()
    match = re.search(
        r"^```bash\n(curl -fsSLO https://oneuptime\.com/install/openstack-agent/install-traces\.sh\n[^`]*?)\n```$", page, re.M
    )
    if not match:
        raise RuntimeError("telemetry/openstack.md no longer holds the traces profile's install commands")
    block = match.group(1).replace("https://oneuptime.com", STATE["url"])
    folder = tempfile.mkdtemp(prefix="traces-", dir=WORK)
    installed = run(
        "traces-install",
        block,
        cwd=folder,
        env={
            "ONEUPTIME_URL": STATE["url"],
            "ONEUPTIME_TELEMETRY_INGESTION_KEY": STATE["ingestion key"],
            "OPENSTACK_CLOUD_NAME": AGENT_CLOUD,
            "OPENSTACK_REGION_NAME": REGION,
        },
        stdin="",
        timeout=600,
    )
    check("the traces profile installs, as the docs say", installed.status == 0, f"exit {installed.status}: {installed.text[-1200:] if installed.status else ''}")
    if installed.status:
        return

    must("traces-libraries", f"sudo {VENV}/bin/pip install 'opentelemetry-sdk<1.44' 'opentelemetry-exporter-otlp<1.44'", timeout=300)
    configure = os.path.join(HERE, "logs-configure.py")
    # Placement stays out, as the installer says: as OpenStack ships it, the driver cannot start there.
    for conf in TRACED_CONFS:
        for name, value in (
            ("enabled", "True"),
            ("hmac_keys", key),
            ("connection_string", "otlp://127.0.0.1:4318"),
            ("trace_sqlalchemy", "False"),
        ):
            must(
                "traces-config",
                f"! sudo test -f {conf} || sudo python3 -I {shlex.quote(configure)} ini-set {conf} profiler {name} {shlex.quote(value)}",
            )
    run("traces-restart", "sudo timeout 240 systemctl restart 'devstack@*'", timeout=300)

    def answers():
        return bool(run("traces-restart", "timeout 30 openstack compute service list && timeout 30 openstack network list", timeout=70))

    back, waited = wait_for(answers, 300, gap=10)
    check("the cloud comes back with OSProfiler on", bool(back), f"after {waited}s")
    if not back:
        return
    # A service that has just come back can still be registering itself.
    time.sleep(30)

    names = must("traces-boot", "openstack image list --status active -f value -c Name").out.split("\n")
    image = next(name.strip() for name in names if "cirros" in name.lower())
    booted = run(
        "traces-boot",
        f"timeout 400 openstack server create --wait --flavor ou.tiny --image {shlex.quote(image)} --network ou-net ou-trace-vm",
        env={"OS_PROFILE": key, "OS_PROJECT_NAME": "ou-payments"},
        timeout=420,
    )
    check("a signed boot works", booted.status == 0, f"exit {booted.status}: {booted.text[-800:] if booted.status else ''}")
    match = re.search(r"Trace ID: ([0-9a-fA-F-]{36})", booted.text)
    check("and prints its Trace ID", bool(match), match.group(1) if match else booted.text[-300:])
    if not match:
        return
    trace_id = match.group(1).replace("-", "").lower()
    found("the Trace ID", trace_id)
    latest = {}

    def spans():
        answer = live.api(
            "POST",
            "/span/get-list?limit=500&skip=0",
            {
                "query": {"traceId": trace_id, "projectId": live.PROJECT_ID},
                "select": {"traceId": True, "spanId": True, "name": True, "startTime": True, "attributes": True},
            },
        )
        latest["rows"] = answer.get("data") or []
        return latest["rows"]

    rows, waited = wait_for(spans, 300, gap=15)
    # Spans keep arriving from a boot's slower services for a while.
    time.sleep(60)
    try:
        rows = spans() or rows
    except Exception as error:  # pylint: disable=broad-except
        STATE["last error"] = str(error)
    check(
        "its spans reach this OneUptime",
        bool(rows),
        f"{len(rows or [])} spans, the first after {waited}s" if rows else f"none after {waited}s; {STATE.get('last error', '')}",
    )
    if not rows:
        return
    attributes = [row.get("attributes") or {} for row in rows]
    # The word the Traces page reads each service by, and what the driver called it if not.
    services = sorted({str(item.get("openstack.service") or item.get("resource.service.name")) for item in attributes})
    clouds = sorted({str(item.get("resource.openstack.cloud.name")) for item in attributes})
    found("the spans", {"count": len(rows), "services": services, "clouds": clouds, "names": sorted({str(row.get("name")) for row in rows})[:40]})
    check("they say which cloud they are from", clouds == [AGENT_CLOUD], clouds)
    check("and cross more than one service", len(services) > 1, services)
    look_at(
        "traces",
        [
            named_page(
                "Traces",
                "OpenStackTraces.png",
                cloud_path(STATE["agent cloud"], "traces"),
                marks=[{"selector": '[data-testid="openstack-traces-status"]'}],
            )
        ],
    )


# OpenStack's own tracing
# ----------------------------------------------------------------------------------------------
def part_native():
    """The docs' "OpenStack's own tracing" on the cloud part_traces left OSProfiler on, with nothing signed."""
    configure = shlex.quote(os.path.join(HERE, "logs-configure.py"))
    with open(DOCS_PAGE, encoding="utf-8") as handle:
        page = handle.read()
    line = re.search(r"^(sed -i '/headers\\\.update\(osprofiler_web[^\n]*)$", page, re.M)
    if not line:
        raise RuntimeError("telemetry/openstack.md no longer holds the line for keystoneauth")
    # Beside it, so that this boot's request can be held to its lines in the logs.
    folder = tempfile.mkdtemp(prefix="logs-", dir=WORK)
    installed = run(
        "native-logs-install",
        f"curl -fsSLO {STATE['url']}/install/openstack-agent/install-logs.sh && sudo -E bash install-logs.sh journald",
        cwd=folder,
        env={
            "ONEUPTIME_URL": STATE["url"],
            "ONEUPTIME_TELEMETRY_INGESTION_KEY": STATE["ingestion key"],
            "OPENSTACK_CLOUD_NAME": AGENT_CLOUD,
            "OPENSTACK_REGION_NAME": REGION,
        },
        stdin="",
        timeout=600,
    )
    check("the logs profile installs, as the docs say", installed.status == 0, f"exit {installed.status}: {installed.text[-1200:] if installed.status else ''}")
    for conf in TRACED_CONFS:
        must("native-config", f"! sudo test -f {conf} || sudo python3 -I {configure} ini-set {conf} oslo_messaging_tracing tracing_enabled True")
    for conf, service in (
        ("/etc/nova/nova.conf", "nova-api"),
        ("/etc/neutron/neutron.conf", "neutron-server"),
        ("/etc/cinder/cinder.conf", "cinder-api"),
        ("/etc/glance/glance-api.conf", "glance-api"),
    ):
        for name, value in (("enabled", "True"), ("otlp_endpoint", "http://127.0.0.1:4318"), ("service_name", service)):
            must("native-config", f"! sudo test -f {conf} || sudo python3 -I {configure} ini-set {conf} oslo_middleware_tracing {name} {value}")
    for paste in ("/etc/nova/api-paste.ini", "/etc/neutron/api-paste.ini", "/etc/cinder/api-paste.ini", "/etc/glance/glance-api-paste.ini"):
        must("native-config", f"! sudo test -f {paste} || sudo python3 -I {configure} paste-otel {paste}")
    must("native-keystoneauth", "sudo " + line.group(1).replace("python3 -c", f"{VENV}/bin/python3 -c"))
    run("native-restart", "sudo timeout 240 systemctl restart 'devstack@*'", timeout=300)

    def answers():
        return bool(run("native-restart", "timeout 30 openstack compute service list && timeout 30 openstack network list", timeout=70))

    back, waited = wait_for(answers, 300, gap=10)
    check("the cloud comes back with OpenStack's own tracing on", bool(back), f"after {waited}s")
    if not back:
        return
    # A service that has just come back can still be registering itself.
    time.sleep(30)

    # What part_traces booted is still there, and the project's quota has room for one more.
    run("native-boot", "timeout 300 openstack server delete --wait ou-trace-vm", env={"OS_PROJECT_NAME": "ou-payments"}, timeout=320)
    names = must("native-boot", "openstack image list --status active -f value -c Name").out.split("\n")
    image = next(name.strip() for name in names if "cirros" in name.lower())
    booted = run(
        "native-boot",
        f"timeout 400 openstack server create --wait --flavor ou.tiny --image {shlex.quote(image)} --network ou-net -f json ou-native-vm",
        env={"OS_PROJECT_NAME": "ou-payments"},
        timeout=420,
    )
    check("a boot with nothing signed works", booted.status == 0, f"exit {booted.status}: {booted.text[-800:] if booted.status else ''}")
    if booted.status:
        return

    def boot_rows():
        answer = live.api(
            "POST",
            "/span/get-list?limit=5&skip=0",
            {
                # oslo's: a signed boot's OSProfiler span has this name too.
                "query": {"projectId": live.PROJECT_ID, "name": "POST /compute/v2.1/servers", "attributes": {"scope.name": "oslo_middleware.tracing"}},
                "select": {"traceId": True, "startTime": True, "attributes": True},
                "sort": {"startTime": "DESC"},
            },
        )
        return answer.get("data") or []

    rows, waited = wait_for(boot_rows, 300, gap=15)
    check("the boot's request reaches this OneUptime, by the name a person reads", bool(rows), f"after {waited}s; {STATE.get('last error', '')}")
    if not rows:
        return
    trace_id = rows[0].get("traceId")
    found("the boot's trace", trace_id)
    # Spans keep arriving from a boot's slower services for a while.
    time.sleep(60)
    spans = (
        live.api(
            "POST",
            "/span/get-list?limit=500&skip=0",
            {
                "query": {"projectId": live.PROJECT_ID, "traceId": trace_id},
                "select": {"traceId": True, "spanId": True, "parentSpanId": True, "name": True, "startTime": True, "attributes": True},
            },
        ).get("data")
        or []
    )
    attributes = [row.get("attributes") or {} for row in spans]
    services = sorted({str(item.get("openstack.service")) for item in attributes})
    scopes = sorted({str(item.get("scope.name")) for item in attributes})
    found("the boot's spans", {"count": len(spans), "services": services, "scopes": scopes, "names": sorted({str(row.get("name")) for row in spans})[:60]})
    check("they are oslo's alone, because nothing was signed", all(scope in ("oslo.messaging", "oslo_middleware.tracing") for scope in scopes), scopes)
    check(
        "one trace crosses Nova's API, conductor, scheduler and compute",
        all(wanted in services for wanted in ("nova-api", "nova-conductor", "nova-scheduler", "nova-compute")),
        services,
    )
    check("and Neutron, over the docs' line in keystoneauth", "neutron-server" in services, services)
    clouds = sorted({str(item.get("resource.openstack.cloud.name")) for item in attributes})
    check("they say which cloud they are from", clouds == [AGENT_CLOUD], clouds)

    events = cloud_json("server event list ou-native-vm", env={"OS_PROJECT_NAME": "ou-payments"}) or []
    asked = {str(event.get("Request ID")) for event in events if str(event.get("Action")).lower() == "create"}
    named = {str(item.get("openstack.request_id")) for item in attributes if item.get("openstack.request_id")}
    found("the request Nova says made it, and those its spans name", {"nova": sorted(asked), "spans": sorted(named)})
    check("its spans hold the request Nova says made the instance", bool(asked & named), {"nova": sorted(asked), "spans": sorted(named)})
    request = sorted(asked & named)[0] if asked & named else ""

    def lines_of_request():
        answer = live.api(
            "POST",
            "/logs/get-list?limit=200&skip=0",
            {
                "query": {"projectId": live.PROJECT_ID, "attributes": {"openstack.request_root_id": request}},
                "select": {"time": True, "attributes": True},
                "sort": {"time": "ASC"},
            },
        )
        return answer.get("data") or []

    lines, waited = wait_for(lines_of_request, 300, gap=15) if request else ([], 0)
    # A boot's later services log as they get to it.
    time.sleep(45)
    lines = (lines_of_request() or lines) if request else lines
    logged = sorted({str((line.get("attributes") or {}).get("openstack.service")) for line in lines})
    found("that request's lines in the logs", {"count": len(lines), "services": logged})
    check(
        "and that request's lines are in this OneUptime's logs, from the services in its trace",
        all(wanted in logged for wanted in ("nova-api", "nova-conductor", "nova-compute")),
        {"lines": len(lines), "services": logged, "after": waited},
    )

    run("native-boot", "timeout 300 openstack server delete --wait ou-native-vm", env={"OS_PROJECT_NAME": "ou-payments"}, timeout=320)
    look_at(
        "native",
        [
            named_page(
                "Traces, with OpenStack's own tracing on",
                "OpenStackTracesNative.png",
                cloud_path(STATE["agent cloud"], "traces"),
                marks=[{"selector": '[data-testid="openstack-traces-native"]'}],
            ),
            # Not held to having no empty state: no log line holds a trace's ID, so the trace page's
            # own Logs part is empty, and the card above it is what joins the two.
            {
                "name": "The boot's trace",
                "file": "OpenStackTraceNative.png",
                "path": f"/dashboard/{live.PROJECT_ID}/traces/view/{trace_id}",
                "marks": [{"selector": '[data-testid="openstack-trace-source"]'}, {"selector": '[data-testid="openstack-trace-requests"]'}],
            },
        ],
    )


def main():
    os.makedirs(LOGS, exist_ok=True)
    RESULTS["started"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    memory("before anything")
    part("oneuptime", "a person signs up, and makes an ingestion key", part_oneuptime)
    part("agent", "the agent, installed as the docs say", part_agent, needs=["oneuptime"])
    part("break", "nova-compute really stopped, and a monitor from the real template", part_break, needs=["agent"])
    part("probe", "the same cloud, through a project's own probe", part_probe, needs=["oneuptime"])
    part("traces", "a signed boot, through the agent's traces profile", part_traces, needs=["agent"])
    part("native", "a boot with nothing signed, through OpenStack's own tracing", part_native, needs=["traces"])
    RESULTS["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save()

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

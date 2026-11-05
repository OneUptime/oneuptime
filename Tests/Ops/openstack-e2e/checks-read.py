#!/usr/bin/env python3
"""What a check run came to, for checks-record.sh to hold each scene to.

    checks-read.py job <authUrl> <regions,> <interface> <fingerprint or -> <credentialId> <secretEnv> \
        <checkKey> <expectedProject> <intervalMinutes> <optionsJson>   writes a job to stdout
    checks-read.py expect <scene dir> <status> [failedStep]            exits 1 if the run did not
    checks-read.py expect-api <scene dir>                              exits 1 if a service failed
    checks-read.py says <scene dir> <words>                            exits 1 if it does not say them
    checks-read.py matrix <output.json> <token> <victim project> ...   what this credential can write

Only standard library, because this runs on a bare runner. A job holds a throwaway cloud's credential,
and it stays on the runner.
"""
import json
import os
import ssl
import sys
import urllib.error
import urllib.request


def job(args):
    auth_url, regions, interface, fingerprint, cred_id, secret_env, key, project, interval, options = args
    print(json.dumps({
        "openStackCloudCheckId": "00000000-0000-4000-8000-000000000001",
        "openStackCloudId": "00000000-0000-4000-8000-000000000002",
        "cloudName": "rig",
        "authUrl": auth_url,
        "regions": [r for r in regions.split(",") if r],
        "endpointInterface": interface,
        "trustedCertificateFingerprints": [] if fingerprint == "-" else [fingerprint],
        "settingsVersion": 1,
        "credential": {
            "kind": "applicationCredential",
            "id": cred_id,
            "secret": os.environ[secret_env],
        },
        "intervalInMinutes": int(interval),
        "checkKey": key,
        "expectedProjectName": project,
        "options": json.loads(options),
    }))


def report_of(scene):
    with open(os.path.join(scene, "report.json")) as handle:
        return json.load(handle)


def expect(scene, status, step=None):
    runs = report_of(scene)
    problems = []
    for run in runs:
        if run["status"] != status:
            problems.append(f"{run['regionName']} is {run['status']}, not {status}: {run.get('fault') or run.get('message')}")
        if step and run.get("failedStep") != step:
            problems.append(f"{run['regionName']} failed at {run.get('failedStep')}, not {step}")
    print(json.dumps([{
        "region": run["regionName"],
        "status": run["status"],
        "failedStep": run.get("failedStep"),
        "fault": run.get("fault"),
        "message": run.get("message"),
        "steps": {s["step"]: s["durationInMs"] for s in run["steps"]},
        "janitor": run.get("janitor"),
        "leftoverCount": run.get("leftoverCount"),
        "writeCount": run.get("writeCount"),
        "warnings": run.get("warnings"),
    } for run in runs], indent=1))
    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit(1)


def expect_api(scene):
    result = report_of(scene)
    print(json.dumps({
        "token": result["token"],
        "services": [[s["regionName"], s["serviceType"], s["outcome"], s.get("status"), s["durationInMs"]] for s in result["services"]],
        "certificates": result["certificates"],
        "warnings": result["warnings"],
    }, indent=1))
    failing = [s for s in result["services"] if s["outcome"] == "Failing"]
    if result["token"]["status"] != "Passed" or failing:
        print(f"Token: {result['token']}, failing: {failing}", file=sys.stderr)
        sys.exit(1)


def says(scene, words):
    text = json.dumps(report_of(scene))
    if words not in text:
        print(f"The report does not say: {words}", file=sys.stderr)
        sys.exit(1)


# Writes a project's member could try, against a project it is not on. Each must be refused.
def attempts(victim):
    project = victim["project"]
    return [
        ("compute", "delete a server of another project", "DELETE", f"/servers/{victim['server']}", None),
        ("compute", "stop a server of another project", "POST", f"/servers/{victim['server']}/action", {"os-stop": None}),
        ("compute", "attach to a server of another project", "POST", f"/servers/{victim['server']}/os-volume_attachments", {"volumeAttachment": {"volumeId": victim["volume"]}}),
        ("compute", "create a flavor", "POST", "/flavors", {"flavor": {"name": "ou-check-write", "ram": 64, "vcpus": 1, "disk": 0}}),
        ("compute", "create an aggregate", "POST", "/os-aggregates", {"aggregate": {"name": "ou-check-write"}}),
        ("network", "delete a floating IP of another project", "DELETE", f"/v2.0/floatingips/{victim['floating_ip']}", None),
        ("network", "delete a security group of another project", "DELETE", f"/v2.0/security-groups/{victim['security_group']}", None),
        ("network", "delete a network of another project", "DELETE", f"/v2.0/networks/{victim['network']}", None),
        ("network", "create a network in another project", "POST", "/v2.0/networks", {"network": {"name": "ou-check-write", "project_id": project}}),
        ("network", "create a security group in another project", "POST", "/v2.0/security-groups", {"security_group": {"name": "ou-check-write", "project_id": project}}),
        ("network", "create a floating IP in another project", "POST", "/v2.0/floatingips", {"floatingip": {"floating_network_id": victim["external_network"], "project_id": project}}),
        ("volume", "delete a volume of another project", "DELETE", f"/volumes/{victim['volume']}", None),
        ("volume", "create a volume under another project's path", "POST", f"/{project}/volumes", {"volume": {"name": "ou-check-write", "size": 1}}),
        ("image", "create a public image", "POST", "/v2/images", {"name": "ou-check-write", "visibility": "public", "disk_format": "raw", "container_format": "bare"}),
        ("identity", "create a project", "POST", "/projects", {"project": {"name": "ou-check-write"}}),
        ("identity", "create a user", "POST", "/users", {"user": {"name": "ou-check-write", "password": "x"}}),
        ("identity", "give itself a role on another project", "PUT", f"/projects/{project}/users/{victim['user']}/roles/{victim['member_role']}", None),
    ]


def matrix(args):
    output, token_body_file, victim_file = args
    with open(token_body_file) as handle:
        answer = json.load(handle)
    token = os.environ["OS_CHECK_TOKEN"]
    with open(victim_file) as handle:
        victim = json.load(handle)

    def base(service_types):
        for service in answer["token"]["catalog"]:
            if service["type"] in service_types:
                for endpoint in service["endpoints"]:
                    if endpoint["interface"] == "public":
                        return endpoint["url"].rstrip("/")
        return None

    bases = {
        "compute": base(["compute"]),
        "network": base(["network"]),
        "volume": base(["block-storage", "volumev3"]),
        "image": base(["image"]),
        "identity": base(["identity"]),
    }
    if bases["identity"] and not bases["identity"].endswith("/v3"):
        bases["identity"] += "/v3"

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    rows = []
    for service, what, method, path, body in attempts(victim):
        url = f"{bases[service]}{path}"
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, data=data, method=method, headers={
            "X-Auth-Token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(request, timeout=60, context=context) as response:
                status = response.status
                text = response.read(2048).decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            status = error.code
            text = error.read(2048).decode("utf-8", "replace")
        except Exception as error:  # A refused connection is not a refused write.
            status = 0
            text = str(error)
        rows.append({
            "service": service,
            "write": what,
            "method": method,
            "status": status,
            # A 2xx is the only thing that counts as having written.
            "wrote": 200 <= status < 300,
            "reason": text[:300],
        })

    with open(output, "w") as handle:
        json.dump({"writes": rows}, handle, indent=1)
        handle.write("\n")

    wrote = [row for row in rows if row["wrote"]]
    unasked = [row for row in rows if row["status"] == 0]
    for row in rows:
        print(f"{row['status']} {row['service']}: {row['write']}")
    if wrote or unasked:
        print(f"Wrote: {wrote}. Could not ask: {unasked}", file=sys.stderr)
        sys.exit(1)


def main():
    command = sys.argv[1]
    args = sys.argv[2:]
    if command == "job":
        job(args)
    elif command == "expect":
        expect(*args)
    elif command == "expect-api":
        expect_api(*args)
    elif command == "says":
        says(*args)
    elif command == "matrix":
        matrix(args)
    else:
        sys.exit(f"What is {command}?")


main()

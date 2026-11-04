#!/usr/bin/env python3
"""What can each kind of credential really read on this cloud, and can it write?

OpenStack's answer to "can this account see everything?" depends on each
service's policy, and a 200 is not enough: Neutron and Cinder answer a plain
reader with a 200 and only that reader's own project. So every read is compared
with what an admin saw, and the matrix says which credentials see all of it.

The OpenStack agent's docs and its access check are held to what this finds.

Reads credentials as `name=token` lines on stdin, the first being the admin the
others are compared with. Writes the matrix as JSON to the path given. Only
standard library, because this runs on a bare runner.

    access-matrix.py <output.json> < tokens
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

COMPUTE_VERSION = {"OpenStack-API-Version": "compute 2.90"}
VOLUME_VERSION = {"OpenStack-API-Version": "volume 3.50"}
PLACEMENT_VERSION = {"OpenStack-API-Version": "placement 1.39"}
MANILA_VERSION = {"X-OpenStack-Manila-API-Version": "2.65"}

# service type, what it reads, path, the list in its answer, extra headers.
READS = [
    ("identity", "projects", "/v3/projects", "projects", {}),
    ("identity", "domains", "/v3/domains", "domains", {}),
    ("identity", "regions", "/v3/regions", "regions", {}),
    ("identity", "services", "/v3/services", "services", {}),
    ("identity", "endpoints", "/v3/endpoints", "endpoints", {}),
    ("compute", "servers, all projects", "/servers/detail?all_tenants=1&limit=1000", "servers", COMPUTE_VERSION),
    ("compute", "services", "/os-services", "services", COMPUTE_VERSION),
    ("compute", "hypervisors", "/os-hypervisors/detail", "hypervisors", COMPUTE_VERSION),
    ("compute", "aggregates", "/os-aggregates", "aggregates", COMPUTE_VERSION),
    ("compute", "availability zones, detail", "/os-availability-zone/detail", "availabilityZoneInfo", COMPUTE_VERSION),
    ("compute", "flavors", "/flavors/detail?is_public=None", "flavors", COMPUTE_VERSION),
    ("compute", "usage per project", "/os-simple-tenant-usage?start=2000-01-01T00:00:00", "tenant_usages", COMPUTE_VERSION),
    ("placement", "resource providers", "/resource_providers", "resource_providers", PLACEMENT_VERSION),
    ("network", "agents", "/v2.0/agents", "agents", {}),
    ("network", "networks", "/v2.0/networks", "networks", {}),
    ("network", "subnets", "/v2.0/subnets", "subnets", {}),
    ("network", "routers", "/v2.0/routers", "routers", {}),
    ("network", "floating IPs", "/v2.0/floatingips", "floatingips", {}),
    ("network", "IP availabilities", "/v2.0/network-ip-availabilities", "network_ip_availabilities", {}),
    ("network", "security groups", "/v2.0/security-groups", "security_groups", {}),
    ("network", "ports", "/v2.0/ports?limit=1000", "ports", {}),
    ("network", "quotas", "/v2.0/quotas", "quotas", {}),
    ("block-storage", "volumes, all projects", "/volumes/detail?all_tenants=1&limit=1000", "volumes", VOLUME_VERSION),
    ("block-storage", "services", "/os-services", "services", VOLUME_VERSION),
    ("block-storage", "pools", "/scheduler-stats/get_pools?detail=true", "pools", VOLUME_VERSION),
    ("block-storage", "snapshots, all projects", "/snapshots/detail?all_tenants=1&limit=1000", "snapshots", VOLUME_VERSION),
    ("block-storage", "backups, all projects", "/backups/detail?all_tenants=1&limit=1000", "backups", VOLUME_VERSION),
    ("block-storage", "volume types", "/types", "volume_types", VOLUME_VERSION),
    ("image", "images", "/v2/images?limit=1000", "images", {}),
    ("load-balancer", "load balancers", "/v2/lbaas/loadbalancers", "loadbalancers", {}),
    ("load-balancer", "amphorae", "/v2/octavia/amphorae", "amphorae", {}),
    ("baremetal", "nodes", "/v1/nodes/detail", "nodes", {"X-OpenStack-Ironic-API-Version": "1.82"}),
    # The same for the rest of the services a cloud may not run, in the exporter's words where
    # it has them, because what the exporter gets is what the product shows.
    ("load-balancer", "pools", "/v2.0/lbaas/pools", "pools", {}),
    ("load-balancer", "load balancers, as the exporter asks", "/v2.0/lbaas/loadbalancers", "loadbalancers", {}),
    ("load-balancer", "amphorae, as the exporter asks", "/v2.0/octavia/amphorae", "amphorae", {}),
    ("baremetal", "conductors", "/v1/conductors", "conductors", {"X-OpenStack-Ironic-API-Version": "1.82"}),
    ("orchestration", "stacks, as the exporter asks", "/stacks", "stacks", {}),
    ("orchestration", "stacks, all projects", "/stacks?global_tenant=true", "stacks", {}),
    ("orchestration", "services", "/services", "services", {}),
    ("container-infra", "clusters", "/clusters", "clusters", {"OpenStack-API-Version": "container-infra latest"}),
    ("container-infra", "services", "/mservices", "mservices", {"OpenStack-API-Version": "container-infra latest"}),
    ("sharev2", "shares, all projects", "/shares/detail?all_tenants=1", "shares", {}),
    ("sharev2", "services", "/services", "services", MANILA_VERSION),
    ("sharev2", "pools", "/scheduler-stats/pools/detail", "pools", MANILA_VERSION),
    ("dns", "zones, all projects", "/v2/zones", "zones", {"X-Auth-All-Projects": "true"}),
    ("dns", "zones, own project", "/v2/zones", "zones", {}),
    ("key-manager", "secrets", "/v1/secrets", "secrets", {}),
    ("key-manager", "orders", "/v1/orders", "orders", {}),
    ("object-store", "own account", "", None, {}),
    ("database", "instances, as the exporter asks", "/mgmt/instances?include_clustered=False&deleted=False", "instances", {}),
    ("database", "instances, own project", "/instances", "instances", {}),
    ("metric", "status", "/v1/status?details=true", "storage", {}),
]

# Writes a monitoring credential must be refused. Each creates something small
# if it wrongly succeeds, on a throwaway cloud, and the run fails if one does.
#
# The ones an ordinary project member can do matter most. Cinder ships with
# enforce_new_defaults off, and there any role on a project can create that project's
# volumes, `reader` included. Only asking is how anyone finds out.
def writes():
    flavor = os.environ.get("OU_WRITE_FLAVOR_ID", "")
    image = os.environ.get("OU_WRITE_IMAGE_ID", "")
    external = os.environ.get("OU_WRITE_EXTERNAL_NETWORK_ID", "")
    return [
        ("compute", "create a flavor", "POST", "/flavors",
         {"flavor": {"name": "ou-write-check", "ram": 64, "vcpus": 1, "disk": 0}}, COMPUTE_VERSION),
        ("compute", "create an aggregate", "POST", "/os-aggregates",
         {"aggregate": {"name": "ou-write-check"}}, COMPUTE_VERSION),
        ("compute", "boot an instance", "POST", "/servers",
         {"server": {"name": "ou-write-check", "flavorRef": flavor, "imageRef": image, "networks": "none"}},
         COMPUTE_VERSION),
        ("network", "create a network", "POST", "/v2.0/networks",
         {"network": {"name": "ou-write-check"}}, {}),
        ("network", "create a router", "POST", "/v2.0/routers",
         {"router": {"name": "ou-write-check"}}, {}),
        ("network", "create a security group", "POST", "/v2.0/security-groups",
         {"security_group": {"name": "ou-write-check"}}, {}),
        ("network", "take a floating IP", "POST", "/v2.0/floatingips",
         {"floatingip": {"floating_network_id": external}}, {}),
        ("block-storage", "create a volume", "POST", "/volumes",
         {"volume": {"size": 1, "name": "ou-write-check"}}, VOLUME_VERSION),
        ("image", "create an image", "POST", "/v2/images",
         {"name": "ou-write-check", "disk_format": "raw", "container_format": "bare"}, {}),
        ("identity", "create a project", "POST", "/v3/projects",
         {"project": {"name": "ou-write-check"}}, {}),
        # The rest of the services a cloud may not run. Each names something that does not
        # exist where it can, so even a call wrongly let through makes nothing of size.
        ("load-balancer", "create a load balancer", "POST", "/v2/lbaas/loadbalancers",
         {"loadbalancer": {"name": "ou-write-check", "vip_subnet_id": "00000000-0000-0000-0000-000000000000"}}, {}),
        ("baremetal", "enroll a node", "POST", "/v1/nodes",
         {"name": "ou-write-check", "driver": "fake-hardware"}, {"X-OpenStack-Ironic-API-Version": "1.82"}),
        ("orchestration", "create a stack", "POST", "/stacks",
         {"stack_name": "ou-write-check", "template": {"heat_template_version": "rocky"}}, {}),
        ("container-infra", "create a cluster template", "POST", "/clustertemplates",
         {"name": "ou-write-check", "coe": "kubernetes", "image_id": "ou-no-such-image", "external_network_id": "public"},
         {"OpenStack-API-Version": "container-infra latest"}),
        ("sharev2", "create a share", "POST", "/shares",
         {"share": {"name": "ou-write-check", "share_proto": "NFS", "size": 1}}, MANILA_VERSION),
        ("dns", "create a zone", "POST", "/v2/zones",
         {"name": "ou-write-check.example.org.", "email": "hostmaster@example.org"}, {}),
        ("key-manager", "store a secret", "POST", "/v1/secrets",
         {"name": "ou-write-check", "payload": "x", "payload_content_type": "text/plain"}, {}),
        ("object-store", "create a container", "PUT", "/ou-write-check", None, {}),
        ("database", "create an instance", "POST", "/instances",
         {"instance": {"name": "ou-write-check", "flavorRef": "ou-no-such-flavor", "volume": {"size": 1}}}, {}),
        ("metric", "create a metric", "POST", "/v1/metric", {"name": "ou-write-check"}, {}),
    ]


def request(url, token, method="GET", body=None, headers=None):
    all_headers = {"X-Auth-Token": token, "Accept": "application/json"}
    all_headers.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        all_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=all_headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as error:
        return 0, str(error)


def endpoints_from_env():
    """The catalog, as `openstack catalog list -f json` printed it."""
    found = {}
    for service in json.loads(os.environ["OPENSTACK_CATALOG_JSON"]):
        kind = service.get("Type") or service.get("type")
        for endpoint in service.get("Endpoints") or service.get("endpoints") or []:
            if endpoint.get("interface") == "public":
                found[kind] = endpoint["url"].rstrip("/")
    # A current catalog calls Cinder block-storage, an older one volumev3.
    if "block-storage" not in found and "volumev3" in found:
        found["block-storage"] = found["volumev3"]
    return found


# Why it was refused, in the service's own words, which often name the rule.
def reason_of(text):
    try:
        parsed = json.loads(text)
    except ValueError:
        return text[:200]
    if not isinstance(parsed, dict):
        return ""
    for value in parsed.values():
        if isinstance(value, dict) and value.get("message"):
            return str(value["message"])[:200]
    return str(parsed.get("message") or parsed.get("detail") or "")[:200]


def count_of(text, key):
    try:
        value = json.loads(text).get(key)
    except (ValueError, AttributeError):
        return None
    return len(value) if isinstance(value, (list, dict)) else None


def main():
    output = sys.argv[1]
    tokens = []
    for line in sys.stdin:
        line = line.strip()
        if line:
            name, _, token = line.partition("=")
            tokens.append((name, token))
    admin_name = tokens[0][0]
    endpoints = endpoints_from_env()

    matrix = {"reads": [], "writes": [], "credentials": [name for name, _ in tokens]}
    for service, label, path, key, headers in READS:
        base = endpoints.get(service)
        if not base:
            continue
        row = {"service": service, "read": label, "path": path, "results": {}}
        admin_count = None
        for name, token in tokens:
            status, text = request(base + path, token, headers=headers)
            count = count_of(text, key) if status == 200 else None
            if name == admin_name:
                admin_count = count
            row["results"][name] = {
                "status": status,
                "count": count,
                # A 200 with fewer rows than an admin saw is the trap this
                # script exists for: it looks like it worked.
                "seesAll": status == 200
                and (admin_count is None or count is None or count >= admin_count),
            }
            if status != 200:
                row["results"][name]["reason"] = reason_of(text)
        matrix["reads"].append(row)

    failures = []
    for service, label, method, path, body, headers in writes():
        base = endpoints.get(service)
        if not base:
            continue
        row = {"service": service, "write": label, "results": {}}
        for name, token in tokens:
            if name == admin_name:
                continue
            status, text = request(base + path, token, method=method, body=body, headers=headers)
            row["results"][name] = {"status": status, "wrote": status in (200, 201, 202)}
            if status not in (200, 201, 202):
                row["results"][name]["reason"] = reason_of(text)
            # Only the credentials we would tell a customer to use must never
            # write. What a plain reader or member can do is the cloud's own business,
            # and is recorded for the docs to say.
            if name.startswith("monitoring") and status in (200, 201, 202):
                failures.append(f"{name} could {label} (HTTP {status})")
        matrix["writes"].append(row)

    with open(output, "w") as handle:
        json.dump(matrix, handle, indent=2)

    names = matrix["credentials"]
    print(f"{'read':<40}" + "".join(f"{n[:22]:<24}" for n in names))
    for row in matrix["reads"]:
        cells = ""
        for name in names:
            result = row["results"][name]
            mark = "all" if result["seesAll"] else "partial" if result["status"] == 200 else str(result["status"])
            count = "" if result["count"] is None else f" ({result['count']})"
            cells += f"{(mark + count):<24}"
        print(f"{row['service'] + ': ' + row['read']:<40}" + cells)
    for row in matrix["writes"]:
        print(f"write {row['service']}: {row['write']:<30}" + " ".join(
            f"{n}={row['results'][n]['status']}" for n in row["results"]))
    for row in matrix["reads"]:
        for name in names:
            if name.startswith("monitoring") and row["results"][name].get("reason"):
                print(f"{name} refused {row['service']}: {row['read']}: {row['results'][name]['reason']}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()

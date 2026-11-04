#!/usr/bin/env python3
"""What capacity-record.sh asks Placement and Nova directly, standard library only.

The CLI has no bare "ask Placement what this flavor would get", and the osc-placement plugin
is not on every DevStack, so these calls are made as the product's probe makes them.

    capacity-placement.py candidates <folder>     one answer per flavor, for each query the probe could make
    capacity-placement.py providers <folder>      every provider's inventories, usages, aggregates and traits
    capacity-placement.py set-trait <provider> <trait>
    capacity-placement.py has-trait <provider> <trait>     exits 0 when it does
    capacity-placement.py orphan <provider> <consumer>     an allocation no instance owns
    capacity-placement.py forget <consumer>

Reads OS_TOKEN, OS_PLACEMENT_URL and OS_COMPUTE_URL from the environment.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# What the product's probe asks at: the first that says which tree a provider is in.
MICROVERSION = "placement 1.29"
COMPUTE_MICROVERSION = "compute 2.87"
# Nova's own [scheduler] max_placement_results default: what one boot asks for.
CANDIDATE_LIMIT = 1000


def request(url, method="GET", body=None, version=MICROVERSION):
    headers = {
        "X-Auth-Token": os.environ["OS_TOKEN"],
        "Accept": "application/json",
        "OpenStack-API-Version": version,
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    call = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(call, timeout=120) as answer:
            text = answer.read().decode()
            return answer.status, json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="replace")
        try:
            return error.code, json.loads(text)
        except ValueError:
            return error.code, {"body": text}


def placement(path, **kwargs):
    return request(os.environ["OS_PLACEMENT_URL"].rstrip("/") + path, **kwargs)


def compute(path):
    return request(
        os.environ["OS_COMPUTE_URL"].rstrip("/") + path, version=COMPUTE_MICROVERSION
    )


def write(folder, name, status, answer):
    os.makedirs(folder, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    with open(os.path.join(folder, f"{safe}.json"), "w") as handle:
        json.dump(answer, handle, indent=0, sort_keys=True)
    with open(os.path.join(folder, "status.txt"), "a") as handle:
        handle.write(f"{status} {safe}\n")


def flavor_request(flavor):
    """What Nova asks Placement for this flavor, from what its own API says of it."""
    specs = flavor.get("extra_specs") or {}
    swap_gb = (flavor.get("swap") or 0) // 1024 + (
        1 if (flavor.get("swap") or 0) % 1024 else 0
    )
    resources = {
        "VCPU": flavor.get("vcpus") or 0,
        "MEMORY_MB": flavor.get("ram") or 0,
        "DISK_GB": (flavor.get("disk") or 0)
        + (flavor.get("OS-FLV-EXT-DATA:ephemeral") or 0)
        + swap_gb,
    }
    required = []
    for key, value in specs.items():
        if key.startswith("resources:"):
            resources[key.split(":", 1)[1]] = int(value)
        elif key.startswith("trait:"):
            if value == "required":
                required.append(key.split(":", 1)[1])
            elif value == "forbidden":
                required.append("!" + key.split(":", 1)[1])
    wanted = ",".join(
        f"{name}:{amount}" for name, amount in sorted(resources.items()) if amount > 0
    )
    return wanted, required


def candidates(folder):
    status, answer = compute("/flavors/detail?is_public=None")
    write(folder, "nova-flavors", status, answer)
    for flavor in answer.get("flavors", []):
        wanted, required = flavor_request(flavor)
        name = flavor.get("name") or flavor.get("id")
        as_nova_asks = {
            "resources": wanted,
            "required": ",".join(required + ["!COMPUTE_STATUS_DISABLED"]),
            "limit": CANDIDATE_LIMIT,
        }
        status, body = placement(
            "/allocation_candidates?" + urllib.parse.urlencode(as_nova_asks)
        )
        write(folder, f"placement-candidates-{name}", status, body)
        # And with neither filter: what a query that left them out would have counted.
        bare = {"resources": wanted}
        status, body = placement(
            "/allocation_candidates?" + urllib.parse.urlencode(bare)
        )
        write(folder, f"placement-candidates-bare-{name}", status, body)


def providers(folder):
    status, answer = placement("/resource_providers")
    write(folder, "placement-providers", status, answer)
    for provider in answer.get("resource_providers", []):
        uuid, name = provider["uuid"], provider.get("name") or provider["uuid"]
        for part in ("inventories", "usages", "aggregates", "traits", "allocations"):
            status, body = placement(f"/resource_providers/{uuid}/{part}")
            write(folder, f"placement-{part}-{name}", status, body)


def provider_uuid(name):
    query = urllib.parse.urlencode({"name": name})
    _, answer = placement(f"/resource_providers?{query}")
    found = answer.get("resource_providers", [])
    if not found:
        raise SystemExit(f"no resource provider is called {name}")
    return found[0]["uuid"]


def set_trait(name, trait):
    uuid = provider_uuid(name)
    status, _ = placement(f"/traits/{trait}", method="PUT")
    print(f"trait {trait}: {status}")
    _, held = placement(f"/resource_providers/{uuid}/traits")
    traits = sorted(set(held.get("traits", [])) | {trait})
    status, _ = placement(
        f"/resource_providers/{uuid}/traits",
        method="PUT",
        body={
            "traits": traits,
            "resource_provider_generation": held["resource_provider_generation"],
        },
    )
    print(f"{name} holds {trait}: {status}")
    if status >= 300:
        raise SystemExit(1)


def has_trait(name, trait):
    uuid = provider_uuid(name)
    _, held = placement(f"/resource_providers/{uuid}/traits")
    raise SystemExit(0 if trait in held.get("traits", []) else 1)


def orphan(name, consumer):
    """An allocation with no instance behind it, in the shape Nova leaves one in."""
    uuid = provider_uuid(name)
    status, answer = placement(
        f"/allocations/{consumer}",
        method="PUT",
        body={
            "allocations": {
                uuid: {"resources": {"VCPU": 2, "MEMORY_MB": 1024, "DISK_GB": 10}}
            },
            "consumer_generation": None,
            "project_id": os.environ.get("OS_ORPHAN_PROJECT", "0" * 32),
            "user_id": os.environ.get("OS_ORPHAN_USER", "0" * 32),
        },
    )
    print(f"orphaned allocation {consumer} on {name}: {status} {answer}")
    if status >= 300:
        raise SystemExit(1)


def forget(consumer):
    status, answer = placement(f"/allocations/{consumer}", method="DELETE")
    print(f"allocation {consumer} deleted: {status} {answer}")


COMMANDS = {
    "candidates": candidates,
    "providers": providers,
    "set-trait": set_trait,
    "has-trait": has_trait,
    "orphan": orphan,
    "forget": forget,
}

if __name__ == "__main__":
    COMMANDS[sys.argv[1]](*sys.argv[2:])

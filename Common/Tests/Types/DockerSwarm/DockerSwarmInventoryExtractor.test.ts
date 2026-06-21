import {
  ExtractedDockerSwarmInventoryRecord,
  INVENTORIED_DOCKER_SWARM_KINDS,
  INVENTORY_KIND_ATTRIBUTE,
  canonicalDockerSwarmKind,
  extractDockerSwarmInventoryResource,
  isInventoriedDockerSwarmKind,
} from "../../../Types/DockerSwarm/DockerSwarmInventoryExtractor";
import { ParsedDockerSwarmResource } from "../../../Server/Services/DockerSwarmResourceService";
import { JSONObject } from "../../../Types/JSON";

/*
 * Locks in extractDockerSwarmInventoryResource — the pure parser that turns
 * one inventory log line emitted by the Docker Swarm Agent's snapshot script
 * into a ParsedDockerSwarmResource. The agent runs on a manager node and
 * polls the Swarm API every 5 minutes (`docker node/service/... ls
 * --format json`) and emits one JSON envelope per line:
 *
 *   { "kind": "Node" | "Service" | ..., "data": { ...native payload... } }
 *
 * with the same `kind` set as the `oneuptime.dockerswarm.kind` log-record
 * attribute. Each kind has a dedicated parser that promotes a subset of
 * fields to first-class columns and stashes the rest in `attributes`.
 *
 * The contracts pinned here:
 *   - kind canonicalization (singular/plural/case) and the unknown -> null
 *     bail-out (callers swallow nulls rather than fail the whole batch);
 *   - per-kind field promotion (role/isLeader for a manager, X/Y replica
 *     split, task name -> serviceName/stackName, externalId conventions,
 *     per-node Volume id suffixing);
 *   - malformed body / missing identity -> null;
 *   - the agent envelope ({kind,data}) AND the bare-payload (data inlined)
 *     fallback both resolve to the same resource.
 */

const LAST_SEEN_AT: Date = new Date("2026-06-15T12:00:00.000Z");

// Build the {kind, logBody, lastSeenAt} arg the OTel log pipeline hands us.
function extract(
  kind: string,
  body: JSONObject | string,
): ExtractedDockerSwarmInventoryRecord | null {
  return extractDockerSwarmInventoryResource({
    kind,
    logBody: typeof body === "string" ? body : JSON.stringify(body),
    lastSeenAt: LAST_SEEN_AT,
  });
}

// Wrap a native `docker ... ls --format json` payload in the agent envelope.
function envelope(kind: string, data: JSONObject): JSONObject {
  return { kind, data };
}

function resourceOf(
  result: ExtractedDockerSwarmInventoryRecord | null,
): ParsedDockerSwarmResource {
  if (!result) {
    throw new Error("expected a non-null extraction result");
  }
  return result.resource;
}

describe("DockerSwarmInventoryExtractor - kind discriminator", () => {
  test("INVENTORY_KIND_ATTRIBUTE is the agent's log-record attribute key", () => {
    expect(INVENTORY_KIND_ATTRIBUTE).toBe("oneuptime.dockerswarm.kind");
  });

  test("INVENTORIED_DOCKER_SWARM_KINDS lists all eight modeled kinds", () => {
    expect([...INVENTORIED_DOCKER_SWARM_KINDS].sort()).toEqual(
      [
        "Config",
        "Network",
        "Node",
        "Secret",
        "Service",
        "Stack",
        "Task",
        "Volume",
      ].sort(),
    );
  });

  test.each([
    ["Node", "Node"],
    ["node", "Node"],
    ["nodes", "Node"],
    ["  NODE  ", "Node"],
    ["Service", "Service"],
    ["services", "Service"],
    ["Task", "Task"],
    ["tasks", "Task"],
    ["Stack", "Stack"],
    ["stacks", "Stack"],
    ["Network", "Network"],
    ["networks", "Network"],
    ["Secret", "Secret"],
    ["secrets", "Secret"],
    ["Config", "Config"],
    ["configs", "Config"],
    ["Volume", "Volume"],
    ["volumes", "Volume"],
  ])(
    "canonicalDockerSwarmKind(%p) -> %p (case/plural insensitive)",
    (raw: string, expected: string) => {
      expect(canonicalDockerSwarmKind(raw)).toBe(expected);
      expect(isInventoriedDockerSwarmKind(raw)).toBe(true);
    },
  );

  test.each(["", "   ", "Container", "Pod", "garbage"])(
    "canonicalDockerSwarmKind(%p) -> null for unknown/empty kinds",
    (raw: string) => {
      expect(canonicalDockerSwarmKind(raw)).toBeNull();
      expect(isInventoriedDockerSwarmKind(raw)).toBe(false);
    },
  );
});

describe("DockerSwarmInventoryExtractor - top-level guards", () => {
  test("unknown kind -> null (kind not modeled, batch keeps going)", () => {
    expect(extract("Container", { ID: "abc", Name: "anything" })).toBeNull();
  });

  test("empty kind -> null", () => {
    expect(extract("", { ID: "abc" })).toBeNull();
  });

  test("malformed (non-JSON) body -> null", () => {
    expect(extract("Node", "this is not json {")).toBeNull();
  });

  test("JSON array body (not an object) -> null", () => {
    expect(extract("Node", "[1,2,3]")).toBeNull();
  });

  test("JSON primitive body -> null", () => {
    expect(extract("Node", '"just-a-string"')).toBeNull();
    expect(extract("Node", "42")).toBeNull();
  });

  test("empty object body -> null (no identity to key on)", () => {
    expect(extract("Node", {})).toBeNull();
  });

  test("lastSeenAt is passed through onto the parsed resource", () => {
    const result: ExtractedDockerSwarmInventoryRecord | null = extract(
      "Stack",
      envelope("Stack", { Name: "web", Services: "3" }),
    );
    expect(resourceOf(result).lastSeenAt).toBe(LAST_SEEN_AT);
  });

  test("bare payload (no {kind,data} envelope) is parsed via fallback", () => {
    /*
     * The agent normally wraps in {kind,data}; if data is inlined at the
     * top level the parser falls back to the body itself.
     */
    const result: ExtractedDockerSwarmInventoryRecord | null = extract(
      "Stack",
      { Name: "web", Services: "2" },
    );
    expect(resourceOf(result).name).toBe("web");
    expect(resourceOf(result).externalId).toBe("stack/web");
  });
});

describe("DockerSwarmInventoryExtractor - Node", () => {
  test("leader manager node -> role manager, isLeader true, isReady true", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Node",
        envelope("Node", {
          ID: "abc123",
          Hostname: "mgr-1",
          Status: "Ready",
          Availability: "Active",
          ManagerStatus: "Leader",
          EngineVersion: "24.0.7",
          TLSStatus: "Ready",
        }),
      ),
    );

    expect(r.kind).toBe("Node");
    expect(r.externalId).toBe("node/abc123");
    expect(r.name).toBe("mgr-1");
    expect(r.state).toBe("Ready");
    expect(r.isReady).toBe(true);
    expect(r.role).toBe("manager");
    expect(r.attributes?.["isLeader"]).toBe(true);
    expect(r.attributes?.["managerStatus"]).toBe("Leader");
    expect(r.attributes?.["availability"]).toBe("Active");
    expect(r.attributes?.["engineVersion"]).toBe("24.0.7");
    expect(r.attributes?.["tlsStatus"]).toBe("Ready");
  });

  test("reachable (non-leader) manager -> role manager, isLeader false", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Node",
        envelope("Node", {
          ID: "mgr2id",
          Hostname: "mgr-2",
          Status: "Ready",
          ManagerStatus: "Reachable",
        }),
      ),
    );

    expect(r.role).toBe("manager");
    expect(r.attributes?.["isLeader"]).toBe(false);
  });

  test("worker node (no ManagerStatus) -> role worker, isLeader false", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Node",
        envelope("Node", {
          ID: "wkr1id",
          Hostname: "wkr-1",
          Status: "Ready",
          Availability: "Active",
        }),
      ),
    );

    expect(r.role).toBe("worker");
    expect(r.attributes?.["isLeader"]).toBe(false);
    expect(r.attributes?.["managerStatus"]).toBeNull();
  });

  test("down node -> isReady false", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Node",
        envelope("Node", {
          ID: "downid",
          Hostname: "wkr-2",
          Status: "Down",
        }),
      ),
    );

    expect(r.state).toBe("Down");
    expect(r.isReady).toBe(false);
  });

  test("accepts lowercase 'Id' key as the node identity", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract("Node", envelope("Node", { Id: "lowerid", Hostname: "n" })),
    );
    expect(r.externalId).toBe("node/lowerid");
  });

  test("node with no ID -> null (no identity to key on)", () => {
    expect(extract("Node", envelope("Node", { Hostname: "no-id" }))).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - Service", () => {
  test("replicated service '3/5' -> running 3, desired 5, isReady false", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Service",
        envelope("Service", {
          ID: "svc1",
          Name: "api",
          Mode: "replicated",
          Replicas: "3/5",
          Image: "nginx:latest",
          Ports: "*:80->80/tcp",
        }),
      ),
    );

    expect(r.kind).toBe("Service");
    expect(r.externalId).toBe("service/svc1");
    expect(r.name).toBe("api");
    expect(r.serviceMode).toBe("replicated");
    expect(r.image).toBe("nginx:latest");
    expect(r.runningReplicas).toBe(3);
    expect(r.desiredReplicas).toBe(5);
    expect(r.state).toBe("3/5");
    expect(r.isReady).toBe(false);
    expect(r.attributes?.["ports"]).toBe("*:80->80/tcp");
  });

  test("fully-converged service '5/5' -> isReady true", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Service",
        envelope("Service", {
          ID: "svc2",
          Name: "web",
          Mode: "replicated",
          Replicas: "5/5",
        }),
      ),
    );

    expect(r.runningReplicas).toBe(5);
    expect(r.desiredReplicas).toBe(5);
    expect(r.state).toBe("5/5");
    expect(r.isReady).toBe(true);
  });

  test("zero-desired '0/0' service -> isReady false (desired must be > 0)", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Service",
        envelope("Service", {
          ID: "svc3",
          Name: "scaled-down",
          Replicas: "0/0",
        }),
      ),
    );

    expect(r.runningReplicas).toBe(0);
    expect(r.desiredReplicas).toBe(0);
    expect(r.isReady).toBe(false);
  });

  test("stack-deployed service 'mystack_api' -> stackName mystack", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Service",
        envelope("Service", {
          ID: "svc4",
          Name: "mystack_api",
          Mode: "replicated",
          Replicas: "2/2",
        }),
      ),
    );

    expect(r.name).toBe("mystack_api");
    expect(r.stackName).toBe("mystack");
  });

  test("standalone service (no underscore) -> stackName null", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Service",
        envelope("Service", {
          ID: "svc5",
          Name: "standalone",
          Replicas: "1/1",
        }),
      ),
    );

    expect(r.stackName).toBeNull();
  });

  test("service with unparseable Replicas -> running/desired/state null, isReady null", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Service",
        envelope("Service", { ID: "svc6", Name: "weird", Replicas: "n/a" }),
      ),
    );

    expect(r.runningReplicas).toBeNull();
    expect(r.desiredReplicas).toBeNull();
    expect(r.state).toBeNull();
    expect(r.isReady).toBeNull();
  });

  test("service with no ID -> null", () => {
    expect(
      extract("Service", envelope("Service", { Name: "no-id" })),
    ).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - Task", () => {
  test("task 'web.1.abc' -> serviceName web, externalId task/<id>, running", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Task",
        envelope("Task", {
          ID: "task9",
          Name: "web.1.abc",
          Image: "nginx:latest",
          Node: "wkr-1",
          DesiredState: "Running",
          CurrentState: "Running 2 hours ago",
        }),
      ),
    );

    expect(r.kind).toBe("Task");
    expect(r.externalId).toBe("task/task9");
    expect(r.name).toBe("web.1.abc");
    expect(r.image).toBe("nginx:latest");
    expect(r.nodeHostname).toBe("wkr-1");
    expect(r.serviceName).toBe("web");
    // No underscore in the service segment -> no stack.
    expect(r.stackName).toBeNull();
    // CurrentState's leading word is lowercased into state.
    expect(r.state).toBe("running");
    expect(r.isReady).toBe(true);
    expect(r.attributes?.["currentState"]).toBe("Running 2 hours ago");
    expect(r.attributes?.["desiredState"]).toBe("Running");
  });

  test("shutdown task -> state shutdown, isReady false, error captured", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Task",
        envelope("Task", {
          ID: "task10",
          Name: "web.2.def",
          CurrentState: "Shutdown 3 minutes ago",
          DesiredState: "Shutdown",
          Error: "task: non-zero exit (1)",
        }),
      ),
    );

    expect(r.state).toBe("shutdown");
    expect(r.isReady).toBe(false);
    expect(r.attributes?.["error"]).toBe("task: non-zero exit (1)");
  });

  test("stack-namespaced task 'mystack_api.1.xyz' -> serviceName + stackName", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Task",
        envelope("Task", {
          ID: "task11",
          Name: "mystack_api.1.xyz",
          CurrentState: "Running 1 minute ago",
        }),
      ),
    );

    expect(r.serviceName).toBe("mystack_api");
    expect(r.stackName).toBe("mystack");
  });

  test("task with no dot in name -> serviceName null", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Task",
        envelope("Task", {
          ID: "task12",
          Name: "nodot",
          CurrentState: "Running",
        }),
      ),
    );

    expect(r.serviceName).toBeNull();
    expect(r.stackName).toBeNull();
  });

  test("task with no ID -> null", () => {
    expect(extract("Task", envelope("Task", { Name: "web.1.abc" }))).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - Stack", () => {
  test("stack '3 services' -> externalId stack/<name>, serviceCount 3", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Stack",
        envelope("Stack", {
          Name: "mystack",
          Services: "3",
          Orchestrator: "Swarm",
        }),
      ),
    );

    expect(r.kind).toBe("Stack");
    expect(r.externalId).toBe("stack/mystack");
    expect(r.name).toBe("mystack");
    expect(r.stackName).toBe("mystack");
    expect(r.state).toBe("3 services");
    expect(r.attributes?.["serviceCount"]).toBe(3);
    expect(r.attributes?.["orchestrator"]).toBe("Swarm");
  });

  test("stack with no Services field -> state null, serviceCount null", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract("Stack", envelope("Stack", { Name: "empty-stack" })),
    );

    expect(r.state).toBeNull();
    expect(r.attributes?.["serviceCount"]).toBeNull();
  });

  test("stack with no Name -> null (Name is the identity)", () => {
    expect(extract("Stack", envelope("Stack", { Services: "2" }))).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - Network", () => {
  test("network -> externalId network/<id>, driver + scope state", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Network",
        envelope("Network", {
          ID: "net1",
          Name: "ingress",
          Driver: "overlay",
          Scope: "swarm",
          Internal: "false",
          IPv6: "false",
        }),
      ),
    );

    expect(r.kind).toBe("Network");
    expect(r.externalId).toBe("network/net1");
    expect(r.name).toBe("ingress");
    expect(r.driver).toBe("overlay");
    expect(r.state).toBe("swarm");
    expect(r.attributes?.["scope"]).toBe("swarm");
    expect(r.attributes?.["internal"]).toBe("false");
    expect(r.attributes?.["ipv6"]).toBe("false");
  });

  test("network with only a Name (no ID) -> externalId falls back to name", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Network",
        envelope("Network", {
          Name: "bridge",
          Driver: "bridge",
          Scope: "local",
        }),
      ),
    );

    expect(r.externalId).toBe("network/bridge");
  });

  test("network with neither ID nor Name -> null", () => {
    expect(
      extract("Network", envelope("Network", { Driver: "overlay" })),
    ).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - Secret and Config", () => {
  test("secret -> kind Secret, externalId secret/<id>, timestamps captured", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Secret",
        envelope("Secret", {
          ID: "sec1",
          Name: "db-password",
          CreatedAt: "2026-06-01T00:00:00Z",
          UpdatedAt: "2026-06-10T00:00:00Z",
        }),
      ),
    );

    expect(r.kind).toBe("Secret");
    expect(r.externalId).toBe("secret/sec1");
    expect(r.name).toBe("db-password");
    expect(r.attributes?.["createdAt"]).toBe("2026-06-01T00:00:00Z");
    expect(r.attributes?.["updatedAt"]).toBe("2026-06-10T00:00:00Z");
  });

  test("config -> kind Config, externalId config/<id>", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract("Config", envelope("Config", { ID: "cfg1", Name: "nginx-conf" })),
    );

    expect(r.kind).toBe("Config");
    expect(r.externalId).toBe("config/cfg1");
    expect(r.name).toBe("nginx-conf");
  });

  test("secret/config with only a Name (no ID) -> externalId falls back to name", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract("Secret", envelope("Secret", { Name: "named-only" })),
    );
    expect(r.externalId).toBe("secret/named-only");
  });

  test("secret with neither ID nor Name -> null", () => {
    expect(
      extract("Secret", envelope("Secret", { CreatedAt: "x" })),
    ).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - Volume", () => {
  test("volume with node hostname -> externalId volume/<name>@<node>", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Volume",
        envelope("Volume", {
          Name: "data-vol",
          Driver: "local",
          Scope: "local",
          Mountpoint: "/var/lib/docker/volumes/data-vol/_data",
          Node: "wkr-1",
        }),
      ),
    );

    expect(r.kind).toBe("Volume");
    // Per-node suffix so two nodes' same-named volumes don't collide.
    expect(r.externalId).toBe("volume/data-vol@wkr-1");
    expect(r.name).toBe("data-vol");
    expect(r.driver).toBe("local");
    expect(r.nodeHostname).toBe("wkr-1");
    expect(r.state).toBe("local");
    expect(r.attributes?.["scope"]).toBe("local");
    expect(r.attributes?.["mountpoint"]).toBe(
      "/var/lib/docker/volumes/data-vol/_data",
    );
  });

  test("volume without node hostname -> externalId volume/<name>", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Volume",
        envelope("Volume", { Name: "shared-vol", Driver: "nfs" }),
      ),
    );

    expect(r.externalId).toBe("volume/shared-vol");
    expect(r.nodeHostname).toBeNull();
  });

  test("volume accepts NodeHostname as an alias for Node", () => {
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Volume",
        envelope("Volume", { Name: "v", NodeHostname: "mgr-1" }),
      ),
    );
    expect(r.externalId).toBe("volume/v@mgr-1");
    expect(r.nodeHostname).toBe("mgr-1");
  });

  test("volume with no Name -> null (Name is the identity)", () => {
    expect(
      extract("Volume", envelope("Volume", { Driver: "local" })),
    ).toBeNull();
  });
});

describe("DockerSwarmInventoryExtractor - kind/payload routing", () => {
  test("kind discriminator routes independently of payload shape", () => {
    /*
     * A Service payload labeled as Stack is parsed as a Stack: Stack only
     * needs Name, which the service payload has -> a Stack resource.
     */
    const r: ParsedDockerSwarmResource = resourceOf(
      extract(
        "Stack",
        envelope("Service", { ID: "svc1", Name: "api", Replicas: "1/1" }),
      ),
    );
    expect(r.kind).toBe("Stack");
    expect(r.externalId).toBe("stack/api");
  });
});

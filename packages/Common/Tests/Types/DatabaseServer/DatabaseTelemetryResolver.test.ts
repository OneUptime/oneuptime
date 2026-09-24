import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseCallTarget,
  resolveDatabaseFromResourceAttributes,
} from "../../../Types/DatabaseServer/DatabaseTelemetryResolver";
import {
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import { describe, expect, test } from "@jest/globals";

type CallTarget = {
  system: string;
  endpoint: DatabaseEndpoint;
  scope: DatabaseEndpointScope;
} | null;

type ResourceResolution = {
  system: string;
  endpoint: DatabaseEndpoint | null;
  linkedDatabaseServerId: string | null;
  displayName: string | null;
  version: string | null;
} | null;

const VM_CALLER: DatabaseCallerContext = {
  hostName: "app-7",
  isEphemeral: false,
};

const K8S_CALLER: DatabaseCallerContext = {
  kubernetesNamespace: "shop",
  kubernetesClusterName: "prod-eu",
  hostName: "checkout-7d9f",
  isEphemeral: true,
};

const LINKED_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";

const CONTRIB: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/";

function callTarget(
  attributes: Record<string, unknown>,
  caller: DatabaseCallerContext = VM_CALLER,
): CallTarget {
  return resolveDatabaseCallTarget({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    caller,
  });
}

function fromResource(
  attributes: Record<string, unknown>,
  receiverSystemHint?: string | null,
): ResourceResolution {
  return resolveDatabaseFromResourceAttributes({
    attributes,
    receiverSystemHint,
  });
}

describe("attribute precedence lists", () => {
  test("stable semconv names come first, legacy names after", () => {
    expect(DATABASE_SYSTEM_ATTRIBUTES).toEqual(["db.system.name", "db.system"]);
    expect(DATABASE_ADDRESS_ATTRIBUTES).toEqual([
      "server.address",
      "net.peer.name",
      "network.peer.address",
      "net.sock.peer.addr",
    ]);
    expect(DATABASE_PORT_ATTRIBUTES).toEqual([
      "server.port",
      "net.peer.port",
      "network.peer.port",
      "net.sock.peer.port",
    ]);
  });
});

describe("resolveDatabaseCallTarget", () => {
  test("a stable-semconv span resolves to its endpoint", () => {
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      }),
    ).toEqual({
      system: "postgresql",
      endpoint: { host: "db.prod.example.com", port: 5432 },
      scope: "global",
    });
  });

  test("legacy attributes resolve the same endpoint", () => {
    expect(
      callTarget({
        "db.system": "postgres",
        "net.peer.name": "db.prod.example.com",
        "net.peer.port": 5432,
      }),
    ).toEqual(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      }),
    );
  });

  test("returns before reading anything else when no system is present", () => {
    const readKeys: Array<string> = [];
    const getAttribute: (key: string) => unknown = (key: string): unknown => {
      readKeys.push(key);
      return key === "server.address" ? "db.prod" : undefined;
    };
    expect(
      resolveDatabaseCallTarget({ getAttribute, caller: VM_CALLER }),
    ).toBeNull();
    expect(readKeys).toEqual(DATABASE_SYSTEM_ATTRIBUTES);
  });

  test("an empty-string system counts as absent; the legacy one is used", () => {
    expect(
      callTarget({
        "db.system.name": "",
        "db.system": "mysql",
        "server.address": "db.prod",
      })?.system,
    ).toBe("mysql");
  });

  test("the engine is normalized", () => {
    expect(
      callTarget({ "db.system.name": "MSSQL", "server.address": "sql.prod" }),
    ).toEqual({
      system: "microsoft.sql_server",
      endpoint: { host: "sql.prod", port: 1433 },
      scope: "global",
    });
  });

  test("address precedence: server.address > net.peer.name > network.peer.address > net.sock.peer.addr", () => {
    const all: Record<string, unknown> = {
      "db.system.name": "redis",
      "server.address": "a.prod",
      "net.peer.name": "b.prod",
      "network.peer.address": "c.prod",
      "net.sock.peer.addr": "d.prod",
    };
    expect(callTarget(all)?.endpoint.host).toBe("a.prod");
    expect(callTarget({ ...all, "server.address": "" })?.endpoint.host).toBe(
      "b.prod",
    );
    expect(
      callTarget({ ...all, "server.address": "", "net.peer.name": null })
        ?.endpoint.host,
    ).toBe("c.prod");
    expect(
      callTarget({
        ...all,
        "server.address": undefined,
        "net.peer.name": undefined,
        "network.peer.address": undefined,
      })?.endpoint.host,
    ).toBe("d.prod");
  });

  test("a scrubbed address does NOT fall back to the next attribute", () => {
    /*
     * Mirrors the discovery SQL's multiIf(x != '', …): the first non-empty
     * attribute is THE address, so the ingest key and the cron endpoint
     * agree even when that value is unusable.
     */
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "[REDACTED]",
        "network.peer.address": "10.0.0.5",
      }),
    ).toBeNull();
  });

  test("port precedence and the engine default", () => {
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod",
        "server.port": 6543,
        "network.peer.port": 5432,
      })?.endpoint.port,
    ).toBe(6543);
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod",
        "network.peer.port": "6432",
      })?.endpoint.port,
    ).toBe(6432);
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod",
      })?.endpoint.port,
    ).toBe(5432);
  });

  test("an address:port value is honoured when no port attribute exists", () => {
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod:6543",
      })?.endpoint.port,
    ).toBe(6543);
  });

  test("no address → null (an engine alone is not a server)", () => {
    expect(callTarget({ "db.system.name": "postgresql" })).toBeNull();
    expect(
      callTarget({ "db.system.name": "postgresql", "server.address": "" }),
    ).toBeNull();
  });

  test.each([
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
    "(local)",
  ])("loopback / host-relative %s is never an identity", (address: string) => {
    expect(
      callTarget({ "db.system.name": "postgresql", "server.address": address }),
    ).toBeNull();
    expect(
      callTarget(
        { "db.system.name": "postgresql", "server.address": address },
        K8S_CALLER,
      ),
    ).toBeNull();
  });

  test.each(["[REDACTED]", "[HASHED:ab12cd34]", "***.***.***.***"])(
    "scrubbed address %s → null",
    (address: string) => {
      expect(
        callTarget({ "db.system.name": "redis", "server.address": address }),
      ).toBeNull();
    },
  );

  test("a Kubernetes caller's short name expands and is cluster-qualified", () => {
    expect(
      callTarget(
        { "db.system.name": "postgresql", "server.address": "pg" },
        K8S_CALLER,
      ),
    ).toEqual({
      system: "postgresql",
      endpoint: {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod-eu",
      },
      scope: "global",
    });
  });

  test("scope: bare names, unqualified cluster DNS and private IPs are local", () => {
    expect(
      callTarget({ "db.system.name": "postgresql", "server.address": "db" })
        ?.scope,
    ).toBe("local");
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "pg.shop.svc.cluster.local",
      })?.scope,
    ).toBe("local");
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "10.0.0.5",
      })?.scope,
    ).toBe("local");
    expect(
      callTarget(
        { "db.system.name": "postgresql", "server.address": "10.0.0.5" },
        K8S_CALLER,
      )?.scope,
    ).toBe("global");
  });

  test("unknown engines still resolve (the key is engine-agnostic)", () => {
    expect(
      callTarget({ "db.system.name": "tidb", "server.address": "tidb.prod" }),
    ).toEqual({
      system: "tidb",
      endpoint: { host: "tidb.prod", port: null },
      scope: "global",
    });
  });

  test("a missing caller is treated as ephemeral, never throws", () => {
    expect(
      resolveDatabaseCallTarget({
        getAttribute: (key: string): unknown => {
          return (
            {
              "db.system.name": "postgresql",
              "server.address": "db.prod",
            } as Record<string, unknown>
          )[key];
        },
        caller: undefined as unknown as DatabaseCallerContext,
      })?.endpoint,
    ).toEqual({ host: "db.prod", port: 5432 });
    expect(
      resolveDatabaseCallTarget(
        undefined as unknown as {
          getAttribute: (key: string) => unknown;
          caller: DatabaseCallerContext;
        },
      ),
    ).toBeNull();
  });

  test("object-valued attributes are ignored", () => {
    expect(
      callTarget({
        "db.system.name": { value: "postgresql" },
        "server.address": "db.prod",
      }),
    ).toBeNull();
  });
});

describe("resolveDatabaseFromResourceAttributes — which batches are databases", () => {
  test("a receiver hint alone decides the engine", () => {
    expect(
      fromResource(
        { "server.address": "db.prod", "server.port": "5432" },
        "postgresql",
      ),
    ).toEqual({
      system: "postgresql",
      endpoint: { host: "db.prod", port: 5432 },
      linkedDatabaseServerId: null,
      displayName: "PostgreSQL db.prod:5432",
      version: null,
    });
  });

  test("the hint is refined by db.system.name (MariaDB via the mysql receiver)", () => {
    expect(
      fromResource(
        { "db.system.name": "mariadb", "server.address": "db.prod" },
        "mysql",
      )?.system,
    ).toBe("mysql");
    expect(
      fromResource(
        { "db.system.name": "cockroachdb", "server.address": "crdb.prod" },
        "postgresql",
      )?.system,
    ).toBe("cockroachdb");
  });

  test("an explicit stamp (db.system.name + server.address) is enough", () => {
    expect(
      fromResource({
        "db.system.name": "redis",
        "server.address": "cache.prod",
        "oneuptime.database.agent": "true",
      }),
    ).toMatchObject({
      system: "redis",
      endpoint: { host: "cache.prod", port: 6379 },
    });
  });

  test("an application resource is never a database", () => {
    // No hint, no stamp: an app that merely has server.address…
    expect(
      fromResource({
        "service.name": "checkout",
        "server.address": "db.prod",
        "host.name": "app-7",
      }),
    ).toBeNull();
    // …or a db.system.name without an address or a linked id.
    expect(
      fromResource({ "service.name": "checkout", "db.system.name": "redis" }),
    ).toBeNull();
    expect(fromResource({})).toBeNull();
  });

  test("a linked row id makes the batch a database even without an endpoint", () => {
    expect(fromResource({ "oneuptime.database.server.id": LINKED_ID })).toEqual(
      {
        system: "",
        endpoint: null,
        linkedDatabaseServerId: LINKED_ID,
        displayName: null,
        version: null,
      },
    );
    expect(
      fromResource({
        "oneuptime.database.server.id": `  ${LINKED_ID.toUpperCase()} `,
        "db.system.name": "postgres",
      }),
    ).toMatchObject({
      system: "postgresql",
      linkedDatabaseServerId: LINKED_ID,
    });
  });

  test("a non-UUID linked id is ignored", () => {
    expect(
      fromResource({ "oneuptime.database.server.id": "not-a-uuid" }),
    ).toBeNull();
    expect(
      fromResource(
        { "oneuptime.database.server.id": "123", "server.address": "db.prod" },
        "postgresql",
      )?.linkedDatabaseServerId,
    ).toBeNull();
  });
});

describe("resolveDatabaseFromResourceAttributes — endpoint precedence", () => {
  test("server.address (+ server.port) first", () => {
    expect(
      fromResource(
        {
          "server.address": "db.prod",
          "server.port": 6543,
          "service.instance.id": "other.prod:5432",
        },
        "postgresql",
      )?.endpoint,
    ).toEqual({ host: "db.prod", port: 6543 });
  });

  test("then service.instance.id parsed as host[:port] (PG legacy)", () => {
    expect(
      fromResource({ "service.instance.id": "db.prod:5433" }, "postgresql")
        ?.endpoint,
    ).toEqual({ host: "db.prod", port: 5433 });
  });

  test("service.instance.id host:port/service is read as host:port (Oracle)", () => {
    expect(
      fromResource(
        { "service.instance.id": "ora.prod:1521/ORCLPDB1" },
        "oracle.db",
      )?.endpoint,
    ).toEqual({ host: "ora.prod", port: 1521 });
  });

  test("service.instance.id host\\instance drops the instance (SQL Server)", () => {
    expect(
      fromResource(
        { "service.instance.id": "sql.prod\\REPORTING" },
        "microsoft.sql_server",
      )?.endpoint,
    ).toEqual({ host: "sql.prod", port: 1433 });
  });

  test("a UUID-shaped service.instance.id is ignored (MySQL / MongoDB)", () => {
    expect(
      fromResource(
        {
          "service.instance.id": "8e9b4f43-5c1f-5a88-9a57-6d3c0a9f1b2e",
          "mysql.instance.endpoint": "mysql.prod:3306",
        },
        "mysql",
      )?.endpoint,
    ).toEqual({ host: "mysql.prod", port: 3306 });
    expect(
      fromResource(
        { "service.instance.id": "8e9b4f43-5c1f-5a88-9a57-6d3c0a9f1b2e" },
        "mongodb",
      ),
    ).toBeNull();
  });

  test("mongodb_atlas.host.name + mongodb_atlas.process.port (Atlas)", () => {
    expect(
      fromResource(
        {
          "mongodb_atlas.host.name": "atlas-abc-shard-00-00.xyz.mongodb.net",
          "mongodb_atlas.process.port": 27017,
          "mongodb_atlas.project.name": "prod",
        },
        "mongodb",
      )?.endpoint,
    ).toEqual({
      host: "atlas-abc-shard-00-00.xyz.mongodb.net",
      port: 27017,
    });
  });

  test("an unusable candidate falls through to the next one", () => {
    expect(
      fromResource(
        {
          "server.address": "[REDACTED]",
          "service.instance.id": "unknown:5432",
          "mysql.instance.endpoint": "mysql.prod:3307",
        },
        "mysql",
      )?.endpoint,
    ).toEqual({ host: "mysql.prod", port: 3307 });
  });

  test("NO host.name fallback: a collector scraping N Redis never merges them", () => {
    const redisA: ResourceResolution = fromResource(
      {
        "host.name": "collector-1",
        "os.type": "linux",
        "redis.version": "7.2",
      },
      "redis",
    );
    const redisB: ResourceResolution = fromResource(
      {
        "host.name": "collector-1",
        "os.type": "linux",
        "redis.version": "7.0",
      },
      "redis",
    );
    expect(redisA).toBeNull();
    expect(redisB).toBeNull();
  });

  test("memcached (no resource attributes at all) is not a database row", () => {
    expect(fromResource({}, "memcached")).toBeNull();
  });

  test("Elasticsearch cluster / node names are never used as a host", () => {
    expect(
      fromResource(
        {
          "elasticsearch.cluster.name": "docker-cluster",
          "elasticsearch.node.name": "es-0",
        },
        "elasticsearch",
      ),
    ).toBeNull();
  });
});

describe("resolveDatabaseFromResourceAttributes — non-identity hosts", () => {
  test.each([
    ["unknown:5432"],
    ["unknown"],
    ["unknown_service"],
    ["nohost"],
    ["localhost.localdomain"],
  ])("%s counts as absent", (value: string) => {
    expect(
      fromResource({ "service.instance.id": value }, "postgresql"),
    ).toBeNull();
    expect(fromResource({ "server.address": value }, "postgresql")).toBeNull();
  });

  test("CouchDB's default nonode@nohost does not become a host", () => {
    expect(fromResource({ "server.address": "nohost" }, "couchdb")).toBeNull();
  });

  test("the resource's own pod name is not a server (sidecar collector)", () => {
    expect(
      fromResource(
        {
          "server.address": "pg-exporter-6c9f-x2x",
          "k8s.pod.name": "PG-Exporter-6c9f-x2x",
        },
        "postgresql",
      ),
    ).toBeNull();
  });

  test("a 12- or 64-hex container id is not a server", () => {
    expect(
      fromResource({ "server.address": "0123456789ab" }, "postgresql"),
    ).toBeNull();
    expect(
      fromResource({ "server.address": "a".repeat(64) }, "postgresql"),
    ).toBeNull();
    // Other hex lengths are ordinary names.
    expect(
      fromResource({ "server.address": "0123456789abcd" }, "postgresql")
        ?.endpoint,
    ).toEqual({ host: "0123456789abcd", port: 5432 });
  });

  test("…unless OUR agent stamped the address explicitly", () => {
    expect(
      fromResource(
        {
          "server.address": "0123456789ab",
          "oneuptime.database.agent": "true",
        },
        "postgresql",
      )?.endpoint,
    ).toEqual({ host: "0123456789ab", port: 5432 });
    expect(
      fromResource(
        {
          "server.address": "pg-0",
          "k8s.pod.name": "pg-0",
          "k8s.namespace.name": "data",
          "k8s.cluster.name": "prod",
          "oneuptime.database.agent": "true",
        },
        "postgresql",
      )?.endpoint,
    ).toEqual({
      host: "pg-0.data.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "prod",
    });
  });

  test("the agent stamp does not rescue 'unknown'", () => {
    expect(
      fromResource(
        { "server.address": "unknown", "oneuptime.database.agent": "true" },
        "postgresql",
      ),
    ).toBeNull();
  });

  test("a non-identity host with a linked id still resolves the row, endpoint-less", () => {
    expect(
      fromResource(
        {
          "server.address": "unknown",
          "oneuptime.database.server.id": LINKED_ID,
        },
        "postgresql",
      ),
    ).toMatchObject({ endpoint: null, linkedDatabaseServerId: LINKED_ID });
  });
});

describe("resolveDatabaseFromResourceAttributes — loopback (collector purpose)", () => {
  test("a stable collector's loopback address is its own host", () => {
    expect(
      fromResource(
        {
          "server.address": "localhost",
          "host.name": "db-1.corp",
          "os.type": "linux",
        },
        "postgresql",
      )?.endpoint,
    ).toEqual({ host: "db-1.corp", port: 5432 });
  });

  test("an ephemeral collector's loopback address is refused", () => {
    // Kubernetes sidecar / Docker container collectors.
    expect(
      fromResource(
        {
          "server.address": "localhost",
          "host.name": "pg-0",
          "os.type": "linux",
          "k8s.pod.name": "pg-0",
        },
        "postgresql",
      ),
    ).toBeNull();
    expect(
      fromResource(
        {
          "server.address": "127.0.0.1",
          "host.name": "3f9a1b2c4d5e",
          "os.type": "linux",
          "container.id": "3f9a1b2c4d5e",
        },
        "redis",
      ),
    ).toBeNull();
  });

  test("the rewrite never lands on a container-id host.name", () => {
    expect(
      fromResource(
        {
          "server.address": "localhost",
          "host.name": "3f9a1b2c4d5e",
          "os.type": "linux",
        },
        "postgresql",
      ),
    ).toBeNull();
  });
});

describe("resolveDatabaseFromResourceAttributes — descriptive fields", () => {
  test.each([
    ["db.system.version", "16.2"],
    ["redis.version", "7.2.4"],
    ["oracle.db.version", "23.4"],
    ["elasticsearch.node.version", "8.13.0"],
    ["mongodb.version", "7.0.5"],
  ])("version from %s", (key: string, version: string) => {
    expect(
      fromResource({ "server.address": "db.prod", [key]: version }, "redis")
        ?.version,
    ).toBe(version);
  });

  test("db.system.version wins when several are present", () => {
    expect(
      fromResource(
        {
          "server.address": "db.prod",
          "redis.version": "7.0",
          "db.system.version": "7.2",
        },
        "redis",
      )?.version,
    ).toBe("7.2");
  });

  test("the display name uses the endpoint, without the cluster qualifier", () => {
    expect(
      fromResource(
        {
          "server.address": "10.0.0.5",
          "k8s.cluster.name": "prod",
          "oneuptime.database.agent": "true",
        },
        "postgresql",
      ),
    ).toMatchObject({
      endpoint: {
        host: "10.0.0.5",
        port: 5432,
        kubernetesClusterName: "prod",
      },
      displayName: "PostgreSQL 10.0.0.5:5432",
    });
  });

  test("the stored resource.-prefixed spelling is accepted", () => {
    expect(
      fromResource(
        { "resource.server.address": "db.prod", "resource.server.port": 6543 },
        "postgresql",
      )?.endpoint,
    ).toEqual({ host: "db.prod", port: 6543 });
  });

  test("garbage input never throws", () => {
    expect(
      resolveDatabaseFromResourceAttributes(
        undefined as unknown as { attributes: Record<string, unknown> },
      ),
    ).toBeNull();
    expect(
      resolveDatabaseFromResourceAttributes({
        attributes: null as unknown as Record<string, unknown>,
        receiverSystemHint: "postgresql",
      }),
    ).toBeNull();
  });

  test("a hint that is not a known engine is not a hint", () => {
    expect(
      fromResource({ "server.address": "db.prod" }, `${CONTRIB}kafkareceiver`),
    ).toBeNull();
    expect(fromResource({ "server.address": "db.prod" }, "tidb")).toBeNull();
    // An alias of a known engine is fine.
    expect(
      fromResource({ "server.address": "db.prod" }, "postgres")?.system,
    ).toBe("postgresql");
  });
});

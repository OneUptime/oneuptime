import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  isStableCollectorEndpoint,
  resolveDatabaseCallTarget,
  resolveDatabaseFromResourceAttributes,
} from "../../../Types/DatabaseServer/DatabaseTelemetryResolver";
import {
  buildDatabaseCallerContext,
  canonicalizeDatabaseEndpoint,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  getDatabaseReceiverSystemHint,
  normalizeDatabaseSystem,
} from "../../../Types/DatabaseServer/DatabaseSystem";
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
  endpointIsStable: boolean;
  allowCreate: boolean;
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
      callTarget({
        "db.system.name": "acme-db",
        "server.address": "acme.prod",
      }),
    ).toEqual({
      system: "acme-db",
      endpoint: { host: "acme.prod", port: null },
      scope: "global",
    });
  });

  test("a SQL Server named instance beside the address is read like the canonicalizer defines it", () => {
    const base: Record<string, unknown> = {
      "db.system.name": "microsoft.sql_server",
      "server.address": "sql1.corp.example.com",
    };

    for (const [attributes, instance] of [
      [{ ...base, "db.mssql.instance_name": "INST01" }, "INST01"],
      [{ ...base, "db.namespace": "INST02|orders" }, "INST02"],
    ] as Array<[Record<string, unknown>, string]>) {
      expect(callTarget(attributes)?.endpoint).toEqual(
        canonicalizeDatabaseEndpoint({
          system: "microsoft.sql_server",
          address: "sql1.corp.example.com",
          instance,
          caller: VM_CALLER,
          purpose: "client-call",
        }),
      );
    }

    // Two instances on one host are two servers…
    expect(
      callTarget({ ...base, "db.mssql.instance_name": "INST01" })?.endpoint,
    ).not.toEqual(
      callTarget({ ...base, "db.mssql.instance_name": "INST02" })?.endpoint,
    );
  });

  test("an instance-shaped db.namespace means nothing for another engine", () => {
    expect(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
        "db.namespace": "INST01|orders",
        "db.mssql.instance_name": "INST01",
      })?.endpoint,
    ).toEqual(
      callTarget({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      })?.endpoint,
    );
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
      endpointIsStable: true,
      allowCreate: true,
    });
  });

  test("the hint is refined by db.system.name (MariaDB via the mysql receiver)", () => {
    // The stamp wins, normalized the way the engine catalog normalizes it.
    expect(
      fromResource(
        { "db.system.name": "mariadb", "server.address": "db.prod" },
        "mysql",
      )?.system,
    ).toBe(normalizeDatabaseSystem("mariadb"));
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
        // No endpoint: nothing to create a row for or claim as an alias.
        endpointIsStable: false,
        allowCreate: false,
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

  test("the legacy db.system stamp counts like db.system.name (receivers that predate the rename)", () => {
    expect(
      fromResource({
        "db.system": "redis",
        "server.address": "cache.prod",
        "oneuptime.database.agent": "true",
      }),
    ).toMatchObject({
      system: "redis",
      endpoint: { host: "cache.prod", port: 6379 },
      displayName: "Redis cache.prod:6379",
    });
    // …with a linked id and no address, too.
    expect(
      fromResource({
        "oneuptime.database.server.id": LINKED_ID,
        "db.system": "postgres",
      }),
    ).toMatchObject({
      system: "postgresql",
      linkedDatabaseServerId: LINKED_ID,
    });
    // …and it refines a receiver hint exactly as db.system.name does.
    expect(
      fromResource(
        { "db.system": "mariadb", "server.address": "db.prod" },
        "mysql",
      )?.system,
    ).toBe("mariadb");
  });

  test("db.system.name wins over db.system; an empty or blank one falls back to it", () => {
    expect(
      fromResource({
        "db.system.name": "mariadb",
        "db.system": "mysql",
        "server.address": "db.prod",
      })?.system,
    ).toBe("mariadb");
    for (const blank of ["", "   "]) {
      expect(
        fromResource({
          "db.system.name": blank,
          "db.system": "postgresql",
          "server.address": "db.prod",
        })?.system,
      ).toBe("postgresql");
    }
    // The stored resource.-prefixed spelling of the legacy key is read too.
    expect(
      fromResource({
        "resource.db.system": "redis",
        "resource.server.address": "cache.prod",
      })?.system,
    ).toBe("redis");
  });

  test("a db.system stamp alone (no address, no link) is still not a database", () => {
    expect(
      fromResource({ "service.name": "checkout", "db.system": "redis" }),
    ).toBeNull();
    // A non-string, object-valued stamp is no engine at all.
    expect(
      fromResource({
        "db.system": { name: "redis" },
        "server.address": "cache.prod",
      }),
    ).toBeNull();
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

  test("service.instance.id host\\instance is read through the endpoint canonicalizer (SQL Server)", () => {
    const endpoint: DatabaseEndpoint | null | undefined = fromResource(
      { "service.instance.id": "sql.prod\\REPORTING" },
      "microsoft.sql_server",
    )?.endpoint;

    // The server is the address part; a named instance never replaces it.
    expect(endpoint?.host.split("\\")[0]).toBe("sql.prod");
    expect(endpoint).toEqual(
      canonicalizeDatabaseEndpoint({
        system: "microsoft.sql_server",
        address: "sql.prod\\REPORTING",
        caller: buildDatabaseCallerContext({}),
        purpose: "collector",
      }),
    );
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

  describe("SAP HANA (the saphana receiver: db.system + saphana.host)", () => {
    // What the receiver stamps: the legacy engine key and the host alone.
    const SAPHANA: Record<string, unknown> = {
      "db.system": "saphana",
      "saphana.host": "hana.prod.example.com",
    };
    const SAPHANA_HINT: string | null = getDatabaseReceiverSystemHint([
      `${CONTRIB}saphanareceiver`,
    ]);

    test("the receiver's scope is the hint", () => {
      expect(SAPHANA_HINT).toBe("sap.hana");
    });

    test("saphana.host is the endpoint, on the engine's default port", () => {
      expect(fromResource(SAPHANA, SAPHANA_HINT)).toEqual({
        system: "sap.hana",
        endpoint: { host: "hana.prod.example.com", port: 30015 },
        linkedDatabaseServerId: null,
        displayName: "SAP HANA hana.prod.example.com:30015",
        version: null,
        endpointIsStable: true,
        allowCreate: true,
      });
    });

    test("a port inside saphana.host is honoured", () => {
      expect(
        fromResource(
          { ...SAPHANA, "saphana.host": "hana.prod.example.com:39017" },
          SAPHANA_HINT,
        )?.endpoint,
      ).toEqual({ host: "hana.prod.example.com", port: 39017 });
    });

    test("the legacy engine stamp alone names the engine (no scope hint)", () => {
      // Linked: the id identifies the row, the host keys the rows.
      expect(
        fromResource({
          ...SAPHANA,
          "oneuptime.database.server.id": LINKED_ID,
        }),
      ).toMatchObject({
        system: "sap.hana",
        linkedDatabaseServerId: LINKED_ID,
        endpoint: { host: "hana.prod.example.com", port: 30015 },
      });
      /*
       * Unlinked, with no server.address and no hint, it is not an explicit
       * stamp: nothing says this resource is the database itself.
       */
      expect(fromResource(SAPHANA)).toBeNull();
    });

    test("saphana.host is the last resort: server.address wins", () => {
      expect(
        fromResource(
          {
            ...SAPHANA,
            "server.address": "hana-vip.prod.example.com",
            "server.port": 30041,
          },
          SAPHANA_HINT,
        )?.endpoint,
      ).toEqual({ host: "hana-vip.prod.example.com", port: 30041 });
    });

    test("a HANA-internal single-label host keys the rows but never creates one", () => {
      // HANA reports its own hostname ("hxehost"), not the address dialled.
      expect(
        fromResource(
          { ...SAPHANA, "saphana.host": "hxehost", "os.type": "linux" },
          SAPHANA_HINT,
        ),
      ).toMatchObject({
        endpoint: { host: "hxehost", port: 30015 },
        endpointIsStable: false,
        allowCreate: false,
      });
    });

    test("a placeholder saphana.host is no endpoint", () => {
      expect(
        fromResource({ ...SAPHANA, "saphana.host": "unknown" }, SAPHANA_HINT),
      ).toBeNull();
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

  describe("the server's own version string refines a family engine", () => {
    const MARIADB_VERSION: string = "10.11.7-MariaDB-1:10.11.7+maria~ubu2204";
    const TIDB_VERSION: string = "8.0.11-TiDB-v7.5.1";

    test("the mysql receiver's hint + a MariaDB version is MariaDB", () => {
      expect(
        fromResource(
          { "server.address": "db.prod", "db.system.version": MARIADB_VERSION },
          "mysql",
        ),
      ).toMatchObject({
        system: "mariadb",
        displayName: "MariaDB db.prod:3306",
        version: MARIADB_VERSION,
        allowCreate: true,
      });
    });

    test("an explicit mysql stamp + a TiDB version is TiDB", () => {
      expect(
        fromResource({
          "db.system.name": "mysql",
          "server.address": "db.prod",
          "server.port": 4000,
          "db.system.version": TIDB_VERSION,
        })?.system,
      ).toBe("tidb");
    });

    test("the linked-id path is refined too", () => {
      expect(
        fromResource({
          "oneuptime.database.server.id": LINKED_ID,
          "db.system.name": "mysql",
          "db.system.version": MARIADB_VERSION,
        })?.system,
      ).toBe("mariadb");
    });

    test("the endpoint does not move with the version: identity is the engine as reported", () => {
      const withVersion: ResourceResolution = fromResource(
        { "server.address": "db.prod", "db.system.version": TIDB_VERSION },
        "mysql",
      );
      const withoutVersion: ResourceResolution = fromResource(
        { "server.address": "db.prod" },
        "mysql",
      );
      expect(withVersion?.system).toBe("tidb");
      expect(withoutVersion?.system).toBe("mysql");
      /*
       * MySQL's default port, not TiDB's: the same server keys the same way
       * whether or not its receiver managed to read the version.
       */
      expect(withVersion?.endpoint).toEqual({ host: "db.prod", port: 3306 });
      expect(withVersion?.endpoint).toEqual(withoutVersion?.endpoint);
    });

    test.each<[string, string, string]>([
      ["a bare version", "mysql", "8.0.36"],
      ["a fork already named (never re-forked)", "mariadb", TIDB_VERSION],
      ["a fork's version under another family", "postgresql", MARIADB_VERSION],
      ["an unknown engine", "acme-db", MARIADB_VERSION],
    ])(
      "%s keeps the engine",
      (_label: string, system: string, version: string) => {
        expect(
          fromResource({
            "db.system.name": system,
            "server.address": "db.prod",
            "db.system.version": version,
          })?.system,
        ).toBe(system);
      },
    );

    test("a batch that names no engine is not given one by its version", () => {
      expect(
        fromResource({
          "oneuptime.database.server.id": LINKED_ID,
          "db.system.version": MARIADB_VERSION,
        })?.system,
      ).toBe("");
    });
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
    expect(fromResource({ "server.address": "db.prod" }, "acme-db")).toBeNull();
    // An alias of a known engine is fine.
    expect(
      fromResource({ "server.address": "db.prod" }, "postgres")?.system,
    ).toBe("postgresql");
  });
});

/*
 * Which collector endpoints may become a server's identity. A pod IP or a
 * name a collector made up from its own namespace keys the rows (so a row
 * that owns it finds them) but never creates a row or becomes an alias:
 * every pod restart would otherwise add another database.
 */
describe("resolveDatabaseFromResourceAttributes — stable identities (endpointIsStable / allowCreate)", () => {
  // A receiver_creator + k8s_observer batch: the scraped pod's IP and identity.
  const RECEIVER_CREATOR: Record<string, unknown> = {
    "server.address": "10.42.1.17",
    "server.port": "5432",
    "k8s.pod.name": "postgres-0",
    "k8s.namespace.name": "prod",
    "k8s.cluster.name": "prod-eu",
  };

  test("a pod IP qualified with its cluster keys the rows but is not stable", () => {
    const resolved: ResourceResolution = fromResource(
      RECEIVER_CREATOR,
      "postgresql",
    );

    expect(resolved?.endpoint).toEqual({
      host: "10.42.1.17",
      port: 5432,
      kubernetesClusterName: "prod-eu",
    });
    expect(resolved?.endpointIsStable).toBe(false);
    expect(resolved?.allowCreate).toBe(false);
  });

  test("a rolling restart's new pod IPs never become new databases", () => {
    for (const address of ["10.42.3.88", "10.42.7.4", "10.42.9.201"]) {
      const resolved: ResourceResolution = fromResource(
        { ...RECEIVER_CREATOR, "server.address": address },
        "postgresql",
      );
      expect(resolved?.endpoint?.host).toBe(address);
      expect(resolved?.allowCreate).toBe(false);
    }
  });

  test("the same pod IP without a cluster is LOCAL, and not stable either", () => {
    const resolved: ResourceResolution = fromResource(
      { ...RECEIVER_CREATOR, "k8s.cluster.name": undefined },
      "postgresql",
    );

    expect(resolved?.endpoint).toEqual({ host: "10.42.1.17", port: 5432 });
    expect(resolved?.endpointIsStable).toBe(false);
    expect(resolved?.allowCreate).toBe(false);
  });

  test.each([["k8s.pod.name"], ["k8s.pod.uid"]])(
    "an IP reported for a pod (%s) is not stable even when it is public",
    (key: string) => {
      const resolved: ResourceResolution = fromResource(
        {
          "server.address": "34.120.7.9",
          [key]: key === "k8s.pod.uid" ? LINKED_ID : "redis-master-0",
        },
        "redis",
      );

      expect(resolved?.endpoint).toEqual({ host: "34.120.7.9", port: 6379 });
      expect(resolved?.endpointIsStable).toBe(false);
      expect(resolved?.allowCreate).toBe(false);
    },
  );

  test("a public IP a VM collector was pointed at is a stable identity", () => {
    const resolved: ResourceResolution = fromResource(
      {
        "server.address": "34.120.7.9",
        "host.name": "collector-vm-1",
        "os.type": "linux",
      },
      "mysql",
    );

    expect(resolved?.endpoint).toEqual({ host: "34.120.7.9", port: 3306 });
    expect(resolved?.endpointIsStable).toBe(true);
    expect(resolved?.allowCreate).toBe(true);
  });

  test("the Database Agent's cluster-qualified private IP is keyed but not stable", () => {
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
      endpointIsStable: false,
      allowCreate: false,
    });
  });

  test("a sidecar's pod hostname expanded with the collector's own namespace is not a Service", () => {
    // The receiver substituted os.Hostname() (the pod name) for localhost.
    const resolved: ResourceResolution = fromResource(
      {
        "server.address": "orders-api-7c9d8f6b5-x2k4q",
        "k8s.namespace.name": "prod",
        "k8s.cluster.name": "c1",
      },
      "postgresql",
    );

    expect(resolved?.endpoint).toEqual({
      host: "orders-api-7c9d8f6b5-x2k4q.prod.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "c1",
    });
    expect(resolved?.endpointIsStable).toBe(false);
    expect(resolved?.allowCreate).toBe(false);
  });

  test("a single-label Service name keys exactly like the detected workload's alias, and joins it instead of creating", () => {
    const resolved: ResourceResolution = fromResource(
      {
        "server.address": "postgres",
        "k8s.namespace.name": "prod",
        "k8s.cluster.name": "c1",
      },
      "postgresql",
    );

    // The alias DiscoverContainerDatabases stores: postgres.prod.svc.cluster.local:5432@c1.
    expect(resolved?.endpoint).toEqual({
      host: "postgres.prod.svc.cluster.local",
      port: 5432,
      kubernetesClusterName: "c1",
    });
    expect(resolved?.allowCreate).toBe(false);
  });

  test.each([
    ["a Service FQDN", "postgres.prod.svc.cluster.local"],
    [
      "a StatefulSet member behind a headless Service",
      "postgres-0.postgres.prod.svc.cluster.local",
    ],
    ["the short .svc form", "postgres.prod.svc"],
  ])(
    "%s written out with the cluster stamped is a stable identity",
    (_label: string, address: string) => {
      const resolved: ResourceResolution = fromResource(
        {
          "server.address": address,
          "k8s.namespace.name": "monitoring",
          "k8s.cluster.name": "c1",
        },
        "postgresql",
      );

      expect(resolved?.endpoint?.kubernetesClusterName).toBe("c1");
      expect(resolved?.endpointIsStable).toBe(true);
      expect(resolved?.allowCreate).toBe(true);
    },
  );

  test("a stable collector's loopback rewritten to its FQDN host.name is stable", () => {
    const resolved: ResourceResolution = fromResource(
      {
        "server.address": "localhost",
        "host.name": "db-1.corp.example.com",
        "os.type": "linux",
      },
      "postgresql",
    );

    expect(resolved?.endpoint).toEqual({
      host: "db-1.corp.example.com",
      port: 5432,
    });
    expect(resolved?.endpointIsStable).toBe(true);
    expect(resolved?.allowCreate).toBe(true);
  });

  test("a loopback rewritten to a single-label host.name stays LOCAL", () => {
    const resolved: ResourceResolution = fromResource(
      {
        "server.address": "localhost",
        "host.name": "db01",
        "os.type": "linux",
      },
      "postgresql",
    );

    expect(resolved?.endpoint).toEqual({ host: "db01", port: 5432 });
    expect(resolved?.endpointIsStable).toBe(false);
    expect(resolved?.allowCreate).toBe(false);
  });

  test("an unknown engine keys and may be joined, but never creates a row", () => {
    const resolved: ResourceResolution = fromResource({
      "db.system.name": "acme-db",
      "server.address": "acme.prod.example.com",
      "server.port": "7000",
    });

    expect(resolved?.system).toBe("acme-db");
    expect(resolved?.endpointIsStable).toBe(true);
    expect(resolved?.allowCreate).toBe(false);
  });

  test("a cloud-API engine (a shared regional host) never creates a row", () => {
    const resolved: ResourceResolution = fromResource({
      "db.system.name": "aws.dynamodb",
      "server.address": "dynamodb.us-east-1.amazonaws.com",
      "server.port": "443",
    });

    expect(resolved?.endpointIsStable).toBe(true);
    expect(resolved?.allowCreate).toBe(false);
  });

  test("a linked id with a pod IP still resolves the link, endpoint not stable", () => {
    expect(
      fromResource(
        { ...RECEIVER_CREATOR, "oneuptime.database.server.id": LINKED_ID },
        "postgresql",
      ),
    ).toMatchObject({
      linkedDatabaseServerId: LINKED_ID,
      endpointIsStable: false,
      allowCreate: false,
    });
  });
});

describe("isStableCollectorEndpoint", () => {
  test("LOCAL endpoints are never stable", () => {
    const endpoints: Array<DatabaseEndpoint> = [
      { host: "pg-primary", port: 5432 },
      { host: "10.0.3.7", port: 5432 },
      { host: "postgres.prod.svc.cluster.local", port: 5432 },
    ];
    for (const endpoint of endpoints) {
      expect(
        isStableCollectorEndpoint({
          rawHost: endpoint.host,
          endpoint,
          attributes: {},
        }),
      ).toBe(false);
    }
  });

  test("an FQDN is stable whatever resource reported it", () => {
    expect(
      isStableCollectorEndpoint({
        rawHost: "db.prod.example.com",
        endpoint: { host: "db.prod.example.com", port: 5432 },
        attributes: { "k8s.pod.name": "collector-0" },
      }),
    ).toBe(true);
  });

  test("the pod rule reads the stored resource.-prefixed spelling too", () => {
    expect(
      isStableCollectorEndpoint({
        rawHost: "34.120.7.9",
        endpoint: { host: "34.120.7.9", port: 5432 },
        attributes: { "resource.k8s.pod.name": "pg-0" },
      }),
    ).toBe(false);
  });

  test("an IPv6 global address from a VM is stable; qualified with a cluster it is not", () => {
    expect(
      isStableCollectorEndpoint({
        rawHost: "2001:db8::10",
        endpoint: { host: "2001:db8::10", port: 5432 },
        attributes: {},
      }),
    ).toBe(true);
    expect(
      isStableCollectorEndpoint({
        rawHost: "fd00::10",
        endpoint: {
          host: "fd00::10",
          port: 5432,
          kubernetesClusterName: "c1",
        },
        attributes: {},
      }),
    ).toBe(false);
  });

  test("a SQL Server named instance is judged by its network host", () => {
    expect(
      isStableCollectorEndpoint({
        rawHost: "sql.prod.example.com",
        endpoint: { host: "sql.prod.example.com\\reporting", port: null },
        attributes: {},
      }),
    ).toBe(true);
    expect(
      isStableCollectorEndpoint({
        rawHost: "34.120.7.9",
        endpoint: { host: "34.120.7.9\\reporting", port: null },
        attributes: { "k8s.pod.name": "mssql-0" },
      }),
    ).toBe(false);
    // The raw host is compared case- and whitespace-insensitively, instance dropped.
    expect(
      isStableCollectorEndpoint({
        rawHost: "  SQL.Prod.Example.COM\\Reporting ",
        endpoint: { host: "sql.prod.example.com\\reporting", port: null },
        attributes: {},
      }),
    ).toBe(true);
  });

  test("garbage input is not stable and never throws", () => {
    expect(
      isStableCollectorEndpoint(
        undefined as unknown as {
          rawHost: string;
          endpoint: DatabaseEndpoint;
          attributes: Record<string, unknown>;
        },
      ),
    ).toBe(false);
    expect(
      isStableCollectorEndpoint({
        rawHost: "",
        endpoint: null as unknown as DatabaseEndpoint,
        attributes: {},
      }),
    ).toBe(false);
    expect(
      isStableCollectorEndpoint({
        rawHost: undefined as unknown as string,
        endpoint: { host: "db.prod.example.com", port: 5432 },
        attributes: undefined as unknown as Record<string, unknown>,
      }),
    ).toBe(true);
  });
});

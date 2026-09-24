import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  CALLER_CLUSTER_ATTRIBUTE,
  CALLER_NAMESPACE_ATTRIBUTE,
  DATABASE_ENDPOINT_SQL_MARKER,
  DATABASE_SERVER_MIN_CALLS_ENV,
  DEFAULT_DATABASE_SERVER_MIN_CALLS,
  DatabaseEndpointQueryWindow,
  DatabaseEndpointRow,
  DiscoveredDatabaseEndpoint,
  PRIVATE_IP_ADDRESS_PATTERN,
  buildDatabaseEndpointSql,
  firstNonEmptyAttributeSql,
  getDatabaseEndpointCallerContextNeeds,
  getDatabaseServerMinCalls,
  isDatabaseEndpointAutoCreateCandidate,
  resolveDatabaseEndpointRows,
} from "../../../../Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import { QUERY_SETTINGS } from "../../../../Server/Utils/Telemetry/ServiceDependencyDiscovery";
import {
  DatabaseCallerContext,
  DatabaseEndpoint,
  canonicalizeDatabaseEndpoint,
  formatDatabaseEndpoint,
} from "../../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseCallTarget,
} from "../../../../Types/DatabaseServer/DatabaseTelemetryResolver";

/*
 * Client-span database discovery turns the DB CLIENT spans of the window
 * into DatabaseServer rows. These tests pin the three things that decide
 * whether it is right:
 *
 *   1. the query — CLIENT spans only, the ingest resolver's attribute
 *      precedence, caller context kept only where it changes the endpoint,
 *      bounded, and recognisable by its marker;
 *   2. that the reduced caller context canonicalizes EXACTLY like the full
 *      one ingest used, so the endpoint a row is created under is the one
 *      whose key the spans carry;
 *   3. row resolution and the conservative create policy.
 */

const PROJECT_ID: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";

const WINDOW: DatabaseEndpointQueryWindow = {
  projectId: PROJECT_ID,
  startSql: "toDateTime64('2026-09-24 09:45:00.000000000', 9)",
  endSql: "toDateTime64('2026-09-24 10:00:00.000000000', 9)",
  maxRows: 321,
};

function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

function row(overrides: Partial<DatabaseEndpointRow>): DatabaseEndpointRow {
  return {
    dbSystem: "postgresql",
    serverAddress: "orders.example.com",
    serverPort: "",
    callerNamespace: "",
    callerCluster: "",
    callCount: "25",
    ...overrides,
  };
}

function formatted(entries: Array<DiscoveredDatabaseEndpoint>): Array<string> {
  return entries.map((entry: DiscoveredDatabaseEndpoint): string => {
    return formatDatabaseEndpoint(entry.endpoint);
  });
}

function discovered(
  overrides: Partial<DiscoveredDatabaseEndpoint>,
): DiscoveredDatabaseEndpoint {
  return {
    system: "postgresql",
    endpoint: { host: "orders.example.com", port: 5432 },
    scope: "global",
    callCount: 50,
    ...overrides,
  };
}

describe("buildDatabaseEndpointSql", () => {
  const sql: string = collapse(buildDatabaseEndpointSql(WINDOW));

  test("carries a unique marker comment so the query is recognisable", () => {
    expect(sql).toContain(`/* ${DATABASE_ENDPOINT_SQL_MARKER} */`);
    // The dependency queries it runs next to never carry it.
    expect(DATABASE_ENDPOINT_SQL_MARKER).toBe(
      "oneuptime:database-endpoint-discovery",
    );
  });

  test("reads CLIENT spans of one project inside the window", () => {
    expect(sql).toContain("FROM oneuptime.SpanItemV3");
    expect(sql).toContain(`WHERE projectId = '${PROJECT_ID}'`);
    expect(sql).toContain(`AND startTime >= ${WINDOW.startSql}`);
    expect(sql).toContain(`AND startTime < ${WINDOW.endSql}`);
    expect(sql).toContain("AND kind = 'SPAN_KIND_CLIENT'");
    expect(sql).not.toContain("SPAN_KIND_SERVER");
    expect(sql).not.toContain("SPAN_KIND_PRODUCER");
  });

  test("keeps only spans that name a database system and an address", () => {
    expect(sql).toContain("AND dbSystem != ''");
    expect(sql).toContain("AND serverAddress != ''");
  });

  test("selects the system with the ingest resolver's precedence, stable name first", () => {
    expect(DATABASE_SYSTEM_ATTRIBUTES).toEqual(["db.system.name", "db.system"]);
    expect(sql).toContain(
      "multiIf(attributes['db.system.name'] != '', attributes['db.system.name'], attributes['db.system'] != '', attributes['db.system'], '') AS dbSystem",
    );
  });

  test("selects the address and the port in DATABASE_*_ATTRIBUTES order", () => {
    expect(sql).toContain(
      `${firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES)} AS serverAddress`,
    );
    expect(sql).toContain(
      `${firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES)} AS serverPort`,
    );

    const addressOrder: Array<number> = DATABASE_ADDRESS_ATTRIBUTES.map(
      (key: string): number => {
        return sql.indexOf(`attributes['${key}'] != ''`);
      },
    );
    for (const index of addressOrder) {
      expect(index).toBeGreaterThan(0);
    }
    expect(
      [...addressOrder].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(addressOrder);

    const portOrder: Array<number> = DATABASE_PORT_ATTRIBUTES.map(
      (key: string): number => {
        return sql.indexOf(`attributes['${key}'] != ''`);
      },
    );
    expect(
      [...portOrder].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(portOrder);
  });

  test("keeps the caller's namespace only for dotless addresses", () => {
    expect(sql).toContain(
      `if( position(serverAddress, '.') = 0, attributes['${CALLER_NAMESPACE_ATTRIBUTE}'], '' ) AS callerNamespace`,
    );
  });

  test("keeps the caller's cluster only for dotless, Service DNS and private IP addresses", () => {
    expect(sql).toContain("position(serverAddress, '.') = 0 OR");
    expect(sql).toContain("position(lower(serverAddress), '.svc') > 0");
    expect(sql).toContain(
      "position(lower(serverAddress), '.cluster.local') > 0",
    );
    expect(sql).toContain("match(lower(serverAddress), '");
    expect(sql).toContain(
      `attributes['${CALLER_CLUSTER_ATTRIBUTE}'], '' ) AS callerCluster`,
    );
  });

  test("escapes the private-IP pattern for a ClickHouse string literal", () => {
    // The one backslash in the pattern (the IPv6 bracket) must arrive doubled.
    expect(PRIVATE_IP_ADDRESS_PATTERN).toContain("\\[");
    expect(sql).toContain("|\\\\[)");
  });

  test("groups on exactly the endpoint and the caller context that matters", () => {
    expect(sql).toContain(
      "GROUP BY dbSystem, serverAddress, serverPort, callerNamespace, callerCluster",
    );
    expect(sql).toContain("count() AS callCount");
  });

  test("never groups on anything that varies per caller instance", () => {
    for (const perCaller of [
      "k8s.pod.name",
      "host.name",
      "service.instance.id",
      "container.id",
      "primaryEntityId",
      "traceId",
      "spanId",
    ]) {
      expect(sql).not.toContain(perCaller);
    }
  });

  test("is bounded: busiest rows first, row cap, query settings", () => {
    expect(sql).toContain("ORDER BY callCount DESC LIMIT 321");
    expect(sql.trim().endsWith(QUERY_SETTINGS)).toBe(true);
  });

  test("a nonsensical row cap still yields a bounded query", () => {
    for (const maxRows of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const capped: string = collapse(
        buildDatabaseEndpointSql({ ...WINDOW, maxRows }),
      );
      expect(capped).toContain("LIMIT 1 ");
    }
    expect(
      collapse(buildDatabaseEndpointSql({ ...WINDOW, maxRows: 12.9 })),
    ).toContain("LIMIT 12 ");
  });

  test("escapes the project id", () => {
    const escaped: string = buildDatabaseEndpointSql({
      ...WINDOW,
      projectId: "x' OR '1'='1",
    });
    expect(escaped).toContain("projectId = 'x\\' OR \\'1\\'=\\'1'");
  });

  test("never mentions the dependency queries' routing markers", () => {
    // ComputeServiceDependencies tells its queries apart by these.
    expect(sql).not.toContain("SELECT DISTINCT projectId");
    expect(sql).not.toContain("NOT IN");
    expect(sql).not.toContain("INNER JOIN");
  });
});

describe("firstNonEmptyAttributeSql", () => {
  test("falls through empty attributes to ''", () => {
    expect(firstNonEmptyAttributeSql(["a", "b"])).toBe(
      "multiIf(attributes['a'] != '', attributes['a'], attributes['b'] != '', attributes['b'], '')",
    );
  });

  test("escapes attribute names", () => {
    expect(firstNonEmptyAttributeSql(["it's"])).toBe(
      "multiIf(attributes['it\\'s'] != '', attributes['it\\'s'], '')",
    );
  });
});

describe("PRIVATE_IP_ADDRESS_PATTERN (the regex the query runs)", () => {
  const pattern: RegExp = new RegExp(PRIVATE_IP_ADDRESS_PATTERN);

  const PRIVATE: Array<string> = [
    "10.0.0.5",
    "10.0.0.5:5432",
    "010.000.000.005",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.20",
    "100.64.0.1",
    "100.127.0.1",
    "fd00::1",
    "[fd12:3456::1]:5432",
    "fc00::1",
    "::ffff:10.0.0.5",
    "0:0:0:0:0:ffff:a00:5",
    "postgresql://user:pw@10.0.0.5:5432/db",
    "jdbc:postgresql://192.168.0.9/app",
    "mongodb://[fd00::5]:27017",
    "tcp:10.1.2.3,1433",
  ];

  for (const address of PRIVATE) {
    test(`matches private address ${address}`, () => {
      expect(pattern.test(address.toLowerCase())).toBe(true);
    });
  }

  const PUBLIC: Array<string> = [
    "8.8.8.8",
    "11.0.0.1",
    "110.0.0.1",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.1.1",
    "100.63.0.1",
    "100.128.0.1",
    "db.example.com",
    "orders.cjd8.eu-west-1.rds.amazonaws.com:5432",
    "2001:4860:4860::8888",
    "db-10.example.com",
  ];

  for (const address of PUBLIC) {
    test(`does not match public address ${address}`, () => {
      expect(pattern.test(address.toLowerCase())).toBe(false);
    });
  }
});

describe("the reduced caller context canonicalizes exactly like the full one", () => {
  /*
   * Ingest canonicalizes each span with the caller's FULL resource context;
   * the query keeps only the parts getDatabaseEndpointCallerContextNeeds
   * says can matter. If the two ever disagree the cron would create or match
   * a row under an endpoint no span is keyed by — so prove they agree.
   */
  const ADDRESSES: Array<string> = [
    "postgres",
    "postgres:5433",
    "POSTGRES",
    "orders-db",
    "orders.shop",
    "orders.shop.svc",
    "orders.shop.svc.cluster.local",
    "orders.shop.svc.cluster.local.",
    "pg-0.pg-headless.shop.svc.cluster.local:5432",
    "orders.shop.svc.corp.internal",
    "ORDERS.SHOP.SVC",
    "db.cluster.local",
    "10.0.0.5",
    "10.0.0.5:6543",
    "010.000.000.005",
    "172.20.1.1",
    "192.168.4.4",
    "100.100.1.1",
    "8.8.8.8",
    "34.120.1.9:5432",
    "fd00::1",
    "[fd00::1]:5432",
    "FD12:3456::7",
    "::ffff:10.0.0.5",
    "::ffff:8.8.8.8",
    "2001:db8::1",
    "orders.cjd8.eu-west-1.rds.amazonaws.com",
    "orders.cjd8.eu-west-1.rds.amazonaws.com:5432",
    "postgresql://app:secret@orders.shop.svc:5432/orders",
    "postgresql://app@postgres/orders",
    "jdbc:mysql://10.2.3.4:3306/app",
    "mongodb://mongo-0.mongo.shop.svc.cluster.local:27017,mongo-1:27017",
    "tcp:10.9.9.9,1433",
    "sqlserver\\INSTANCE",
    "localhost",
    "127.0.0.1:5432",
    "host.docker.internal",
    "[REDACTED]",
    "***.***.***.***",
  ];

  const CALLERS: Array<DatabaseCallerContext> = [
    {
      kubernetesNamespace: "shop",
      kubernetesClusterName: "prod-eu",
      isEphemeral: true,
    },
    {
      kubernetesNamespace: "billing",
      kubernetesClusterName: "arn:aws:eks:eu-west-1:1234:cluster/Prod",
      isEphemeral: true,
    },
    { kubernetesNamespace: "shop", isEphemeral: true },
    { kubernetesClusterName: "prod-eu", isEphemeral: true },
    { isEphemeral: false, hostName: "vm-1" },
  ];

  for (const system of ["postgresql", "mysql", "mongodb", "redis"]) {
    for (const address of ADDRESSES) {
      test(`${system} ${address}`, () => {
        for (const caller of CALLERS) {
          const needs: { namespace: boolean; cluster: boolean } =
            getDatabaseEndpointCallerContextNeeds(address);

          const full: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
            system,
            address,
            caller,
            purpose: "client-call",
          });

          const reduced: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint(
            {
              system,
              address,
              caller: {
                kubernetesNamespace: needs.namespace
                  ? caller.kubernetesNamespace
                  : null,
                kubernetesClusterName: needs.cluster
                  ? caller.kubernetesClusterName
                  : null,
                isEphemeral: true,
              },
              purpose: "client-call",
            },
          );

          expect(reduced ? formatDatabaseEndpoint(reduced) : null).toBe(
            full ? formatDatabaseEndpoint(full) : null,
          );

          // And the cron's row resolution lands on the ingest resolver's endpoint.
          const ingest: { endpoint: DatabaseEndpoint } | null =
            resolveDatabaseCallTarget({
              getAttribute: (key: string): unknown => {
                return (
                  {
                    "db.system.name": system,
                    "server.address": address,
                  } as Record<string, unknown>
                )[key];
              },
              caller,
            });
          const cron: Array<DiscoveredDatabaseEndpoint> =
            resolveDatabaseEndpointRows([
              {
                dbSystem: system,
                serverAddress: address,
                serverPort: "",
                callerNamespace: needs.namespace
                  ? caller.kubernetesNamespace || ""
                  : "",
                callerCluster: needs.cluster
                  ? caller.kubernetesClusterName || ""
                  : "",
                callCount: 1,
              },
            ]);

          expect(formatted(cron)).toEqual(
            ingest ? [formatDatabaseEndpoint(ingest.endpoint)] : [],
          );
        }
      });
    }
  }
});

describe("grouping is bounded by construction", () => {
  interface SimulatedSpan {
    attributes: Record<string, string>;
  }

  // What the query's SELECT would produce for one span (JS twin of the SQL).
  function groupKeyOf(span: SimulatedSpan): string {
    const first: (keys: ReadonlyArray<string>) => string = (
      keys: ReadonlyArray<string>,
    ): string => {
      for (const key of keys) {
        const value: string | undefined = span.attributes[key];
        if (value !== undefined && value !== "") {
          return value;
        }
      }
      return "";
    };
    const address: string = first(DATABASE_ADDRESS_ATTRIBUTES);
    const needs: { namespace: boolean; cluster: boolean } =
      getDatabaseEndpointCallerContextNeeds(address);
    return [
      first(DATABASE_SYSTEM_ATTRIBUTES),
      address,
      first(DATABASE_PORT_ATTRIBUTES),
      needs.namespace ? span.attributes[CALLER_NAMESPACE_ATTRIBUTE] || "" : "",
      needs.cluster ? span.attributes[CALLER_CLUSTER_ATTRIBUTE] || "" : "",
    ].join("|");
  }

  function callers(address: string, count: number): Array<SimulatedSpan> {
    const spans: Array<SimulatedSpan> = [];
    for (let index: number = 0; index < count; index++) {
      spans.push({
        attributes: {
          "db.system.name": "postgresql",
          "server.address": address,
          "server.port": "5432",
          [CALLER_NAMESPACE_ATTRIBUTE]: `ns-${index % 40}`,
          [CALLER_CLUSTER_ATTRIBUTE]: `cluster-${index % 7}`,
          "resource.k8s.pod.name": `api-${index}`,
          "resource.host.name": `node-${index}`,
        },
      });
    }
    return spans;
  }

  test("1000 callers of one public endpoint collapse to ONE group", () => {
    const keys: Set<string> = new Set<string>(
      callers("orders.cjd8.eu-west-1.rds.amazonaws.com", 1000).map(groupKeyOf),
    );
    expect(keys.size).toBe(1);
  });

  test("1000 callers of one Service FQDN are one group per cluster, never per namespace or pod", () => {
    const keys: Set<string> = new Set<string>(
      callers("orders.shop.svc.cluster.local", 1000).map(groupKeyOf),
    );
    expect(keys.size).toBe(7);
  });

  test("1000 callers of one private IP are one group per cluster", () => {
    const keys: Set<string> = new Set<string>(
      callers("10.0.0.5", 1000).map(groupKeyOf),
    );
    expect(keys.size).toBe(7);
  });

  test("a single-label Service name keeps namespace and cluster — they name different databases", () => {
    const keys: Set<string> = new Set<string>(
      callers("postgres", 1000).map(groupKeyOf),
    );
    // 40 namespaces x 7 clusters, bounded by the caller estate, not its pods.
    expect(keys.size).toBe(280);
  });
});

describe("getDatabaseEndpointCallerContextNeeds", () => {
  const CASES: Array<{
    address: string;
    namespace: boolean;
    cluster: boolean;
  }> = [
    { address: "postgres", namespace: true, cluster: true },
    { address: "postgres:5432", namespace: true, cluster: true },
    { address: "orders.shop.svc", namespace: false, cluster: true },
    {
      address: "orders.shop.svc.cluster.local",
      namespace: false,
      cluster: true,
    },
    {
      address: "ORDERS.SHOP.SVC.CLUSTER.LOCAL",
      namespace: false,
      cluster: true,
    },
    { address: "db.cluster.local", namespace: false, cluster: true },
    { address: "10.0.0.5", namespace: false, cluster: true },
    { address: "fd00::1", namespace: true, cluster: true },
    { address: "db.example.com", namespace: false, cluster: false },
    { address: "8.8.8.8", namespace: false, cluster: false },
    { address: "", namespace: true, cluster: true },
  ];

  for (const entry of CASES) {
    test(`"${entry.address}" → namespace ${entry.namespace}, cluster ${entry.cluster}`, () => {
      expect(getDatabaseEndpointCallerContextNeeds(entry.address)).toEqual({
        namespace: entry.namespace,
        cluster: entry.cluster,
      });
    });
  }

  test("tolerates a non-string address", () => {
    expect(
      getDatabaseEndpointCallerContextNeeds(undefined as unknown as string),
    ).toEqual({ namespace: true, cluster: true });
  });
});

describe("resolveDatabaseEndpointRows", () => {
  test("canonicalizes the system and applies the engine's default port", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ dbSystem: "postgres", serverAddress: "Orders.Example.COM." }),
      ]);

    expect(result).toEqual([
      {
        system: "postgresql",
        endpoint: { host: "orders.example.com", port: 5432 },
        scope: "global",
        callCount: 25,
      },
    ]);
  });

  test("an explicit port wins over the default, as a string or a number", () => {
    expect(
      formatted(
        resolveDatabaseEndpointRows([
          row({ serverAddress: "a.example.com", serverPort: "6432" }),
          row({ serverAddress: "b.example.com", serverPort: 7432 }),
        ]),
      ).sort(),
    ).toEqual(["a.example.com:6432", "b.example.com:7432"]);
  });

  test("a dotless Service name from a known namespace and cluster becomes a qualified FQDN", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          serverAddress: "orders-db",
          callerNamespace: "shop",
          callerCluster: "prod-eu",
        }),
      ]);

    expect(formatted(result)).toEqual([
      "orders-db.shop.svc.cluster.local:5432@prod-eu",
    ]);
    expect(result[0]!.scope).toBe("global");
  });

  test("the same Service name without a cluster is LOCAL scope", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ serverAddress: "orders-db", callerNamespace: "shop" }),
      ]);

    expect(formatted(result)).toEqual([
      "orders-db.shop.svc.cluster.local:5432",
    ]);
    expect(result[0]!.scope).toBe("local");
  });

  test("a bare single-label name with no namespace is LOCAL scope", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([row({ serverAddress: "postgres" })]);

    expect(formatted(result)).toEqual(["postgres:5432"]);
    expect(result[0]!.scope).toBe("local");
  });

  test("a private IP is qualified with the caller's cluster, else LOCAL", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ serverAddress: "10.0.0.5", callerCluster: "prod-eu" }),
        row({ serverAddress: "10.0.0.6" }),
      ]);

    const byEndpoint: Map<string, DiscoveredDatabaseEndpoint> = new Map(
      result.map((entry: DiscoveredDatabaseEndpoint) => {
        return [formatDatabaseEndpoint(entry.endpoint), entry];
      }),
    );
    expect(byEndpoint.get("10.0.0.5:5432@prod-eu")?.scope).toBe("global");
    expect(byEndpoint.get("10.0.0.6:5432")?.scope).toBe("local");
  });

  test("drops loopback, host-relative, scrubbed and unparseable addresses", () => {
    expect(
      resolveDatabaseEndpointRows([
        row({ serverAddress: "localhost" }),
        row({ serverAddress: "127.0.0.1:5432" }),
        row({ serverAddress: "::1" }),
        row({ serverAddress: "host.docker.internal" }),
        row({ serverAddress: "[REDACTED]" }),
        row({ serverAddress: "***.***.***.***" }),
        row({ serverAddress: "/var/run/postgresql" }),
        row({ serverAddress: "   " }),
        row({ serverAddress: "" }),
        row({ serverAddress: undefined }),
      ]),
    ).toEqual([]);
  });

  test("drops rows without a system", () => {
    expect(
      resolveDatabaseEndpointRows([
        row({ dbSystem: "" }),
        row({ dbSystem: "   " }),
        row({ dbSystem: undefined }),
      ]),
    ).toEqual([]);
  });

  test("keeps an unknown engine (it is still keyed) under its lowercased name", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "AcmeDB",
          serverAddress: "acme.example.com",
          serverPort: "9000",
        }),
      ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe("acmedb");
    expect(formatted(result)).toEqual(["acme.example.com:9000"]);
  });

  test("rows that land on one endpoint merge into one entry with their calls summed", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ serverAddress: "orders.example.com", callCount: "10" }),
        row({
          serverAddress: "ORDERS.example.com:5432",
          dbSystem: "postgres",
          callCount: 5,
        }),
        row({
          serverAddress: "postgresql://app:pw@orders.example.com/orders",
          callCount: "7",
        }),
      ]);

    expect(result).toHaveLength(1);
    expect(formatted(result)).toEqual(["orders.example.com:5432"]);
    expect(result[0]!.callCount).toBe(22);
    expect(result[0]!.system).toBe("postgresql");
  });

  test("one caller namespace per row never splits an FQDN endpoint", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          serverAddress: "orders.shop.svc",
          callerCluster: "prod-eu",
          callCount: 3,
        }),
        row({
          serverAddress: "orders.shop.svc.cluster.local",
          callerCluster: "prod-eu",
          callCount: 4,
        }),
      ]);

    expect(formatted(result)).toEqual([
      "orders.shop.svc.cluster.local:5432@prod-eu",
    ]);
    expect(result[0]!.callCount).toBe(7);
  });

  test("when engines disagree on one endpoint, an auto-creatable engine wins, then the busiest", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "other_sql",
          serverAddress: "crdb.example.com:26257",
          callCount: 500,
        }),
        row({
          dbSystem: "postgresql",
          serverAddress: "crdb.example.com:26257",
          callCount: 20,
        }),
        row({
          dbSystem: "cockroachdb",
          serverAddress: "crdb.example.com:26257",
          callCount: 30,
        }),
      ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe("cockroachdb");
    expect(result[0]!.callCount).toBe(550);
  });

  test("an engine tie is broken by name, so the answer is stable", () => {
    const first: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ dbSystem: "postgresql", serverAddress: "x.example.com:1" }),
        row({ dbSystem: "mysql", serverAddress: "x.example.com:1" }),
      ]);
    const second: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ dbSystem: "mysql", serverAddress: "x.example.com:1" }),
        row({ dbSystem: "postgresql", serverAddress: "x.example.com:1" }),
      ]);
    expect(first[0]!.system).toBe("mysql");
    expect(second[0]!.system).toBe("mysql");
  });

  test("returns the busiest endpoints first, then by endpoint", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ serverAddress: "b.example.com", callCount: "5" }),
        row({ serverAddress: "c.example.com", callCount: "90" }),
        row({ serverAddress: "a.example.com", callCount: "5" }),
      ]);
    expect(formatted(result)).toEqual([
      "c.example.com:5432",
      "a.example.com:5432",
      "b.example.com:5432",
    ]);
  });

  test("malformed call counts count as zero, never NaN", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ callCount: "not-a-number" }),
        row({ callCount: -4 }),
        row({ callCount: undefined }),
      ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.callCount).toBe(0);
  });

  test("tolerates junk input", () => {
    expect(
      resolveDatabaseEndpointRows(
        undefined as unknown as Array<DatabaseEndpointRow>,
      ),
    ).toEqual([]);
    expect(
      resolveDatabaseEndpointRows([
        null as unknown as DatabaseEndpointRow,
        "row" as unknown as DatabaseEndpointRow,
      ]),
    ).toEqual([]);
  });
});

describe("isDatabaseEndpointAutoCreateCandidate", () => {
  test("a busy global endpoint of a known engine, named by host, is a candidate", () => {
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({}),
        minCalls: 10,
      }),
    ).toBe(true);
  });

  test("the call threshold is inclusive", () => {
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({ callCount: 10 }),
        minCalls: 10,
      }),
    ).toBe(true);
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({ callCount: 9 }),
        minCalls: 10,
      }),
    ).toBe(false);
  });

  test("a LOCAL endpoint never creates", () => {
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({
          endpoint: { host: "postgres", port: 5432 },
          scope: "local",
          callCount: 100000,
        }),
        minCalls: 10,
      }),
    ).toBe(false);
  });

  test("an IP literal never creates, even when it is global", () => {
    for (const endpoint of [
      { host: "34.120.1.9", port: 5432 },
      { host: "10.0.0.5", port: 5432, kubernetesClusterName: "prod-eu" },
      { host: "2001:db8::1", port: 5432 },
    ]) {
      expect(
        isDatabaseEndpointAutoCreateCandidate({
          discovered: discovered({ endpoint, scope: "global" }),
          minCalls: 10,
        }),
      ).toBe(false);
    }
  });

  test("an unknown engine never creates", () => {
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({ system: "acmedb" }),
        minCalls: 10,
      }),
    ).toBe(false);
  });

  test("cloud-API and in-process engines never create", () => {
    for (const system of ["aws.dynamodb", "gcp.spanner", "sqlite"]) {
      expect(
        isDatabaseEndpointAutoCreateCandidate({
          discovered: discovered({
            system,
            endpoint: { host: "dynamodb.us-east-1.amazonaws.com", port: 443 },
          }),
          minCalls: 10,
        }),
      ).toBe(false);
    }
  });

  test("a cluster-qualified Service FQDN is a candidate", () => {
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({
          endpoint: {
            host: "orders.shop.svc.cluster.local",
            port: 5432,
            kubernetesClusterName: "prod-eu",
          },
        }),
        minCalls: 10,
      }),
    ).toBe(true);
  });
});

describe("getDatabaseServerMinCalls", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[DATABASE_SERVER_MIN_CALLS_ENV];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[DATABASE_SERVER_MIN_CALLS_ENV];
    } else {
      process.env[DATABASE_SERVER_MIN_CALLS_ENV] = saved;
    }
  });

  test("defaults to 10", () => {
    delete process.env[DATABASE_SERVER_MIN_CALLS_ENV];
    expect(DEFAULT_DATABASE_SERVER_MIN_CALLS).toBe(10);
    expect(getDatabaseServerMinCalls()).toBe(10);
  });

  test("reads the environment on every call", () => {
    process.env[DATABASE_SERVER_MIN_CALLS_ENV] = " 25 ";
    expect(getDatabaseServerMinCalls()).toBe(25);
    process.env[DATABASE_SERVER_MIN_CALLS_ENV] = "3";
    expect(getDatabaseServerMinCalls()).toBe(3);
  });

  test("is at least 1", () => {
    process.env[DATABASE_SERVER_MIN_CALLS_ENV] = "0";
    expect(getDatabaseServerMinCalls()).toBe(1);
    process.env[DATABASE_SERVER_MIN_CALLS_ENV] = "-7";
    expect(getDatabaseServerMinCalls()).toBe(1);
  });

  test("falls back to the default for anything unparseable", () => {
    for (const value of ["", "   ", "ten", "2.5", "Infinity"]) {
      process.env[DATABASE_SERVER_MIN_CALLS_ENV] = value;
      expect(getDatabaseServerMinCalls()).toBe(10);
    }
  });
});

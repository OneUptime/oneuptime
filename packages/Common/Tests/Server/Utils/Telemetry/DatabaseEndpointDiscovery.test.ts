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
  NON_BLANK_TEXT_PATTERN,
  ORDINAL_SUFFIX_PATTERN,
  PLAIN_HOST_ADDRESS_PATTERN,
  PRIVATE_IP_ADDRESS_PATTERN,
  buildDatabaseEndpointSql,
  databaseInstanceSql,
  databaseQuerySpanSql,
  firstNonEmptyAttributeSql,
  getDatabaseEndpointCallerContextNeeds,
  getDatabaseServerMinCalls,
  getDiscoveredDatabaseEndpoints,
  isDatabaseEndpointAutoCreateCandidate,
  resolveDatabaseEndpointRows,
} from "../../../../Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import { QUERY_SETTINGS } from "../../../../Server/Utils/Telemetry/ServiceDependencyDiscovery";
import {
  DATABASE_CONNECTION_SPAN_NAMES,
  isDatabaseConnectionSpanName,
} from "../../../../Types/DatabaseServer/DatabaseConnectionSpan";
import {
  DatabaseCallerContext,
  DatabaseEndpoint,
  NETWORK_SCOPED_NAME_SUFFIXES,
  canonicalizeDatabaseEndpoint,
  formatDatabaseEndpoint,
  readDatabaseInstanceName,
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

  const PLAIN: string = `match(lower(serverAddress), '${PLAIN_HOST_ADDRESS_PATTERN}')`;
  const LABELS: string =
    "splitByChar('.', splitByChar(':', lower(serverAddress))[1])";

  function column(alias: string): string {
    const end: number = sql.indexOf(` AS ${alias}`);
    const start: number = sql.lastIndexOf(" if(", end);
    expect(end).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(0);
    return sql.substring(start, end);
  }

  test("decides on the lowercased raw address: plain host[:port] or not", () => {
    expect(PLAIN_HOST_ADDRESS_PATTERN).toBe(
      "^[a-z0-9_-]+(?:[.][a-z0-9_-]+)*(?::[0-9]*)?$",
    );
    expect(sql).toContain(PLAIN);
  });

  test("keeps the caller's namespace for non-plain, single-label and StatefulSet-member addresses only", () => {
    const namespace: string = column("callerNamespace");
    expect(namespace).toContain(`NOT ${PLAIN}`);
    expect(namespace).toContain(`OR length(${LABELS}) = 1`);
    expect(namespace).toContain(
      `OR (length(${LABELS}) = 2 AND match(${LABELS}[1], '${ORDINAL_SUFFIX_PATTERN}'))`,
    );
    expect(namespace).toContain(
      `attributes['${CALLER_NAMESPACE_ATTRIBUTE}'], '' )`,
    );
    // The old "no dot anywhere in the raw value" test is gone.
    expect(sql).not.toContain("position(serverAddress, '.') = 0");
  });

  test("keeps only a 'caller has a namespace' flag for plain two-label addresses", () => {
    const flag: string = column("callerInKubernetes");
    expect(flag).toContain(`${PLAIN} AND length(${LABELS}) = 2`);
    expect(flag).toContain(
      `match(attributes['${CALLER_NAMESPACE_ATTRIBUTE}'], '${NON_BLANK_TEXT_PATTERN.replace(
        /\\/g,
        "\\\\",
      )}'), 0 )`,
    );
  });

  test("keeps the caller's cluster for non-plain, short, Service DNS, private-zone and private / link-local IP addresses", () => {
    const cluster: string = column("callerCluster");
    expect(cluster).toContain(`NOT ${PLAIN}`);
    expect(cluster).toContain(`OR length(${LABELS}) <= 2`);
    expect(cluster).toContain(`OR has(${LABELS}, 'svc')`);
    for (const suffix of NETWORK_SCOPED_NAME_SUFFIXES) {
      expect(cluster).toContain(
        `endsWith(splitByChar(':', lower(serverAddress))[1], '${suffix}')`,
      );
    }
    expect(cluster).toContain("match(lower(serverAddress), '");
    expect(cluster).toContain(
      `attributes['${CALLER_CLUSTER_ATTRIBUTE}'], '' )`,
    );
  });

  test("escapes the private-IP pattern for a ClickHouse string literal", () => {
    // The one backslash in the pattern (the IPv6 bracket) must arrive doubled.
    expect(PRIVATE_IP_ADDRESS_PATTERN).toContain("\\[");
    expect(sql).toContain("|\\\\[)");
  });

  test("selects the SQL Server instance with readDatabaseInstanceName's precedence", () => {
    expect(databaseInstanceSql()).toBe(
      "multiIf(attributes['db.mssql.instance_name'] != '', attributes['db.mssql.instance_name'], position(attributes['db.namespace'], '|') > 0, splitByChar('|', attributes['db.namespace'])[1], '')",
    );
    expect(sql).toContain(`${databaseInstanceSql()} AS dbInstance`);
  });

  test("groups on exactly the endpoint and the caller context that matters", () => {
    expect(sql).toContain(
      "GROUP BY dbSystem, serverAddress, serverPort, dbInstance, callerNamespace, callerInKubernetes, callerCluster",
    );
    // Queries only - see "connection spans are not calls".
    expect(sql).toContain(`countIf(${databaseQuerySpanSql()}) AS callCount`);
  });

  test("drops spans without a system or an address on attributeKeys before reading the map", () => {
    expect(sql).toContain(
      "AND hasAny(attributeKeys, ['db.system.name', 'db.system'])",
    );
    expect(sql).toContain(
      `AND hasAny(attributeKeys, [${DATABASE_ADDRESS_ATTRIBUTES.map(
        (key: string): string => {
          return `'${key}'`;
        },
      ).join(", ")}])`,
    );
    // Before the map-derived filters.
    expect(sql.indexOf("hasAny(attributeKeys")).toBeLessThan(
      sql.indexOf("AND dbSystem != ''"),
    );
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

  test("is bounded: host-named rows first, then the busiest, row cap, query settings", () => {
    expect(sql).toContain(
      "ORDER BY (isIPv4String(splitByChar(':', lower(serverAddress))[1]) OR isIPv6String(lower(serverAddress)) OR isIPv6String(extract(lower(serverAddress), '^\\\\[([^\\\\]]*)\\\\]'))) ASC, callCount DESC LIMIT 321",
    );
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

/*
 * The e2e run found rare-db.example.com created from 4 real queries: in its
 * 15-minute window ClickHouse held 4 `pg.query:SELECT orders`, 4
 * `pg-pool.connect` and 4 `pg.connect` CLIENT spans, every one carrying
 * db.system.name + server.address, and `count()` read that as 12 calls. The
 * ioredis `connect` span even carries `db.query.text = 'connect'`, so only
 * the span name tells connection management from a query.
 */
describe("connection spans are not calls", () => {
  const sql: string = collapse(buildDatabaseEndpointSql(WINDOW));

  test("the call count counts queries only, never connection spans", () => {
    expect(sql).toContain(`countIf(${databaseQuerySpanSql()}) AS callCount`);
    expect(sql).not.toContain("count() AS callCount");
  });

  test("connection spans still reach the query, so a row owning the endpoint is sighted", () => {
    // No WHERE predicate on the name: only the count ignores them.
    const where: string = sql.substring(sql.indexOf(" WHERE "));
    expect(where).not.toContain("pg.connect");
  });

  test("the predicate compares the trimmed, lowercased name with every listed name", () => {
    const predicate: string = databaseQuerySpanSql();
    expect(predicate.startsWith("NOT has([")).toBe(true);
    expect(predicate.endsWith("], lower(trimBoth(ifNull(name, ''))))")).toBe(
      true,
    );
    for (const name of DATABASE_CONNECTION_SPAN_NAMES) {
      expect(predicate).toContain(`'${name.toLowerCase()}'`);
    }
    expect(databaseQuerySpanSql("s.name")).toContain("ifNull(s.name, '')");
  });

  test.each<[string, boolean]>([
    // node-postgres, as the e2e app emitted them.
    ["pg.connect", true],
    ["pg-pool.connect", true],
    ["pg.query:SELECT orders", false],
    // ioredis: `connect` is management; the handshake commands are commands.
    ["connect", true],
    ["info", false],
    ["client", false],
    ["auth", false],
    ["ping", false],
    // psycopg2 (Python), as the e2e billing-api emitted it.
    ["SELECT", false],
    // node-redis v4 / v5.
    ["redis-connect", true],
    ["redis-GET", false],
    // node-oracledb: connect-time round trips are management; execute is a query.
    ["oracledb.getConnection", true],
    ["oracledb.Pool.getConnection", true],
    ["oracledb.AuthMessage", true],
    ["oracledb.Connection.execute:SELECT orders", false],
    // Case and padding do not matter; a query on a table called connect is a query.
    ["  PG-POOL.CONNECT ", true],
    ["SELECT connect", false],
    ["", false],
  ])("%s → connection span: %s", (name: string, expected: boolean) => {
    expect(isDatabaseConnectionSpanName(name)).toBe(expected);
  });

  test("a span without a name is a query", () => {
    expect(isDatabaseConnectionSpanName(undefined)).toBe(false);
    expect(isDatabaseConnectionSpanName(null)).toBe(false);
  });

  test("the list is one spelling per name", () => {
    const lowered: Array<string> = DATABASE_CONNECTION_SPAN_NAMES.map(
      (name: string): string => {
        return name.toLowerCase();
      },
    );
    expect(new Set<string>(lowered).size).toBe(lowered.length);
  });

  test("the real rare-db window: 4 queries and their connects do not reach 10 calls", () => {
    const window: Array<string> = [];
    for (let run: number = 0; run < 4; run++) {
      window.push("pg-pool.connect", "pg.connect", "pg.query:SELECT orders");
    }
    const queries: number = window.filter((name: string): boolean => {
      return !isDatabaseConnectionSpanName(name);
    }).length;

    expect(window).toHaveLength(12);
    expect(queries).toBe(4);
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: discovered({
          endpoint: { host: "rare-db.example.com", port: 5432 },
          callCount: queries,
        }),
        minCalls: DEFAULT_DATABASE_SERVER_MIN_CALLS,
      }),
    ).toBe(false);
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
    "169.254.1.10",
    "169.254.169.254:5432",
    "fd00::1",
    "[fd12:3456::1]:5432",
    "fc00::1",
    "fe80::1",
    "[fe80::1%eth0]:5432",
    "febf::1",
    "::ffff:10.0.0.5",
    "0:0:0:0:0:ffff:a00:5",
    "postgresql://user:pw@10.0.0.5:5432/db",
    "jdbc:postgresql://192.168.0.9/app",
    "mongodb://[fd00::5]:27017",
    "tcp:10.1.2.3,1433",
  ];

  for (const address of PRIVATE) {
    test(`matches private or link-local address ${address}`, () => {
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
    "169.253.1.1",
    "db.example.com",
    "orders.cjd8.eu-west-1.rds.amazonaws.com:5432",
    "2001:4860:4860::8888",
    "fec0::1",
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
   * Ingest resolves each span with the caller's FULL resource context; the
   * query keeps only the parts getDatabaseEndpointCallerContextNeeds says
   * can matter. If the two ever disagree the cron would create or match a
   * row under an endpoint no span is keyed by — so prove they agree.
   */
  const ADDRESSES: Array<string> = [
    "postgres",
    "postgres:5433",
    "POSTGRES",
    "orders-db",
    "orders.shop",
    "Orders.Shop:6543",
    "postgres.data",
    "mongo-0.mongo-headless",
    "redis-node-2.redis-headless:6379",
    "postgres-2.data",
    "db.internal",
    "db.local",
    "orders.shop.svc",
    "orders.shop.svc.cluster.local",
    "orders.shop.svc.cluster.local.",
    "pg-0.pg-headless.shop.svc.cluster.local:5432",
    "orders.shop.svc.corp.internal",
    "ORDERS.SHOP.SVC",
    "db.cluster.local",
    "ip-10-0-0-5.ec2.internal",
    "db-1.c.my-project.internal",
    "nas.home.arpa",
    "build-7.localdomain",
    "host.minikube.internal",
    "10.0.0.5",
    "10.0.0.5:6543",
    "010.000.000.005",
    "172.20.1.1",
    "192.168.4.4",
    "100.100.1.1",
    "169.254.1.10",
    "8.8.8.8",
    "34.120.1.9:5432",
    "fd00::1",
    "[fd00::1]:5432",
    "FD12:3456::7",
    "fe80::1%eth0",
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
    "tcp:postgres",
    "sqlserver\\INSTANCE",
    "sql1.corp.example.com\\INST01",
    // The dotless-predicate finding's four probes.
    "postgres.",
    "postgresql://svc.user@postgres:5432/db",
    "mongo-a:27017,mongo-b.example.com:27017",
    "jdbc:sqlserver://mssql:1433;databaseName=app.db",
    // More values whose raw text has a dot the parsed host does not.
    "postgres.:5432",
    "postgres@db.example.com",
    "postgres?sslmode=require.x",
    " postgres ",
    "postgres.data.",
    "mongo-b.example.com:27017,mongo-a:27017",
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
    { kubernetesNamespace: "data", isEphemeral: true },
    { kubernetesClusterName: "prod-eu", isEphemeral: true },
    { kubernetesNamespace: "Not A Namespace", isEphemeral: true },
    {
      kubernetesNamespace: "   ",
      kubernetesClusterName: " ",
      isEphemeral: true,
    },
    { kubernetesNamespace: " ", isEphemeral: true },
    { isEphemeral: false, hostName: "vm-1" },
  ];

  function nonBlank(value: string | null | undefined): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }

  for (const system of ["postgresql", "mysql", "mongodb", "redis", "mssql"]) {
    for (const address of ADDRESSES) {
      test(`${system} ${address}`, () => {
        for (const caller of CALLERS) {
          const needs: {
            namespace: boolean;
            kubernetes: boolean;
            cluster: boolean;
          } = getDatabaseEndpointCallerContextNeeds(address);

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
                runsInKubernetes:
                  needs.kubernetes && nonBlank(caller.kubernetesNamespace),
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
                dbInstance: "",
                callerNamespace: needs.namespace
                  ? caller.kubernetesNamespace || ""
                  : "",
                callerInKubernetes:
                  needs.kubernetes && nonBlank(caller.kubernetesNamespace)
                    ? 1
                    : 0,
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

  test("the four probes of the dotless-predicate finding keep the context the host needs", () => {
    const caller: DatabaseCallerContext = {
      kubernetesNamespace: "prod",
      kubernetesClusterName: "c1",
      isEphemeral: true,
    };
    for (const [address, expected] of [
      ["postgres.", "postgres.prod.svc.cluster.local:5432@c1"],
      [
        "postgresql://svc.user@postgres:5432/db",
        "postgres.prod.svc.cluster.local:5432@c1",
      ],
      [
        "mongo-a:27017,mongo-b.example.com:27017",
        "mongo-a.prod.svc.cluster.local:27017@c1",
      ],
      [
        "jdbc:sqlserver://mssql:1433;databaseName=app.db",
        "mssql.prod.svc.cluster.local:1433@c1",
      ],
    ] as Array<[string, string]>) {
      const needs: {
        namespace: boolean;
        kubernetes: boolean;
        cluster: boolean;
      } = getDatabaseEndpointCallerContextNeeds(address);
      expect(needs.namespace).toBe(true);
      expect(needs.cluster).toBe(true);
      const system: string = address.includes("mongo")
        ? "mongodb"
        : address.includes("sqlserver")
          ? "mssql"
          : "postgresql";
      expect(
        formatted(
          resolveDatabaseEndpointRows([
            {
              dbSystem: system,
              serverAddress: address,
              callerNamespace: caller.kubernetesNamespace || "",
              callerCluster: caller.kubernetesClusterName || "",
              callCount: 1,
            },
          ]),
        ),
      ).toEqual([expected]);
    }
  });
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
    const needs: { namespace: boolean; kubernetes: boolean; cluster: boolean } =
      getDatabaseEndpointCallerContextNeeds(address);
    const namespace: string = span.attributes[CALLER_NAMESPACE_ATTRIBUTE] || "";
    return [
      first(DATABASE_SYSTEM_ATTRIBUTES),
      address,
      first(DATABASE_PORT_ATTRIBUTES),
      needs.namespace ? namespace : "",
      needs.kubernetes && namespace.trim() ? "1" : "0",
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

  test("1000 callers of one <service>.<namespace> short name are one group per cluster too", () => {
    const keys: Set<string> = new Set<string>(
      callers("postgres.data", 1000).map(groupKeyOf),
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
    kubernetes: boolean;
    cluster: boolean;
  }> = [
    { address: "postgres", namespace: true, kubernetes: false, cluster: true },
    {
      address: "postgres:5432",
      namespace: true,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "postgres.data",
      namespace: false,
      kubernetes: true,
      cluster: true,
    },
    {
      address: "Postgres.Data:6543",
      namespace: false,
      kubernetes: true,
      cluster: true,
    },
    {
      address: "mongo-0.mongo-headless",
      namespace: true,
      kubernetes: true,
      cluster: true,
    },
    {
      address: "orders.shop.svc",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "orders.shop.svc.cluster.local",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "ORDERS.SHOP.SVC.CLUSTER.LOCAL",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "db.cluster.local",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "ip-10-0-0-5.ec2.internal",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "nas.home.arpa",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    { address: "10.0.0.5", namespace: false, kubernetes: false, cluster: true },
    {
      address: "169.254.1.1",
      namespace: false,
      kubernetes: false,
      cluster: true,
    },
    { address: "fd00::1", namespace: true, kubernetes: false, cluster: true },
    {
      address: "db.example.com",
      namespace: false,
      kubernetes: false,
      cluster: false,
    },
    {
      address: "db.internalapi.com",
      namespace: false,
      kubernetes: false,
      cluster: false,
    },
    { address: "8.8.8.8", namespace: false, kubernetes: false, cluster: false },
    // Not a plain host[:port]: everything is kept.
    { address: "postgres.", namespace: true, kubernetes: false, cluster: true },
    {
      address: "postgresql://svc.user@postgres:5432/db",
      namespace: true,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "a.example.com:5432,b.example.com:5432",
      namespace: true,
      kubernetes: false,
      cluster: true,
    },
    {
      address: "sql1.corp\\INST01",
      namespace: true,
      kubernetes: false,
      cluster: true,
    },
    {
      address: " db.example.com",
      namespace: true,
      kubernetes: false,
      cluster: true,
    },
    { address: "", namespace: true, kubernetes: false, cluster: true },
  ];

  for (const entry of CASES) {
    test(`"${entry.address}" → namespace ${entry.namespace}, kubernetes ${entry.kubernetes}, cluster ${entry.cluster}`, () => {
      expect(getDatabaseEndpointCallerContextNeeds(entry.address)).toEqual({
        namespace: entry.namespace,
        kubernetes: entry.kubernetes,
        cluster: entry.cluster,
      });
    });
  }

  test("lowercases ASCII only, as ClickHouse lower() does", () => {
    // U+212A KELVIN SIGN lowercases to "k" in JavaScript but not in SQL.
    expect(getDatabaseEndpointCallerContextNeeds("Kafka.data")).toEqual({
      namespace: true,
      kubernetes: false,
      cluster: true,
    });
  });

  test("tolerates a non-string address", () => {
    expect(
      getDatabaseEndpointCallerContextNeeds(undefined as unknown as string),
    ).toEqual({ namespace: true, kubernetes: false, cluster: true });
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

  /*
   * Regression: a pure majority recorded a MariaDB server as MySQL whenever
   * the MySQL drivers outnumbered the MariaDB connector — the one client
   * that can tell. Engines of one family are one database seen by
   * different clients: the fork wins, whatever the counts.
   */
  test("engines of one family: the fork a client named wins over a busier family value", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "mysql",
          serverAddress: "orders.example.com",
          callCount: 900,
        }),
        row({
          dbSystem: "mariadb",
          serverAddress: "orders.example.com",
          callCount: 3,
        }),
      ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.system).toBe("mariadb");
    expect(result[0]!.callCount).toBe(903);
    expect(formatted(result)).toEqual(["orders.example.com:3306"]);
  });

  test("the fork wins in any row order, and when it is the busier one", () => {
    const rows: Array<DatabaseEndpointRow> = [
      row({ dbSystem: "valkey", serverAddress: "cache.example.com" }),
      row({ dbSystem: "redis", serverAddress: "cache.example.com" }),
    ];
    expect(resolveDatabaseEndpointRows(rows)[0]!.system).toBe("valkey");
    expect(resolveDatabaseEndpointRows([...rows].reverse())[0]!.system).toBe(
      "valkey",
    );
    expect(
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "valkey",
          serverAddress: "cache.example.com",
          callCount: 90,
        }),
        row({
          dbSystem: "redis",
          serverAddress: "cache.example.com",
          callCount: 10,
        }),
      ])[0]!.system,
    ).toBe("valkey");
  });

  test("aliases of the family engine fold into the family with the fork", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "postgres",
          serverAddress: "crdb.example.com:26257",
          callCount: 40,
        }),
        row({
          dbSystem: "postgresql",
          serverAddress: "crdb.example.com:26257",
          callCount: 40,
        }),
        row({
          dbSystem: "cockroachdb",
          serverAddress: "crdb.example.com:26257",
          callCount: 1,
        }),
      ]);
    expect(result[0]!.system).toBe("cockroachdb");
    expect(result[0]!.callCount).toBe(81);
  });

  test("two forks of one family: the busier fork, then the name — never order-dependent", () => {
    const rows: Array<DatabaseEndpointRow> = [
      row({
        dbSystem: "mysql",
        serverAddress: "x.example.com",
        callCount: 500,
      }),
      row({ dbSystem: "tidb", serverAddress: "x.example.com", callCount: 7 }),
      row({
        dbSystem: "mariadb",
        serverAddress: "x.example.com",
        callCount: 9,
      }),
    ];
    expect(resolveDatabaseEndpointRows(rows)[0]!.system).toBe("mariadb");
    expect(resolveDatabaseEndpointRows([...rows].reverse())[0]!.system).toBe(
      "mariadb",
    );

    const tied: Array<DatabaseEndpointRow> = [
      row({ dbSystem: "tidb", serverAddress: "x.example.com", callCount: 9 }),
      row({
        dbSystem: "mariadb",
        serverAddress: "x.example.com",
        callCount: 9,
      }),
    ];
    expect(resolveDatabaseEndpointRows(tied)[0]!.system).toBe("mariadb");
    expect(resolveDatabaseEndpointRows([...tied].reverse())[0]!.system).toBe(
      "mariadb",
    );
  });

  test("between families, a family's calls count together", () => {
    // postgresql + cockroachdb (50) outvote mysql (45), though each alone would not.
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "mysql",
          serverAddress: "x.example.com:1",
          callCount: 45,
        }),
        row({
          dbSystem: "postgresql",
          serverAddress: "x.example.com:1",
          callCount: 25,
        }),
        row({
          dbSystem: "cockroachdb",
          serverAddress: "x.example.com:1",
          callCount: 25,
        }),
      ]);
    expect(result[0]!.system).toBe("cockroachdb");
    expect(result[0]!.callCount).toBe(95);
  });

  test("an unknown engine never joins a known family", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "mysql_fork_x",
          serverAddress: "x.example.com:3306",
          callCount: 1000,
        }),
        row({
          dbSystem: "mysql",
          serverAddress: "x.example.com:3306",
          callCount: 1,
        }),
      ]);
    // The known, auto-creatable engine still wins over the unknown one.
    expect(result[0]!.system).toBe("mysql");
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

/*
 * ---- Audit regressions (lane B1) ------------------------------------------
 */

describe("resolveDatabaseEndpointRows — two-label Kubernetes names", () => {
  test("the finding's probe: postgres.data from two clusters is two cluster-qualified endpoints, not one global row", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          serverAddress: "postgres.data",
          callerInKubernetes: 1,
          callerCluster: "staging",
          callCount: "40",
        }),
        row({
          serverAddress: "postgres.data",
          callerInKubernetes: 1,
          callerCluster: "prod",
          callCount: "40",
        }),
      ]);

    expect(formatted(result).sort()).toEqual([
      "postgres.data.svc.cluster.local:5432@prod",
      "postgres.data.svc.cluster.local:5432@staging",
    ]);
    for (const entry of result) {
      expect(entry.callCount).toBe(40);
      expect(entry.scope).toBe("global");
    }
  });

  test("callers with a namespace but no cluster give a LOCAL endpoint that can never create a row", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          serverAddress: "postgres.data",
          callerInKubernetes: "1",
          callCount: "500",
        }),
      ]);
    expect(formatted(result)).toEqual(["postgres.data.svc.cluster.local:5432"]);
    expect(result[0]!.scope).toBe("local");
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: result[0]!,
        minCalls: 10,
      }),
    ).toBe(false);
  });

  test("callers outside Kubernetes keep the domain reading", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ serverAddress: "postgres.data", callerInKubernetes: 0 }),
      ]);
    expect(formatted(result)).toEqual(["postgres.data:5432"]);
    expect(result[0]!.scope).toBe("global");
  });

  test("the flag is read leniently (ClickHouse may send it as a number, string or boolean)", () => {
    for (const flag of [1, "1", true, "true"]) {
      expect(
        formatted(
          resolveDatabaseEndpointRows([
            row({
              serverAddress: "postgres.data",
              callerInKubernetes: flag,
              callerCluster: "prod",
            }),
          ]),
        ),
      ).toEqual(["postgres.data.svc.cluster.local:5432@prod"]);
    }
    for (const flag of [0, "0", false, "", undefined]) {
      expect(
        formatted(
          resolveDatabaseEndpointRows([
            row({ serverAddress: "postgres.data", callerInKubernetes: flag }),
          ]),
        ),
      ).toEqual(["postgres.data:5432"]);
    }
  });

  test("a StatefulSet member short name uses the namespace the query kept", () => {
    expect(
      formatted(
        resolveDatabaseEndpointRows([
          row({
            dbSystem: "mongodb",
            serverAddress: "mongo-0.mongo-headless",
            callerNamespace: "data",
            callerInKubernetes: 1,
            callerCluster: "prod",
          }),
        ]),
      ),
    ).toEqual(["mongo-0.mongo-headless.data.svc.cluster.local:27017@prod"]);
  });
});

describe("resolveDatabaseEndpointRows — SQL Server named instances", () => {
  test("the finding's probe: two instances on one host are two endpoints (from the address)", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "mssql",
          serverAddress: "sql1.corp.example.com\\INST01",
        }),
        row({
          dbSystem: "mssql",
          serverAddress: "sql1.corp.example.com\\INST02",
        }),
      ]);
    expect(formatted(result).sort()).toEqual([
      "sql1.corp.example.com\\inst01",
      "sql1.corp.example.com\\inst02",
    ]);
  });

  /*
   * The query's dbInstance column (databaseInstanceSql) holds what
   * readDatabaseInstanceName reads from the span, and the row reaches the
   * ingest resolver as `db.mssql.instance_name`. Whatever the resolver does
   * with an instance attribute, the cron therefore does the same with the
   * grouped row: the pairs below must always resolve alike.
   */
  const INSTANCE_SPANS: Array<{
    span: Record<string, unknown>;
    dbInstance: string;
  }> = [
    { span: { "db.mssql.instance_name": "INST01" }, dbInstance: "INST01" },
    { span: { "db.namespace": "INST02|orders" }, dbInstance: "INST02" },
    {
      span: {
        "db.mssql.instance_name": "INST03",
        "db.namespace": "INST04|orders",
      },
      dbInstance: "INST03",
    },
    {
      span: { "db.mssql.instance_name": "", "db.namespace": "INST05|x" },
      dbInstance: "INST05",
    },
    { span: { "db.namespace": "orders" }, dbInstance: "" },
    {
      span: { "db.mssql.instance_name": "MSSQLSERVER" },
      dbInstance: "MSSQLSERVER",
    },
    {
      span: { "server.port": "1434", "db.mssql.instance_name": "INST01" },
      dbInstance: "INST01",
    },
  ];

  for (const entry of INSTANCE_SPANS) {
    test(`an instance column resolves like the span ${JSON.stringify(entry.span)}`, () => {
      for (const system of ["microsoft.sql_server", "mssql", "postgresql"]) {
        const attributes: Record<string, unknown> = {
          "db.system.name": system,
          "server.address": "sql1.corp.example.com",
          ...entry.span,
        };
        const ingest: { endpoint: DatabaseEndpoint } | null =
          resolveDatabaseCallTarget({
            getAttribute: (key: string): unknown => {
              return attributes[key];
            },
            caller: { isEphemeral: false, hostName: "vm" },
          });

        expect(
          formatted(
            resolveDatabaseEndpointRows([
              row({
                dbSystem: system,
                serverAddress: "sql1.corp.example.com",
                serverPort: (entry.span["server.port"] as string) || "",
                dbInstance: entry.dbInstance,
              }),
            ]),
          ),
        ).toEqual(ingest ? [formatDatabaseEndpoint(ingest.endpoint)] : []);
      }
    });
  }

  test("the instance column's SQL and readDatabaseInstanceName pick the same value", () => {
    for (const entry of INSTANCE_SPANS) {
      const expected: string | null = readDatabaseInstanceName({
        system: "mssql",
        getAttribute: (key: string): unknown => {
          return entry.span[key];
        },
      });
      expect(expected ?? "").toBe(entry.dbInstance);
    }
  });

  test("an instance column is ignored for every other engine", () => {
    expect(
      formatted(
        resolveDatabaseEndpointRows([
          row({ serverAddress: "db.example.com", dbInstance: "INST01" }),
        ]),
      ),
    ).toEqual(["db.example.com:5432"]);
  });
});

describe("resolveDatabaseEndpointRows — managed cluster members are one database", () => {
  const MEMBERS: Array<string> = [
    "c0-shard-00-00.abcd.mongodb.net",
    "c0-shard-00-01.abcd.mongodb.net",
    "c0-shard-00-02.abcd.mongodb.net",
  ];

  test("the finding's probe: three Atlas members are ONE entry, not three create candidates", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows(
        MEMBERS.map((serverAddress: string, index: number) => {
          return row({
            dbSystem: "mongodb",
            serverAddress: serverAddress,
            callCount: String(10 + index),
          });
        }),
      );

    expect(result).toHaveLength(1);
    // Recorded under the busiest member, the others its siblings.
    expect(formatDatabaseEndpoint(result[0]!.endpoint)).toBe(
      "c0-shard-00-02.abcd.mongodb.net:27017",
    );
    expect(
      (result[0]!.siblings || []).map((endpoint: DatabaseEndpoint) => {
        return formatDatabaseEndpoint(endpoint);
      }),
    ).toEqual([
      "c0-shard-00-00.abcd.mongodb.net:27017",
      "c0-shard-00-01.abcd.mongodb.net:27017",
    ]);
    expect(result[0]!.callCount).toBe(33);
    expect(result[0]!.displayName).toBe("MongoDB c0.abcd.mongodb.net:27017");
    expect(result[0]!.system).toBe("mongodb");
    expect(getDiscoveredDatabaseEndpoints(result[0]!)).toHaveLength(3);
  });

  test("a quiet cluster still counts its members' calls together towards the minimum", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows(
        MEMBERS.map((serverAddress: string) => {
          return row({
            dbSystem: "mongodb",
            serverAddress: serverAddress,
            callCount: "4",
          });
        }),
      );
    expect(result[0]!.callCount).toBe(12);
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: result[0]!,
        minCalls: 10,
      }),
    ).toBe(true);
  });

  test("a client using the cluster's own name joins its members, and that name is preferred", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "mongodb",
          serverAddress: "c0-shard-00-01.abcd.mongodb.net",
          callCount: "90",
        }),
        row({
          dbSystem: "mongodb",
          serverAddress: "c0.abcd.mongodb.net",
          callCount: "5",
        }),
      ]);
    expect(result).toHaveLength(1);
    expect(formatDatabaseEndpoint(result[0]!.endpoint)).toBe(
      "c0.abcd.mongodb.net:27017",
    );
    expect(result[0]!.callCount).toBe(95);
  });

  test("a single member seen alone is still named after its cluster, with no siblings", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ dbSystem: "mongodb", serverAddress: MEMBERS[1]! }),
      ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.siblings).toBeUndefined();
    expect(result[0]!.displayName).toBe("MongoDB c0.abcd.mongodb.net:27017");
  });

  test("different clusters, and a cluster on another port, stay apart", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({ dbSystem: "mongodb", serverAddress: MEMBERS[0]! }),
        row({
          dbSystem: "mongodb",
          serverAddress: "c1-shard-00-00.abcd.mongodb.net",
        }),
        row({
          dbSystem: "mongodb",
          serverAddress: "c0-shard-00-01.abcd.mongodb.net:27018",
        }),
      ]);
    expect(result).toHaveLength(3);
  });

  test("ordinary endpoints carry no siblings and no display name", () => {
    const result: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([row({})]);
    expect(result[0]).toEqual({
      system: "postgresql",
      endpoint: { host: "orders.example.com", port: 5432 },
      scope: "global",
      callCount: 25,
    });
  });
});

describe("isDatabaseEndpointAutoCreateCandidate — per-network names", () => {
  test("never creates for a link-local address, qualified or not", () => {
    for (const endpoint of [
      { host: "169.254.1.10", port: 5432, kubernetesClusterName: "prod" },
      { host: "fe80::1", port: 5432 },
    ]) {
      const [resolved]: Array<DiscoveredDatabaseEndpoint> =
        resolveDatabaseEndpointRows([
          row({
            serverAddress:
              endpoint.host === "fe80::1" ? "fe80::1%eth0" : endpoint.host,
            callerCluster: endpoint.kubernetesClusterName || "",
          }),
        ]);
      expect(resolved!.scope).toBe("local");
      expect(
        isDatabaseEndpointAutoCreateCandidate({
          discovered: resolved!,
          minCalls: 1,
        }),
      ).toBe(false);
    }
  });

  test("never creates for a private-zone name without a cluster, but does with one", () => {
    const [vm]: Array<DiscoveredDatabaseEndpoint> = resolveDatabaseEndpointRows(
      [row({ serverAddress: "ip-10-0-0-5.ec2.internal", callCount: "900" })],
    );
    expect(vm!.scope).toBe("local");
    expect(
      isDatabaseEndpointAutoCreateCandidate({ discovered: vm!, minCalls: 10 }),
    ).toBe(false);

    const [podCaller]: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          serverAddress: "ip-10-0-0-5.ec2.internal",
          callerCluster: "prod",
          callCount: "900",
        }),
      ]);
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: podCaller!,
        minCalls: 10,
      }),
    ).toBe(true);
  });

  test("dev-tool gateway names never resolve at all", () => {
    expect(
      resolveDatabaseEndpointRows([
        row({ serverAddress: "host.minikube.internal", callCount: "900" }),
        row({ serverAddress: "host.k3d.internal:5432", callCount: "900" }),
      ]),
    ).toEqual([]);
  });

  test("a named SQL Server instance on an IP never creates; on a host name it may", () => {
    const [ip]: Array<DiscoveredDatabaseEndpoint> = resolveDatabaseEndpointRows(
      [
        row({
          dbSystem: "mssql",
          serverAddress: "10.0.0.5\\INST01",
          callerCluster: "prod",
        }),
      ],
    );
    expect(
      isDatabaseEndpointAutoCreateCandidate({ discovered: ip!, minCalls: 1 }),
    ).toBe(false);

    const [host]: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        row({
          dbSystem: "mssql",
          serverAddress: "sql1.corp.example.com\\INST01",
        }),
      ]);
    expect(
      isDatabaseEndpointAutoCreateCandidate({ discovered: host!, minCalls: 1 }),
    ).toBe(true);
  });
});

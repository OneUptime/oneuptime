import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Service Map `database` node (EntityType.Database: engine + host +
 * logical database, inferred from CLIENT spans — the host's port is
 * stripped) links to the Databases product page of the DatabaseServer that
 * owns the endpoint it names. The product keys servers by endpoint (host
 * AND port, cluster-qualified when cluster-local), so this is the one place
 * the two identities meet — pinned here against a fake endpoint table:
 *
 *   - the exact endpoint first (the node's own port, else the engine
 *     default), then a cluster-local name's `@cluster` twins;
 *   - then any endpoint on the same host — a database on a non-default port
 *     (the audit's PgBouncer on 6432, DigitalOcean on 25060) and a
 *     single-label Kubernetes name (`postgres`) recorded in its namespace
 *     form — of the same engine family;
 *   - never a guess between two databases.
 */

const getListMock: MockFunction = getJestMockFunction();

// The arrow wrapper is load bearing: jest.mock is hoisted above getListMock.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string) => {
          return value;
        },
        translateValue: (value: React.ReactNode) => {
          return value;
        },
      };
    },
  };
});
jest.mock("../../../UI/Components/SideOver/SideOver", () => {
  return {
    __esModule: true,
    SideOverSize: { Small: "small" },
    default: (props: { title: string; children: React.ReactNode }) => {
      return <section aria-label={props.title}>{props.children}</section>;
    },
  };
});

import {
  DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE,
  DatabaseEntityEndpoint,
  OPEN_DATABASE_LABEL,
  TypedRowLink,
  getDatabaseEntityEndpoint,
  resolveDatabaseServerIdForEndpoint,
  resolveDatabaseServerLink,
  resolveTypedRowLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/ResolveTypedRowLink";
import EntityDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b2f5b1c-0000-4000-8000-000000000001",
);
const DATABASE_ID: string = "d8a7f000-0000-4000-8000-000000000001";
const OTHER_DATABASE_ID: string = "d8a7f000-0000-4000-8000-000000000002";

interface GetListArgs {
  modelType: { name: string };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

interface StoredEndpoint {
  owner: string;
  endpoint: string;
  dbSystem?: string;
}

function calls(): Array<GetListArgs> {
  return getListMock.mock.calls.map((call: Array<unknown>): GetListArgs => {
    return call[0] as GetListArgs;
  });
}

function prefixQueries(): Array<string> {
  return calls()
    .map((args: GetListArgs): unknown => {
      return args.query["endpoint"];
    })
    .filter((value: unknown): boolean => {
      return value instanceof StartsWith;
    })
    .map((value: unknown): string => {
      return (value as StartsWith<string>).toString();
    });
}

/*
 * A DatabaseServerEndpoint table: an exact query matches by equality, a
 * StartsWith query like SQL LIKE — `_` matches any one character, which is
 * why the resolver re-checks every prefix hit.
 */
function useTable(rows: Array<StoredEndpoint>): void {
  getListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (args as GetListArgs).query;
    const wanted: unknown = query["endpoint"];
    const matching: Array<StoredEndpoint> = rows.filter(
      (row: StoredEndpoint): boolean => {
        if (wanted instanceof StartsWith) {
          const pattern: RegExp = new RegExp(
            `^${wanted
              .toString()
              .split("")
              .map((char: string): string => {
                return char === "_"
                  ? "."
                  : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              })
              .join("")}`,
          );
          return pattern.test(row.endpoint);
        }
        return row.endpoint === wanted;
      },
    );
    return {
      data: matching.map((row: StoredEndpoint): JSONObject => {
        return {
          databaseServerId: new ObjectID(row.owner),
          endpoint: row.endpoint,
          databaseServer: row.dbSystem ? { dbSystem: row.dbSystem } : undefined,
        } as unknown as JSONObject;
      }),
      count: matching.length,
    };
  });
}

function databaseNode(
  identifying: JSONObject,
  descriptive?: JSONObject,
): InventoryItem {
  return {
    entityKey: "db-node",
    displayName: "orders",
    entityType: EntityType.Database,
    identifyingAttributes: identifying,
    descriptiveAttributes: descriptive,
  } as unknown as InventoryItem;
}

async function linkFor(
  identifying: JSONObject,
  descriptive?: JSONObject,
): Promise<string | null> {
  const link: TypedRowLink | null = await resolveDatabaseServerLink(
    databaseNode(identifying, descriptive),
  );
  return link ? link.route.toString() : null;
}

function databasePage(id: string): string {
  return `/dashboard/${PROJECT_ID.toString()}/databases/${id}`;
}

beforeEach(() => {
  getListMock.mockReset();
  useTable([]);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("getDatabaseEntityEndpoint", () => {
  test.each([
    ["postgresql", "db.prod.example.com", "db.prod.example.com:5432"],
    ["mysql", "orders.example.com", "orders.example.com:3306"],
    ["redis", "cache.example.com", "cache.example.com:6379"],
    ["mongodb", "docs.example.com", "docs.example.com:27017"],
  ])(
    "a %s node on %s names the endpoint %s",
    (system: string, address: string, expected: string) => {
      expect(
        getDatabaseEntityEndpoint({
          "db.system.name": system,
          "server.address": address,
        }),
      ).toEqual({
        endpoint: expected,
        isLocal: false,
        host: address,
        system: system,
        port: null,
      });
    },
  );

  test("the engine is normalized before its default port is looked up", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": " PostgreSQL ",
        "server.address": "DB.Prod.Example.com",
      }),
    ).toMatchObject({
      endpoint: "db.prod.example.com:5432",
      isLocal: false,
      host: "db.prod.example.com",
      system: "postgresql",
    });
  });

  test("an address that carries a port keeps it, and says so", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "postgresql",
        "server.address": "pgbouncer.example.com:6432",
      }),
    ).toMatchObject({ endpoint: "pgbouncer.example.com:6432", port: 6432 });
  });

  test("a server.port attribute on the node is its port", () => {
    expect(
      getDatabaseEntityEndpoint(
        { "db.system.name": "postgresql", "server.address": "pg.example.com" },
        { "server.port": "25060" },
      ),
    ).toMatchObject({ endpoint: "pg.example.com:25060", port: 25060 });
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "postgresql",
        "server.address": "pg.example.com",
        "server.port": "not-a-port",
      }),
    ).toMatchObject({ endpoint: "pg.example.com:5432", port: null });
  });

  test("a stamped canonical endpoint wins over the address", () => {
    expect(
      getDatabaseEntityEndpoint(
        { "db.system.name": "postgresql", "server.address": "postgres" },
        {
          [DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE]:
            "postgres.prod.svc.cluster.local:5433@c1",
        },
      ),
    ).toEqual({
      endpoint: "postgres.prod.svc.cluster.local:5433@c1",
      isLocal: false,
      host: "postgres.prod.svc.cluster.local",
      system: "postgresql",
      port: 5433,
    });
  });

  test("an unknown engine has no default port, so the endpoint is the host alone", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "made-up-db",
        "server.address": "weird.example.com",
      }),
    ).toMatchObject({ endpoint: "weird.example.com", isLocal: false });
  });

  test("Kubernetes service DNS is expanded and marked local (its stored twin is cluster-qualified)", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "postgresql",
        "server.address": "postgres.data.svc",
      }),
    ).toMatchObject({
      endpoint: "postgres.data.svc.cluster.local:5432",
      isLocal: true,
      host: "postgres.data.svc.cluster.local",
    });
  });

  test("a private IP and a single-label name are local too", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "redis",
        "server.address": "10.0.0.5",
      }),
    ).toMatchObject({ endpoint: "10.0.0.5:6379", isLocal: true });
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "postgresql",
        "server.address": "postgres",
      }),
    ).toMatchObject({
      endpoint: "postgres:5432",
      isLocal: true,
      host: "postgres",
    });
  });

  test.each([
    [{ "db.system.name": "postgresql" }],
    [{ "db.system.name": "postgresql", "server.address": "" }],
    [{ "db.system.name": "postgresql", "server.address": "   " }],
    [{ "db.system.name": "postgresql", "server.address": 5432 }],
    [{ "db.system.name": "postgresql", "server.address": "localhost" }],
    [{ "db.system.name": "postgresql", "server.address": "127.0.0.1" }],
    [{ "db.system.name": "postgresql", "server.address": "[REDACTED]" }],
  ])("%j names no endpoint", (identifying: JSONObject) => {
    expect(getDatabaseEntityEndpoint(identifying)).toBeNull();
  });
});

describe("resolveDatabaseServerIdForEndpoint", () => {
  const GLOBAL: DatabaseEntityEndpoint = {
    endpoint: "db.prod.example.com:5432",
    isLocal: false,
  };
  const LOCAL: DatabaseEntityEndpoint = {
    endpoint: "postgres.data.svc.cluster.local:5432",
    isLocal: true,
  };

  test("the owner of the exact endpoint wins, in one project-scoped query", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: GLOBAL.endpoint }]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: GLOBAL,
      }),
    ).resolves.toBe(DATABASE_ID);

    expect(calls()).toHaveLength(1);
    expect(calls()[0]!.modelType.name).toBe("DatabaseServerEndpoint");
    expect(calls()[0]!.query).toEqual({
      projectId: PROJECT_ID,
      endpoint: "db.prod.example.com:5432",
    });
    expect(calls()[0]!.select).toEqual({ databaseServerId: true });
    expect(calls()[0]!.limit).toBe(1);
  });

  test("an endpoint that names no host has nothing to fall back on", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "db.prod.example.com:6432" }]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: GLOBAL,
      }),
    ).resolves.toBeNull();
    expect(calls()).toHaveLength(1);
  });

  test("a local endpoint falls back to its cluster-qualified twin when exactly one database owns it", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: `${LOCAL.endpoint}@prod-eu` }]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBe(DATABASE_ID);

    expect(calls()).toHaveLength(2);
    expect(prefixQueries()).toEqual([`${LOCAL.endpoint}@`]);
    expect(calls()[1]!.query["projectId"]).toBe(PROJECT_ID);
  });

  test("one database qualified in two clusters is still one owner", async () => {
    useTable([
      { owner: DATABASE_ID, endpoint: `${LOCAL.endpoint}@prod-eu` },
      { owner: DATABASE_ID, endpoint: `${LOCAL.endpoint}@prod-us` },
    ]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBe(DATABASE_ID);
  });

  test("two clusters' servers of the same name are two databases — never guessed between", async () => {
    useTable([
      { owner: DATABASE_ID, endpoint: `${LOCAL.endpoint}@prod-eu` },
      { owner: OTHER_DATABASE_ID, endpoint: `${LOCAL.endpoint}@prod-us` },
    ]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: { ...LOCAL, host: "postgres.data.svc.cluster.local" },
      }),
    ).resolves.toBeNull();
    // Ambiguous twins end it: no same-host guess afterwards.
    expect(prefixQueries()).toEqual([`${LOCAL.endpoint}@`]);
  });

  test("a LIKE-wildcard lookalike returned by the prefix search is ignored", async () => {
    useTable([
      // `_` is a single-character wildcard in a LIKE prefix.
      {
        owner: OTHER_DATABASE_ID,
        endpoint: "postgres.data.svc.cluster.local:5432X",
      },
      { owner: DATABASE_ID, endpoint: `${LOCAL.endpoint}@prod-eu` },
    ]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBe(DATABASE_ID);
  });

  test("a local endpoint with no qualified twin and no host resolves to nothing", async () => {
    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBeNull();
  });
});

/*
 * The audit's failure scenarios, end to end from the node the Service Map
 * actually has (port stripped by normalizeHost).
 */
describe("resolving nodes whose database is not on the default port", () => {
  test("PgBouncer on 6432: the only endpoint on the host is the database", async () => {
    useTable([
      {
        owner: DATABASE_ID,
        endpoint: "pgbouncer.example.com:6432",
        dbSystem: "postgresql",
      },
    ]);

    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "pgbouncer.example.com",
      }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    expect(prefixQueries()).toEqual(["pgbouncer.example.com:"]);
  });

  test("a managed Postgres on 25060 and an Azure Redis on TLS 6380 resolve too", async () => {
    useTable([
      {
        owner: DATABASE_ID,
        endpoint: "db-abc.ondigitalocean.com:25060",
        dbSystem: "postgresql",
      },
      {
        owner: OTHER_DATABASE_ID,
        endpoint: "cache.redis.cache.windows.net:6380",
        dbSystem: "redis",
      },
    ]);

    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "db-abc.ondigitalocean.com",
      }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    await expect(
      linkFor({
        "db.system.name": "redis",
        "server.address": "cache.redis.cache.windows.net",
      }),
    ).resolves.toBe(databasePage(OTHER_DATABASE_ID));
  });

  test("two instances on one host: no port means the default one; a known port picks its own", async () => {
    useTable([
      { owner: DATABASE_ID, endpoint: "pg1.example.com:5432" },
      { owner: OTHER_DATABASE_ID, endpoint: "pg1.example.com:5433" },
    ]);

    // A span that reports no server.port called the default port.
    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "pg1.example.com",
      }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    await expect(
      linkFor(
        { "db.system.name": "postgresql", "server.address": "pg1.example.com" },
        { "server.port": "5433" },
      ),
    ).resolves.toBe(databasePage(OTHER_DATABASE_ID));
  });

  test("a known port that nothing owns on that host is no link, not the other port", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "pg1.example.com:5433" }]);

    await expect(
      linkFor(
        { "db.system.name": "postgresql", "server.address": "pg1.example.com" },
        { "server.port": "6432" },
      ),
    ).resolves.toBeNull();
  });

  test("two databases on non-default ports of one host are never guessed between", async () => {
    useTable([
      { owner: DATABASE_ID, endpoint: "pg1.example.com:5433" },
      { owner: OTHER_DATABASE_ID, endpoint: "pg1.example.com:5434" },
    ]);

    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "pg1.example.com",
      }),
    ).resolves.toBeNull();
  });

  test("another engine family on the same host is not this node's database", async () => {
    useTable([
      {
        owner: DATABASE_ID,
        endpoint: "shared.example.com:5433",
        dbSystem: "postgresql",
      },
      {
        owner: OTHER_DATABASE_ID,
        endpoint: "shared.example.com:6380",
        dbSystem: "valkey",
      },
    ]);

    // A Valkey server is the Redis family: a "redis" span resolves to it.
    await expect(
      linkFor({
        "db.system.name": "redis",
        "server.address": "shared.example.com",
      }),
    ).resolves.toBe(databasePage(OTHER_DATABASE_ID));
    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "shared.example.com",
      }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    await expect(
      linkFor({
        "db.system.name": "mongodb",
        "server.address": "shared.example.com",
      }),
    ).resolves.toBeNull();
  });

  test("a hostname that merely starts like the node's host is someone else", async () => {
    useTable([
      { owner: DATABASE_ID, endpoint: "pg1.example.com.evil.net:5433" },
    ]);

    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "pg1.example.com",
      }),
    ).resolves.toBeNull();
  });

  test("an IPv6 host is matched in its bracketed form", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "[2001:db8::1]:6432" }]);

    await expect(
      linkFor({
        "db.system.name": "postgresql",
        "server.address": "2001:db8::1",
      }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    expect(prefixQueries()).toContain("[2001:db8::1]:");
  });
});

describe("resolving a single-label Kubernetes name", () => {
  test("`postgres` finds the Service a namespace's callers were recorded with", async () => {
    useTable([
      {
        owner: DATABASE_ID,
        endpoint: "postgres.prod.svc.cluster.local:5432@c1",
        dbSystem: "postgresql",
      },
      // Not a Kubernetes Service: must not match `postgres`.
      { owner: OTHER_DATABASE_ID, endpoint: "postgres.example.com:5432" },
    ]);

    await expect(
      linkFor({ "db.system.name": "postgresql", "server.address": "postgres" }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    expect(prefixQueries()).toEqual([
      "postgres:5432@",
      "postgres:",
      "postgres.",
    ]);
  });

  test("the same Service in two namespaces is two databases: no link", async () => {
    useTable([
      {
        owner: DATABASE_ID,
        endpoint: "postgres.prod.svc.cluster.local:5432@c1",
      },
      {
        owner: OTHER_DATABASE_ID,
        endpoint: "postgres.staging.svc.cluster.local:5432@c1",
      },
    ]);

    await expect(
      linkFor({ "db.system.name": "postgresql", "server.address": "postgres" }),
    ).resolves.toBeNull();
  });

  test("with two candidates, the only one on the default port is the one a portless span called", async () => {
    useTable([
      { owner: DATABASE_ID, endpoint: "redis.cache.svc.cluster.local:6379@c1" },
      {
        owner: OTHER_DATABASE_ID,
        endpoint: "redis.jobs.svc.cluster.local:7000@c1",
      },
    ]);

    await expect(
      linkFor({ "db.system.name": "redis", "server.address": "redis" }),
    ).resolves.toBe(databasePage(DATABASE_ID));
  });

  test("a stored single-label alias still matches first, exactly", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "postgres:5432" }]);

    await expect(
      linkFor({ "db.system.name": "postgresql", "server.address": "postgres" }),
    ).resolves.toBe(databasePage(DATABASE_ID));
    expect(calls()).toHaveLength(1);
  });
});

describe("resolveDatabaseServerLink", () => {
  test("links a database node to its DatabaseServer page", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "db.prod.example.com:5432" }]);

    const link: TypedRowLink | null = await resolveDatabaseServerLink(
      databaseNode({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
        "db.namespace": "orders",
      }),
    );

    expect(link).not.toBeNull();
    expect(link!.label).toBe(OPEN_DATABASE_LABEL);
    expect(link!.label).toBe("Open database");
    expect(link!.route.toString()).toBe(databasePage(DATABASE_ID));
  });

  test("resolveTypedRowLink routes a database node through the same lookup", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "db.prod.example.com:5432" }]);

    const link: TypedRowLink | null = await resolveTypedRowLink(
      databaseNode({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      }),
    );

    expect(link?.label).toBe("Open database");
    expect(link?.route.toString()).toContain(`/databases/${DATABASE_ID}`);
    expect(calls()[0]!.query["endpoint"]).toBe("db.prod.example.com:5432");
  });

  test("a node without an address costs no request", async () => {
    await expect(
      resolveDatabaseServerLink(databaseNode({ "db.system.name": "redis" })),
    ).resolves.toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("only database nodes are linked", async () => {
    await expect(
      resolveDatabaseServerLink({
        entityKey: "svc",
        displayName: "api",
        entityType: EntityType.Service,
        identifyingAttributes: { "server.address": "db.prod.example.com" },
      } as unknown as InventoryItem),
    ).resolves.toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an endpoint no database owns is no link", async () => {
    await expect(
      resolveDatabaseServerLink(
        databaseNode({
          "db.system.name": "postgresql",
          "server.address": "db.prod.example.com",
        }),
      ),
    ).resolves.toBeNull();
  });

  test("without a current project nothing is requested", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    await expect(
      resolveDatabaseServerLink(
        databaseNode({
          "db.system.name": "postgresql",
          "server.address": "db.prod.example.com",
        }),
      ),
    ).resolves.toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a failing lookup is a missing link, never an error", async () => {
    getListMock.mockImplementation(async () => {
      throw new Error("403");
    });

    await expect(
      resolveDatabaseServerLink(
        databaseNode({
          "db.system.name": "postgresql",
          "server.address": "db.prod.example.com",
        }),
      ),
    ).resolves.toBeNull();
  });

  test("the same-host lookup asks for the owner's engine, project-scoped", async () => {
    await linkFor({
      "db.system.name": "postgresql",
      "server.address": "pg.example.com",
    });

    const hostLookup: GetListArgs | undefined = calls().find(
      (args: GetListArgs): boolean => {
        return args.query["endpoint"] instanceof StartsWith;
      },
    );
    expect(hostLookup).toBeDefined();
    expect(hostLookup!.query["projectId"]).toBe(PROJECT_ID);
    expect(hostLookup!.select).toEqual({
      databaseServerId: true,
      endpoint: true,
      databaseServer: { dbSystem: true },
    });
  });
});

describe("the Service Map detail drawer", () => {
  function renderPanel(entity: InventoryItem): void {
    render(
      <EntityDetailPanel
        entity={entity}
        relationships={[] as Array<InventoryItemRelationship>}
        entityByKey={new Map<string, InventoryItem>([["db-node", entity]])}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
        onFocus={() => {
          return undefined;
        }}
      />,
    );
  }

  test("offers 'Open database' for a database node a DatabaseServer owns", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "db.prod.example.com:5432" }]);

    renderPanel(
      databaseNode({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      }),
    );

    const link: HTMLElement = await screen.findByText("Open database");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      databasePage(DATABASE_ID),
    );
  });

  test("offers it for a database on a non-default port too", async () => {
    useTable([{ owner: DATABASE_ID, endpoint: "pgbouncer.example.com:6432" }]);

    renderPanel(
      databaseNode({
        "db.system.name": "postgresql",
        "server.address": "pgbouncer.example.com",
      }),
    );

    const link: HTMLElement = await screen.findByText("Open database");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      databasePage(DATABASE_ID),
    );
  });

  test("shows no database link when no DatabaseServer owns the endpoint", async () => {
    renderPanel(
      databaseNode({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      }),
    );

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });
    expect(screen.queryByText("Open database")).not.toBeInTheDocument();
  });

  test("never looks a database up for other node types", async () => {
    renderPanel({
      entityKey: "db-node",
      displayName: "web-1",
      entityType: EntityType.Container,
    } as InventoryItem);

    expect(screen.queryByText("Open database")).not.toBeInTheDocument();
    const endpointLookups: Array<GetListArgs> = calls().filter(
      (args: GetListArgs): boolean => {
        return args.modelType.name === "DatabaseServerEndpoint";
      },
    );
    expect(endpointLookups).toHaveLength(0);
  });
});

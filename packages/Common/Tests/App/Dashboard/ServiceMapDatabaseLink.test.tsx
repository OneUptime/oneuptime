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
 * logical database, inferred from CLIENT spans) links to the Databases
 * product page of the DatabaseServer that owns the endpoint it names,
 * `server.address:<engine default port>`. The node never carries a port and
 * the product keys servers by endpoint, so this is the one place the two
 * identities meet — pinned here against a mocked ModelAPI: which endpoint is
 * asked for, when a cluster-qualified owner is accepted, and that nothing
 * guesses between two candidates.
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

function calls(): Array<GetListArgs> {
  return getListMock.mock.calls.map((call: Array<unknown>): GetListArgs => {
    return call[0] as GetListArgs;
  });
}

function endpointRow(owner: string, endpoint: string): JSONObject {
  return { databaseServerId: new ObjectID(owner), endpoint } as JSONObject;
}

/*
 * Answer the exact-endpoint query with `exact` and the qualified-prefix
 * query with `qualified`.
 */
function answer(
  exact: Array<JSONObject>,
  qualified: Array<JSONObject> = [],
): void {
  getListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (args as GetListArgs).query;
    return {
      data: query["endpoint"] instanceof StartsWith ? qualified : exact,
      count: 0,
    };
  });
}

function databaseNode(identifying: JSONObject): InventoryItem {
  return {
    entityKey: "db-node",
    displayName: "orders",
    entityType: EntityType.Database,
    identifyingAttributes: identifying,
  } as unknown as InventoryItem;
}

beforeEach(() => {
  getListMock.mockReset();
  answer([]);
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
      ).toEqual({ endpoint: expected, isLocal: false });
    },
  );

  test("the engine is normalized before its default port is looked up", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": " PostgreSQL ",
        "server.address": "DB.Prod.Example.com",
      }),
    ).toEqual({ endpoint: "db.prod.example.com:5432", isLocal: false });
  });

  test("an address that already carries a port keeps it", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "postgresql",
        "server.address": "pgbouncer.example.com:6432",
      }),
    ).toEqual({ endpoint: "pgbouncer.example.com:6432", isLocal: false });
  });

  test("an unknown engine has no default port, so the endpoint is the host alone", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "made-up-db",
        "server.address": "weird.example.com",
      }),
    ).toEqual({ endpoint: "weird.example.com", isLocal: false });
  });

  test("Kubernetes service DNS is expanded and marked local (its stored twin is cluster-qualified)", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "postgresql",
        "server.address": "postgres.data.svc",
      }),
    ).toEqual({
      endpoint: "postgres.data.svc.cluster.local:5432",
      isLocal: true,
    });
  });

  test("a private IP is local too", () => {
    expect(
      getDatabaseEntityEndpoint({
        "db.system.name": "redis",
        "server.address": "10.0.0.5",
      }),
    ).toEqual({ endpoint: "10.0.0.5:6379", isLocal: true });
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
    answer([endpointRow(DATABASE_ID, GLOBAL.endpoint)]);

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

  test("a global endpoint nobody owns resolves to nothing, without a prefix search", async () => {
    answer([], [endpointRow(DATABASE_ID, "db.prod.example.com:5432@prod")]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: GLOBAL,
      }),
    ).resolves.toBeNull();
    expect(calls()).toHaveLength(1);
  });

  test("a local endpoint falls back to its cluster-qualified twin when exactly one database owns it", async () => {
    answer([], [endpointRow(DATABASE_ID, `${LOCAL.endpoint}@prod-eu`)]);

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBe(DATABASE_ID);

    expect(calls()).toHaveLength(2);
    const prefix: unknown = calls()[1]!.query["endpoint"];
    expect(prefix).toBeInstanceOf(StartsWith);
    expect((prefix as StartsWith<string>).toString()).toBe(
      `${LOCAL.endpoint}@`,
    );
    expect(calls()[1]!.query["projectId"]).toBe(PROJECT_ID);
  });

  test("one database qualified in two clusters is still one owner", async () => {
    answer(
      [],
      [
        endpointRow(DATABASE_ID, `${LOCAL.endpoint}@prod-eu`),
        endpointRow(DATABASE_ID, `${LOCAL.endpoint}@prod-us`),
      ],
    );

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBe(DATABASE_ID);
  });

  test("two clusters' servers of the same name are two databases — never guessed between", async () => {
    answer(
      [],
      [
        endpointRow(DATABASE_ID, `${LOCAL.endpoint}@prod-eu`),
        endpointRow(OTHER_DATABASE_ID, `${LOCAL.endpoint}@prod-us`),
      ],
    );

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBeNull();
  });

  test("a LIKE-wildcard lookalike returned by the prefix search is ignored", async () => {
    answer(
      [],
      [
        // `_` is a single-character wildcard in a LIKE prefix.
        endpointRow(OTHER_DATABASE_ID, "postgres.data.svc.cluster.local:5432X"),
        endpointRow(DATABASE_ID, `${LOCAL.endpoint}@prod-eu`),
      ],
    );

    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBe(DATABASE_ID);
  });

  test("a local endpoint with no qualified twin resolves to nothing", async () => {
    await expect(
      resolveDatabaseServerIdForEndpoint({
        projectId: PROJECT_ID,
        endpoint: LOCAL,
      }),
    ).resolves.toBeNull();
  });
});

describe("resolveDatabaseServerLink", () => {
  test("links a database node to its DatabaseServer page", async () => {
    answer([endpointRow(DATABASE_ID, "db.prod.example.com:5432")]);

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
    expect(link!.route.toString()).toBe(
      `/dashboard/${PROJECT_ID.toString()}/databases/${DATABASE_ID}`,
    );
  });

  test("resolveTypedRowLink routes a database node through the same lookup", async () => {
    answer([endpointRow(DATABASE_ID, "db.prod.example.com:5432")]);

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
    answer([endpointRow(DATABASE_ID, "db.prod.example.com:5432")]);

    renderPanel(
      databaseNode({
        "db.system.name": "postgresql",
        "server.address": "db.prod.example.com",
      }),
    );

    const link: HTMLElement = await screen.findByText("Open database");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/databases/${DATABASE_ID}`,
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

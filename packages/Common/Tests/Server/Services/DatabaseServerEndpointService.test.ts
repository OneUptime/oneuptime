/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
  DatabaseServerEndpointOwner,
  hasOutOfRangePort,
} from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";

/*
 * DatabaseServerEndpointService - the one-owner-per-endpoint table.
 *
 * Pinned here:
 *   - findOwnerByEndpoint / claimEndpoint / listEndpoints, the root API the
 *     discovery paths code against: a claim never takes an endpoint from
 *     another database, and a lost unique-index race re-reads the owner
 *     instead of throwing;
 *   - a person adding an alias goes through the REAL create pipeline,
 *     column permission check included: the endpoint is canonicalized with
 *     the parent database's engine / namespace / cluster, source and
 *     isPrimary are forced, and a collision names the database that owns the
 *     endpoint;
 *   - a person can never remove the primary endpoint.
 *
 * The repository is faked - no Postgres, no Redis.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const DATABASE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_DATABASE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = DatabaseServerEndpointService;

function userPermission(permission: Permission): UserPermission {
  return {
    permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

/* The shape getUserMiddleware builds for a signed-in member of the project. */
function memberProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map(userPermission),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function owner(
  databaseServerId: ObjectID,
  isPrimary: boolean = false,
): DatabaseServerEndpointOwner {
  return { databaseServerId: databaseServerId, isPrimary: isPrimary };
}

function parentDatabase(
  overrides: {
    dbSystem?: string;
    kubernetesNamespace?: string;
    clusterIdentifier?: string;
  } = {},
): DatabaseServer {
  const database: DatabaseServer = new DatabaseServer(DATABASE_ID);
  database.projectId = PROJECT_ID;
  database.dbSystem = overrides.dbSystem || "postgresql";

  if (overrides.kubernetesNamespace) {
    database.kubernetesNamespace = overrides.kubernetesNamespace;
  }

  if (overrides.clusterIdentifier) {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.clusterIdentifier = overrides.clusterIdentifier;
    database.kubernetesCluster = cluster;
  }

  return database;
}

function aliasRequest(
  endpoint: unknown,
  extra: Partial<DatabaseServerEndpoint> = {},
): DatabaseServerEndpoint {
  const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
  data.databaseServerId = DATABASE_ID;
  data.endpoint = endpoint as string;
  Object.assign(data, extra);
  return data;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DatabaseServerEndpointService.findOwnerByEndpoint", () => {
  test("reads the owner of the exact canonical endpoint in the project, as root", async () => {
    const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    row.databaseServerId = DATABASE_ID;
    row.isPrimary = true;
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findOneBy",
    ).mockResolvedValue(row);

    const result: DatabaseServerEndpointOwner | null =
      await DatabaseServerEndpointService.findOwnerByEndpoint(
        PROJECT_ID,
        " orders-db.internal:5432 ",
      );

    expect(result).not.toBeNull();
    expect(result!.databaseServerId.toString()).toBe(DATABASE_ID.toString());
    expect(result!.isPrimary).toBe(true);

    const call: any = findOneBy.mock.calls[0]![0];
    expect(call.query.projectId).toBe(PROJECT_ID);
    // Stored canonical, so compared byte for byte - trimmed, not lowercased again.
    expect(call.query.endpoint).toBe("orders-db.internal:5432");
    expect(call.props.isRoot).toBe(true);
    expect(call.select).toMatchObject({
      databaseServerId: true,
      isPrimary: true,
    });
  });

  test("null when no database lists the endpoint", async () => {
    getJestSpyOn(service, "findOneBy").mockResolvedValue(null);

    await expect(
      DatabaseServerEndpointService.findOwnerByEndpoint(
        PROJECT_ID,
        "orders-db.internal:5432",
      ),
    ).resolves.toBeNull();
  });

  test("a blank endpoint answers null without a query", async () => {
    const findOneBy: jest.SpyInstance = getJestSpyOn(service, "findOneBy");

    await expect(
      DatabaseServerEndpointService.findOwnerByEndpoint(PROJECT_ID, "   "),
    ).resolves.toBeNull();
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("an isPrimary column that was not read comes back as false", async () => {
    const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    row.databaseServerId = DATABASE_ID;
    getJestSpyOn(service, "findOneBy").mockResolvedValue(row);

    const result: DatabaseServerEndpointOwner | null =
      await DatabaseServerEndpointService.findOwnerByEndpoint(
        PROJECT_ID,
        "orders-db.internal:5432",
      );

    expect(result!.isPrimary).toBe(false);
  });
});

/*
 * The endpoint parser reads an out-of-range port as "no port" (right for
 * telemetry). A person's typed value must be refused instead of having the
 * engine default quietly substituted.
 */
describe("hasOutOfRangePort", () => {
  test.each([
    ["db.internal:99999", true],
    ["db.internal:0", true],
    ["db.internal:65536", true],
    ["[2001:db8::1]:70000", true],
    ["db.internal:70000@prod", true],
    ["postgresql://user@db.internal:99999/orders", true],
    ["db.internal:5432", false],
    ["db.internal:65535", false],
    ["db.internal", false],
    ["db.internal:5432@prod", false],
    ["[2001:db8::1]:5432", false],
    // A bare IPv6 address has no port to check.
    ["2001:db8::99999", false],
    ["postgresql://user:secret@db.internal:5432/orders", false],
    ["", false],
  ])("%s -> %s", (value: string, expected: boolean) => {
    expect(hasOutOfRangePort(value)).toBe(expected);
  });

  test("a non-string is never out of range", () => {
    expect(hasOutOfRangePort(5432)).toBe(false);
    expect(hasOutOfRangePort(undefined)).toBe(false);
  });
});

describe("DatabaseServerEndpointService.claimEndpoint", () => {
  const CLAIM: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    endpoint: string;
    isPrimary: boolean;
    source: "auto";
  } = {
    projectId: PROJECT_ID,
    databaseServerId: DATABASE_ID,
    endpoint: "orders-db.data.svc.cluster.local:5432@prod",
    isPrimary: true,
    source: "auto",
  };

  test("inserts an unowned endpoint as root, stamped matched now", async () => {
    getJestSpyOn(service, "findOwnerByEndpoint").mockResolvedValue(null);
    const create: jest.SpyInstance = getJestSpyOn(
      service,
      "create",
    ).mockImplementation(async (input: any) => {
      return input.data;
    });

    const before: number = Date.now();
    const result: DatabaseServerEndpointClaimResult =
      await DatabaseServerEndpointService.claimEndpoint(CLAIM);

    expect(result).toBe("claimed");
    expect(create).toHaveBeenCalledTimes(1);
    const call: any = create.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true });
    const row: DatabaseServerEndpoint = call.data;
    expect(row.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(row.databaseServerId!.toString()).toBe(DATABASE_ID.toString());
    expect(row.endpoint).toBe(CLAIM.endpoint);
    expect(row.isPrimary).toBe(true);
    expect(row.source).toBe("auto");
    expect(row.lastMatchedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("an endpoint this database already owns is not written again", async () => {
    getJestSpyOn(service, "findOwnerByEndpoint").mockResolvedValue(
      owner(DATABASE_ID, true),
    );
    const create: jest.SpyInstance = getJestSpyOn(service, "create");

    await expect(
      DatabaseServerEndpointService.claimEndpoint(CLAIM),
    ).resolves.toBe("already-owned-by-this");
    expect(create).not.toHaveBeenCalled();
  });

  test("never takes an endpoint away from another database", async () => {
    getJestSpyOn(service, "findOwnerByEndpoint").mockResolvedValue(
      owner(OTHER_DATABASE_ID),
    );
    const create: jest.SpyInstance = getJestSpyOn(service, "create");

    await expect(
      DatabaseServerEndpointService.claimEndpoint(CLAIM),
    ).resolves.toBe("owned-by-other");
    expect(create).not.toHaveBeenCalled();
  });

  test("a claim lost to a racing writer reports the winner instead of throwing", async () => {
    getJestSpyOn(service, "findOwnerByEndpoint")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(owner(OTHER_DATABASE_ID));
    getJestSpyOn(service, "create").mockRejectedValue(
      new BadDataException("duplicate key value violates unique constraint"),
    );

    await expect(
      DatabaseServerEndpointService.claimEndpoint(CLAIM),
    ).resolves.toBe("owned-by-other");
  });

  test("a race won by another claim for the SAME database is a success", async () => {
    getJestSpyOn(service, "findOwnerByEndpoint")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(owner(DATABASE_ID));
    getJestSpyOn(service, "create").mockRejectedValue(
      new BadDataException("duplicate key value violates unique constraint"),
    );

    await expect(
      DatabaseServerEndpointService.claimEndpoint(CLAIM),
    ).resolves.toBe("already-owned-by-this");
  });

  test("a failure that is not a lost race is surfaced", async () => {
    getJestSpyOn(service, "findOwnerByEndpoint").mockResolvedValue(null);
    getJestSpyOn(service, "create").mockRejectedValue(
      new Error("insert or update violates foreign key constraint"),
    );

    await expect(
      DatabaseServerEndpointService.claimEndpoint(CLAIM),
    ).rejects.toThrow("foreign key");
  });

  test("a blank endpoint is refused", async () => {
    await expect(
      DatabaseServerEndpointService.claimEndpoint({ ...CLAIM, endpoint: " " }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("DatabaseServerEndpointService.listEndpoints", () => {
  test("lists one database's endpoints, primary first, deduped", async () => {
    const rows: Array<DatabaseServerEndpoint> = [
      "orders-db.internal:5432",
      "orders-replica.internal:5432",
      "orders-replica.internal:5432",
      "",
    ].map((endpoint: string, index: number) => {
      const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      if (endpoint) {
        row.endpoint = endpoint;
      }
      row.isPrimary = index === 0;
      return row;
    });
    const findBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findBy",
    ).mockResolvedValue(rows);

    const endpoints: Array<string> =
      await DatabaseServerEndpointService.listEndpoints(DATABASE_ID);

    expect(endpoints).toEqual([
      "orders-db.internal:5432",
      "orders-replica.internal:5432",
    ]);
    const call: any = findBy.mock.calls[0]![0];
    expect(call.query.databaseServerId).toBe(DATABASE_ID);
    expect(call.sort).toEqual({
      isPrimary: SortOrder.Descending,
      endpoint: SortOrder.Ascending,
    });
    expect(call.props.isRoot).toBe(true);
  });
});

describe("DatabaseServerEndpointService - a person adding an alias (real create pipeline)", () => {
  let save: jest.Mock;
  let findParent: jest.SpyInstance;
  let findOwner: jest.SpyInstance;

  beforeEach(() => {
    save = jest.fn(async (entity: any) => {
      entity._id = ObjectID.generate().toString();
      return entity;
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({ save } as never);
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    findParent = getJestSpyOn(DatabaseServerService, "findOneBy");
    findParent.mockResolvedValue(parentDatabase());
    findOwner = getJestSpyOn(service, "findOwnerByEndpoint");
    findOwner.mockResolvedValue(null);
    getJestSpyOn(DatabaseServerService, "getDatabaseServerName").mockResolvedValue(
      "PostgreSQL orders-db.internal:5432",
    );
  });

  test("canonicalizes what was typed and forces a removable user alias", async () => {
    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest(" Orders-DB.Internal. ", {
          // Whatever the caller claims, a person only adds a removable alias.
          isPrimary: true,
          source: "auto",
        }),
        props: memberProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(created.endpoint).toBe("orders-db.internal:5432");
    expect(created.isPrimary).toBe(false);
    expect(created.source).toBe("user");
    expect(created.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(created.databaseServerId!.toString()).toBe(DATABASE_ID.toString());
    expect(created.createdByUserId!.toString()).toBe(USER_ID.toString());

    // Ownership was checked against the canonical form, in the caller's project.
    expect(findOwner).toHaveBeenCalledWith(
      PROJECT_ID,
      "orders-db.internal:5432",
    );
  });

  test("an explicit port is kept, the engine default fills a missing one", async () => {
    findParent.mockResolvedValue(parentDatabase({ dbSystem: "mysql" }));

    const withPort: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal:3307"),
        props: memberProps(),
      });
    const withoutPort: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal"),
        props: memberProps(),
      });

    expect(withPort.endpoint).toBe("orders-db.internal:3307");
    expect(withoutPort.endpoint).toBe("orders-db.internal:3306");
  });

  test("a bare service name on a Kubernetes database expands in its namespace and cluster", async () => {
    findParent.mockResolvedValue(
      parentDatabase({
        kubernetesNamespace: "data",
        clusterIdentifier: "prod-cluster",
      }),
    );

    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db"),
        props: memberProps(),
      });

    expect(created.endpoint).toBe(
      "orders-db.data.svc.cluster.local:5432@prod-cluster",
    );
  });

  test("reads the parent database only inside the caller's project", async () => {
    await DatabaseServerEndpointService.create({
      data: aliasRequest("orders-db.internal"),
      props: memberProps(),
    });

    const call: any = findParent.mock.calls[0]![0];
    expect(call.query._id).toBe(DATABASE_ID.toString());
    expect(call.query.projectId).toBe(PROJECT_ID);
    expect(call.select.kubernetesCluster).toEqual({ clusterIdentifier: true });
  });

  test("a database in another project is 'not found', and nothing is written", async () => {
    findParent.mockResolvedValue(null);

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal"),
        props: memberProps(),
      }),
    ).rejects.toThrow("Database not found.");
    expect(save).not.toHaveBeenCalled();
  });

  test("an alias without a database is refused", async () => {
    const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    data.endpoint = "orders-db.internal";

    await expect(
      DatabaseServerEndpointService.create({ data, props: memberProps() }),
    ).rejects.toThrow("Select the database this endpoint belongs to.");
    expect(save).not.toHaveBeenCalled();
  });

  test.each([
    ["an empty value", "", "An empty value is not a valid host[:port]"],
    ["localhost", "localhost:5432", '"localhost:5432" is not a valid host[:port]'],
    ["a loopback IP", "127.0.0.1", '"127.0.0.1" is not a valid host[:port]'],
    ["a port out of range", "db.internal:99999", "is not a valid host[:port]"],
  ])(
    "refuses %s with a message saying what a valid endpoint is",
    async (_label: string, value: string, message: string) => {
      const error: unknown = await DatabaseServerEndpointService.create({
        data: aliasRequest(value),
        props: memberProps(),
      }).catch((e: unknown) => {
        return e;
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(message);
      expect((error as Error).message).toContain("orders-db.internal:5432");
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("an endpoint another database owns is refused, naming that database", async () => {
    findOwner.mockResolvedValue(owner(OTHER_DATABASE_ID, true));
    const getName: jest.SpyInstance = getJestSpyOn(
      DatabaseServerService,
      "getDatabaseServerName",
    ).mockResolvedValue("PostgreSQL payments-db.internal:5432");

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      'orders-db.internal:5432 already belongs to the database "PostgreSQL payments-db.internal:5432". An endpoint can belong to only one database in a project - remove it from that database first.',
    );
    expect(getName.mock.calls[0]![0]).toEqual({
      databaseServerId: OTHER_DATABASE_ID,
    });
    expect(save).not.toHaveBeenCalled();
  });

  test("a nameless owner still produces a readable refusal", async () => {
    findOwner.mockResolvedValue(owner(OTHER_DATABASE_ID));
    getJestSpyOn(DatabaseServerService, "getDatabaseServerName").mockRejectedValue(
      new Error("row gone"),
    );

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "orders-db.internal:5432 already belongs to another database.",
    );
  });

  test("an endpoint this database already lists is refused as a duplicate", async () => {
    findOwner.mockResolvedValue(owner(DATABASE_ID));

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("ORDERS-DB.internal:5432"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "orders-db.internal:5432 is already an endpoint of this database.",
    );
    expect(save).not.toHaveBeenCalled();
  });

  /*
   * The hook forces the columns it owns; everything else still goes through
   * the model's column ACLs - lastMatchedAt is root-only.
   */
  test("a root-only column is still refused by the column permission check", async () => {
    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal", {
          lastMatchedAt: new Date(),
        }),
        props: memberProps(),
      }),
    ).rejects.toThrow("lastMatchedAt");
    expect(save).not.toHaveBeenCalled();
  });

  test("a caller without edit permission on databases cannot add one", async () => {
    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal"),
        props: memberProps([Permission.ReadDatabaseServer]),
      }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  test("a root create passes through untouched - discovery owns its own canonical form", async () => {
    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.internal:5432", {
          projectId: PROJECT_ID,
          isPrimary: true,
          source: "auto",
        }),
        props: { isRoot: true },
      });

    expect(findParent).not.toHaveBeenCalled();
    expect(findOwner).not.toHaveBeenCalled();
    expect(created.isPrimary).toBe(true);
    expect(created.source).toBe("auto");
  });
});

describe("DatabaseServerEndpointService - removing endpoints", () => {
  let findBy: jest.SpyInstance;
  let repositoryDelete: jest.Mock;

  beforeEach(() => {
    repositoryDelete = jest.fn(async () => {
      return { affected: 1 };
    }) as any;
    getJestSpyOn(service, "getRepository").mockReturnValue({
      delete: repositoryDelete,
    } as never);
    findBy = getJestSpyOn(service, "findBy");
  });

  test("a person cannot remove the primary endpoint", async () => {
    const primary: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    primary.endpoint = "orders-db.internal:5432";
    findBy.mockResolvedValue([primary]);

    await expect(
      DatabaseServerEndpointService.deleteBy({
        query: { _id: ObjectID.generate().toString() },
        limit: 1,
        skip: 0,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "orders-db.internal:5432 is the primary endpoint of this database and cannot be removed.",
    );
    expect(repositoryDelete).not.toHaveBeenCalled();
  });

  test("the primary check only looks inside the caller's project", async () => {
    findBy.mockResolvedValue([
      Object.assign(new DatabaseServerEndpoint(), { endpoint: "x:1" }),
    ]);
    const endpointId: string = ObjectID.generate().toString();

    await DatabaseServerEndpointService.deleteBy({
      query: { _id: endpointId, projectId: OTHER_PROJECT_ID },
      limit: 1,
      skip: 0,
      props: memberProps(),
    }).catch(() => {
      return 0;
    });

    const call: any = findBy.mock.calls[0]![0];
    expect(call.query._id).toBe(endpointId);
    expect(call.query.isPrimary).toBe(true);
    // The request tenant wins over whatever project the query named.
    expect(call.query.projectId).toBe(PROJECT_ID);
    expect(call.props.isRoot).toBe(true);
  });

  test("an alias passes the guard", async () => {
    findBy.mockResolvedValue([]);
    const onBeforeDelete: (deleteBy: any) => Promise<any> =
      service.onBeforeDelete.bind(service);
    const deleteBy: any = {
      query: { _id: ObjectID.generate().toString() },
      limit: 1,
      skip: 0,
      props: memberProps(),
    };

    await expect(onBeforeDelete(deleteBy)).resolves.toEqual({
      deleteBy: deleteBy,
      carryForward: null,
    });
  });

  test("root deletes (project cleanup, discovery) are not guarded", async () => {
    const onBeforeDelete: (deleteBy: any) => Promise<any> =
      service.onBeforeDelete.bind(service);

    await onBeforeDelete({
      query: {},
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(findBy).not.toHaveBeenCalled();
  });
});

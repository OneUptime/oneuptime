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
} from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import logger from "../../../Server/Utils/Logger";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
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
    dbSystem?: string | undefined;
    kubernetesNamespace?: string | undefined;
    clusterIdentifier?: string | undefined;
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
        " orders-db.example.com:5432 ",
      );

    expect(result).not.toBeNull();
    expect(result!.databaseServerId.toString()).toBe(DATABASE_ID.toString());
    expect(result!.isPrimary).toBe(true);

    const call: any = findOneBy.mock.calls[0]![0];
    expect(call.query.projectId).toBe(PROJECT_ID);
    // Stored canonical, so compared byte for byte - trimmed, not lowercased again.
    expect(call.query.endpoint).toBe("orders-db.example.com:5432");
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
        "orders-db.example.com:5432",
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
        "orders-db.example.com:5432",
      );

    expect(result!.isPrimary).toBe(false);
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
      "orders-db.example.com:5432",
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
      "orders-db.example.com:5432",
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

/*
 * A fake DatabaseServer table for the parent lookups. A root lookup is
 * matched as the service built it (after the REAL update-permission check
 * scoped it); a caller's own lookup first goes through the REAL
 * read-permission check, exactly as DatabaseService would run it. So the
 * project, label and Owned scoping under test is the framework's - the fake
 * only evaluates the resulting operators.
 */
interface FakeDatabase {
  row: DatabaseServer;
  labelIds: Array<string>;
}

function operatorValues(value: unknown): Array<string> | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" || value instanceof ObjectID) {
    return [value.toString().toLowerCase()];
  }

  const operator: any = value;

  if (operator._type === "and" && Array.isArray(operator._value)) {
    let result: Array<string> | null = null;
    for (const child of operator._value) {
      const values: Array<string> | null = operatorValues(child);
      if (values === null) {
        continue;
      }
      result =
        result === null
          ? values
          : result.filter((item: string) => {
              return values.includes(item);
            });
    }
    return result;
  }

  if (operator._type === "equal") {
    return operatorValues(operator._value);
  }

  const parameters: unknown =
    operator._objectLiteralParameters || operator.objectLiteralParameters;

  if (parameters && typeof parameters === "object") {
    const values: Array<string> = [];
    for (const parameter of Object.values(parameters)) {
      for (const item of Array.isArray(parameter) ? parameter : [parameter]) {
        values.push(String(item).toLowerCase());
      }
    }
    return values;
  }

  throw new Error(`The fake cannot evaluate ${JSON.stringify(value)}`);
}

function fakeRowMatches(database: FakeDatabase, query: any): boolean {
  const ids: Array<string> | null = operatorValues(query._id);
  if (ids && !ids.includes(database.row.id!.toString())) {
    return false;
  }

  const projects: Array<string> | null = operatorValues(query.projectId);
  if (projects && !projects.includes(database.row.projectId!.toString())) {
    return false;
  }

  if (query.labels) {
    const labelIds: Array<string> | null = operatorValues(query.labels._id);
    if (
      labelIds &&
      !database.labelIds.some((labelId: string) => {
        return labelIds.includes(labelId);
      })
    ) {
      return false;
    }
  }

  return true;
}

function permissionRow(
  permission: Permission,
  overrides: Partial<UserPermission> = {},
): UserPermission {
  return {
    permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
    ...overrides,
  };
}

function propsWith(
  permissions: Array<UserPermission>,
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
        permissions: permissions,
        _type: "UserTenantAccessPermission",
      },
    },
    userTeamIds: [],
  };
}

// Edit + Read Database, both scoped to one label: a team's own databases.
function labelScopedEditorProps(
  labelId: string,
): DatabaseCommonInteractionProps {
  return propsWith([
    permissionRow(Permission.EditDatabaseServer, {
      labelIds: [new ObjectID(labelId)],
      scope: PermissionScope.Labels,
    }),
    permissionRow(Permission.ReadDatabaseServer, {
      labelIds: [new ObjectID(labelId)],
      scope: PermissionScope.Labels,
    }),
  ]);
}

// Edit + Read Database, both only on databases the caller owns.
function ownedScopeEditorProps(): DatabaseCommonInteractionProps {
  return propsWith([
    permissionRow(Permission.EditDatabaseServer, {
      scope: PermissionScope.Owned,
    }),
    permissionRow(Permission.ReadDatabaseServer, {
      scope: PermissionScope.Owned,
    }),
  ]);
}

const LABEL_TEAM_A: string = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const LABEL_TEAM_B: string = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";

describe("DatabaseServerEndpointService - a person adding an alias (real create pipeline)", () => {
  let save: jest.Mock;
  let findParent: jest.SpyInstance;
  let findOwner: jest.SpyInstance;
  let databases: Array<FakeDatabase>;

  function addDatabase(
    overrides: {
      id?: ObjectID;
      projectId?: ObjectID;
      name?: string;
      labelIds?: Array<string>;
      dbSystem?: string;
      kubernetesNamespace?: string;
      clusterIdentifier?: string;
    } = {},
  ): FakeDatabase {
    const row: DatabaseServer = parentDatabase({
      dbSystem: overrides.dbSystem,
      kubernetesNamespace: overrides.kubernetesNamespace,
      clusterIdentifier: overrides.clusterIdentifier,
    });
    row._id = (overrides.id || DATABASE_ID).toString();
    row.projectId = overrides.projectId || PROJECT_ID;
    row.name = overrides.name || "PostgreSQL orders-db.example.com:5432";
    const database: FakeDatabase = {
      row: row,
      labelIds: overrides.labelIds || [],
    };
    databases = databases.filter((item: FakeDatabase) => {
      return item.row.id!.toString() !== row.id!.toString();
    });
    databases.push(database);
    return database;
  }

  beforeEach(() => {
    databases = [];
    addDatabase();
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
    findParent.mockImplementation(async (findOneBy: any) => {
      let query: any = findOneBy.query;
      if (!findOneBy.props?.isRoot) {
        query = (
          await ModelPermission.checkReadQueryPermission(
            DatabaseServer,
            { ...findOneBy.query },
            findOneBy.select || null,
            findOneBy.props,
          )
        ).query;
      }
      const found: FakeDatabase | undefined = databases.find(
        (database: FakeDatabase) => {
          return fakeRowMatches(database, query);
        },
      );
      return found ? found.row : null;
    });
    findOwner = getJestSpyOn(service, "findOwnerByEndpoint");
    findOwner.mockResolvedValue(null);
  });

  test("canonicalizes what was typed and forces a removable user alias", async () => {
    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest(" Orders-DB.Example.com. ", {
          // Whatever the caller claims, a person only adds a removable alias.
          isPrimary: true,
          source: "auto",
        }),
        props: memberProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(created.endpoint).toBe("orders-db.example.com:5432");
    expect(created.isPrimary).toBe(false);
    expect(created.source).toBe("user");
    expect(created.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(created.databaseServerId!.toString()).toBe(DATABASE_ID.toString());
    expect(created.createdByUserId!.toString()).toBe(USER_ID.toString());

    // Ownership was checked against the canonical form, in the caller's project.
    expect(findOwner).toHaveBeenCalledWith(
      PROJECT_ID,
      "orders-db.example.com:5432",
    );
  });

  test("an explicit port is kept, the engine default fills a missing one", async () => {
    addDatabase({ dbSystem: "mysql" });

    const withPort: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com:3307"),
        props: memberProps(),
      });
    const withoutPort: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: memberProps(),
      });

    expect(withPort.endpoint).toBe("orders-db.example.com:3307");
    expect(withoutPort.endpoint).toBe("orders-db.example.com:3306");
  });

  test("a bare service name on a Kubernetes database expands in its namespace and cluster", async () => {
    addDatabase({
      kubernetesNamespace: "data",
      clusterIdentifier: "prod-cluster",
    });

    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db"),
        props: memberProps(),
      });

    expect(created.endpoint).toBe(
      "orders-db.data.svc.cluster.local:5432@prod-cluster",
    );
  });

  test("reads the parent as root, through the caller's EDIT scope, pinned to the caller's project", async () => {
    await DatabaseServerEndpointService.create({
      data: aliasRequest("orders-db.example.com"),
      props: memberProps(),
    });

    const call: any = findParent.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true });
    expect(operatorValues(call.query._id)).toEqual([DATABASE_ID.toString()]);
    expect(operatorValues(call.query.projectId)).toEqual([
      PROJECT_ID.toString(),
    ]);
    expect(call.select.kubernetesCluster).toEqual({ clusterIdentifier: true });
  });

  test("a database in another project is refused, and nothing is written", async () => {
    addDatabase({ projectId: OTHER_PROJECT_ID });

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "Database not found, or you do not have permission to edit it.",
    );
    expect(save).not.toHaveBeenCalled();
    expect(findOwner).not.toHaveBeenCalled();
  });

  test("an alias without a database is refused", async () => {
    const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    data.endpoint = "orders-db.example.com";

    await expect(
      DatabaseServerEndpointService.create({ data, props: memberProps() }),
    ).rejects.toThrow("Select the database this endpoint belongs to.");
    expect(save).not.toHaveBeenCalled();
  });

  /*
   * TypeORM persists a relation object's id over the FK column's, so the
   * relation object must be validated exactly like the column.
   */
  describe("the database reference", () => {
    test("a relation object pointing elsewhere than the FK column is refused", async () => {
      addDatabase({ id: OTHER_DATABASE_ID, projectId: OTHER_PROJECT_ID });
      const foreign: DatabaseServer = new DatabaseServer(OTHER_DATABASE_ID);

      await expect(
        DatabaseServerEndpointService.create({
          data: aliasRequest("orders-db.example.com", {
            databaseServer: foreign,
          }),
          props: memberProps(),
        }),
      ).rejects.toThrow("Conflicting database references were provided.");
      expect(save).not.toHaveBeenCalled();
      expect(findParent).not.toHaveBeenCalled();
    });

    test("a relation object alone is validated like the FK column: another project's database is refused", async () => {
      addDatabase({ id: OTHER_DATABASE_ID, projectId: OTHER_PROJECT_ID });
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.endpoint = "orders-db.example.com";
      data.databaseServer = new DatabaseServer(OTHER_DATABASE_ID);

      await expect(
        DatabaseServerEndpointService.create({ data, props: memberProps() }),
      ).rejects.toThrow(
        "Database not found, or you do not have permission to edit it.",
      );
      expect(save).not.toHaveBeenCalled();
    });

    test("a relation object alone for the caller's own database becomes the FK column - and only that reaches the insert", async () => {
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.endpoint = "orders-db.example.com";
      data.databaseServer = new DatabaseServer(DATABASE_ID);

      await DatabaseServerEndpointService.create({
        data,
        props: memberProps(),
      });

      expect(save).toHaveBeenCalledTimes(1);
      const saved: any = save.mock.calls[0]![0];
      expect(saved.databaseServerId.toString()).toBe(DATABASE_ID.toString());
      expect(saved.databaseServer).toBeUndefined();
    });

    test("a relation object that agrees with the FK column is dropped, the validated column kept", async () => {
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com", {
          databaseServer: new DatabaseServer(DATABASE_ID),
        }),
        props: memberProps(),
      });

      const saved: any = save.mock.calls[0]![0];
      expect(saved.databaseServerId.toString()).toBe(DATABASE_ID.toString());
      expect(saved.databaseServer).toBeUndefined();
    });
  });

  /*
   * Adding an endpoint decides which traffic a database's pages show, and
   * that no other database can claim it: it is an edit of that database, so
   * a label- or Owned-scoped editor may only do it on the rows they edit.
   */
  describe("scoped edit permission", () => {
    test("an editor scoped to label A adds an alias to a database labelled A", async () => {
      addDatabase({ labelIds: [LABEL_TEAM_A] });

      const created: DatabaseServerEndpoint =
        await DatabaseServerEndpointService.create({
          data: aliasRequest("orders-db.example.com"),
          props: labelScopedEditorProps(LABEL_TEAM_A),
        });

      expect(save).toHaveBeenCalledTimes(1);
      expect(created.databaseServerId!.toString()).toBe(DATABASE_ID.toString());
    });

    test("an editor scoped to label A cannot add an alias to a database labelled only B", async () => {
      addDatabase({ labelIds: [LABEL_TEAM_B] });

      const error: unknown = await DatabaseServerEndpointService.create({
        data: aliasRequest("payments-db.example.com"),
        props: labelScopedEditorProps(LABEL_TEAM_A),
      }).catch((e: unknown) => {
        return e;
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(
        "Database not found, or you do not have permission to edit it. Adding an endpoint to a database needs permission to edit that database.",
      );
      expect(save).not.toHaveBeenCalled();
      // Refused before anything about the endpoint's owner is looked up.
      expect(findOwner).not.toHaveBeenCalled();
    });

    test("an unlabelled database is outside a label-scoped editor's reach", async () => {
      addDatabase({ labelIds: [] });

      await expect(
        DatabaseServerEndpointService.create({
          data: aliasRequest("orders-db.example.com"),
          props: labelScopedEditorProps(LABEL_TEAM_A),
        }),
      ).rejects.toThrow("Database not found, or you do not have permission");
      expect(save).not.toHaveBeenCalled();
    });

    test("an Owned-scoped editor adds an alias to a database they own", async () => {
      const allowed: jest.SpyInstance = jest
        .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
        .mockResolvedValue([DATABASE_ID]);

      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: ownedScopeEditorProps(),
      });

      expect(allowed).toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(1);
    });

    test("an Owned-scoped editor cannot add an alias to a database they do not own", async () => {
      jest
        .spyOn(OwnedScopePermission as any, "getAllowedResourceIds")
        .mockResolvedValue([OTHER_DATABASE_ID]);

      await expect(
        DatabaseServerEndpointService.create({
          data: aliasRequest("orders-db.example.com"),
          props: ownedScopeEditorProps(),
        }),
      ).rejects.toThrow("Database not found, or you do not have permission");
      expect(save).not.toHaveBeenCalled();
      expect(findOwner).not.toHaveBeenCalled();
    });

    test("a Viewer is refused by the permission check before any lookup", async () => {
      const error: unknown = await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: memberProps([Permission.Viewer]),
      }).catch((e: unknown) => {
        return e;
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      // Neither "Database not found" nor an owner's name: nothing to probe with.
      expect((error as Error).message).not.toContain("Database not found");
      expect(findParent).not.toHaveBeenCalled();
      expect(findOwner).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    test("an endpoint owned by a database the scoped caller can read names it", async () => {
      addDatabase({ labelIds: [LABEL_TEAM_A] });
      addDatabase({
        id: OTHER_DATABASE_ID,
        name: "PostgreSQL payments (team A)",
        labelIds: [LABEL_TEAM_A],
      });
      findOwner.mockResolvedValue(owner(OTHER_DATABASE_ID, true));

      await expect(
        DatabaseServerEndpointService.create({
          data: aliasRequest("orders-db.example.com"),
          props: labelScopedEditorProps(LABEL_TEAM_A),
        }),
      ).rejects.toThrow(
        'orders-db.example.com:5432 already belongs to the database "PostgreSQL payments (team A)".',
      );
    });

    test("an endpoint owned by a database the scoped caller cannot read does not reveal its name", async () => {
      addDatabase({ labelIds: [LABEL_TEAM_A] });
      addDatabase({
        id: OTHER_DATABASE_ID,
        name: "PostgreSQL payments (team B)",
        labelIds: [LABEL_TEAM_B],
      });
      findOwner.mockResolvedValue(owner(OTHER_DATABASE_ID, true));

      const error: unknown = await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: labelScopedEditorProps(LABEL_TEAM_A),
      }).catch((e: unknown) => {
        return e;
      });

      expect((error as Error).message).toContain(
        "orders-db.example.com:5432 already belongs to another database.",
      );
      expect((error as Error).message).not.toContain("team B");
      expect(save).not.toHaveBeenCalled();
    });
  });

  /*
   * Every refusal says what to change. The example is a public name:
   * `.internal` names are network-scoped now, so they are no longer the
   * example of an address that works everywhere.
   */
  test.each([
    [
      "an empty value",
      "",
      "Endpoint is required. Enter the host name or IP address applications use to reach this database, with an optional port, for example orders-db.example.com:5432.",
    ],
    [
      "a blank value",
      "   ",
      "Endpoint is required. Enter the host name or IP address applications use to reach this database, with an optional port, for example orders-db.example.com:5432.",
    ],
    [
      "localhost",
      "localhost:5432",
      '"localhost:5432" is a loopback or host-local address, such as localhost or host.docker.internal. Every application reaches its own, so it cannot identify one database.',
    ],
    ["a loopback IP", "127.0.0.1", '"127.0.0.1" is a loopback or host-local'],
    [
      "a host-relative name",
      "host.minikube.internal:5432",
      '"host.minikube.internal:5432" is a loopback or host-local',
    ],
    [
      "something that is not an address",
      "orders db",
      '"orders db" is not a valid host[:port] endpoint. Enter a host name or IP address with an optional port, for example orders-db.example.com:5432.',
    ],
    [
      "user@host (psql habit)",
      "admin@10.0.0.5:5432",
      '"admin@10.0.0.5:5432" looks like user@host. Remove "admin@": the database user does not belong in an endpoint.',
    ],
    [
      "a dotted user name before a public host",
      "john.doe@orders-db.example.com",
      'Remove "john.doe@"',
    ],
    [
      "a cluster qualifier on a public host",
      "orders-db.example.com@prod",
      '"orders-db.example.com" resolves the same way everywhere, so it cannot take a Kubernetes cluster qualifier. Remove "@prod".',
    ],
  ])(
    "refuses %s with a message saying what to change",
    async (_label: string, value: string, message: string) => {
      const error: unknown = await DatabaseServerEndpointService.create({
        data: aliasRequest(value),
        props: memberProps(),
      }).catch((e: unknown) => {
        return e;
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(message);
      expect((error as Error).message).not.toContain("orders-db.internal");
      expect(save).not.toHaveBeenCalled();
      expect(findOwner).not.toHaveBeenCalled();
    },
  );

  /*
   * A port a person typed is kept or refused - never read as "no port" and
   * quietly replaced by the engine default, which is right for telemetry
   * and wrong for a typed value.
   */
  test.each([
    ["orders-db.example.com:99999"],
    ["orders-db.example.com:0"],
    ["orders-db.example.com:65536"],
    ["[2001:db8::1]:70000"],
    ["pg.shop.svc.cluster.local:70000@prod"],
    ["postgresql://app@orders-db.example.com:99999/orders"],
  ])("refuses the out-of-range port in %s", async (value: string) => {
    const error: unknown = await DatabaseServerEndpointService.create({
      data: aliasRequest(value),
      props: memberProps(),
    }).catch((e: unknown) => {
      return e;
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "has a port outside 1-65535. Enter a port between 1 and 65535.",
    );
    expect(save).not.toHaveBeenCalled();
  });

  test.each([
    ["orders-db.example.com:65535", "orders-db.example.com:65535"],
    ["orders-db.example.com:1", "orders-db.example.com:1"],
    ["[2001:db8::1]:5432", "[2001:db8::1]:5432"],
    // A bare IPv6 address carries no port: the engine default fills it.
    ["2001:db8::1", "[2001:db8::1]:5432"],
    [
      "postgresql://app:secret@orders-db.example.com:6432/orders",
      "orders-db.example.com:6432",
    ],
    [
      "pg.shop.svc.cluster.local:6432@prod",
      "pg.shop.svc.cluster.local:6432@prod",
    ],
  ])("keeps the port typed in %s", async (value: string, expected: string) => {
    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest(value),
        props: memberProps(),
      });

    expect(created.endpoint).toBe(expected);
  });

  test("`<service>.<namespace>` on a Kubernetes database is the Service's full name in its cluster", async () => {
    addDatabase({
      kubernetesNamespace: "data",
      clusterIdentifier: "prod-cluster",
    });

    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.billing:5433"),
        props: memberProps(),
      });

    expect(created.endpoint).toBe(
      "orders-db.billing.svc.cluster.local:5433@prod-cluster",
    );
  });

  test("a cluster-local name typed on a Kubernetes database is qualified with its cluster", async () => {
    addDatabase({
      kubernetesNamespace: "data",
      clusterIdentifier: "prod-cluster",
    });

    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("10.0.4.12"),
        props: memberProps(),
      });

    expect(created.endpoint).toBe("10.0.4.12:5432@prod-cluster");
  });

  /*
   * The manual-create form refuses an unqualified Kubernetes Service name in
   * a project with clusters and suggests adding it here as well: an alias
   * is the explicit way to also match a Database Agent or applications that
   * do not report their cluster.
   */
  test("an unqualified cluster-local alias on a database outside Kubernetes is kept as typed", async () => {
    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("pg.shop.svc.cluster.local"),
        props: memberProps(),
      });

    expect(created.endpoint).toBe("pg.shop.svc.cluster.local:5432");
  });

  test("a SQL Server named instance alias keeps its instance and gets no default port", async () => {
    addDatabase({ dbSystem: "mssql" });

    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("SQL1.corp.example.com\\INST01"),
        props: memberProps(),
      });

    expect(created.endpoint).toBe("sql1.corp.example.com\\inst01");
  });

  test("an endpoint another database owns is refused, naming that database", async () => {
    addDatabase({
      id: OTHER_DATABASE_ID,
      name: "PostgreSQL payments-db.example.com:5432",
    });
    findOwner.mockResolvedValue(owner(OTHER_DATABASE_ID, true));

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      'orders-db.example.com:5432 already belongs to the database "PostgreSQL payments-db.example.com:5432". An endpoint can belong to only one database in a project - remove it from that database first.',
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("a nameless owner still produces a readable refusal", async () => {
    findOwner.mockResolvedValue(owner(OTHER_DATABASE_ID));
    getJestSpyOn(
      DatabaseServerService,
      "getDatabaseServerNameIfReadable",
    ).mockRejectedValue(new Error("row gone"));

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "orders-db.example.com:5432 already belongs to another database.",
    );
  });

  test("an endpoint this database already lists is refused as a duplicate", async () => {
    findOwner.mockResolvedValue(owner(DATABASE_ID));

    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("ORDERS-DB.example.com:5432"),
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "orders-db.example.com:5432 is already an endpoint of this database.",
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
        data: aliasRequest("orders-db.example.com", {
          lastMatchedAt: new Date(),
        }),
        props: memberProps(),
      }),
    ).rejects.toThrow("lastMatchedAt");
    expect(save).not.toHaveBeenCalled();
    // The column check now runs before the hook reads anything.
    expect(findParent).not.toHaveBeenCalled();
  });

  test("a caller without edit permission on databases cannot add one", async () => {
    await expect(
      DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com"),
        props: memberProps([Permission.ReadDatabaseServer]),
      }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(findParent).not.toHaveBeenCalled();
  });

  test("a root create passes through untouched - discovery owns its own canonical form", async () => {
    const created: DatabaseServerEndpoint =
      await DatabaseServerEndpointService.create({
        data: aliasRequest("orders-db.example.com:5432", {
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
    primary.endpoint = "orders-db.example.com:5432";
    findBy.mockResolvedValue([primary]);

    await expect(
      DatabaseServerEndpointService.deleteBy({
        query: { _id: ObjectID.generate().toString() },
        limit: 1,
        skip: 0,
        props: memberProps(),
      }),
    ).rejects.toThrow(
      "orders-db.example.com:5432 is the primary endpoint of this database and cannot be removed.",
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

/*
 * ---------------------------------------------------------------------------
 * The alias lifecycle: "last matched" kept honest, discovered endpoints moved
 * or released - never a person's.
 * ---------------------------------------------------------------------------
 */
describe("DatabaseServerEndpointService - endpoint lifecycle", () => {
  const ENDPOINT_ID: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );
  const HOUR_MS: number = 60 * 60 * 1000;

  function ownerRow(
    overrides: Partial<DatabaseServerEndpointOwner> = {},
  ): DatabaseServerEndpointOwner {
    return {
      databaseServerId: DATABASE_ID,
      isPrimary: false,
      endpointId: ENDPOINT_ID,
      source: "auto",
      lastMatchedAt: new Date(Date.now() - 2 * HOUR_MS),
      ...overrides,
    };
  }

  function mockRawQuery(result: unknown = []): jest.Mock {
    const query: jest.Mock = jest.fn(async () => {
      return result;
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      manager: { query },
    } as never);
    return query;
  }

  describe("findOwnerByEndpoint", () => {
    test("returns the endpoint row itself: id, source and when it last matched", async () => {
      const row: DatabaseServerEndpoint = new DatabaseServerEndpoint(
        ENDPOINT_ID,
      );
      const lastMatchedAt: Date = new Date("2026-09-01T10:00:00Z");
      row.databaseServerId = DATABASE_ID;
      row.isPrimary = false;
      row.source = "workload";
      row.lastMatchedAt = lastMatchedAt;
      const findOneBy: jest.SpyInstance = getJestSpyOn(
        service,
        "findOneBy",
      ).mockResolvedValue(row);

      const result: DatabaseServerEndpointOwner | null =
        await DatabaseServerEndpointService.findOwnerByEndpoint(
          PROJECT_ID,
          "orders-db.example.com:5432",
        );

      expect(result!.endpointId!.toString()).toBe(ENDPOINT_ID.toString());
      expect(result!.source).toBe("workload");
      expect(result!.lastMatchedAt).toBe(lastMatchedAt);
      expect(findOneBy.mock.calls[0]![0].select).toMatchObject({
        source: true,
        lastMatchedAt: true,
      });
    });
  });

  describe("markEndpointMatched", () => {
    let write: jest.SpyInstance;

    beforeEach(() => {
      write = getJestSpyOn(
        service,
        "updateColumnsByIdWithoutHooks",
      ).mockResolvedValue(undefined);
    });

    test("a match after more than an hour moves lastMatchedAt to now, without bumping updatedAt", async () => {
      const matched: DatabaseServerEndpointOwner = ownerRow();
      const before: number = Date.now();

      await DatabaseServerEndpointService.markEndpointMatched(matched);

      expect(write).toHaveBeenCalledTimes(1);
      const call: any = write.mock.calls[0]![0];
      expect(call.id).toBe(ENDPOINT_ID);
      expect(call.skipUpdateDateColumn).toBe(true);
      expect(
        (call.data.lastMatchedAt as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);
      // The caller's copy is refreshed too, so a second call is free.
      await DatabaseServerEndpointService.markEndpointMatched(matched);
      expect(write).toHaveBeenCalledTimes(1);
    });

    test("an endpoint never matched since it was added (a person's alias) gets its first match", async () => {
      await DatabaseServerEndpointService.markEndpointMatched(
        ownerRow({ source: "user", lastMatchedAt: undefined }),
      );

      expect(write).toHaveBeenCalledTimes(1);
    });

    test("a match within the hour costs no write", async () => {
      await DatabaseServerEndpointService.markEndpointMatched(
        ownerRow({ lastMatchedAt: new Date(Date.now() - 10 * 60 * 1000) }),
      );

      expect(write).not.toHaveBeenCalled();
    });

    test("a workload alias is left to discovery: its lastMatchedAt says when the workload last produced it", async () => {
      await DatabaseServerEndpointService.markEndpointMatched(
        ownerRow({ source: "workload", lastMatchedAt: undefined }),
      );

      expect(write).not.toHaveBeenCalled();
    });

    test("nothing to write without the endpoint row's id", async () => {
      await DatabaseServerEndpointService.markEndpointMatched(
        owner(DATABASE_ID),
      );
      await DatabaseServerEndpointService.markEndpointMatched(null);

      expect(write).not.toHaveBeenCalled();
    });

    test("a failing write is logged, never thrown", async () => {
      write.mockRejectedValue(new Error("connection terminated"));
      const warn: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation(() => {
          return undefined as never;
        });

      await expect(
        DatabaseServerEndpointService.markEndpointMatched(ownerRow()),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });

  describe("claimEndpoint re-reported by its owner", () => {
    test("records the match instead of writing the endpoint again", async () => {
      const existing: DatabaseServerEndpointOwner = ownerRow();
      getJestSpyOn(service, "findOwnerByEndpoint").mockResolvedValue(existing);
      const create: jest.SpyInstance = getJestSpyOn(service, "create");
      const mark: jest.SpyInstance = getJestSpyOn(
        service,
        "markEndpointMatched",
      ).mockResolvedValue(undefined);

      await expect(
        DatabaseServerEndpointService.claimEndpoint({
          projectId: PROJECT_ID,
          databaseServerId: DATABASE_ID,
          endpoint: "orders-db.example.com:5432",
          isPrimary: false,
          source: "auto",
        }),
      ).resolves.toBe("already-owned-by-this");
      expect(mark).toHaveBeenCalledWith(existing);
      expect(create).not.toHaveBeenCalled();
    });

    test("an endpoint another database owns is not marked for the claimant", async () => {
      getJestSpyOn(service, "findOwnerByEndpoint").mockResolvedValue(
        ownerRow({ databaseServerId: OTHER_DATABASE_ID }),
      );
      const mark: jest.SpyInstance = getJestSpyOn(
        service,
        "markEndpointMatched",
      ).mockResolvedValue(undefined);

      await expect(
        DatabaseServerEndpointService.claimEndpoint({
          projectId: PROJECT_ID,
          databaseServerId: DATABASE_ID,
          endpoint: "orders-db.example.com:5432",
          isPrimary: false,
          source: "auto",
        }),
      ).resolves.toBe("owned-by-other");
      expect(mark).not.toHaveBeenCalled();
    });
  });

  describe("refreshMatchedEndpoints", () => {
    test("one statement, only for this database's stale endpoints among those given", async () => {
      const query: jest.Mock = mockRawQuery([]);
      const now: Date = new Date("2026-09-24T12:00:00Z");
      const staleBefore: Date = new Date("2026-09-24T11:00:00Z");

      await DatabaseServerEndpointService.refreshMatchedEndpoints({
        projectId: PROJECT_ID,
        databaseServerId: DATABASE_ID,
        endpoints: ["a.example.com:5432", "b.example.com:5432"],
        now: now,
        staleBefore: staleBefore,
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      expect(sql).toContain(`UPDATE "DatabaseServerEndpoint"`);
      expect(sql).toContain(`SET "lastMatchedAt" = $1`);
      expect(sql).toContain(`"projectId" = $2`);
      expect(sql).toContain(`"databaseServerId" = $3`);
      expect(sql).toContain(`"endpoint" = ANY($4::text[])`);
      expect(sql).toContain(
        `("lastMatchedAt" IS NULL OR "lastMatchedAt" < $5)`,
      );
      expect(sql).not.toContain(`"updatedAt"`);
      expect(params).toEqual([
        now,
        PROJECT_ID.toString(),
        DATABASE_ID.toString(),
        ["a.example.com:5432", "b.example.com:5432"],
        staleBefore,
      ]);
    });

    test("no endpoints, no statement", async () => {
      const query: jest.Mock = mockRawQuery([]);

      await DatabaseServerEndpointService.refreshMatchedEndpoints({
        projectId: PROJECT_ID,
        databaseServerId: DATABASE_ID,
        endpoints: [],
        now: new Date(),
        staleBefore: new Date(),
      });

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("transferEndpoint", () => {
    test("moves a discovered endpoint with a compare-and-set on its owner - never a person's", async () => {
      const query: jest.Mock = mockRawQuery([{ _id: ENDPOINT_ID.toString() }]);
      const now: Date = new Date();

      await expect(
        DatabaseServerEndpointService.transferEndpoint({
          projectId: PROJECT_ID,
          endpointId: ENDPOINT_ID,
          fromDatabaseServerId: OTHER_DATABASE_ID,
          toDatabaseServerId: DATABASE_ID,
          isPrimary: true,
          now: now,
        }),
      ).resolves.toBe(true);

      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      expect(sql).toContain(`SET "databaseServerId" = $1`);
      expect(sql).toContain(`"source" = 'workload'`);
      expect(sql).toContain(`"isPrimary" = $2`);
      expect(sql).toContain(`"lastMatchedAt" = $3`);
      expect(sql).toContain(`WHERE "_id" = $4`);
      expect(sql).toContain(`"projectId" = $5`);
      expect(sql).toContain(`"databaseServerId" = $6`);
      expect(sql).toContain(`COALESCE("source", '') <> 'user'`);
      expect(sql).toContain(`RETURNING "_id"`);
      /*
       * A top-level SELECT over the UPDATE: TypeORM answers a bare UPDATE
       * with [rows, rowCount], which would always read as "moved".
       */
      expect(sql.trim().startsWith(`WITH "moved" AS (`)).toBe(true);
      expect(sql).toContain(`SELECT "_id" FROM "moved"`);
      expect(params).toEqual([
        DATABASE_ID.toString(),
        true,
        now,
        ENDPOINT_ID.toString(),
        PROJECT_ID.toString(),
        OTHER_DATABASE_ID.toString(),
      ]);
    });

    test("a lost compare-and-set (moved or re-owned meanwhile) answers false", async () => {
      mockRawQuery([]);

      await expect(
        DatabaseServerEndpointService.transferEndpoint({
          projectId: PROJECT_ID,
          endpointId: ENDPOINT_ID,
          fromDatabaseServerId: OTHER_DATABASE_ID,
          toDatabaseServerId: DATABASE_ID,
          isPrimary: false,
          now: new Date(),
        }),
      ).resolves.toBe(false);
    });
  });

  describe("releaseUnproducedWorkloadEndpoints", () => {
    test("deletes only this database's stale non-primary workload aliases outside the kept set", async () => {
      const query: jest.Mock = mockRawQuery([
        { endpoint: "redis.cache.svc.cluster.local:6379" },
      ]);
      const staleBefore: Date = new Date("2026-09-24T10:00:00Z");

      await expect(
        DatabaseServerEndpointService.releaseUnproducedWorkloadEndpoints({
          projectId: PROJECT_ID,
          databaseServerId: DATABASE_ID,
          keepEndpoints: ["redis.cache.svc.cluster.local:6379@prod"],
          staleBefore: staleBefore,
        }),
      ).resolves.toEqual(["redis.cache.svc.cluster.local:6379"]);

      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
      expect(sql).toContain(`DELETE FROM "DatabaseServerEndpoint"`);
      expect(sql.trim().startsWith(`WITH "released" AS (`)).toBe(true);
      expect(sql).toContain(`SELECT "endpoint" FROM "released"`);
      expect(sql).toContain(`"projectId" = $1`);
      expect(sql).toContain(`"databaseServerId" = $2`);
      expect(sql).toContain(`"source" = 'workload'`);
      expect(sql).toContain(`"isPrimary" = false`);
      expect(sql).toContain(`NOT ("endpoint" = ANY($3::text[]))`);
      expect(sql).toContain(
        `("lastMatchedAt" IS NULL OR "lastMatchedAt" < $4)`,
      );
      expect(params).toEqual([
        PROJECT_ID.toString(),
        DATABASE_ID.toString(),
        ["redis.cache.svc.cluster.local:6379@prod"],
        staleBefore,
      ]);
    });

    test("an unexpected driver answer releases nothing", async () => {
      mockRawQuery(undefined);

      await expect(
        DatabaseServerEndpointService.releaseUnproducedWorkloadEndpoints({
          projectId: PROJECT_ID,
          databaseServerId: DATABASE_ID,
          keepEndpoints: [],
          staleBefore: new Date(),
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("hasPrimaryEndpoint", () => {
    test("asks for a primary endpoint of this database in this project, as root", async () => {
      const findOneBy: jest.SpyInstance = getJestSpyOn(
        service,
        "findOneBy",
      ).mockResolvedValue(new DatabaseServerEndpoint());

      await expect(
        DatabaseServerEndpointService.hasPrimaryEndpoint({
          projectId: PROJECT_ID,
          databaseServerId: DATABASE_ID,
        }),
      ).resolves.toBe(true);

      const call: any = findOneBy.mock.calls[0]![0];
      expect(call.query).toEqual({
        projectId: PROJECT_ID,
        databaseServerId: DATABASE_ID,
        isPrimary: true,
      });
      expect(call.props).toEqual({ isRoot: true });
    });

    test("false when it has none", async () => {
      getJestSpyOn(service, "findOneBy").mockResolvedValue(null);

      await expect(
        DatabaseServerEndpointService.hasPrimaryEndpoint({
          projectId: PROJECT_ID,
          databaseServerId: DATABASE_ID,
        }),
      ).resolves.toBe(false);
    });
  });
});

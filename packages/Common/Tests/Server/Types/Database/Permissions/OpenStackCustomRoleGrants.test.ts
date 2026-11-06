import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import OpenStackCloud from "../../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudFeed from "../../../../../Models/DatabaseModels/OpenStackCloudFeed";
import OpenStackCloudLabelRule from "../../../../../Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "../../../../../Models/DatabaseModels/OpenStackCloudOwnerRule";
import OpenStackCloudOwnerTeam from "../../../../../Models/DatabaseModels/OpenStackCloudOwnerTeam";
import OpenStackCloudOwnerUser from "../../../../../Models/DatabaseModels/OpenStackCloudOwnerUser";
import OpenStackResource from "../../../../../Models/DatabaseModels/OpenStackResource";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackResourceAPI from "../../../../../Server/API/OpenStackResourceAPI";
import OpenStackCloudService from "../../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../../Server/Services/OpenStackResourceService";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import CommonAPI from "../../../../../Server/API/CommonAPI";
import Response from "../../../../../Server/Utils/Response";
import Query from "../../../../../Types/BaseDatabase/Query";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../../../Types/Permission";

/*
 * A custom role, down to the server: what someone may do in the OpenStack product follows from
 * the permissions their role holds and from nothing else. These run the real gates of the
 * database layer on the real models' lists, as a request's own props reach them, and only what
 * would touch a database is replaced. OpenStackProductArea.spec.ts walks the same two roles
 * through the pages.
 */
const PROJECT_ID: ObjectID = ObjectID.generate();
// The project filter every read carries, for a table the test only knows as a model type.
const PROJECT_QUERY: Query<BaseModel> = {
  projectId: PROJECT_ID,
} as Query<BaseModel>;
const USER_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();

function propsHolding(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTeamIds: [],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              scope: PermissionScope.All,
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

interface Table {
  name: string;
  modelType: DatabaseBaseModelType;
  read: Permission;
  create?: Permission | undefined;
  edit?: Permission | undefined;
  remove?: Permission | undefined;
}

const TABLES: ReadonlyArray<Table> = [
  {
    name: "OpenStackCloud",
    modelType: OpenStackCloud,
    read: Permission.ReadOpenStackCloud,
    create: Permission.CreateOpenStackCloud,
    edit: Permission.EditOpenStackCloud,
    remove: Permission.DeleteOpenStackCloud,
  },
  {
    name: "OpenStackCloudFeed",
    modelType: OpenStackCloudFeed,
    read: Permission.ReadOpenStackCloudFeed,
    create: Permission.CreateOpenStackCloudFeed,
  },
  {
    name: "OpenStackCloudOwnerUser",
    modelType: OpenStackCloudOwnerUser,
    read: Permission.ReadOpenStackCloudOwnerUser,
    create: Permission.CreateOpenStackCloudOwnerUser,
    edit: Permission.EditOpenStackCloudOwnerUser,
    remove: Permission.DeleteOpenStackCloudOwnerUser,
  },
  {
    name: "OpenStackCloudOwnerTeam",
    modelType: OpenStackCloudOwnerTeam,
    read: Permission.ReadOpenStackCloudOwnerTeam,
    create: Permission.CreateOpenStackCloudOwnerTeam,
    edit: Permission.EditOpenStackCloudOwnerTeam,
    remove: Permission.DeleteOpenStackCloudOwnerTeam,
  },
  {
    name: "OpenStackCloudOwnerRule",
    modelType: OpenStackCloudOwnerRule,
    read: Permission.ReadOpenStackCloudOwnerRule,
    create: Permission.CreateOpenStackCloudOwnerRule,
    edit: Permission.EditOpenStackCloudOwnerRule,
    remove: Permission.DeleteOpenStackCloudOwnerRule,
  },
  {
    name: "OpenStackCloudLabelRule",
    modelType: OpenStackCloudLabelRule,
    read: Permission.ReadOpenStackCloudLabelRule,
    create: Permission.CreateOpenStackCloudLabelRule,
    edit: Permission.EditOpenStackCloudLabelRule,
    remove: Permission.DeleteOpenStackCloudLabelRule,
  },
];

// Everything the product's own tables take: what a role holding "the read ones" holds.
const EVERY_READ: Array<Permission> = TABLES.map((table: Table): Permission => {
  return table.read;
});

const READ_ROLE: DatabaseCommonInteractionProps = propsHolding(EVERY_READ);
// @CanAccessIfCanReadOn("openStackCloud"): their rows belong to a cloud someone can see.
const READ_THROUGH_THE_CLOUD: Set<string> = new Set([
  "OpenStackCloudFeed",
  "OpenStackCloudOwnerUser",
  "OpenStackCloudOwnerTeam",
]);
const NO_ROLE: DatabaseCommonInteractionProps = propsHolding([]);
// A role for some other product, which must open none of this.
const OTHER_ROLE: DatabaseCommonInteractionProps = propsHolding([
  Permission.ReadProxmoxCluster,
  Permission.ReadVMwareVCenter,
]);

describe("the feed", () => {
  test("is written by the server alone once created: no role edits or deletes a line of it", () => {
    const feed: OpenStackCloudFeed = new OpenStackCloudFeed();
    expect(feed.getUpdatePermissions()).toEqual([]);
    expect(feed.getDeletePermissions()).toEqual([]);
  });
});

describe("what a custom role can be granted", () => {
  const grantable: Map<Permission, PermissionProps> = new Map(
    PermissionHelper.getTenantPermissionProps().map(
      (props: PermissionProps): [Permission, PermissionProps] => {
        return [props.permission, props];
      },
    ),
  );

  test.each(
    Object.values(Permission).filter((permission: Permission): boolean => {
      return permission.includes("OpenStack");
    }),
  )(
    "%s is offered, with a title and a line that say what it is",
    (permission: Permission) => {
      const props: PermissionProps | undefined = grantable.get(permission);
      expect(props).toBeDefined();
      expect(props?.isAssignableToTenant).toBe(true);
      expect(props?.title).toContain("OpenStack");
      expect(props?.description).toContain("OpenStack");
    },
  );

  test("every permission a table names is one of them, so none can be missed on a role", () => {
    for (const table of TABLES) {
      for (const permission of [
        table.read,
        table.create,
        table.edit,
        table.remove,
      ]) {
        if (permission) {
          expect(grantable.has(permission)).toBe(true);
        }
      }
    }
  });
});

describe.each(TABLES)("$name", (table: Table) => {
  const model: BaseModel = new table.modelType();

  test("its lists name its own permissions", () => {
    expect(model.getReadPermissions()).toContain(table.read);
    if (table.create) {
      expect(model.getCreatePermissions()).toContain(table.create);
    }
    if (table.edit) {
      expect(model.getUpdatePermissions()).toContain(table.edit);
    }
    if (table.remove) {
      expect(model.getDeletePermissions()).toContain(table.remove);
    }
  });

  test("a role with the read permissions reads it", async () => {
    await expect(
      ModelPermission.checkReadQueryPermission(
        table.modelType,
        PROJECT_QUERY,
        { _id: true },
        READ_ROLE,
      ),
    ).resolves.toBeDefined();
  });

  test("a table read through its cloud takes the cloud's read too, and says so", async () => {
    if (!READ_THROUGH_THE_CLOUD.has(table.name)) {
      return;
    }
    await expect(
      ModelPermission.checkReadQueryPermission(
        table.modelType,
        PROJECT_QUERY,
        { _id: true },
        propsHolding([table.read]),
      ),
    ).rejects.toThrow("It is read through its OpenStack Cloud");
    await expect(
      ModelPermission.checkReadQueryPermission(
        table.modelType,
        PROJECT_QUERY,
        { _id: true },
        propsHolding([table.read, Permission.ReadOpenStackCloud]),
      ),
    ).resolves.toBeDefined();
  });

  test("a role with none of it, or another product's, is refused", async () => {
    for (const props of [NO_ROLE, OTHER_ROLE]) {
      await expect(
        ModelPermission.checkReadQueryPermission(
          table.modelType,
          PROJECT_QUERY,
          { _id: true },
          props,
        ),
      ).rejects.toThrow(NotAuthorizedException);
    }
  });

  test("a role that only reads can't write it", () => {
    expect(() => {
      ModelPermission.checkCreatePermissions(
        table.modelType,
        new table.modelType(),
        READ_ROLE,
      );
    }).toThrow(NotAuthorizedException);
  });

  test("create takes create: granting it opens exactly that", () => {
    if (!table.create) {
      return;
    }
    expect(() => {
      ModelPermission.checkCreatePermissions(
        table.modelType,
        new table.modelType(),
        propsHolding([table.create as Permission]),
      );
    }).not.toThrow();
  });
});

describe("OpenStackResource, what the cloud's pages read", () => {
  test("takes the permission of the cloud it belongs to", async () => {
    expect(new OpenStackResource().getReadPermissions()).toContain(
      Permission.ReadOpenStackCloud,
    );
    await expect(
      ModelPermission.checkReadQueryPermission(
        OpenStackResource,
        { projectId: PROJECT_ID },
        { _id: true },
        propsHolding([Permission.ReadOpenStackCloud]),
      ),
    ).resolves.toBeDefined();
  });

  test("a role without it reads none of it", async () => {
    await expect(
      ModelPermission.checkReadQueryPermission(
        OpenStackResource,
        { projectId: PROJECT_ID },
        { _id: true },
        NO_ROLE,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("no role writes it: only ingest does, as root", () => {
    const resource: OpenStackResource = new OpenStackResource();
    expect(resource.getCreatePermissions()).toEqual([]);
    expect(resource.getUpdatePermissions()).toEqual([]);
    expect(resource.getDeletePermissions()).toEqual([]);
  });
});

describe("the API's own routes", () => {
  type Handler = (req: unknown, res: unknown) => Promise<void>;
  const api: Record<string, Handler> =
    new OpenStackResourceAPI() as unknown as Record<string, Handler>;

  /*
   * Each of these reads the inventory as root once it knows the cloud, so all that stands between
   * a request and every row is that first read of the cloud, with the caller's own props.
   */
  const ROUTES: ReadonlyArray<string> = [
    "getInventorySummary",
    "getNeedsAttention",
    "getBlastRadius",
    "getRows",
    "getCounts",
    "getRegionSummaries",
    "getTopConsumers",
    "getProjectSummaries",
    "getDomainSummaries",
    "getTopology",
  ];

  const REQUEST: unknown = {
    params: { cloudId: CLOUD_ID.toString() },
    body: {},
    query: {},
    headers: { tenantid: PROJECT_ID.toString() },
  };

  let reachedInventory: boolean = false;

  beforeEach(() => {
    reachedInventory = false;
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {
      return undefined as never;
    });
    // The real gate on the caller's own props, and no database behind it.
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockImplementation(async (data: unknown) => {
        const { props, select } = data as {
          props: DatabaseCommonInteractionProps;
          select: Record<string, boolean>;
        };
        await ModelPermission.checkReadQueryPermission(
          OpenStackCloud,
          { _id: CLOUD_ID },
          select as never,
          props,
        );
        return Object.assign(new OpenStackCloud(), {
          _id: CLOUD_ID.toString(),
          projectId: PROJECT_ID,
        }) as never;
      });
    const reachesInventory: () => Promise<never> = async (): Promise<never> => {
      reachedInventory = true;
      return {} as never;
    };
    for (const name of [
      "getInventorySummary",
      "getRows",
      "getCounts",
      "getRegionSummaries",
      "getTopConsumers",
      "getProjectSummaries",
      "getDomainSummaries",
      "getTopology",
      "getAttentionRows",
    ]) {
      if (
        typeof (OpenStackResourceService as unknown as Record<string, unknown>)[
          name
        ] === "function"
      ) {
        jest
          .spyOn(
            OpenStackResourceService as unknown as Record<
              string,
              () => Promise<unknown>
            >,
            name,
          )
          .mockImplementation(reachesInventory);
      }
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(ROUTES)(
    "%s refuses a role with no read of the cloud, before it reads any inventory",
    async (route: string) => {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(NO_ROLE);

      await expect(
        (api[route] as Handler).call(api, REQUEST, {}),
      ).rejects.toThrow(NotAuthorizedException);
      expect(reachedInventory).toBe(false);
    },
  );

  test("a role that reads the cloud gets the summary its pages are drawn from", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(propsHolding([Permission.ReadOpenStackCloud]));

    await (api["getInventorySummary"] as Handler).call(api, REQUEST, {});

    expect(reachedInventory).toBe(true);
  });
});

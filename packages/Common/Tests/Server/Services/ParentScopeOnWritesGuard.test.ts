import CreatePermission, {
  CreateParent,
} from "../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import { UnreadableParentException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A RECORD'S PARENTS FOLLOW THE CALLER'S READ ON EVERY WRITE.
 *
 *   - Every model whose parent an update may change - the column
 *     permissions of its parent relation or of its ID column name someone -
 *     is pinned here, and swept through the update's parent check
 *     (UpdatePermission.checkParentPermission), which DatabaseService asks
 *     of every update before its hooks, and after them should a hook name
 *     another parent. A new one fails this test until it is weighed.
 *   - Only ProjectReferencesService says its own hooks hold a write's
 *     references to the project; every other service has the parents and
 *     the listed records it is given looked up in the project
 *     (DatabaseService.checksReferencesInProject).
 *   - A create permission limited to owned records makes only records its
 *     creator will own: every model whose records have owners of their own
 *     gives its creator an owner row (DatabaseService.autoOwnerOnCreate),
 *     whatever kind of resource it is.
 */

type ModelType = { new (): BaseModel };

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-abab-4aaa-8bbb-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("0193c0de-abab-4aaa-8bbb-0000000000a1");
const HELD_PARENT: string = "0193c0de-abab-4aaa-8bbb-00000000f001";
const NEW_PARENT: string = "0193c0de-abab-4aaa-8bbb-00000000f002";

// The models whose parent an update may change, as their tables are named.
const PARENTS_AN_UPDATE_MAY_CHANGE: Array<string> = [
  "MetricPipelineRule",
  "StatusPageAnnouncement",
  "StatusPageAnnouncementTemplate",
];

const BUILT_IN_ROLES: Set<string> = new Set<string>(
  PermissionHelper.getRolePermissionProps().map(
    (props: PermissionProps): string => {
      return props.permission.toString();
    },
  ),
);

const SERVER_DIRECTORY: string = path.resolve(__dirname, "../../../Server");
const EE_SERVER_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../ee/Server",
);

function listTypeScriptFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "build") {
        continue;
      }

      found.push(...listTypeScriptFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }

  return found;
}

const modelsWhoseParentAnUpdateMayChange: () => Array<ModelType> =
  (): Array<ModelType> => {
    return (AllModelTypes as Array<ModelType>).filter(
      (modelType: ModelType): boolean => {
        const model: BaseModel = new modelType();
        const parent: CreateParent | null =
          CreatePermission.getCreateParent(modelType);

        if (!parent) {
          return false;
        }

        const accessControl: Dictionary<ColumnAccessControl> =
          model.getColumnAccessControlForAllColumns();

        return (
          (accessControl[parent.relation]?.update || []).length > 0 ||
          Boolean(
            parent.idColumn &&
              (accessControl[parent.idColumn]?.update || []).length > 0,
          )
        );
      },
    );
  };

// A permission of the model's update list that reads nothing of the parent.
const updateGrantOf: (modelType: ModelType) => Permission = (
  modelType: ModelType,
): Permission => {
  return (new modelType().updateRecordPermissions || []).find(
    (permission: Permission): boolean => {
      return !BUILT_IN_ROLES.has(permission.toString());
    },
  )!;
};

const readGrantOf: (modelType: ModelType) => Permission = (
  modelType: ModelType,
): Permission => {
  return (new modelType().readRecordPermissions || []).find(
    (permission: Permission): boolean => {
      return !BUILT_IN_ROLES.has(permission.toString());
    },
  )!;
};

const row: (
  permission: Permission,
  labelIds?: Array<ObjectID>,
) => UserPermission = (
  permission: Permission,
  labelIds: Array<ObjectID> = [],
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds,
    isBlockPermission: false,
    scope: labelIds.length > 0 ? PermissionScope.Labels : PermissionScope.All,
  };
};

const memberWith: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
  };
};

// The update's data naming `ids` as the parent.
const naming: (parent: CreateParent, ids: Array<string>) => unknown = (
  parent: CreateParent,
  ids: Array<string>,
): unknown => {
  if (parent.isList) {
    return {
      [parent.relation]: ids.map((id: string): Record<string, string> => {
        return { _id: id };
      }),
    };
  }

  return { [parent.idColumn || parent.relation]: new ObjectID(ids[0]!) };
};

describe("every model whose parent an update may change", () => {
  test("is one of the pinned models", () => {
    expect(
      modelsWhoseParentAnUpdateMayChange()
        .map((modelType: ModelType): string => {
          return new modelType().tableName || "";
        })
        .sort(),
    ).toEqual([...PARENTS_AN_UPDATE_MAY_CHANGE].sort());
  });

  test.each(
    modelsWhoseParentAnUpdateMayChange().map(
      (modelType: ModelType): [string, ModelType] => {
        return [new modelType().tableName || "", modelType];
      },
    ),
  )(
    "%s moves only to a parent its editor may read; the one it has is not asked again",
    async (_name: string, modelType: ModelType) => {
      const parent: CreateParent = CreatePermission.getCreateParent(modelType)!;
      const lookups: Array<Array<string>> = [];

      const props: DatabaseCommonInteractionProps = memberWith([
        row(updateGrantOf(modelType)),
        row(readGrantOf(modelType)),
        row(readGrantOf(parent.parentModelType), [LABEL_ID]),
      ]);

      const check: (ids: Array<string>) => Promise<Array<string>> = async (
        ids: Array<string>,
      ): Promise<Array<string>> => {
        return await ModelPermission.checkUpdateParentPermission({
          modelType: modelType,
          data: naming(parent, ids),
          props: props,
          heldParentIds: [[HELD_PARENT]],
          referencesCheckedInProject: true,
          findReadableParentIds: async (lookup: {
            ids: Array<string>;
          }): Promise<Array<string>> => {
            lookups.push(lookup.ids);
            return lookup.ids.filter((id: string): boolean => {
              return id === HELD_PARENT;
            });
          },
          findParentIdsInProject: async (): Promise<Array<string>> => {
            return [];
          },
        });
      };

      await expect(check([HELD_PARENT])).resolves.toEqual([HELD_PARENT]);
      expect(lookups).toEqual([]);

      await expect(check([NEW_PARENT])).rejects.toBeInstanceOf(
        UnreadableParentException,
      );
      expect(lookups).toEqual([[NEW_PARENT]]);
    },
  );
});

describe("the shared update path asks it, once, around the hooks", () => {
  const source: string = fs.readFileSync(
    path.join(SERVER_DIRECTORY, "Services/DatabaseService.ts"),
    "utf8",
  );

  test("before the update's hooks, and after them for parents a hook names", () => {
    const start: number = source.indexOf(
      "private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<number> {",
    );
    const update: string = source.slice(start, start + 6000);

    const before: number = update.indexOf(
      "await this.checkUpdateNamedRecords(updateBy)",
    );
    const hooks: number = update.indexOf("await this.onBeforeUpdate(updateBy)");
    const after: number = update.indexOf(
      "await this.checkUpdateParentsAfterHooks(",
    );
    const permission: number = update.indexOf(
      "await ModelPermission.checkUpdateQueryPermissions(",
    );

    expect(start).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(-1);
    expect(hooks).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(hooks);
    expect(permission).toBeGreaterThan(after);
  });

  test("no service checks a parent change of its own instead", () => {
    const offenders: Array<string> = [];

    for (const file of [
      ...listTypeScriptFiles(path.join(SERVER_DIRECTORY, "Services")),
      ...listTypeScriptFiles(path.join(EE_SERVER_DIRECTORY, "Services")),
    ]) {
      const text: string = fs.readFileSync(file, "utf8");

      if (
        text.includes("checkUpdateParentPermission") &&
        !file.endsWith("DatabaseService.ts")
      ) {
        offenders.push(path.relative(SERVER_DIRECTORY, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("which services check the references a write names themselves", () => {
  test("only ProjectReferencesService says so; every other service has them looked up", () => {
    const overriding: Array<string> = [];

    for (const file of [
      ...listTypeScriptFiles(SERVER_DIRECTORY),
      ...listTypeScriptFiles(EE_SERVER_DIRECTORY),
    ]) {
      const text: string = fs.readFileSync(file, "utf8");

      if (/checksReferencesInProject\(\): boolean/.test(text)) {
        overriding.push(path.basename(file));
      }
    }

    expect(overriding.sort()).toEqual([
      "DatabaseService.ts",
      "ProjectReferencesService.ts",
    ]);
  });
});

describe("a create limited to owned records makes a record its creator owns", () => {
  test("every operational resource has owner rows of its own", () => {
    const withoutOwners: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((modelType: ModelType): boolean => {
        return Boolean(new modelType().isOperationalResource);
      })
      .filter((modelType: ModelType): boolean => {
        return !OwnedScopePermission.hasOwnerTables(modelType);
      })
      .map((modelType: ModelType): string => {
        return modelType.name;
      });

    expect(withoutOwners).toEqual([]);
  });

  test("the creator of any record with owner rows becomes an owner, operational resource or not", () => {
    const source: string = fs.readFileSync(
      path.join(SERVER_DIRECTORY, "Services/DatabaseService.ts"),
      "utf8",
    );
    const start: number = source.indexOf("private async autoOwnerOnCreate(");
    const body: string = source.slice(start, source.indexOf("\n  }\n", start));

    expect(start).toBeGreaterThan(-1);
    expect(body).not.toContain("isOperationalResource");
    expect(body).toContain("ownerTableRegistry.get(modelName)");

    // The hosts, clusters and the rest carry owners, but are no operational resource.
    expect(
      (AllModelTypes as Array<ModelType>).filter(
        (modelType: ModelType): boolean => {
          return (
            OwnedScopePermission.hasOwnerTables(modelType) &&
            !new modelType().isOperationalResource
          );
        },
      ).length,
    ).toBeGreaterThan(10);
  });

  test("a model that takes its owners from a parent is created only on a parent its creator owns", () => {
    const source: string = fs.readFileSync(
      path.join(
        SERVER_DIRECTORY,
        "Types/Database/Permissions/CreateScopePermission.ts",
      ),
      "utf8",
    );

    expect(source).toContain("OwnedScopePermission.hasOwnerTables(modelType)");
    expect(source).toContain("ownedThrough.fkColumn");
    expect(source).toContain("OwnedScopePermission.getOwnedIds(");
  });
});

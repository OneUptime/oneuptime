import DatabaseService from "../../../Server/Services/DatabaseService";
import CreatePermission, {
  CreateParent,
} from "../../../Server/Types/Database/Permissions/CreatePermission";
import EditionPermissions from "../../../Server/Types/Database/Permissions/EditionPermission";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * EVERY MODEL READ THROUGH ANOTHER RECORD IS CREATED ONLY UNDER A PARENT ITS
 * CREATOR MAY READ - through the one check every create makes
 * (DatabaseService.create -> ModelPermission.checkCreateParentPermission).
 *
 * This sweeps every model declared with @CanAccessIfCanReadOn through the
 * real create path, as a member whose read of the parent is limited to a
 * label: the parent they name is looked up as they would read it, and when
 * the read does not find it the create is refused - like a record that does
 * not exist - before any of the service's hooks run. When the read finds it,
 * the create goes on to the hooks.
 *
 * And it holds the code to that path: every service that overrides create
 * hands it on to DatabaseService.create, and nothing writes these tables
 * with SQL of its own but the system writes listed below.
 */

type ModelType = { new (): BaseModel };

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const PARENT_ID: string = "0193c0de-bbbb-4aaa-8bbb-00000000f001";
const LABEL_ID: ObjectID = new ObjectID("0193c0de-bbbb-4aaa-8bbb-0000000000a1");

// Thrown in place of the service's create hooks: the create got past the check.
class PastTheCheck extends Error {}

const BUILT_IN_ROLES: Set<string> = new Set<string>(
  PermissionHelper.getRolePermissionProps().map(
    (props: PermissionProps): string => {
      return props.permission.toString();
    },
  ),
);

const MODELS_READ_THROUGH_A_PARENT: Array<ModelType> = (
  AllModelTypes as Array<ModelType>
).filter((modelType: ModelType): boolean => {
  return Boolean(new modelType().canAccessIfCanReadOn);
});

const nameOf: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName || modelType.name;
};

const parentOf: (modelType: ModelType) => CreateParent = (
  modelType: ModelType,
): CreateParent => {
  return CreatePermission.getCreateParent(modelType)!;
};

/*
 * A permission of the model's create list that reads nothing of the parent:
 * the narrowest grant to create it.
 */
const createGrantOf: (modelType: ModelType) => Permission | undefined = (
  modelType: ModelType,
): Permission | undefined => {
  const parentRead: Array<string> = (
    new (parentOf(modelType).parentModelType)().readRecordPermissions || []
  ).map(String);

  return (new modelType().createRecordPermissions || []).find(
    (permission: Permission): boolean => {
      return (
        !BUILT_IN_ROLES.has(permission.toString()) &&
        permission !== Permission.Public &&
        !parentRead.includes(permission.toString())
      );
    },
  );
};

// The parent's own read permission (Read Project Incident, Read Status Page ...).
const parentReadGrantOf: (modelType: ModelType) => Permission = (
  modelType: ModelType,
): Permission => {
  const parentRead: Array<Permission> =
    new (parentOf(modelType).parentModelType)().readRecordPermissions || [];

  return parentRead.find((permission: Permission): boolean => {
    return !BUILT_IN_ROLES.has(permission.toString());
  })!;
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

// A record of the model naming the parent, as the API writes it.
const recordUnder: (modelType: ModelType) => BaseModel = (
  modelType: ModelType,
): BaseModel => {
  const parent: CreateParent = parentOf(modelType);
  const record: BaseModel = new modelType();

  if (parent.isList) {
    (record as unknown as Record<string, unknown>)[parent.relation] = [
      { _id: PARENT_ID },
    ];
  } else {
    (record as unknown as Record<string, unknown>)[
      parent.idColumn || parent.relation
    ] = parent.idColumn ? new ObjectID(PARENT_ID) : { _id: PARENT_ID };
  }

  return record;
};

interface LookupCall {
  parentModelType: ModelType;
  ids: Array<string>;
}

/*
 * The service of a model, its hooks replaced by the sentinel, and the read of
 * the parents answered by `readableIds` - as the caller reads them, and as
 * OneUptime finds them in the project for a caller whose read of the parent
 * is optional (`projectLookups`). The service is a plain DatabaseService,
 * which holds no reference to the project itself (no ProjectReferencesService
 * check), so every parent it is given is looked up. The edition check is
 * left out: the Enterprise Edition's models are swept on a Community Edition
 * test run too.
 */
const serviceFor: (
  modelType: ModelType,
  readableIds: Array<string>,
) => {
  service: DatabaseService<BaseModel>;
  lookups: Array<LookupCall>;
  projectLookups: Array<LookupCall>;
} = (
  modelType: ModelType,
  readableIds: Array<string>,
): {
  service: DatabaseService<BaseModel>;
  lookups: Array<LookupCall>;
  projectLookups: Array<LookupCall>;
} => {
  const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
    modelType,
  );
  const lookups: Array<LookupCall> = [];
  const projectLookups: Array<LookupCall> = [];

  getJestSpyOn(DatabaseService as never, "findIdsInProject").mockImplementation(
    (async (lookup: {
      modelType: ModelType;
      ids: Array<string>;
    }): Promise<Array<string>> => {
      projectLookups.push({
        parentModelType: lookup.modelType,
        ids: lookup.ids,
      });

      return lookup.ids.filter((id: string): boolean => {
        return readableIds.includes(id);
      });
    }) as never,
  );

  getJestSpyOn(
    service as unknown as { _onBeforeCreate: () => Promise<unknown> },
    "_onBeforeCreate",
  ).mockRejectedValue(new PastTheCheck() as never);

  getJestSpyOn(
    DatabaseService as never,
    "findReadableParentIds",
  ).mockImplementation((async (lookup: {
    parentModelType: ModelType;
    ids: Array<string>;
  }): Promise<Array<string>> => {
    lookups.push({
      parentModelType: lookup.parentModelType,
      ids: lookup.ids,
    });

    return lookup.ids.filter((id: string): boolean => {
      return readableIds.includes(id);
    });
  }) as never);

  getJestSpyOn(EditionPermissions, "checkEditionPermissions").mockReturnValue(
    undefined as never,
  );
  getJestSpyOn(
    EditionPermissions,
    "checkEnterpriseColumnPermissions",
  ).mockReturnValue(undefined as never);

  return {
    service: service,
    lookups: lookups,
    projectLookups: projectLookups,
  };
};

const refusalOf: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
};

const CREATABLE: Array<[string, ModelType]> =
  MODELS_READ_THROUGH_A_PARENT.filter((modelType: ModelType): boolean => {
    return Boolean(createGrantOf(modelType));
  }).map((modelType: ModelType): [string, ModelType] => {
    return [nameOf(modelType), modelType];
  });

// Created by OneUptime alone: no permission creates them.
const CREATED_BY_ONEUPTIME_ONLY: Array<[string, ModelType]> =
  MODELS_READ_THROUGH_A_PARENT.filter((modelType: ModelType): boolean => {
    return (new modelType().createRecordPermissions || []).length === 0;
  }).map((modelType: ModelType): [string, ModelType] => {
    return [nameOf(modelType), modelType];
  });

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every model read through another record is created only under a parent its creator may read", () => {
  test("the sweep covers the models read through another record", () => {
    expect(MODELS_READ_THROUGH_A_PARENT.length).toBeGreaterThan(50);

    // Every one is either created by some permission, or by OneUptime alone.
    expect(CREATABLE.length + CREATED_BY_ONEUPTIME_ONLY.length).toBe(
      MODELS_READ_THROUGH_A_PARENT.length,
    );

    const names: Array<string> = CREATABLE.map(
      (entry: [string, ModelType]): string => {
        return entry[0];
      },
    );

    // A key column, and a join table.
    expect(names).toContain("IncidentInternalNote");
    expect(names).toContain("StatusPageAnnouncement");
  });

  test.each(CREATABLE)(
    "%s: a parent the creator's read does not find is refused before any hook",
    async (_name: string, modelType: ModelType) => {
      const parent: CreateParent = parentOf(modelType);
      const { service, lookups } = serviceFor(modelType, []);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: memberWith([
            row(createGrantOf(modelType)!),
            row(parentReadGrantOf(modelType), [LABEL_ID]),
          ]),
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect((refusal as Error).message).toContain(
        `references records that are not in this project: ${parent.title} "${PARENT_ID}".`,
      );
      expect(lookups).toEqual([
        { parentModelType: parent.parentModelType, ids: [PARENT_ID] },
      ]);
    },
  );

  test.each(CREATABLE)(
    "%s: a parent the creator's read finds lets the create go on",
    async (_name: string, modelType: ModelType) => {
      const { service, lookups } = serviceFor(modelType, [PARENT_ID]);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: memberWith([
            row(createGrantOf(modelType)!),
            row(parentReadGrantOf(modelType), [LABEL_ID]),
          ]),
        }),
      );

      expect(refusal).toBeInstanceOf(PastTheCheck);
      expect(lookups).toHaveLength(1);
    },
  );

  test.each(CREATABLE)(
    "%s: OneUptime's own create is not looked up",
    async (_name: string, modelType: ModelType) => {
      const { service, lookups } = serviceFor(modelType, []);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: { isRoot: true, tenantId: PROJECT_ID },
        }),
      );

      expect(refusal).toBeInstanceOf(PastTheCheck);
      expect(lookups).toEqual([]);
    },
  );

  test.each(CREATED_BY_ONEUPTIME_ONLY)(
    "%s: created by OneUptime alone - anyone else is refused by its create list first",
    async (_name: string, modelType: ModelType) => {
      const { service, lookups } = serviceFor(modelType, []);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: memberWith([row(Permission.ProjectOwner)]),
        }),
      );

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(lookups).toEqual([]);
    },
  );

  test("a model whose parent read is optional is created by its own rule by a caller who reads no parent", async () => {
    const optional: Array<ModelType> = CREATABLE.map(
      (entry: [string, ModelType]): ModelType => {
        return entry[1];
      },
    ).filter((modelType: ModelType): boolean => {
      return Boolean(new modelType().isParentReadOptional);
    });

    // An incident's links to alerts, telemetry rules of a service.
    expect(optional.length).toBeGreaterThan(0);

    for (const modelType of optional) {
      const parent: CreateParent = parentOf(modelType);
      const { service, lookups, projectLookups } = serviceFor(modelType, [
        PARENT_ID,
      ]);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: memberWith([row(createGrantOf(modelType)!)]),
        }),
      );

      expect([nameOf(modelType), refusal instanceof PastTheCheck]).toEqual([
        nameOf(modelType),
        true,
      ]);

      // Never as the caller; a record of the project, found by OneUptime.
      expect(lookups).toEqual([]);
      expect(projectLookups).toEqual([
        { parentModelType: parent.parentModelType, ids: [PARENT_ID] },
      ]);
    }
  });

  test("a model whose parent read is optional takes no parent of another project from a caller who reads no parent", async () => {
    const optional: Array<ModelType> = CREATABLE.map(
      (entry: [string, ModelType]): ModelType => {
        return entry[1];
      },
    ).filter((modelType: ModelType): boolean => {
      return Boolean(new modelType().isParentReadOptional);
    });

    for (const modelType of optional) {
      const parent: CreateParent = parentOf(modelType);
      const { service, lookups } = serviceFor(modelType, []);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: memberWith([row(createGrantOf(modelType)!)]),
        }),
      );

      expect([
        nameOf(modelType),
        refusal instanceof ProjectScopedReferenceException,
      ]).toEqual([nameOf(modelType), true]);
      expect((refusal as Error).message).toContain(
        `references records that are not in this project: ${parent.title} "${PARENT_ID}".`,
      );
      expect(lookups).toEqual([]);
    }
  });

  test.each(CREATABLE)(
    "%s: a parent of another project is refused when the caller reads every parent, for a service that checks no reference itself",
    async (_name: string, modelType: ModelType) => {
      const parent: CreateParent = parentOf(modelType);
      const { service, lookups } = serviceFor(modelType, []);

      const refusal: unknown = await refusalOf(
        service.create({
          data: recordUnder(modelType),
          props: memberWith([
            row(createGrantOf(modelType)!),
            row(parentReadGrantOf(modelType)),
          ]),
        }),
      );

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect((refusal as Error).message).toContain(
        `references records that are not in this project: ${parent.title} "${PARENT_ID}".`,
      );
      expect(lookups).toEqual([
        { parentModelType: parent.parentModelType, ids: [PARENT_ID] },
      ]);
    },
  );
});

const SERVER_DIRECTORY: string = path.resolve(__dirname, "../../../Server");
const EE_SERVER_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../../ee/Server",
);

// Every TypeScript file under `directory`, its schema migrations left out.
const sourceFilesUnder: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "SchemaMigrations") {
        continue;
      }

      files.push(...sourceFilesUnder(entryPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
};

const SERVER_FILES: Array<string> = [
  ...sourceFilesUnder(SERVER_DIRECTORY),
  ...sourceFilesUnder(EE_SERVER_DIRECTORY),
];

const relativeName: (file: string) => string = (file: string): string => {
  return path
    .relative(path.resolve(__dirname, "../../../../.."), file)
    .split(path.sep)
    .join("/");
};

/*
 * Writes of these tables in SQL of their own, each a write OneUptime makes
 * itself. May only shrink: each entry is the exact line the scan produces.
 *
 *   - adopting the monitor rules of a service level objective's legacy
 *     monitor label: the objective's own rule, written as the objective's
 *     backfill writes it.
 */
const RAW_INSERTS_BY_ONEUPTIME: Array<string> = [
  "packages/Common/Server/Utils/Slo/SloLegacyMonitorLabelAdoption.ts: ServiceLevelObjectiveMonitorRule",
];

describe("the code creates these records through DatabaseService.create only", () => {
  test("every service that overrides create hands it on to DatabaseService.create", () => {
    const overriding: Array<string> = [];
    const notHandedOn: Array<string> = [];

    for (const file of SERVER_FILES) {
      const source: string = fs.readFileSync(file, "utf-8");

      if (!source.includes("override async create(")) {
        continue;
      }

      overriding.push(relativeName(file));

      if (!source.includes("super.create(")) {
        notHandedOn.push(relativeName(file));
      }
    }

    // The on-call escalation configuration overrides it, among others.
    expect(overriding).toContain(
      "packages/Common/Server/Services/OnCallDutyPolicyChildService.ts",
    );
    expect(notHandedOn).toEqual([]);
  });

  test("no SQL of the code's own inserts these records, but OneUptime's listed writes", () => {
    const tables: Array<string> = MODELS_READ_THROUGH_A_PARENT.map(nameOf);
    const lines: Array<string> = [];

    for (const file of SERVER_FILES) {
      const source: string = fs.readFileSync(file, "utf-8");

      for (const table of tables) {
        if (source.includes(`INSERT INTO "${table}"`)) {
          lines.push(`${relativeName(file)}: ${table}`);
        }
      }
    }

    expect(lines.sort()).toEqual([...RAW_INSERTS_BY_ONEUPTIME].sort());
  });
});

/*
 * THE PARENT TABLES THAT HOLD PRIVATE RECORDS. An incident, an alert or an
 * episode marked private is read only by the people it names and by those
 * who see every private record of the project - a rule its own service adds
 * to every read of it (IncidentService.onBeforeFind and the others). The
 * parent lookup reads through a plain service, so it adds that rule itself
 * (CreatePermission.getParentLookupQuery): every parent table with private
 * records has its rule there, and it is the rule that table's service
 * applies to its reads.
 */
describe("a parent table's private records are looked up with its own rule", () => {
  const parentModels: Array<ModelType> = Array.from(
    new Set<ModelType>(
      MODELS_READ_THROUGH_A_PARENT.map((modelType: ModelType): ModelType => {
        return parentOf(modelType).parentModelType as ModelType;
      }),
    ),
  );

  const holdsPrivateRecords: (modelType: ModelType) => boolean = (
    modelType: ModelType,
  ): boolean => {
    return Boolean(new modelType().getTableColumnMetadata("isPrivate"));
  };

  test("the incidents, alerts and episodes are the parents with private records", () => {
    expect(parentModels.filter(holdsPrivateRecords).map(nameOf).sort()).toEqual(
      ["Alert", "AlertEpisode", "Incident", "IncidentEpisode"],
    );
  });

  test.each(
    parentModels.map((modelType: ModelType): [string, ModelType] => {
      return [nameOf(modelType), modelType];
    }),
  )(
    "%s is looked up with a rule for private records exactly when it holds them",
    (_name: string, modelType: ModelType) => {
      expect(CreatePermission.getParentPrivacyFilter(modelType) !== null).toBe(
        holdsPrivateRecords(modelType),
      );
    },
  );

  test.each(
    parentModels
      .filter(holdsPrivateRecords)
      .map((modelType: ModelType): [string, ModelType] => {
        return [nameOf(modelType), modelType];
      }),
  )(
    "%s's rule is the one its own service adds to every read",
    (name: string, modelType: ModelType) => {
      const filterName: string =
        CreatePermission.getParentPrivacyFilter(modelType)!.name;
      const serviceSource: string = fs.readFileSync(
        path.join(SERVER_DIRECTORY, "Services", `${name}Service.ts`),
        "utf-8",
      );

      expect(filterName).toMatch(/^apply\w+SelfPrivacyFilter$/);
      expect(serviceSource).toMatch(
        new RegExp(`${filterName}\\(\\s*findBy\\.query,`),
      );
    },
  );
});

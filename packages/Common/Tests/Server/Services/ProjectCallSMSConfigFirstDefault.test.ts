import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import CountBy from "../../../Server/Types/Database/CountBy";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROJECT'S FIRST TWILIO CONFIG BECOMES ITS DEFAULT.
 *
 * SMS and calls to a project's members go through the project's default
 * Twilio config, and through OneUptime's own account when it has none. A
 * config was created with isProjectDefault off unless someone found the
 * switch, so a project that added its own Twilio account kept sending (and
 * paying for) everything through OneUptime's. Now a create that leaves the
 * choice out makes the project's first config its default. An explicit
 * false - the dashboard's switch turned off, an API call, Terraform, which
 * always sends one - is kept, and a project that already has a config keeps
 * the one it uses.
 *
 * A config saved as the default takes the default from the project's other
 * configs once it exists (onCreateSuccess, onUpdateSuccess), never before:
 * DatabaseService refuses a caller who may not create or change a config
 * before any hook runs, and onBeforeCreate itself only decides the new
 * config's flag.
 *
 * These pin ProjectCallSMSConfigService: onBeforeCreate on its own, the full
 * create() path for a non-root member (where whatever the hook writes is
 * held to the caller's column permissions), and the success hooks. Every
 * service with a project default is driven end to end in
 * ProjectDefaultRowWrites.test.ts. The billing plan's part is pinned in
 * ProjectCallSMSConfigFirstDefaultBilling.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1a000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("1a000000-0000-4000-8000-000000000003");
const CONFIG_ID: ObjectID = new ObjectID(
  "1a000000-0000-4000-8000-000000000004",
);

type PropsBuilder = () => DatabaseCommonInteractionProps;

type MemberPropsFunction = (
  permissions: Array<Permission>,
  memberOf?: ObjectID,
) => DatabaseCommonInteractionProps;

/*
 * A signed-in member of `memberOf` with these permissions, sending the
 * request to PROJECT_ID (the tenant).
 */
const memberProps: MemberPropsFunction = (
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: memberOf,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [memberOf.toString()]: tenantPermission,
    },
  };
};

const rootProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return { isRoot: true };
};

// The narrowest role that may add a config: Create Call and SMS Config alone.
const configCreatorProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.CreateProjectCallSMSConfig]);
};

const projectAdminProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.ProjectAdmin]);
};

// Someone who may see the configs, and nothing more.
const configReaderProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.ReadProjectCallSMSConfig]);
};

// An owner of another project, sending the request to this one.
const strangerProps: PropsBuilder = (): DatabaseCommonInteractionProps => {
  return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID);
};

interface ConfigOptions {
  projectId?: ObjectID | undefined;
  isProjectDefault?: boolean | null | undefined;
}

type BuildConfigFunction = (options?: ConfigOptions) => ProjectCallSMSConfig;

// A config as the dashboard's create form or an API call sends it.
const buildConfig: BuildConfigFunction = (
  options: ConfigOptions = {},
): ProjectCallSMSConfig => {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.name = "Production Twilio";
  config.twilioAccountSID = "AC00000000000000000000000000000001";
  config.twilioAuthToken = "00000000000000000000000000000001";
  config.twilioPrimaryPhoneNumber = new Phone("+15551234567");

  const projectId: ObjectID | undefined =
    "projectId" in options ? options.projectId : PROJECT_ID;

  if (projectId) {
    config.projectId = projectId;
  }

  if ("isProjectDefault" in options) {
    config.isProjectDefault = options.isProjectDefault as boolean;
  }

  return config;
};

let configsInProject: number;
let countCalls: Array<CountBy<ProjectCallSMSConfig>>;
let updateCalls: Array<UpdateBy<ProjectCallSMSConfig>>;

/*
 * The project's configs, as countBy answers for them: a query for one
 * project and nothing else is the hook's "how many configs does the project
 * have"; anything else (the name's uniqueness check in create()) finds none.
 */
const mockStorage: () => void = (): void => {
  countCalls = [];
  updateCalls = [];

  jest
    .spyOn(ProjectCallSMSConfigService, "countBy")
    .mockImplementation(
      async (
        countBy: CountBy<ProjectCallSMSConfig>,
      ): Promise<PositiveNumber> => {
        countCalls.push(countBy);

        const keys: Array<string> = Object.keys(countBy.query);

        if (keys.length === 1 && keys[0] === "projectId") {
          return new PositiveNumber(configsInProject);
        }

        return new PositiveNumber(0);
      },
    );

  jest
    .spyOn(ProjectCallSMSConfigService, "updateBy")
    .mockImplementation(
      async (updateBy: UpdateBy<ProjectCallSMSConfig>): Promise<number> => {
        updateCalls.push(updateBy);
        return 0;
      },
    );
};

// The hook's own count of the project's configs, if it made one.
const projectCounts: () => Array<CountBy<ProjectCallSMSConfig>> = (): Array<
  CountBy<ProjectCallSMSConfig>
> => {
  return countCalls.filter((countBy: CountBy<ProjectCallSMSConfig>) => {
    const keys: Array<string> = Object.keys(countBy.query);
    return keys.length === 1 && keys[0] === "projectId";
  });
};

type OnBeforeCreateFunction = (
  createBy: CreateBy<ProjectCallSMSConfig>,
) => Promise<OnCreate<ProjectCallSMSConfig>>;

type OnCreateSuccessFunction = (
  onCreate: OnCreate<ProjectCallSMSConfig>,
  createdItem: ProjectCallSMSConfig,
) => Promise<ProjectCallSMSConfig>;

type OnUpdateSuccessFunction = (
  onUpdate: OnUpdate<ProjectCallSMSConfig>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<ProjectCallSMSConfig>>;

type RunBeforeCreateFunction = (
  config: ProjectCallSMSConfig,
  props?: DatabaseCommonInteractionProps,
) => Promise<OnCreate<ProjectCallSMSConfig>>;

// Calls the protected hook exactly as create() does.
const runBeforeCreate: RunBeforeCreateFunction = async (
  config: ProjectCallSMSConfig,
  props: DatabaseCommonInteractionProps = rootProps(),
): Promise<OnCreate<ProjectCallSMSConfig>> => {
  return await (
    ProjectCallSMSConfigService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate({ data: config, props: props });
};

// Calls the protected success hooks exactly as create() and update do.
const runCreateSuccess: (
  createdItem: ProjectCallSMSConfig,
) => Promise<ProjectCallSMSConfig> = async (
  createdItem: ProjectCallSMSConfig,
): Promise<ProjectCallSMSConfig> => {
  return await (
    ProjectCallSMSConfigService as unknown as {
      onCreateSuccess: OnCreateSuccessFunction;
    }
  ).onCreateSuccess(
    {
      createBy: { data: createdItem, props: rootProps() },
      carryForward: [],
    },
    createdItem,
  );
};

const runUpdateSuccess: (
  data: Record<string, unknown>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<ProjectCallSMSConfig>> = async (
  data: Record<string, unknown>,
  updatedItemIds: Array<ObjectID>,
): Promise<OnUpdate<ProjectCallSMSConfig>> => {
  return await (
    ProjectCallSMSConfigService as unknown as {
      onUpdateSuccess: OnUpdateSuccessFunction;
    }
  ).onUpdateSuccess(
    {
      updateBy: {
        query: { _id: CONFIG_ID.toString() },
        data: data as UpdateBy<ProjectCallSMSConfig>["data"],
        limit: 1,
        skip: 0,
        props: rootProps(),
      },
      carryForward: null,
    },
    updatedItemIds,
  );
};

/*
 * The one write that takes the default from the project's other configs:
 * every other default config of the project, as root, keeping `keepId`.
 */
const expectDefaultTakenFromOthers: (
  projectId: ObjectID,
  keepId: ObjectID,
) => void = (projectId: ObjectID, keepId: ObjectID): void => {
  expect(updateCalls).toHaveLength(1);

  const updateBy: UpdateBy<ProjectCallSMSConfig> = updateCalls[0]!;

  expect(Object.keys(updateBy.query).sort()).toEqual([
    "_id",
    "isProjectDefault",
    "projectId",
  ]);
  expect((updateBy.query.projectId as ObjectID).toString()).toBe(
    projectId.toString(),
  );
  expect(updateBy.query.isProjectDefault).toBe(true);
  expect(JSON.stringify(updateBy.query._id)).toContain(keepId.toString());
  expect(updateBy.data).toEqual({ isProjectDefault: false });
  expect(updateBy.props).toEqual({ isRoot: true });
};

beforeEach(() => {
  configsInProject = 0;
  mockStorage();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["a root caller", rootProps],
  ["a member who may only create Twilio configs", configCreatorProps],
  ["a project admin", projectAdminProps],
] as Array<[string, PropsBuilder]>)(
  "ProjectCallSMSConfigService onBeforeCreate for %s",
  (_label: string, buildProps: PropsBuilder) => {
    test("the project's first config becomes its default when the create does not say", async () => {
      configsInProject = 0;

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        buildConfig(),
        buildProps(),
      );

      expect(result.createBy.data.isProjectDefault).toBe(true);
      expect(projectCounts()).toHaveLength(1);
      // Decided here; nothing else is changed until the config is saved.
      expect(updateCalls).toHaveLength(0);
    });

    test("a null choice says nothing either: the first config becomes the default", async () => {
      configsInProject = 0;

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        buildConfig({ isProjectDefault: null }),
        buildProps(),
      );

      expect(result.createBy.data.isProjectDefault).toBe(true);
      expect(projectCounts()).toHaveLength(1);
    });

    test("a project with one config keeps it: the new one is left to the column's default, off", async () => {
      configsInProject = 1;

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        buildConfig(),
        buildProps(),
      );

      expect(result.createBy.data.isProjectDefault).toBeUndefined();
      expect(projectCounts()).toHaveLength(1);
      expect(updateCalls).toHaveLength(0);
    });

    test.each([2, 3, 25])(
      "a project with %i configs keeps the one it uses",
      async (existing: number) => {
        configsInProject = existing;

        const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
          buildConfig(),
          buildProps(),
        );

        expect(result.createBy.data.isProjectDefault).toBeUndefined();
        expect(updateCalls).toHaveLength(0);
      },
    );

    test("an explicit false on the project's first config is kept, without counting", async () => {
      configsInProject = 0;

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        buildConfig({ isProjectDefault: false }),
        buildProps(),
      );

      expect(result.createBy.data.isProjectDefault).toBe(false);
      expect(projectCounts()).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
    });

    test("an explicit false on a later config is kept, without counting", async () => {
      configsInProject = 4;

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        buildConfig({ isProjectDefault: false }),
        buildProps(),
      );

      expect(result.createBy.data.isProjectDefault).toBe(false);
      expect(projectCounts()).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
    });

    test("an explicit true on a later config is kept, and nothing else is changed before it is saved", async () => {
      configsInProject = 2;

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        buildConfig({ isProjectDefault: true }),
        buildProps(),
      );

      expect(result.createBy.data.isProjectDefault).toBe(true);
      expect(projectCounts()).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
    });

    test("counts the project's configs as root, by project and nothing else", async () => {
      await runBeforeCreate(buildConfig(), buildProps());

      const countBy: CountBy<ProjectCallSMSConfig> = projectCounts()[0]!;

      expect(Object.keys(countBy.query)).toEqual(["projectId"]);
      expect((countBy.query.projectId as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(countBy.props).toEqual({ isRoot: true });
    });

    test("returns the same create request", async () => {
      const config: ProjectCallSMSConfig = buildConfig();
      const props: DatabaseCommonInteractionProps = buildProps();

      const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
        config,
        props,
      );

      expect(result.createBy.data).toBe(config);
      expect(result.createBy.props).toBe(props);
      expect(result.carryForward).toEqual([]);
    });

    test("a failed count fails the create, and changes nothing", async () => {
      jest
        .spyOn(ProjectCallSMSConfigService, "countBy")
        .mockRejectedValue(new Error("count failed"));

      await expect(
        runBeforeCreate(buildConfig(), buildProps()),
      ).rejects.toThrow("count failed");
      expect(updateCalls).toHaveLength(0);
    });
  },
);

describe("ProjectCallSMSConfigService onBeforeCreate without a project", () => {
  test("a root create that names no project is left alone", async () => {
    const result: OnCreate<ProjectCallSMSConfig> = await runBeforeCreate(
      buildConfig({ projectId: undefined }),
    );

    expect(result.createBy.data.isProjectDefault).toBeUndefined();
    expect(countCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("ProjectCallSMSConfigService onCreateSuccess", () => {
  test("a config saved as the default takes it from the project's other configs, keeping itself", async () => {
    const created: ProjectCallSMSConfig = buildConfig({
      isProjectDefault: true,
    });
    created._id = CONFIG_ID.toString();

    const result: ProjectCallSMSConfig = await runCreateSuccess(created);

    expect(result).toBe(created);
    expectDefaultTakenFromOthers(PROJECT_ID, CONFIG_ID);
  });

  test.each([
    ["off", false],
    ["left to the column's default", undefined],
  ])(
    "a config saved with the default %s takes nothing",
    async (_label: string, isProjectDefault: boolean | undefined) => {
      const created: ProjectCallSMSConfig = buildConfig(
        isProjectDefault === undefined ? {} : { isProjectDefault },
      );
      created._id = CONFIG_ID.toString();

      await runCreateSuccess(created);

      expect(updateCalls).toHaveLength(0);
    },
  );
});

describe("ProjectCallSMSConfigService create() with the first-config default", () => {
  let save: MockFunction;

  beforeEach(() => {
    // Saves the config and gives it its id, as the database does.
    save = getJestMockFunction().mockImplementation(
      async (entity: ProjectCallSMSConfig): Promise<ProjectCallSMSConfig> => {
        entity._id = CONFIG_ID.toString();
        return entity;
      },
    );

    jest
      .spyOn(ProjectCallSMSConfigService, "getRepository")
      .mockReturnValue({ save: save } as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ProjectCallSMSConfigService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
  });

  test("a member's first config is saved as the project default", async () => {
    configsInProject = 0;

    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: buildConfig({ projectId: undefined }),
        props: configCreatorProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(saved);
    expect(saved.isProjectDefault).toBe(true);
    // Stamped into the caller's project, which is the one counted.
    expect(saved.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect((projectCounts()[0]!.query.projectId as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("counts the configs of the caller's project, not of the project the request names", async () => {
    configsInProject = 0;

    await ProjectCallSMSConfigService.create({
      data: buildConfig({ projectId: OTHER_PROJECT_ID }),
      props: configCreatorProps(),
    });

    expect((projectCounts()[0]!.query.projectId as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a member's second config is saved without taking the default", async () => {
    configsInProject = 1;

    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: buildConfig({ projectId: undefined }),
        props: configCreatorProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.isProjectDefault).not.toBe(true);
    expect(updateCalls).toHaveLength(0);
  });

  test("a member's first config switched off on the form is saved off", async () => {
    configsInProject = 0;

    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: buildConfig({ projectId: undefined, isProjectDefault: false }),
        props: configCreatorProps(),
      });

    expect(saved.isProjectDefault).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  test.each([
    ["a member who may only read them", configReaderProps],
    ["an owner of another project", strangerProps],
  ] as Array<[string, PropsBuilder]>)(
    "%s asking for the default is refused before any hook: nothing counted, changed or saved",
    async (_label: string, buildProps: PropsBuilder) => {
      configsInProject = 1;

      await expect(
        ProjectCallSMSConfigService.create({
          data: buildConfig({ projectId: undefined, isProjectDefault: true }),
          props: buildProps(),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);

      expect(countCalls).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("a member's config saved as the default takes it from the others once it exists", async () => {
    configsInProject = 1;

    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: buildConfig({ projectId: undefined, isProjectDefault: true }),
        props: configCreatorProps(),
      });

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved.isProjectDefault).toBe(true);
    // Taken after the save, from the configs of the caller's project only.
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(
      (ProjectCallSMSConfigService.updateBy as unknown as MockFunction).mock
        .invocationCallOrder[0]!,
    );
    expect(updateCalls).toHaveLength(1);
    expect((updateCalls[0]!.query.projectId as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a member who may only read configs is refused, and nothing is counted, changed or saved", async () => {
    configsInProject = 0;

    await expect(
      ProjectCallSMSConfigService.create({
        data: buildConfig({ projectId: undefined, isProjectDefault: true }),
        props: configReaderProps(),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(projectCounts()).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  test("an owner of another project is refused, and this project's default is left where it is", async () => {
    configsInProject = 1;

    await expect(
      ProjectCallSMSConfigService.create({
        data: buildConfig({ projectId: undefined, isProjectDefault: true }),
        props: strangerProps(),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(updateCalls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("ProjectCallSMSConfigService onUpdateSuccess", () => {
  let findCalls: Array<FindBy<ProjectCallSMSConfig>>;

  beforeEach(() => {
    findCalls = [];

    jest
      .spyOn(ProjectCallSMSConfigService, "findBy")
      .mockImplementation(
        async (
          findBy: FindBy<ProjectCallSMSConfig>,
        ): Promise<Array<ProjectCallSMSConfig>> => {
          findCalls.push(findBy);

          const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
          config._id = CONFIG_ID.toString();
          config.projectId = PROJECT_ID;
          return [config];
        },
      );
  });

  test("making a config the default takes it from the others in its project, keeping the config", async () => {
    const result: OnUpdate<ProjectCallSMSConfig> = await runUpdateSuccess(
      { isProjectDefault: true },
      [CONFIG_ID],
    );

    // The project is read from the config the update wrote, by its id.
    expect(findCalls).toHaveLength(1);
    expect(JSON.stringify(findCalls[0]!.query._id)).toContain(
      CONFIG_ID.toString(),
    );
    expect(findCalls[0]!.props).toEqual({ isRoot: true });
    expectDefaultTakenFromOthers(PROJECT_ID, CONFIG_ID);
    expect(result.updateBy.data).toEqual({ isProjectDefault: true });
  });

  test("an update that wrote no config takes the default from nobody", async () => {
    await runUpdateSuccess({ isProjectDefault: true }, []);

    expect(findCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test.each([
    ["turning the default off", { isProjectDefault: false }],
    ["renaming the config", { name: "Backup Twilio" }],
  ])(
    "%s leaves the project's other configs alone",
    async (_label: string, data: Record<string, unknown>) => {
      await runUpdateSuccess(data, [CONFIG_ID]);

      expect(findCalls).toHaveLength(0);
      expect(updateCalls).toHaveLength(0);
    },
  );
});

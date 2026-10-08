import DatabaseService from "../../../Server/Services/DatabaseService";
import ServiceOwnerUserService from "../../../Server/Services/ServiceOwnerUserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateScopeException from "../../../Server/Types/Database/Permissions/UpdateScopeException";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import { UnreadableReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceOwnerUser from "../../../Models/DatabaseModels/ServiceOwnerUser";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { getLabelJoinTable } from "../TestingUtils/LabelJoinTables";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * DatabaseService holds every create and update to what its caller may read
 * and change, in the shared path:
 *
 *   - the one record a write names in a field of its own - a status page
 *     resource's monitor - is asked about before the hooks run, on what the
 *     caller sent, and again after them on what a hook named besides (a
 *     template's monitor), before anything is written; a hook that sets
 *     something off first asks itself (checkRecordsNamedSoFar); what a hook
 *     fills in from a record the write names is the service's to answer
 *     for, when it says so (getReferencesFilledFromNamedRecords);
 *   - an update that changes the labels a record carries is held to the
 *     caller's permission to update it, on the labels the record carries
 *     once written, before and after the hooks;
 *   - a creator whose permission to create reaches only what they own owns
 *     what they create right after the save, or it is not created.
 *
 * No database is touched: the reads and the writes are stubbed, and
 * whatever reaches them is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const PRODUCTION: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a1";
const STAGING: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a2";

const RESOURCE_ID: string = "0193c0de-bbbb-4aaa-8bbb-00000000c001";
const PAGE_A: string = "0193c0de-bbbb-4aaa-8bbb-00000000d001";
const PRODUCTION_MONITOR: string = "0193c0de-bbbb-4aaa-8bbb-00000000a001";
const OTHER_PRODUCTION_MONITOR: string = "0193c0de-bbbb-4aaa-8bbb-00000000a002";
const STAGING_MONITOR: string = "0193c0de-bbbb-4aaa-8bbb-00000000a003";

// The labels each record carries.
const LABELS_OF: Record<string, Array<string>> = {
  [PAGE_A]: [],
  [PRODUCTION_MONITOR]: [PRODUCTION],
  [OTHER_PRODUCTION_MONITOR]: [PRODUCTION],
  [STAGING_MONITOR]: [STAGING],
};

const LABEL_NAMES: Record<string, string> = {
  [PRODUCTION]: "Production",
  [STAGING]: "Staging",
};

const row: (
  permission: Permission,
  labelIds?: Array<string>,
  scope?: PermissionScope,
) => UserPermission = (
  permission: Permission,
  labelIds: Array<string> = [],
  scope?: PermissionScope,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds.map((labelId: string): ObjectID => {
      return new ObjectID(labelId);
    }),
    isBlockPermission: false,
    scope:
      scope ||
      (labelIds.length > 0 ? PermissionScope.Labels : PermissionScope.All),
  };
};

const member: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [],
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

// The status pages and monitors a caller's read finds, and what was asked.
let readableMonitors: Array<string>;
let recordReads: Array<{ modelType: string; ids: Array<string> }>;

const monitorReads: () => Array<Array<string>> = (): Array<Array<string>> => {
  return recordReads
    .filter((read: { modelType: string }): boolean => {
      return read.modelType === "Monitor";
    })
    .map((read: { ids: Array<string> }): Array<string> => {
      return read.ids;
    });
};

beforeEach(() => {
  stubProjectDirectory({});

  // The label join tables, as a migrated database describes them.
  getJestSpyOn(QueryUtil, "getManyToManyRelationMetadata").mockImplementation(((
    modelType: { new (): BaseModel },
    propertyPath: string,
  ) => {
    if (propertyPath === new modelType().getAccessControlColumn()) {
      return getLabelJoinTable(modelType);
    }

    return null;
  }) as never);

  readableMonitors = [PRODUCTION_MONITOR, OTHER_PRODUCTION_MONITOR];
  recordReads = [];

  getJestSpyOn(
    DatabaseService as never,
    "findReadableParentIds",
  ).mockImplementation((async (lookup: {
    parentModelType: { new (): BaseModel };
    ids: Array<string>;
  }): Promise<Array<string>> => {
    const table: string = new lookup.parentModelType().tableName || "";
    recordReads.push({ modelType: table, ids: lookup.ids });

    if (table !== "Monitor") {
      return lookup.ids;
    }

    return lookup.ids.filter((id: string): boolean => {
      return readableMonitors.includes(id.toLowerCase());
    });
  }) as never);

  getJestSpyOn(DatabaseService as never, "findRecordLabels").mockImplementation(
    (async (lookup: {
      ids: Array<string>;
    }): Promise<Record<string, Array<string>>> => {
      const labels: Record<string, Array<string>> = {};

      for (const id of lookup.ids) {
        labels[id.toLowerCase()] = LABELS_OF[id.toLowerCase()] || [];
      }

      return labels;
    }) as never,
  );

  getJestSpyOn(DatabaseService as never, "findLabelNames").mockImplementation(
    (async (lookup: { labelIds: Array<string> }): Promise<Array<string>> => {
      return lookup.labelIds.map((labelId: string): string => {
        return LABEL_NAMES[labelId] || labelId;
      });
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A status page resource service whose hooks may point the resource at a
 * monitor, as one that fills a record in from a template would.
 */
class ResourceService extends DatabaseService<StatusPageResource> {
  public monitorNamedByCreateHook: string | null = null;
  public monitorNamedByUpdateHook: string | null = null;
  // The create hook asks about what it named before it sets something off.
  public asksBeforeSideEffect: boolean = false;
  public sideEffects: number = 0;
  public createHookCalls: number = 0;
  public updateHookCalls: number = 0;
  // The update hook changes what the update reaches, and so the rows it writes.
  public replacesQueryInUpdateHook: boolean = false;
  public onUpdateHook: (() => void) | null = null;

  public constructor() {
    super(StatusPageResource);
  }

  public async askAboutRecordsNamedSoFar(
    createBy: CreateBy<StatusPageResource>,
  ): Promise<void> {
    await this.checkRecordsNamedSoFar(createBy);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<StatusPageResource>,
  ): Promise<OnCreate<StatusPageResource>> {
    this.createHookCalls++;

    if (this.monitorNamedByCreateHook) {
      createBy.data.monitorId = new ObjectID(this.monitorNamedByCreateHook);
    }

    if (this.asksBeforeSideEffect) {
      await this.checkRecordsNamedSoFar(createBy);
    }

    this.sideEffects++;

    return { createBy: createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<StatusPageResource>,
  ): Promise<OnUpdate<StatusPageResource>> {
    this.updateHookCalls++;

    if (this.monitorNamedByUpdateHook) {
      (updateBy.data as Record<string, unknown>)["monitorId"] = new ObjectID(
        this.monitorNamedByUpdateHook,
      );
    }

    if (this.replacesQueryInUpdateHook) {
      updateBy.query = { ...updateBy.query };
    }

    if (this.onUpdateHook) {
      this.onUpdateHook();
    }

    return { updateBy: updateBy, carryForward: null };
  }
}

/*
 * One whose hooks fill the monitor in from a record the write names, as a
 * device takes its site's default probe, and say so.
 */
class FillingResourceService extends ResourceService {
  protected override getReferencesFilledFromNamedRecords(): Array<string> {
    return ["monitor"];
  }
}

interface ResourceStubs {
  service: ResourceService;
  rowReads: Array<FindBy<StatusPageResource>>;
  save: Mock<(entity: unknown) => Promise<unknown>>;
  update: Mock<() => Promise<unknown>>;
}

// The monitor the stored resource shows.
let storedMonitor: string;

const resourceService: (service?: ResourceService) => ResourceStubs = (
  service: ResourceService = new ResourceService(),
): ResourceStubs => {
  const rowReads: Array<FindBy<StatusPageResource>> = [];

  getJestSpyOn(service as never, "_findBy").mockImplementation((async (
    findBy: FindBy<StatusPageResource>,
  ): Promise<Array<StatusPageResource>> => {
    rowReads.push(findBy);

    const resource: StatusPageResource = new StatusPageResource();
    resource._id = RESOURCE_ID;
    resource.projectId = PROJECT_ID;
    resource.statusPageId = new ObjectID(PAGE_A);
    resource.monitorId = new ObjectID(storedMonitor);

    return [resource];
  }) as never);

  const save: Mock<(entity: unknown) => Promise<unknown>> = jest.fn(
    async (entity: unknown): Promise<unknown> => {
      (entity as BaseModel)._id = RESOURCE_ID;
      return entity;
    },
  );
  const update: Mock<() => Promise<unknown>> = jest.fn(
    async (): Promise<unknown> => {
      return { affected: 1 };
    },
  );

  getJestSpyOn(service, "getRepository").mockReturnValue({
    save,
    update,
  } as never);
  getJestSpyOn(service, "countBy").mockResolvedValue({
    toNumber: () => {
      return 0;
    },
  } as never);
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );

  return { service, rowReads, save, update };
};

const newResource: (data: {
  monitorId?: string;
  monitor?: string;
}) => StatusPageResource = (data: {
  monitorId?: string;
  monitor?: string;
}): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource.statusPageId = new ObjectID(PAGE_A);
  resource.displayName = "API";

  if (data.monitorId) {
    resource.monitorId = new ObjectID(data.monitorId);
  }

  if (data.monitor) {
    const monitor: Monitor = new Monitor();
    monitor._id = data.monitor;
    resource.monitor = monitor;
  }

  return resource;
};

// An editor of status page resources whose read of monitors is limited to Production.
const RESOURCE_EDITOR: Array<UserPermission> = [
  row(Permission.CreateStatusPageResource),
  row(Permission.EditStatusPageResource),
  row(Permission.ReadStatusPageResource),
  row(Permission.ReadProjectStatusPage),
  row(Permission.ReadProjectMonitor, [PRODUCTION]),
];

describe("a create that names a record in a field of its own", () => {
  beforeEach(() => {
    storedMonitor = PRODUCTION_MONITOR;
  });

  test.each([
    ["by its ID column", { monitorId: STAGING_MONITOR }],
    ["by its relation", { monitor: STAGING_MONITOR }],
  ])(
    "%s, a monitor the creator may not read is refused before the hooks, and nothing is saved",
    async (_name: string, data: { monitorId?: string; monitor?: string }) => {
      const stubs: ResourceStubs = resourceService();

      const refusal: unknown = await refusalOf(
        stubs.service.create({
          data: newResource(data),
          props: member(RESOURCE_EDITOR),
        }),
      );

      expect(refusal).toBeInstanceOf(UnreadableReferenceException);
      expect((refusal as Error).message).toBe(
        `This status page resource references records that are not in this project: Monitor "${STAGING_MONITOR}". Please pick values from this project and try again.`,
      );
      expect(stubs.service.createHookCalls).toBe(0);
      expect(stubs.service.sideEffects).toBe(0);
      expect(stubs.save).not.toHaveBeenCalled();
      expect(monitorReads()).toEqual([[STAGING_MONITOR]]);
    },
  );

  test("a monitor the creator may read is saved, asked about once", async () => {
    const stubs: ResourceStubs = resourceService();

    await stubs.service.create({
      data: newResource({ monitorId: PRODUCTION_MONITOR }),
      props: member(RESOURCE_EDITOR),
    });

    expect(stubs.save).toHaveBeenCalledTimes(1);
    expect(monitorReads()).toEqual([[PRODUCTION_MONITOR]]);
  });

  test("a monitor a hook names besides is asked about after the hooks, before anything is saved", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByCreateHook = STAGING_MONITOR;

    const refusal: unknown = await refusalOf(
      stubs.service.create({
        data: newResource({}),
        props: member(RESOURCE_EDITOR),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(
      `Monitor "${STAGING_MONITOR}"`,
    );
    expect(stubs.service.createHookCalls).toBe(1);
    expect(stubs.save).not.toHaveBeenCalled();
    expect(monitorReads()).toEqual([[STAGING_MONITOR]]);
  });

  test("a monitor a hook names that the caller had named already is not asked about again", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByCreateHook = PRODUCTION_MONITOR.toUpperCase();

    await stubs.service.create({
      data: newResource({ monitorId: PRODUCTION_MONITOR }),
      props: member(RESOURCE_EDITOR),
    });

    expect(stubs.save).toHaveBeenCalledTimes(1);
    expect(monitorReads()).toEqual([[PRODUCTION_MONITOR]]);
  });

  test("a hook that sets something off asks first, and the ask after the hooks does not repeat it", async () => {
    const refused: ResourceStubs = resourceService();
    refused.service.monitorNamedByCreateHook = STAGING_MONITOR;
    refused.service.asksBeforeSideEffect = true;

    const refusal: unknown = await refusalOf(
      refused.service.create({
        data: newResource({}),
        props: member(RESOURCE_EDITOR),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    // Refused before what the hook would set off.
    expect(refused.service.sideEffects).toBe(0);
    expect(refused.save).not.toHaveBeenCalled();

    recordReads = [];

    const allowed: ResourceStubs = resourceService();
    allowed.service.monitorNamedByCreateHook = OTHER_PRODUCTION_MONITOR;
    allowed.service.asksBeforeSideEffect = true;

    await allowed.service.create({
      data: newResource({ monitorId: PRODUCTION_MONITOR }),
      props: member(RESOURCE_EDITOR),
    });

    expect(allowed.service.sideEffects).toBe(1);
    expect(allowed.save).toHaveBeenCalledTimes(1);
    // The caller's monitor before the hooks, the hook's once: never again.
    expect(monitorReads()).toEqual([
      [PRODUCTION_MONITOR],
      [OTHER_PRODUCTION_MONITOR],
    ]);
  });

  test("OneUptime's own creates are not asked, a hook's monitor included", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByCreateHook = STAGING_MONITOR;
    stubs.service.asksBeforeSideEffect = true;

    const resource: StatusPageResource = newResource({});
    resource.projectId = PROJECT_ID;

    await stubs.service.create({
      data: resource,
      props: { isRoot: true },
    });

    expect(stubs.save).toHaveBeenCalledTimes(1);
    expect(monitorReads()).toEqual([]);

    // And a root create asked through the hook's own helper asks nothing.
    await stubs.service.askAboutRecordsNamedSoFar({
      data: newResource({ monitorId: STAGING_MONITOR }),
      props: { isRoot: true },
    });

    expect(monitorReads()).toEqual([]);
  });

  test("a hook that writes one name of the reference beside the caller's other has the record each holds asked about, not a refusal of the two names", async () => {
    const refused: ResourceStubs = resourceService();
    refused.service.monitorNamedByCreateHook = STAGING_MONITOR;

    const refusal: unknown = await refusalOf(
      refused.service.create({
        data: newResource({ monitor: PRODUCTION_MONITOR }),
        props: member(RESOURCE_EDITOR),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toBe(
      `This status page resource references records that are not in this project: Monitor "${STAGING_MONITOR}". Please pick values from this project and try again.`,
    );
    expect(refused.save).not.toHaveBeenCalled();
    // The caller's monitor before the hooks, the hook's after them.
    expect(monitorReads()).toEqual([[PRODUCTION_MONITOR], [STAGING_MONITOR]]);

    recordReads = [];

    const allowed: ResourceStubs = resourceService();
    allowed.service.monitorNamedByCreateHook = OTHER_PRODUCTION_MONITOR;

    await allowed.service.create({
      data: newResource({ monitor: PRODUCTION_MONITOR }),
      props: member(RESOURCE_EDITOR),
    });

    expect(allowed.save).toHaveBeenCalledTimes(1);
    expect(monitorReads()).toEqual([
      [PRODUCTION_MONITOR],
      [OTHER_PRODUCTION_MONITOR],
    ]);
  });
});

describe("a record a hook fills in from one the write names", () => {
  beforeEach(() => {
    storedMonitor = PRODUCTION_MONITOR;
  });

  test("on a create, what the hook fills in is the service's to answer for, not asked about after the hooks", async () => {
    const stubs: ResourceStubs = resourceService(new FillingResourceService());
    stubs.service.monitorNamedByCreateHook = STAGING_MONITOR;

    await stubs.service.create({
      data: newResource({}),
      props: member(RESOURCE_EDITOR),
    });

    expect(stubs.service.createHookCalls).toBe(1);
    expect(stubs.save).toHaveBeenCalledTimes(1);
    expect(monitorReads()).toEqual([]);
  });

  test("on a create, a monitor the caller names there is asked about as theirs, before the hooks", async () => {
    const stubs: ResourceStubs = resourceService(new FillingResourceService());

    const refusal: unknown = await refusalOf(
      stubs.service.create({
        data: newResource({ monitorId: STAGING_MONITOR }),
        props: member(RESOURCE_EDITOR),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(stubs.service.createHookCalls).toBe(0);
    expect(stubs.save).not.toHaveBeenCalled();
    expect(monitorReads()).toEqual([[STAGING_MONITOR]]);
  });

  test("on an update, what the hook fills in is not asked about, and what the caller sent is asked about once", async () => {
    const filled: ResourceStubs = resourceService(new FillingResourceService());
    filled.service.monitorNamedByUpdateHook = STAGING_MONITOR;

    await filled.service.updateOneById({
      id: new ObjectID(RESOURCE_ID),
      data: { displayName: "API" } as never,
      props: member(RESOURCE_EDITOR),
    });

    expect(filled.service.updateHookCalls).toBe(1);
    expect(monitorReads()).toEqual([]);

    const replaced: ResourceStubs = resourceService(
      new FillingResourceService(),
    );
    replaced.service.monitorNamedByUpdateHook = STAGING_MONITOR;

    await replaced.service.updateOneById({
      id: new ObjectID(RESOURCE_ID),
      data: { monitorId: OTHER_PRODUCTION_MONITOR } as never,
      props: member(RESOURCE_EDITOR),
    });

    expect(replaced.service.updateHookCalls).toBe(1);
    expect(monitorReads()).toEqual([[OTHER_PRODUCTION_MONITOR]]);
  });

  test("on an update whose hook changes the rows it writes, what the caller sent there is asked about again, on those rows", async () => {
    // The row the update reaches shows the monitor the caller keeps.
    storedMonitor = STAGING_MONITOR;
    const stubs: ResourceStubs = resourceService(new FillingResourceService());
    stubs.service.replacesQueryInUpdateHook = true;
    // The rows the hook's query reaches show another one.
    stubs.service.onUpdateHook = (): void => {
      storedMonitor = PRODUCTION_MONITOR;
    };

    const refusal: unknown = await refusalOf(
      stubs.service.updateOneById({
        id: new ObjectID(RESOURCE_ID),
        data: { monitorId: STAGING_MONITOR } as never,
        props: member(RESOURCE_EDITOR),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(stubs.service.updateHookCalls).toBe(1);
    expect(stubs.update).not.toHaveBeenCalled();
    // Kept by the row before the hooks, new to the rows after them.
    expect(monitorReads()).toEqual([[STAGING_MONITOR]]);
  });

  test("a service that does not say so has what its hook fills in asked about", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByCreateHook = STAGING_MONITOR;

    const refusal: unknown = await refusalOf(
      stubs.service.create({
        data: newResource({}),
        props: member(RESOURCE_EDITOR),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(stubs.save).not.toHaveBeenCalled();
  });
});

describe("an update that points a record at another one", () => {
  beforeEach(() => {
    storedMonitor = PRODUCTION_MONITOR;
  });

  const updateResource: (
    stubs: ResourceStubs,
    data: Record<string, unknown>,
    props?: DatabaseCommonInteractionProps,
  ) => Promise<number> = async (
    stubs: ResourceStubs,
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = member(RESOURCE_EDITOR),
  ): Promise<number> => {
    return await stubs.service.updateOneById({
      id: new ObjectID(RESOURCE_ID),
      data: data as never,
      props: props,
    });
  };

  test.each([
    ["by its ID column", { monitorId: STAGING_MONITOR }],
    ["by its relation", { monitor: { _id: STAGING_MONITOR } }],
  ])(
    "%s, a monitor the editor may not read is refused before the hooks, and nothing is written",
    async (_name: string, data: Record<string, unknown>) => {
      const stubs: ResourceStubs = resourceService();

      const refusal: unknown = await refusalOf(updateResource(stubs, data));

      expect(refusal).toBeInstanceOf(UnreadableReferenceException);
      expect((refusal as Error).message).toContain(
        `Monitor "${STAGING_MONITOR}"`,
      );
      expect(stubs.service.updateHookCalls).toBe(0);
      expect(stubs.update).not.toHaveBeenCalled();
      expect(stubs.save).not.toHaveBeenCalled();

      // The rows were read with the monitor they show now.
      expect(
        stubs.rowReads.some((read: FindBy<StatusPageResource>): boolean => {
          return (
            (read.select as Record<string, unknown> | undefined)?.[
              "monitorId"
            ] === true
          );
        }),
      ).toBe(true);
    },
  );

  test("keeping the monitor a row shows already asks nothing about it", async () => {
    storedMonitor = STAGING_MONITOR;
    const stubs: ResourceStubs = resourceService();

    await updateResource(stubs, {
      monitorId: STAGING_MONITOR,
      displayName: "API",
    });

    expect(monitorReads()).toEqual([]);
    expect(stubs.service.updateHookCalls).toBe(1);
  });

  test("a monitor the editor may read is written", async () => {
    const stubs: ResourceStubs = resourceService();

    await updateResource(stubs, { monitorId: OTHER_PRODUCTION_MONITOR });

    expect(monitorReads()).toEqual([[OTHER_PRODUCTION_MONITOR]]);
    expect(stubs.service.updateHookCalls).toBe(1);
  });

  test("a monitor a hook points it at is asked about after the hooks, before anything is written", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByUpdateHook = STAGING_MONITOR;

    const refusal: unknown = await refusalOf(
      updateResource(stubs, { displayName: "API" }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(stubs.service.updateHookCalls).toBe(1);
    expect(stubs.update).not.toHaveBeenCalled();
    expect(stubs.save).not.toHaveBeenCalled();
    expect(monitorReads()).toEqual([[STAGING_MONITOR]]);
  });

  test("a hook that writes one name of the reference beside the caller's other has the record each holds asked about, not a refusal of the two names", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByUpdateHook = STAGING_MONITOR;

    const refusal: unknown = await refusalOf(
      updateResource(stubs, { monitor: { _id: OTHER_PRODUCTION_MONITOR } }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(
      `Monitor "${STAGING_MONITOR}"`,
    );
    expect(stubs.update).not.toHaveBeenCalled();
    expect(stubs.save).not.toHaveBeenCalled();
    // The caller's monitor before the hooks, the hook's after them.
    expect(monitorReads()).toEqual([
      [OTHER_PRODUCTION_MONITOR],
      [STAGING_MONITOR],
    ]);
  });

  test("OneUptime's own updates are not asked", async () => {
    const stubs: ResourceStubs = resourceService();

    await updateResource(
      stubs,
      { monitorId: STAGING_MONITOR },
      {
        isRoot: true,
      },
    );

    expect(monitorReads()).toEqual([]);
  });
});

describe("an update that changes the labels a record carries", () => {
  // Every monitor read; changing resources limited to Production.
  const PRODUCTION_RESOURCE_EDITOR: Array<UserPermission> = [
    row(Permission.EditStatusPageResource, [PRODUCTION]),
    row(Permission.ReadStatusPageResource),
    row(Permission.ReadProjectStatusPage),
    row(Permission.ReadProjectMonitor),
  ];

  beforeEach(() => {
    storedMonitor = PRODUCTION_MONITOR;
    readableMonitors = [
      PRODUCTION_MONITOR,
      OTHER_PRODUCTION_MONITOR,
      STAGING_MONITOR,
    ];
  });

  const updateResource: (
    stubs: ResourceStubs,
    data: Record<string, unknown>,
  ) => Promise<number> = async (
    stubs: ResourceStubs,
    data: Record<string, unknown>,
  ): Promise<number> => {
    return await stubs.service.updateOneById({
      id: new ObjectID(RESOURCE_ID),
      data: data as never,
      props: member(PRODUCTION_RESOURCE_EDITOR),
    });
  };

  test("a resource pointed at a monitor outside the editor's labels is refused before the hooks", async () => {
    const stubs: ResourceStubs = resourceService();

    const refusal: unknown = await refusalOf(
      updateResource(stubs, { monitorId: STAGING_MONITOR }),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect((refusal as Error).message).toBe(
      "Your access lets you change Status Page Resources only for records with one of these labels: Production.",
    );
    expect(stubs.service.updateHookCalls).toBe(0);
    expect(stubs.update).not.toHaveBeenCalled();

    // The rows were read with what their labels are read from.
    expect(
      stubs.rowReads.some((read: FindBy<StatusPageResource>): boolean => {
        const select: Record<string, unknown> =
          (read.select as Record<string, unknown> | undefined) || {};

        return select["statusPageId"] === true && select["monitorId"] === true;
      }),
    ).toBe(true);
  });

  test("a resource pointed at another monitor within them is written", async () => {
    const stubs: ResourceStubs = resourceService();

    await updateResource(stubs, { monitorId: OTHER_PRODUCTION_MONITOR });

    expect(stubs.service.updateHookCalls).toBe(1);
  });

  test("a hook that points it outside them is refused after the hooks, before anything is written", async () => {
    const stubs: ResourceStubs = resourceService();
    stubs.service.monitorNamedByUpdateHook = STAGING_MONITOR;

    const refusal: unknown = await refusalOf(
      updateResource(stubs, { monitorId: OTHER_PRODUCTION_MONITOR }),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect(stubs.service.updateHookCalls).toBe(1);
    expect(stubs.update).not.toHaveBeenCalled();
    expect(stubs.save).not.toHaveBeenCalled();
  });

  test("an update that leaves what it names alone is not asked", async () => {
    const stubs: ResourceStubs = resourceService();
    const labelLookups: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      DatabaseService as never,
      "findRecordLabels",
    );

    await updateResource(stubs, { displayName: "Checkout API" });

    expect(labelLookups).not.toHaveBeenCalled();
    expect(stubs.service.updateHookCalls).toBe(1);
  });
});

describe("an update that changes a labelled record's own labels", () => {
  class ServiceWrites extends DatabaseService<Service> {
    public updateHookCalls: number = 0;
    public labelsSetByHook: Array<string> | null = null;

    public constructor() {
      super(Service);
    }

    protected override async onBeforeUpdate(
      updateBy: UpdateBy<Service>,
    ): Promise<OnUpdate<Service>> {
      this.updateHookCalls++;

      if (this.labelsSetByHook) {
        (updateBy.data as Record<string, unknown>)["labels"] =
          this.labelsSetByHook.map((id: string): Label => {
            const label: Label = new Label();
            label._id = id;
            return label;
          });
      }

      return { updateBy: updateBy, carryForward: null };
    }
  }

  const SERVICE_ID: string = "0193c0de-bbbb-4aaa-8bbb-00000000e001";

  const servicesStubbed: () => {
    service: ServiceWrites;
    save: Mock<(entity: unknown) => Promise<unknown>>;
  } = (): {
    service: ServiceWrites;
    save: Mock<(entity: unknown) => Promise<unknown>>;
  } => {
    const service: ServiceWrites = new ServiceWrites();

    getJestSpyOn(service as never, "_findBy").mockImplementation(
      (async (): Promise<Array<Service>> => {
        const stored: Service = new Service();
        stored._id = SERVICE_ID;
        stored.projectId = PROJECT_ID;
        const label: Label = new Label();
        label._id = PRODUCTION;
        stored.labels = [label];
        return [stored];
      }) as never,
    );

    const save: Mock<(entity: unknown) => Promise<unknown>> = jest.fn(
      async (entity: unknown): Promise<unknown> => {
        return entity;
      },
    );

    getJestSpyOn(service, "getRepository").mockReturnValue({
      save,
      update: jest.fn(async (): Promise<unknown> => {
        return { affected: 1 };
      }),
    } as never);
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );

    return { service, save };
  };

  const PRODUCTION_SERVICE_EDITOR: Array<UserPermission> = [
    row(Permission.ReadService),
    row(Permission.EditService, [PRODUCTION]),
  ];

  const relabel: (
    service: ServiceWrites,
    labelIds: Array<string>,
  ) => Promise<number> = async (
    service: ServiceWrites,
    labelIds: Array<string>,
  ): Promise<number> => {
    return await service.updateOneById({
      id: new ObjectID(SERVICE_ID),
      data: {
        labels: labelIds.map((id: string): Record<string, string> => {
          return { _id: id };
        }),
      } as never,
      props: member(PRODUCTION_SERVICE_EDITOR),
    });
  };

  test("a change that takes the last of the editor's labels away is refused before the hooks", async () => {
    const { service, save } = servicesStubbed();

    const refusal: unknown = await refusalOf(relabel(service, [STAGING]));

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect((refusal as Error).message).toBe(
      "Your access lets you change Services only with one of these labels: Production. Keep one of them and try again.",
    );
    expect(service.updateHookCalls).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  test("a change that keeps one of them is written", async () => {
    const { service, save } = servicesStubbed();

    await relabel(service, [PRODUCTION, STAGING]);

    expect(service.updateHookCalls).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("labels a hook writes instead are asked about after the hooks", async () => {
    const { service, save } = servicesStubbed();
    service.labelsSetByHook = [STAGING];

    const refusal: unknown = await refusalOf(
      relabel(service, [PRODUCTION, STAGING]),
    );

    expect(refusal).toBeInstanceOf(UpdateScopeException);
    expect(service.updateHookCalls).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("a creator whose permission to create reaches only what they own", () => {
  class ServiceCreates extends DatabaseService<Service> {
    public events: Array<string> = [];

    public constructor() {
      super(Service);
    }

    protected override async onCreateSuccess(
      _onCreate: OnCreate<Service>,
      createdItem: Service,
    ): Promise<Service> {
      this.events.push("created hooks");
      return createdItem;
    }
  }

  const CREATED_ID: string = "0193c0de-bbbb-4aaa-8bbb-00000000f001";

  interface CreateStubs {
    service: ServiceCreates;
    save: Mock<(entity: unknown) => Promise<unknown>>;
    ownerInsert: ReturnType<typeof getJestSpyOn>;
    ownerRead: ReturnType<typeof getJestSpyOn>;
    undo: ReturnType<typeof getJestSpyOn>;
    realtime: ReturnType<typeof getJestSpyOn>;
  }

  const stubbed: (data: {
    ownerInsertFails?: unknown;
    isOwnerAfterFailure?: boolean;
    undoFails?: boolean;
  }) => CreateStubs = (data: {
    ownerInsertFails?: unknown;
    isOwnerAfterFailure?: boolean;
    undoFails?: boolean;
  }): CreateStubs => {
    const service: ServiceCreates = new ServiceCreates();

    const save: Mock<(entity: unknown) => Promise<unknown>> = jest.fn(
      async (entity: unknown): Promise<unknown> => {
        (entity as BaseModel)._id = CREATED_ID;
        service.events.push("saved");
        return entity;
      },
    );

    getJestSpyOn(service, "getRepository").mockReturnValue({
      save,
    } as never);
    getJestSpyOn(service, "countBy").mockResolvedValue({
      toNumber: () => {
        return 0;
      },
    } as never);
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );

    const realtime: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      service,
      "onTriggerRealtime",
    ).mockResolvedValue(undefined as never);

    const ownerInsert: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ServiceOwnerUserService,
      "create",
    ).mockImplementation((async (args: {
      data: ServiceOwnerUser;
    }): Promise<ServiceOwnerUser> => {
      if (data.ownerInsertFails) {
        service.events.push("owner insert failed");
        throw data.ownerInsertFails;
      }

      service.events.push("owner");
      return args.data;
    }) as never);

    const ownerRead: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ServiceOwnerUserService,
      "findOneBy",
    ).mockResolvedValue(
      (data.isOwnerAfterFailure ? new ServiceOwnerUser() : null) as never,
    );

    const undo: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      service,
      "hardDeleteBy",
    ).mockImplementation((async (): Promise<number> => {
      service.events.push("undone");

      if (data.undoFails) {
        throw new Error("The database went away.");
      }

      return 1;
    }) as never);

    return { service, save, ownerInsert, ownerRead, undo, realtime };
  };

  const newService: () => Service = (): Service => {
    const created: Service = new Service();
    created.name = "Checkout";
    return created;
  };

  const OWNED_CREATOR: Array<UserPermission> = [
    row(Permission.CreateService, [], PermissionScope.Owned),
    row(Permission.ReadService, [], PermissionScope.Owned),
  ];

  test("is made its owner right after the save, before its hooks", async () => {
    const stubs: CreateStubs = stubbed({});
    const props: DatabaseCommonInteractionProps = member(OWNED_CREATOR);

    await stubs.service.create({ data: newService(), props: props });

    expect(stubs.service.events).toEqual(["saved", "owner", "created hooks"]);
    expect(stubs.ownerInsert).toHaveBeenCalledTimes(1);

    const written: { data: ServiceOwnerUser; props: unknown } = stubs
      .ownerInsert.mock.calls[0]![0] as {
      data: ServiceOwnerUser;
      props: unknown;
    };

    expect(written.props).toEqual({ isRoot: true });
    expect(written.data.serviceId?.toString()).toBe(CREATED_ID);
    expect(written.data.userId?.toString()).toBe(props.userId!.toString());
    expect(written.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(stubs.undo).not.toHaveBeenCalled();
  });

  test("when they could not be made its owner, the record is removed and the create refused", async () => {
    const stubs: CreateStubs = stubbed({
      ownerInsertFails: new Error("The database went away."),
    });

    const refusal: unknown = await refusalOf(
      stubs.service.create({
        data: newService(),
        props: member(OWNED_CREATOR),
      }),
    );

    expect(refusal).toBeInstanceOf(ServerException);
    expect((refusal as Error).message).toBe(
      "This Service was not created: your access lets you create only the Services you own, and you could not be made its owner. Please try again.",
    );

    // Removed as OneUptime, with nothing else done to it.
    expect(stubs.undo).toHaveBeenCalledTimes(1);
    expect(stubs.undo.mock.calls[0]![0]).toEqual({
      query: { _id: CREATED_ID },
      limit: 1,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });
    expect(stubs.service.events).toEqual([
      "saved",
      "owner insert failed",
      "undone",
    ]);
    expect(stubs.realtime).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("an insert refused because they own it already leaves the record theirs", async () => {
    const stubs: CreateStubs = stubbed({
      ownerInsertFails: PostgresErrorTranslator.createUniqueViolationException(
        "This owner exists already.",
      ),
      isOwnerAfterFailure: true,
    });

    await stubs.service.create({
      data: newService(),
      props: member(OWNED_CREATOR),
    });

    expect(stubs.ownerRead).toHaveBeenCalledTimes(1);
    expect(stubs.undo).not.toHaveBeenCalled();
    expect(stubs.service.events).toEqual([
      "saved",
      "owner insert failed",
      "created hooks",
    ]);
  });

  test("a failed removal still refuses the create", async () => {
    const stubs: CreateStubs = stubbed({
      ownerInsertFails: new Error("The database went away."),
      undoFails: true,
    });

    const refusal: unknown = await refusalOf(
      stubs.service.create({
        data: newService(),
        props: member(OWNED_CREATOR),
      }),
    );

    expect(refusal).toBeInstanceOf(ServerException);
    expect(stubs.undo).toHaveBeenCalledTimes(1);
    expect(stubs.service.events).not.toContain("created hooks");
  });

  test("a create that skips its hooks makes them its owner all the same", async () => {
    const stubs: CreateStubs = stubbed({});

    await stubs.service.create({
      data: newService(),
      props: { ...member(OWNED_CREATOR), ignoreHooks: true },
    });

    expect(stubs.service.events).toEqual(["saved", "owner"]);
  });

  test("a creator who reaches every service keeps the best effort: owner after the hooks, a failure logged and the record kept", async () => {
    const kept: CreateStubs = stubbed({});

    await kept.service.create({
      data: newService(),
      props: member([row(Permission.CreateService)]),
    });

    expect(kept.service.events).toEqual(["saved", "created hooks", "owner"]);

    const failed: CreateStubs = stubbed({
      ownerInsertFails: new Error("The database went away."),
    });

    const created: Service = await failed.service.create({
      data: newService(),
      props: member([row(Permission.CreateService)]),
    });

    expect(created._id).toBe(CREATED_ID);
    expect(failed.undo).not.toHaveBeenCalled();
    expect(failed.ownerRead).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

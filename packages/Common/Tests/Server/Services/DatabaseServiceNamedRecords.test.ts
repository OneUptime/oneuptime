import DatabaseService from "../../../Server/Services/DatabaseService";
import HostOwnerUserService from "../../../Server/Services/HostOwnerUserService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import {
  UnreadableParentException,
  UnreadableReferenceException,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
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
 * DatabaseService holds every create and update to what its caller may
 * read, once, in the shared path:
 *
 *   - an update that gives a record a parent it does not have - a status
 *     page added to an announcement - is asked about before the update's
 *     hooks run, on the rows the caller may update as they are now, and
 *     again after the hooks should they name another parent; nothing is
 *     written when it is refused;
 *   - the records a create or an update lists are asked about before the
 *     hooks run, on what the caller sent;
 *   - a create is held to its create permission's scope once the hooks have
 *     run, on the record as it will be saved;
 *   - the lookups OneUptime makes for them are held to the project.
 *
 * No database is touched: the reads and the writes are stubbed, and
 * whatever reaches them is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000001",
);
const PRODUCTION: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-0000000000a1",
);
const STAGING: ObjectID = new ObjectID("0193c0de-ffff-4aaa-8bbb-0000000000a2");

const ANNOUNCEMENT_ID: string = "0193c0de-ffff-4aaa-8bbb-00000000c001";
const PAGE_A: string = "0193c0de-ffff-4aaa-8bbb-00000000d001";
const PAGE_B: string = "0193c0de-ffff-4aaa-8bbb-00000000d002";
const PAGE_C: string = "0193c0de-ffff-4aaa-8bbb-00000000d003";
const MONITOR_A: string = "0193c0de-ffff-4aaa-8bbb-00000000a001";
const MONITOR_B: string = "0193c0de-ffff-4aaa-8bbb-00000000a002";

const row: (
  permission: Permission,
  labelIds?: Array<ObjectID>,
  scope?: PermissionScope,
) => UserPermission = (
  permission: Permission,
  labelIds: Array<ObjectID> = [],
  scope?: PermissionScope,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds,
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

// An editor of announcements who reads the status pages and monitors carrying one label.
const EDITOR: Array<UserPermission> = [
  row(Permission.CreateStatusPageAnnouncement),
  row(Permission.EditStatusPageAnnouncement),
  row(Permission.ReadStatusPageAnnouncement),
  row(Permission.ReadProjectStatusPage, [PRODUCTION]),
  row(Permission.ReadProjectMonitor, [PRODUCTION]),
];

const asStatusPages: (ids: Array<string>) => Array<StatusPage> = (
  ids: Array<string>,
): Array<StatusPage> => {
  return ids.map((id: string): StatusPage => {
    const page: StatusPage = new StatusPage();
    page._id = id;
    return page;
  });
};

const asMonitors: (ids: Array<string>) => Array<Monitor> = (
  ids: Array<string>,
): Array<Monitor> => {
  return ids.map((id: string): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    return monitor;
  });
};

/*
 * An announcement service whose update hook may name another status page,
 * as a hook that derives a record's parents would.
 */
class AnnouncementService extends DatabaseService<StatusPageAnnouncement> {
  public pageAddedByHook: string | null = null;
  public updateHookCalls: number = 0;
  public createHookCalls: number = 0;

  public constructor() {
    super(StatusPageAnnouncement);
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<StatusPageAnnouncement>,
  ): Promise<OnUpdate<StatusPageAnnouncement>> {
    this.updateHookCalls++;

    if (this.pageAddedByHook) {
      const data: Record<string, unknown> = updateBy.data as Record<
        string,
        unknown
      >;
      data["statusPages"] = [
        ...((data["statusPages"] as Array<unknown>) || []),
        { _id: this.pageAddedByHook },
      ];
    }

    return { updateBy: updateBy, carryForward: null };
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<StatusPageAnnouncement>,
  ): Promise<OnCreate<StatusPageAnnouncement>> {
    this.createHookCalls++;
    return { createBy: createBy, carryForward: null };
  }
}

interface RowRead {
  findBy: FindBy<StatusPageAnnouncement>;
}

let service: AnnouncementService;
let rowReads: Array<RowRead>;
let storedPages: Array<string>;
let storedMonitors: Array<string>;
let readablePages: Array<string>;
let readableMonitors: Array<string>;
let parentReads: Array<{ modelType: string; ids: Array<string> }>;
let save: Mock<(entity: unknown) => Promise<unknown>>;
let update: Mock<() => Promise<unknown>>;

beforeEach(() => {
  stubProjectDirectory({});

  /*
   * The label join tables and the announcement's own, as a migrated
   * database describes them: the record rule follows its status pages
   * through them, and their labels.
   */
  getJestSpyOn(QueryUtil, "getManyToManyRelationMetadata").mockImplementation(((
    modelType: { new (): BaseModel },
    propertyPath: string,
  ) => {
    if (propertyPath === new modelType().getAccessControlColumn()) {
      return getLabelJoinTable(modelType);
    }

    if (modelType === (StatusPageAnnouncement as unknown)) {
      if (propertyPath === "statusPages") {
        return {
          joinTableName: "AnnouncementStatusPage",
          ownerColumnName: "announcementId",
          relationColumnName: "statusPageId",
        };
      }

      if (propertyPath === "monitors") {
        return {
          joinTableName: "AnnouncementMonitor",
          ownerColumnName: "announcementId",
          relationColumnName: "monitorId",
        };
      }
    }

    return null;
  }) as never);

  service = new AnnouncementService();
  rowReads = [];
  parentReads = [];
  storedPages = [PAGE_A];
  storedMonitors = [];
  readablePages = [PAGE_A, PAGE_C];
  readableMonitors = [MONITOR_A];

  // The rows an update reaches, as they are stored now.
  getJestSpyOn(service as never, "_findBy").mockImplementation((async (
    findBy: FindBy<StatusPageAnnouncement>,
  ): Promise<Array<StatusPageAnnouncement>> => {
    rowReads.push({ findBy: findBy });

    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement._id = ANNOUNCEMENT_ID;
    announcement.projectId = PROJECT_ID;
    announcement.statusPages = asStatusPages(storedPages);
    announcement.monitors = asMonitors(storedMonitors);

    return [announcement];
  }) as never);

  // The status pages and monitors the caller's read finds.
  getJestSpyOn(
    DatabaseService as never,
    "findReadableParentIds",
  ).mockImplementation((async (lookup: {
    parentModelType: { new (): BaseModel };
    ids: Array<string>;
  }): Promise<Array<string>> => {
    const table: string = new lookup.parentModelType().tableName || "";
    parentReads.push({ modelType: table, ids: lookup.ids });

    const readable: Array<string> =
      table === "Monitor" ? readableMonitors : readablePages;

    return lookup.ids.filter((id: string): boolean => {
      return readable.includes(id);
    });
  }) as never);

  save = jest.fn(async (entity: unknown): Promise<unknown> => {
    return entity;
  });
  update = jest.fn(async (): Promise<unknown> => {
    return { affected: 1 };
  });

  getJestSpyOn(service, "getRepository").mockReturnValue({
    save,
    update,
  } as never);
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const updateAnnouncement: (
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
) => Promise<number> = async (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = member(EDITOR),
): Promise<number> => {
  return await service.updateOneById({
    id: new ObjectID(ANNOUNCEMENT_ID),
    data: data as never,
    props: props,
  });
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

describe("an update that gives a record a parent it does not have", () => {
  test("is refused before its hooks run, and nothing is written", async () => {
    const refusal: unknown = await refusalOf(
      updateAnnouncement({
        statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }],
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableParentException);
    expect((refusal as Error).message).toContain(`Status Pages "${PAGE_B}"`);
    expect(service.updateHookCalls).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    // Only the page the announcement does not have was read, as the editor.
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_B] }]);
  });

  test("reads the rows it writes as they are now, through the query the editor may update with", async () => {
    const updatable: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ModelPermission,
      "getUpdatableQuery",
    );

    await refusalOf(
      updateAnnouncement({
        statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }],
      }),
    );

    const read: RowRead | undefined = rowReads.find((each: RowRead) => {
      return Boolean(
        (each.findBy.select as Record<string, unknown> | undefined)?.[
          "statusPages"
        ],
      );
    });

    expect(read).toBeDefined();
    expect(read!.findBy.props.isRoot).toBe(true);
    expect(read!.findBy.select).toMatchObject({
      _id: true,
      projectId: true,
      statusPages: { _id: true },
    });
    // The query the editor may update with: their project, their record rule.
    const queries: Array<unknown> = [];

    for (const result of updatable.mock.results) {
      queries.push(await (result.value as Promise<unknown>));
    }

    expect(queries).toContain(read!.findBy.query);
    expect(JSON.stringify(read!.findBy.query.projectId)).toContain(
      PROJECT_ID.toString(),
    );
  });

  test("a page the editor may read is added, and the update runs its hooks and writes", async () => {
    await updateAnnouncement({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    expect(service.updateHookCalls).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("keeping a page the editor may not read asks nothing about it", async () => {
    storedPages = [PAGE_A, PAGE_B];

    await updateAnnouncement({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }],
    });

    expect(parentReads).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("a page a hook adds is asked about after the hooks, before anything is written", async () => {
    service.pageAddedByHook = PAGE_B;

    const refusal: unknown = await refusalOf(
      updateAnnouncement({
        statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableParentException);
    expect(service.updateHookCalls).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(parentReads).toEqual([
      { modelType: "StatusPage", ids: [PAGE_C] },
      { modelType: "StatusPage", ids: [PAGE_B] },
    ]);
  });

  test("an update that names no parent reads nothing more", async () => {
    await updateAnnouncement({ title: "Renamed" });

    expect(parentReads).toEqual([]);
    expect(
      rowReads.filter((each: RowRead) => {
        return Boolean(
          (each.findBy.select as Record<string, unknown> | undefined)?.[
            "statusPages"
          ] &&
            typeof (each.findBy.select as Record<string, unknown>)[
              "statusPages"
            ] === "object",
        );
      }),
    ).toEqual([]);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("OneUptime's own update is not asked", async () => {
    await updateAnnouncement(
      { statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }] },
      { isRoot: true },
    );

    expect(parentReads).toEqual([]);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("a write that lists records", () => {
  test("an update that adds a monitor the editor may not read is refused before its hooks", async () => {
    const refusal: unknown = await refusalOf(
      updateAnnouncement({
        monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(`Monitors "${MONITOR_B}"`);
    expect(service.updateHookCalls).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  test("an update keeps a monitor it lists already, unasked", async () => {
    storedMonitors = [MONITOR_B];

    await updateAnnouncement({
      monitors: [{ _id: MONITOR_A }, { _id: MONITOR_B }],
    });

    expect(parentReads).toEqual([{ modelType: "Monitor", ids: [MONITOR_A] }]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("a create that lists a monitor the creator may not read is refused before its hooks", async () => {
    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement.title = "Maintenance";
    announcement.statusPages = asStatusPages([PAGE_A]);
    announcement.monitors = asMonitors([MONITOR_B]);

    const refusal: unknown = await refusalOf(
      service.create({ data: announcement, props: member(EDITOR) }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(`Monitors "${MONITOR_B}"`);
    expect(service.createHookCalls).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  test("a plain service checks no reference itself: every record named is looked up, for an admin too", async () => {
    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement.title = "Maintenance";
    announcement.statusPages = asStatusPages([PAGE_A]);
    announcement.monitors = asMonitors([MONITOR_B]);

    const refusal: unknown = await refusalOf(
      service.create({
        data: announcement,
        props: member([row(Permission.ProjectAdmin)]),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(parentReads).toEqual([
      { modelType: "StatusPage", ids: [PAGE_A] },
      { modelType: "Monitor", ids: [MONITOR_B] },
    ]);
  });
});

describe("what decides whether a lookup is made", () => {
  test("a service whose own hooks hold its references to the project says so; a plain one does not", () => {
    const asked: (service: unknown) => boolean = (target: unknown): boolean => {
      return (
        target as { checksReferencesInProject: () => boolean }
      ).checksReferencesInProject();
    };

    expect(asked(new DatabaseService(StatusPageAnnouncement))).toBe(false);
    expect(asked(new ProjectReferencesService(StatusPageAnnouncement))).toBe(
      true,
    );
    expect(asked(StatusPageAnnouncementService)).toBe(true);
  });
});

describe("the lookups OneUptime makes for a write", () => {
  test("records in the project: ids alone, as root, pinned to the project", async () => {
    const reads: Array<FindBy<BaseModel>> = [];

    getJestSpyOn(DatabaseService.prototype, "findBy").mockImplementation(
      async function (
        this: DatabaseService<BaseModel>,
        findBy: FindBy<BaseModel>,
      ): Promise<Array<BaseModel>> {
        reads.push(findBy);
        const page: StatusPage = new StatusPage();
        page._id = PAGE_A;
        return [page];
      } as never,
    );

    const found: Array<string> = await (
      DatabaseService as unknown as {
        findIdsInProject: (data: {
          modelType: { new (): BaseModel };
          ids: Array<string>;
          query: Record<string, unknown>;
          projectId: ObjectID | null;
        }) => Promise<Array<string>>;
      }
    ).findIdsInProject({
      modelType: StatusPage,
      ids: [PAGE_A, PAGE_B],
      query: { _id: PAGE_A },
      projectId: PROJECT_ID,
    });

    expect(found).toEqual([PAGE_A]);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect(reads[0]!.select).toEqual({ _id: true });
    expect(reads[0]!.limit).toBe(2);
    expect(
      (reads[0]!.query as unknown as Record<string, unknown>)["projectId"],
    ).toEqual(new Includes([PROJECT_ID.toString()]));

    // No project to hold them to: none found, nothing read.
    await expect(
      (
        DatabaseService as unknown as {
          findIdsInProject: (data: {
            modelType: { new (): BaseModel };
            ids: Array<string>;
            query: Record<string, unknown>;
            projectId: ObjectID | null;
          }) => Promise<Array<string>>;
        }
      ).findIdsInProject({
        modelType: StatusPage,
        ids: [PAGE_A],
        query: { _id: PAGE_A },
        projectId: null,
      }),
    ).resolves.toEqual([]);

    expect(reads).toHaveLength(1);
  });

  test("the labels of named records: their labels' ids, as root, in the project, lower-cased", async () => {
    const reads: Array<FindBy<BaseModel>> = [];

    getJestSpyOn(DatabaseService.prototype, "findBy").mockImplementation(
      async function (
        this: DatabaseService<BaseModel>,
        findBy: FindBy<BaseModel>,
      ): Promise<Array<BaseModel>> {
        reads.push(findBy);
        const page: StatusPage = new StatusPage();
        page._id = PAGE_A.toUpperCase();
        const label: Label = new Label();
        label._id = PRODUCTION.toString().toUpperCase();
        page.labels = [label];
        return [page];
      } as never,
    );

    const labels: Record<string, Array<string>> = await (
      DatabaseService as unknown as {
        findRecordLabels: (data: {
          modelType: { new (): BaseModel };
          ids: Array<string>;
          projectId: ObjectID | null;
        }) => Promise<Record<string, Array<string>>>;
      }
    ).findRecordLabels({
      modelType: StatusPage,
      ids: [PAGE_A],
      projectId: PROJECT_ID,
    });

    expect(labels).toEqual({ [PAGE_A]: [PRODUCTION.toString()] });
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect(reads[0]!.select).toEqual({ _id: true, labels: { _id: true } });
    expect(
      (reads[0]!.query as unknown as Record<string, unknown>)["projectId"],
    ).toEqual(new Includes([PROJECT_ID.toString()]));
  });

  test("the names of labels, in the order asked, an unknown one by its id", async () => {
    getJestSpyOn(DatabaseService.prototype, "findBy").mockImplementation(
      async function (
        this: DatabaseService<BaseModel>,
        findBy: FindBy<BaseModel>,
      ): Promise<Array<BaseModel>> {
        expect(this.modelType).toBe(Label);
        expect(findBy.props).toEqual({ isRoot: true });
        expect(
          String(
            (findBy.query as unknown as Record<string, unknown>)["projectId"],
          ),
        ).toBe(PROJECT_ID.toString());

        const label: Label = new Label();
        label._id = PRODUCTION.toString();
        label.name = "Production";
        return [label];
      } as never,
    );

    await expect(
      (
        DatabaseService as unknown as {
          findLabelNames: (data: {
            labelIds: Array<string>;
            projectId: ObjectID | null;
          }) => Promise<Array<string>>;
        }
      ).findLabelNames({
        labelIds: [STAGING.toString(), PRODUCTION.toString()],
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual([STAGING.toString(), "Production"]);
  });
});

describe("a create held to its create permission's scope", () => {
  class ServiceWrites extends DatabaseService<Service> {
    public labelAddedByHook: ObjectID | null = null;

    public constructor() {
      super(Service);
    }

    protected override async onBeforeCreate(
      createBy: CreateBy<Service>,
    ): Promise<OnCreate<Service>> {
      if (this.labelAddedByHook) {
        const label: Label = new Label();
        label._id = this.labelAddedByHook.toString();
        createBy.data.labels = [label];
      }

      return { createBy: createBy, carryForward: null };
    }
  }

  const newService: () => Service = (): Service => {
    const created: Service = new Service();
    created.name = "Checkout";
    return created;
  };

  test("is asked once the hooks have run, on the record as it will be saved", async () => {
    const writes: ServiceWrites = new ServiceWrites();
    const saved: Mock<(entity: unknown) => Promise<unknown>> = jest.fn(
      async (entity: unknown): Promise<unknown> => {
        return entity;
      },
    );

    getJestSpyOn(writes, "getRepository").mockReturnValue({
      save: saved,
    } as never);
    getJestSpyOn(writes, "countBy").mockResolvedValue({
      toNumber: () => {
        return 0;
      },
    } as never);
    getJestSpyOn(writes, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(writes, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(DatabaseService as never, "findLabelNames").mockImplementation(
      (async (lookup: { labelIds: Array<string> }) => {
        return lookup.labelIds;
      }) as never,
    );
    const scope: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ModelPermission,
      "checkCreateScopePermission",
    );

    const props: DatabaseCommonInteractionProps = member([
      row(Permission.CreateService, [PRODUCTION]),
      row(Permission.ReadService),
    ]);

    // No label: refused, nothing saved.
    const refusal: unknown = await refusalOf(
      writes.create({ data: newService(), props: props }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as Error).message).toContain(PRODUCTION.toString());
    expect(saved).not.toHaveBeenCalled();

    // A hook gives it the label: the record as it will be saved carries it.
    writes.labelAddedByHook = PRODUCTION;

    await writes.create({ data: newService(), props: props });

    expect(saved).toHaveBeenCalledTimes(1);
    expect(scope).toHaveBeenCalledTimes(2);
  });
});

describe("the creator of a record with owners of its own becomes one of them", () => {
  test("for a host too, which is no operational resource", async () => {
    const owners: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      HostOwnerUserService,
      "create",
    ).mockResolvedValue({} as never);

    const writes: DatabaseService<Host> = new DatabaseService<Host>(Host);
    const userId: ObjectID = ObjectID.generate();
    const host: Host = new Host();
    host.id = ObjectID.generate();
    host.projectId = PROJECT_ID;

    await (
      writes as unknown as {
        autoOwnerOnCreate: (
          createdItem: Host,
          props: DatabaseCommonInteractionProps,
        ) => Promise<void>;
      }
    ).autoOwnerOnCreate(host, {
      userId: userId,
      tenantId: PROJECT_ID,
    });

    expect(owners).toHaveBeenCalledTimes(1);

    const created: { data: BaseModel; props: DatabaseCommonInteractionProps } =
      owners.mock.calls[0]![0] as {
        data: BaseModel;
        props: DatabaseCommonInteractionProps;
      };

    expect(created.props).toEqual({ isRoot: true });
    expect(
      (created.data as unknown as Record<string, unknown>)["hostId"],
    ).toEqual(host.id);
    expect(
      (created.data as unknown as Record<string, unknown>)["userId"],
    ).toEqual(userId);
  });

  test("but not for an API key's create, which no person makes", async () => {
    const owners: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      HostOwnerUserService,
      "create",
    ).mockResolvedValue({} as never);

    const host: Host = new Host();
    host.id = ObjectID.generate();
    host.projectId = PROJECT_ID;

    await (
      new DatabaseService<Host>(Host) as unknown as {
        autoOwnerOnCreate: (
          createdItem: Host,
          props: DatabaseCommonInteractionProps,
        ) => Promise<void>;
      }
    ).autoOwnerOnCreate(host, { tenantId: PROJECT_ID, userType: UserType.API });

    expect(owners).not.toHaveBeenCalled();
  });
});

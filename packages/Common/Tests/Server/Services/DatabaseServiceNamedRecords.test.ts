import DatabaseService from "../../../Server/Services/DatabaseService";
import HostOwnerUserService from "../../../Server/Services/HostOwnerUserService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
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
  // A hook that narrows the update's query in place.
  public queryNarrowedByHook: boolean = false;
  // Run by the update hook, as it runs.
  public duringUpdateHook: (() => void) | null = null;
  // A hook that checks the rows the update writes, holding it to them.
  public holdsUpdateInHook: boolean = false;
  // A hook that names the one row the update writes by its plain id.
  public rowNamedByHook: string | null = null;
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

    if (this.queryNarrowedByHook) {
      (updateBy.query as Record<string, unknown>)["title"] = "Launch";
    }

    if (this.holdsUpdateInHook) {
      await this.findRowsAndHoldUpdateToThem(updateBy, { _id: true });
    }

    if (this.rowNamedByHook) {
      updateBy.query = {
        ...updateBy.query,
        _id: this.rowNamedByHook,
      } as UpdateBy<StatusPageAnnouncement>["query"];
    }

    if (this.duringUpdateHook) {
      this.duringUpdateHook();
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
// The announcements an update reaches, as they are stored now.
let storedAnnouncements: Array<string>;
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
  storedAnnouncements = [ANNOUNCEMENT_ID];
  storedPages = [PAGE_A];
  storedMonitors = [];
  readablePages = [PAGE_A, PAGE_C];
  readableMonitors = [MONITOR_A];

  // The rows an update reaches, as they are stored now.
  getJestSpyOn(service as never, "_findBy").mockImplementation((async (
    findBy: FindBy<StatusPageAnnouncement>,
  ): Promise<Array<StatusPageAnnouncement>> => {
    rowReads.push({ findBy: findBy });

    return storedAnnouncements.map((id: string): StatusPageAnnouncement => {
      const announcement: StatusPageAnnouncement =
        new StatusPageAnnouncement();
      announcement._id = id;
      announcement.projectId = PROJECT_ID;
      announcement.statusPages = asStatusPages(storedPages);
      announcement.monitors = asMonitors(storedMonitors);
      return announcement;
    });
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

/*
 * An update of the announcements a filter names - two of them, whose query
 * names neither by id (keepRowsCallerMayWrite keeps it to the project).
 */
const SECOND_ANNOUNCEMENT_ID: string = "0193c0de-ffff-4aaa-8bbb-00000000c002";

const updateAnnouncementsWhere: (
  query: Record<string, unknown>,
  data: Record<string, unknown>,
) => Promise<number> = async (
  query: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<number> => {
  storedAnnouncements = [ANNOUNCEMENT_ID, SECOND_ANNOUNCEMENT_ID];

  return await service.updateBy({
    query: query as never,
    data: data as never,
    skip: 0,
    limit: 10,
    props: member(EDITOR),
  });
};

// The reads of the rows an update writes, with the status pages they have.
const rowReadsWithPages: () => Array<RowRead> = (): Array<RowRead> => {
  return rowReads.filter((each: RowRead): boolean => {
    const select: Record<string, unknown> | undefined = each.findBy.select as
      | Record<string, unknown>
      | undefined;

    return (
      Boolean(select?.["statusPages"]) &&
      typeof select?.["statusPages"] === "object"
    );
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

  test("a page a hook adds is asked about on the rows read before the hooks, when the hooks keep the query", async () => {
    service.pageAddedByHook = PAGE_C;

    await updateAnnouncement({
      statusPages: [{ _id: PAGE_A }],
    });

    // Kept as it was before the hooks, then the page the hook added.
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    expect(rowReadsWithPages()).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("a hook that changes the query of an update by filter has the rows it writes read again", async () => {
    service.pageAddedByHook = PAGE_C;
    service.queryNarrowedByHook = true;

    await updateAnnouncementsWhere(
      { description: "Planned" },
      {
        statusPages: [{ _id: PAGE_A }],
      },
    );

    const reads: Array<RowRead> = rowReadsWithPages();

    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    expect(reads).toHaveLength(2);
    expect(JSON.stringify(reads[1]!.findBy.query)).toContain("Launch");
    expect(save).toHaveBeenCalledTimes(2);
  });

  /*
   * An update that names its one row by id - updateOneById - writes no row
   * but that one, whatever a hook adds to its query: what was asked of the
   * row stands, and it is not read again.
   */
  test("a hook that narrows an update of one row by id has nothing read or asked again", async () => {
    service.pageAddedByHook = PAGE_C;
    service.queryNarrowedByHook = true;

    await updateAnnouncement({
      statusPages: [{ _id: PAGE_A }],
    });

    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    expect(rowReadsWithPages()).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("the rows it writes are read once before its hooks, with the pages they have", async () => {
    let readsBeforeHook: number = -1;
    service.duringUpdateHook = (): void => {
      readsBeforeHook = rowReads.length;
    };

    await updateAnnouncement({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    // The read that keeps the rows the editor may update, with their pages.
    expect(readsBeforeHook).toBe(1);
    expect(rowReadsWithPages()).toHaveLength(1);
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("a page every row had before the hooks is asked about on the rows a hook has the update reach instead", async () => {
    storedPages = [PAGE_A, PAGE_B];
    readablePages = [PAGE_A];
    service.queryNarrowedByHook = true;
    service.duringUpdateHook = (): void => {
      // The rows the narrowed query reaches are on page A only.
      storedPages = [PAGE_A];
    };

    const refusal: unknown = await refusalOf(
      updateAnnouncementsWhere(
        { description: "Planned" },
        {
          statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }],
        },
      ),
    );

    expect(refusal).toBeInstanceOf(UnreadableParentException);
    expect((refusal as Error).message).toContain(`Status Pages "${PAGE_B}"`);
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_B] }]);
    expect(save).not.toHaveBeenCalled();
  });

  test("a hook that names a page with other letter case asks nothing more", async () => {
    service.pageAddedByHook = PAGE_C.toUpperCase();

    await updateAnnouncement({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    expect(rowReadsWithPages()).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
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

/*
 * A HOOK THAT HOLDS AN UPDATE TO THE ROWS IT READS LEAVES WHAT WAS ASKED OF
 * THEM STANDING.
 *
 * The records an update names are asked about before its hooks, on the rows
 * the caller may update (keepRowsCallerMayWrite). A hook that then reads the
 * rows the update writes holds it to them by their ids
 * (findRowsAndHoldUpdateToThem): the update writes no row but ones already
 * asked about, so the asks after the hooks neither read the rows again nor
 * ask about any record again. A hook that has the update reach a row that
 * was not read has the rows read again.
 */
describe("a hook that holds an update to the rows it reads", () => {
  const UNREAD_ANNOUNCEMENT_ID: string =
    "0193c0de-ffff-4aaa-8bbb-00000000c003";

  // An update of every announcement named Launch: two of them.
  const updateLaunches: (data: Record<string, unknown>) => Promise<number> =
    async (data: Record<string, unknown>): Promise<number> => {
      return await updateAnnouncementsWhere({ title: "Launch" }, data);
    };

  test("an update of several rows reads them with their pages once, and asks about the page it adds once", async () => {
    service.holdsUpdateInHook = true;

    await updateLaunches({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    // Read once, before the hooks: the hold named only rows read then.
    expect(rowReadsWithPages()).toHaveLength(1);
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
    // Each announcement written, by the save a list of pages needs.
    expect(save).toHaveBeenCalledTimes(2);
  });

  test("the update is held to the rows the hook read, by their ids", async () => {
    service.holdsUpdateInHook = true;

    let heldQuery: Record<string, unknown> = {};

    const findRowsAndHoldUpdateToThem: (
      ...args: Array<unknown>
    ) => Promise<unknown> = service.findRowsAndHoldUpdateToThem.bind(
      service,
    ) as unknown as (...args: Array<unknown>) => Promise<unknown>;

    getJestSpyOn(service, "findRowsAndHoldUpdateToThem").mockImplementation(
      (async (...args: Array<unknown>): Promise<unknown> => {
        const rows: unknown = await findRowsAndHoldUpdateToThem(...args);
        heldQuery = (args[0] as { query: Record<string, unknown> }).query;
        return rows;
      }) as never,
    );

    await updateLaunches({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    expect(heldQuery["title"]).toBe("Launch");
    expect(JSON.stringify(heldQuery["_id"])).toContain(ANNOUNCEMENT_ID);
    expect(JSON.stringify(heldQuery["_id"])).toContain(SECOND_ANNOUNCEMENT_ID);
  });

  test("a hook that holds the update to the rows it reads and adds a page asks about that page alone, on the rows read before the hooks", async () => {
    service.holdsUpdateInHook = true;
    service.pageAddedByHook = PAGE_C;

    await updateLaunches({
      statusPages: [{ _id: PAGE_A }],
    });

    expect(rowReadsWithPages()).toHaveLength(1);
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
  });

  test("a hook that has the update reach a row that was not read has the rows read again, and every page asked about on them", async () => {
    service.rowNamedByHook = UNREAD_ANNOUNCEMENT_ID;

    await updateLaunches({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    expect(rowReadsWithPages()).toHaveLength(2);
    expect(parentReads).toEqual([
      { modelType: "StatusPage", ids: [PAGE_C] },
      { modelType: "StatusPage", ids: [PAGE_C] },
    ]);
  });

  test("a hook that names one of the rows read by its plain id asks nothing again", async () => {
    service.rowNamedByHook = SECOND_ANNOUNCEMENT_ID;

    await updateLaunches({
      statusPages: [{ _id: PAGE_A }, { _id: PAGE_C }],
    });

    expect(rowReadsWithPages()).toHaveLength(1);
    expect(parentReads).toEqual([{ modelType: "StatusPage", ids: [PAGE_C] }]);
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
  test("a write that skips its hooks has every record it names looked up, though the service's hooks would hold them to the project", async () => {
    getJestSpyOn(service as never, "checksReferencesInProject").mockReturnValue(
      true as never,
    );

    const announcementOnPageAWithMonitorB: () => StatusPageAnnouncement =
      (): StatusPageAnnouncement => {
        const announcement: StatusPageAnnouncement =
          new StatusPageAnnouncement();
        announcement.title = "Maintenance";
        announcement.statusPages = asStatusPages([PAGE_A]);
        announcement.monitors = asMonitors([MONITOR_B]);
        return announcement;
      };

    // With its hooks, which hold the records to the project: none looked up.
    await refusalOf(
      service.create({
        data: announcementOnPageAWithMonitorB(),
        props: member([row(Permission.ProjectAdmin)]),
      }),
    );

    expect(service.createHookCalls).toBe(1);
    expect(parentReads).toEqual([]);

    // Without them, nothing else would: each record is looked up.
    const refusal: unknown = await refusalOf(
      service.create({
        data: announcementOnPageAWithMonitorB(),
        props: { ...member([row(Permission.ProjectAdmin)]), ignoreHooks: true },
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(parentReads).toEqual([
      { modelType: "StatusPage", ids: [PAGE_A] },
      { modelType: "Monitor", ids: [MONITOR_B] },
    ]);
    expect(service.createHookCalls).toBe(1);
  });

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

// What a create's success makes of its creator (DatabaseService.autoOwnerOnCreate).
const autoOwner: <TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  createdItem: TBaseModel,
  props: DatabaseCommonInteractionProps,
) => Promise<void> = async <TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  createdItem: TBaseModel,
  props: DatabaseCommonInteractionProps,
): Promise<void> => {
  await (
    new DatabaseService<TBaseModel>(modelType) as unknown as {
      autoOwnerOnCreate: (
        createdItem: TBaseModel,
        props: DatabaseCommonInteractionProps,
      ) => Promise<void>;
    }
  ).autoOwnerOnCreate(createdItem, props);
};

describe("the creator of a record with owners of its own becomes one of them", () => {
  test("for an operational resource, whatever their permission to create it reaches", async () => {
    const owners: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      MonitorOwnerUserService,
      "create",
    ).mockResolvedValue({} as never);

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.projectId = PROJECT_ID;

    const props: DatabaseCommonInteractionProps = member([
      row(Permission.CreateProjectMonitor),
    ]);

    await autoOwner(Monitor, monitor, props);

    expect(owners).toHaveBeenCalledTimes(1);
    expect(
      (
        (owners.mock.calls[0]![0] as { data: BaseModel })
          .data as unknown as Record<string, unknown>
      )["userId"],
    ).toEqual(props.userId);
  });

  test("for a host, which is no operational resource, when their permission to create hosts reaches only the ones they own", async () => {
    const owners: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      HostOwnerUserService,
      "create",
    ).mockResolvedValue({} as never);

    const props: DatabaseCommonInteractionProps = member([
      row(Permission.CreateHost, [], PermissionScope.Owned),
    ]);
    const userId: ObjectID = props.userId!;
    const host: Host = new Host();
    host.id = ObjectID.generate();
    host.projectId = PROJECT_ID;

    await autoOwner(Host, host, props);

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

  test("but not for a host created under a permission that reaches every host, as before", async () => {
    const owners: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      HostOwnerUserService,
      "create",
    ).mockResolvedValue({} as never);

    const host: Host = new Host();
    host.id = ObjectID.generate();
    host.projectId = PROJECT_ID;

    await autoOwner(Host, host, member([row(Permission.CreateHost)]));

    expect(owners).not.toHaveBeenCalled();
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

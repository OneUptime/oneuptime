import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A maintenance event, and a maintenance template, on the status pages
 * picked on its form (#9920): whether one of them shows maintenance events,
 * and whether one that does tells its subscribers - or why not. Schedule
 * Maintenance Event's Subscriber Notifications line says it, and a
 * template's.
 *
 * Each is a kind of record of the one rule every form that picks its
 * status pages is answered by (PickedStatusPagesReachBuilder), run here for
 * real down to the services, over a small project held in memory: status
 * pages, which of them the caller may read, and the event or template an
 * Edit edits. What is pinned, for both kinds:
 *
 *   - the answer, as the maintenance jobs send: a page picked that shows
 *     maintenance events and sends notifications notifies; pages that show
 *     them with notifications off are NotificationsOff; pages that hide
 *     maintenance events, archived pages, a blocked project's pages and no
 *     page at all are NoStatusPages - Show Announcements counts for
 *     nothing;
 *   - every page picked must be the project's; a page the caller may not
 *     read counts when the record is on it already, and the answer names
 *     none;
 *   - who may ask is decided for the event or the template as the form
 *     will save it: on Create the checks a create of it runs, on Edit an
 *     update of it - never the table's permissions alone;
 *   - the body: ids that are ids, each page once, the record's own id under
 *     its own key, and refusals that name the record.
 */

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceTemplateService from "../../../../Server/Services/ScheduledMaintenanceTemplateService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import PickedStatusPagesReachBuilder, {
  PickedStatusPagesReachRequest,
  PickedStatusPagesRecordKind,
} from "../../../../Server/Utils/StatusPage/PickedStatusPagesReachBuilder";
import PublicNoteReachBuilder from "../../../../Server/Utils/StatusPage/PublicNoteReachBuilder";
import {
  SCHEDULED_MAINTENANCE_RECORD,
  SCHEDULED_MAINTENANCE_TEMPLATE_RECORD,
} from "../../../../Server/Utils/StatusPage/ScheduledMaintenanceReachBuilder";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "../../../../Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "../../../../Types/StatusPage/PublicNoteReach";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");

// The event, or the template, an Edit edits.
const RECORD: string = "e0000000-0000-4000-8000-000000000001";

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const SITE_3: string = "b0000000-0000-4000-8000-000000000003";
const NOWHERE: string = "b0000000-0000-4000-8000-0000000000ff";

interface PageRow {
  id: string;
  name: string;
  projectId: ObjectID;
  showMaintenanceEvents: boolean;
  showAnnouncements: boolean;
  sendNotifications: boolean;
  isArchived: boolean;
  isOfBlockedProject: boolean;
}

let pages: Dictionary<PageRow> = {};
// The pages the caller may read with their own permissions; null: all.
let readablePageIds: Array<string> | null = null;
// The pages the record being edited is on.
let pagesTheRecordIsOn: Array<string> = [];
// Whether the caller may update that record.
let isRecordUpdatable: boolean = true;

function page(id: string, overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: id,
    name: `Site ${id.slice(-2)}`,
    projectId: PROJECT_ID,
    showMaintenanceEvents: true,
    showAnnouncements: true,
    sendNotifications: true,
    isArchived: false,
    isOfBlockedProject: false,
    ...overrides,
  };
}

function setPages(...rows: Array<PageRow>): void {
  pages = {};

  for (const row of rows) {
    pages[row.id] = row;
  }
}

function props(
  grants: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: grants.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
  } as UserTenantAccessPermission;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function sameId(a: unknown, b: unknown): boolean {
  return (
    String(a?.toString() || "").toLowerCase() ===
    String(b?.toString() || "").toLowerCase()
  );
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsIn(operator: unknown): Array<string> {
  if (typeof operator === "string" || operator instanceof ObjectID) {
    return [operator.toString().toLowerCase()];
  }

  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

function toPage(row: PageRow): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = row.id;
  statusPage.name = row.name;
  statusPage.projectId = row.projectId;
  statusPage.showScheduledMaintenanceEventsOnStatusPage =
    row.showMaintenanceEvents;
  statusPage.showAnnouncementsOnStatusPage = row.showAnnouncements;
  statusPage.sendSubscriberNotifications = row.sendNotifications;
  return statusPage;
}

function pagesLoaded(): jest.Mock {
  return StatusPageSubscriberService.getStatusPagesToSendNotification as unknown as jest.Mock;
}

interface Kind {
  name: string;
  kind: PickedStatusPagesRecordKind<BaseModel>;
  service: DatabaseService<BaseModel>;
  modelType: { new (): BaseModel };
  recordIdKey: string;
  recordName: string;
}

const KINDS: Array<Kind> = [
  {
    name: "a maintenance event",
    kind: SCHEDULED_MAINTENANCE_RECORD as unknown as PickedStatusPagesRecordKind<BaseModel>,
    service:
      ScheduledMaintenanceService as unknown as DatabaseService<BaseModel>,
    modelType: ScheduledMaintenance,
    recordIdKey: "scheduledMaintenanceId",
    recordName: "maintenance event",
  },
  {
    name: "a maintenance template",
    kind: SCHEDULED_MAINTENANCE_TEMPLATE_RECORD as unknown as PickedStatusPagesRecordKind<BaseModel>,
    service:
      ScheduledMaintenanceTemplateService as unknown as DatabaseService<BaseModel>,
    modelType: ScheduledMaintenanceTemplate,
    recordIdKey: "scheduledMaintenanceTemplateId",
    recordName: "maintenance template",
  },
];

beforeEach(() => {
  setPages(page(SITE_1), page(SITE_2), page(SITE_3));
  readablePageIds = null;
  pagesTheRecordIsOn = [SITE_1];
  isRecordUpdatable = true;

  /*
   * As every subscriber notification loads them: archived pages and a
   * blocked project's pages left out.
   */
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation((async (
      ids: Array<ObjectID>,
    ): Promise<Array<StatusPage>> => {
      return Object.values(pages)
        .filter((row: PageRow): boolean => {
          return (
            !row.isArchived &&
            !row.isOfBlockedProject &&
            ids.some((id: ObjectID): boolean => {
              return sameId(id, row.id);
            })
          );
        })
        .map(toPage);
    }) as never);

  // A read of pages: the caller's only finds the pages they may read.
  jest.spyOn(StatusPageService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<StatusPage>> => {
    const wanted: Array<string> = idsIn(findBy.query["_id"]);

    return Object.values(pages)
      .filter((row: PageRow): boolean => {
        return (
          wanted.includes(row.id) &&
          sameId(row.projectId, findBy.query["projectId"]) &&
          (findBy.props.isRoot ||
            readablePageIds === null ||
            readablePageIds.includes(row.id))
        );
      })
      .map(toPage);
  }) as never);

  for (const each of KINDS) {
    standInForTheRecord(each);
  }
});

// The record an Edit edits, and the caller's create and update of it.
function standInForTheRecord(each: Kind): void {
  // The caller may create this record: the create's own checks pass.
  jest
    .spyOn(each.service, "checkCallerMayCreate")
    .mockResolvedValue(undefined as never);

  // The record being edited, when the caller may update it.
  jest
    .spyOn(each.service, "findOneUpdatableById")
    .mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<BaseModel | null> => {
      if (!isRecordUpdatable || !sameId(data.id, RECORD)) {
        return null;
      }

      const record: BaseModel = new each.modelType();
      record._id = RECORD;
      record.setColumnValue(
        "statusPages",
        pagesTheRecordIsOn.map((id: string): StatusPage => {
          const statusPage: StatusPage = new StatusPage();
          statusPage._id = id;
          return statusPage;
        }),
      );
      return record;
    }) as never);

  jest
    .spyOn(each.service, "getUnwrittenByIdError")
    .mockResolvedValue(
      new NotAuthorizedException(
        `You do not have permission to update this ${each.recordName}.`,
      ) as never,
    );
}

afterEach(() => {
  jest.restoreAllMocks();
});

function request(
  statusPageIds: Array<string>,
  recordId: string | null = null,
): PickedStatusPagesReachRequest {
  return {
    statusPageIds: statusPageIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    recordId: recordId ? new ObjectID(recordId) : null,
  };
}

describe.each(KINDS)("$name on the status pages picked", (each: Kind) => {
  async function reach(
    statusPageIds: Array<string>,
    options: {
      recordId?: string | null;
      callerProps?: DatabaseCommonInteractionProps;
    } = {},
  ): Promise<PickedStatusPagesReachResult["nothingSentReason"]> {
    const result: PickedStatusPagesReachResult =
      await PickedStatusPagesReachBuilder.build({
        projectId: PROJECT_ID,
        props: options.callerProps || props(),
        request: request(statusPageIds, options.recordId || null),
        kind: each.kind,
      });

    // Nothing but the reason ever travels.
    expect(Object.keys(PickedStatusPagesReach.toJSON(result))).toEqual([
      "nothingSentReason",
    ]);

    return result.nothingSentReason;
  }

  function createCheck(): jest.Mock {
    return each.service.checkCallerMayCreate as unknown as jest.Mock;
  }

  function updatableRead(): jest.Mock {
    return each.service.findOneUpdatableById as unknown as jest.Mock;
  }

  describe("as the maintenance jobs send", () => {
    test("shown and notifies: a page picked shows maintenance events and sends notifications", async () => {
      expect(await reach([SITE_1])).toBeNull();
    });

    test("pages that hide maintenance events: it shows nowhere - NoStatusPages, whatever they send", async () => {
      setPages(
        page(SITE_1, { showMaintenanceEvents: false }),
        page(SITE_2, {
          showMaintenanceEvents: false,
          sendNotifications: false,
        }),
      );

      expect(await reach([SITE_1, SITE_2])).toBe(
        PublicNoteNothingSentReason.NoStatusPages,
      );
    });

    test("a page that shows announcements but hides maintenance events counts for nothing", async () => {
      setPages(
        page(SITE_1, { showMaintenanceEvents: false, showAnnouncements: true }),
      );

      expect(await reach([SITE_1])).toBe(
        PublicNoteNothingSentReason.NoStatusPages,
      );
    });

    test("a page that hides announcements still shows maintenance events", async () => {
      setPages(page(SITE_1, { showAnnouncements: false }));

      expect(await reach([SITE_1])).toBeNull();
    });

    test("pages that never notify: it shows, and tells no one - NotificationsOff", async () => {
      setPages(
        page(SITE_1, { sendNotifications: false }),
        page(SITE_2, { sendNotifications: false }),
      );

      expect(await reach([SITE_1, SITE_2])).toBe(
        PublicNoteNothingSentReason.NotificationsOff,
      );
    });

    test("one page that shows it and notifies is enough, beside pages that hide it or never notify", async () => {
      setPages(
        page(SITE_1, { showMaintenanceEvents: false }),
        page(SITE_2, { sendNotifications: false }),
        page(SITE_3),
      );

      expect(await reach([SITE_1, SITE_2, SITE_3])).toBeNull();
    });

    test("a page that hides maintenance events beside one that never notifies: NotificationsOff", async () => {
      setPages(
        page(SITE_1, { showMaintenanceEvents: false }),
        page(SITE_2, { sendNotifications: false }),
      );

      expect(await reach([SITE_1, SITE_2])).toBe(
        PublicNoteNothingSentReason.NotificationsOff,
      );
    });

    test("no page picked: it shows nowhere, and no page is read", async () => {
      expect(await reach([])).toBe(PublicNoteNothingSentReason.NoStatusPages);
      expect(pagesLoaded()).not.toHaveBeenCalled();
    });

    test("an archived page, or a blocked project's, shows nothing and sends nothing", async () => {
      setPages(
        page(SITE_1, { isArchived: true }),
        page(SITE_2, { isOfBlockedProject: true }),
      );

      expect(await reach([SITE_1, SITE_2])).toBe(
        PublicNoteNothingSentReason.NoStatusPages,
      );
    });

    test("by the one rule a public note's composer is answered by, with maintenance events shown", async () => {
      const rule: jest.Mock = jest.spyOn(
        PublicNoteReachBuilder,
        "getStatusPagesReason",
      ) as unknown as jest.Mock;

      await reach([SITE_1]);

      expect(rule).toHaveBeenCalledTimes(1);

      const asked: {
        showsEvent: (statusPage: StatusPage) => boolean;
      } = rule.mock.calls[0]![0] as never;

      const shows: StatusPage = new StatusPage();
      shows.showScheduledMaintenanceEventsOnStatusPage = true;
      const hides: StatusPage = new StatusPage();
      hides.showScheduledMaintenanceEventsOnStatusPage = false;
      hides.showAnnouncementsOnStatusPage = true;

      expect(asked.showsEvent(shows)).toBe(true);
      expect(asked.showsEvent(hides)).toBe(false);
    });
  });

  describe("the pages picked are the project's", () => {
    test("one of another project is refused, as a page that is not there", async () => {
      setPages(page(SITE_1), page(SITE_2, { projectId: OTHER_PROJECT_ID }));

      await expect(reach([SITE_1, SITE_2])).rejects.toThrow(
        "One or more of these status pages were not found in this project.",
      );
      expect(pagesLoaded()).not.toHaveBeenCalled();
    });

    test("one that is not there is refused", async () => {
      await expect(reach([SITE_1, NOWHERE])).rejects.toBeInstanceOf(
        BadDataException,
      );
    });
  });

  describe("who may ask: on Create, whoever may create it on those pages", () => {
    test(`asked as a create of ${each.name} on the pages picked, in the project, as the caller`, async () => {
      const caller: DatabaseCommonInteractionProps = props();

      await reach([SITE_1, SITE_2], { callerProps: caller });

      const asked: { data: BaseModel; props: unknown } = createCheck().mock
        .calls[0]![0] as { data: BaseModel; props: unknown };

      expect(asked.data).toBeInstanceOf(each.modelType);
      expect(String(asked.data.getColumnValue("projectId"))).toBe(
        PROJECT_ID.toString(),
      );
      expect(
        (asked.data.getColumnValue("statusPages") as Array<StatusPage>).map(
          (statusPage: StatusPage): string => {
            return String(statusPage._id);
          },
        ),
      ).toEqual([SITE_1, SITE_2]);
      expect(asked.props).toBe(caller);
      expect(updatableRead()).not.toHaveBeenCalled();
    });

    test("a create the caller may not make is refused with its own sentence, and no page is read", async () => {
      const refusal: CreateScopeException = new CreateScopeException(
        'This permission only lets you create these on status pages labelled "Internal".',
      );

      createCheck().mockRejectedValue(refusal as never);

      await expect(reach([SITE_1])).rejects.toBe(refusal);
      expect(pagesLoaded()).not.toHaveBeenCalled();
    });
  });

  describe("who may ask: on Edit, whoever may update it", () => {
    test("asked as an update of it, as the caller - and no create is asked", async () => {
      const caller: DatabaseCommonInteractionProps = props();

      expect(
        await reach([SITE_1], { recordId: RECORD, callerProps: caller }),
      ).toBeNull();

      const asked: { id: ObjectID; props: unknown } = updatableRead().mock
        .calls[0]![0] as { id: ObjectID; props: unknown };

      expect(asked.id.toString()).toBe(RECORD);
      expect(asked.props).toBe(caller);
      expect(createCheck()).not.toHaveBeenCalled();
    });

    test("a caller who may not update it is refused as the update would be, and no page is read", async () => {
      isRecordUpdatable = false;

      await expect(
        reach([SITE_1], { recordId: RECORD }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
      expect(pagesLoaded()).not.toHaveBeenCalled();
    });

    test("one that is not there is answered as missing", async () => {
      isRecordUpdatable = false;
      (
        each.service.getUnwrittenByIdError as unknown as jest.Mock
      ).mockResolvedValue(new NotFoundException("Not found.") as never);

      await expect(
        reach([SITE_1], { recordId: RECORD }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    test("hidden pages: a page the caller may not read, already on it, counts - and is named nowhere", async () => {
      readablePageIds = [SITE_2];
      pagesTheRecordIsOn = [SITE_1, SITE_2];
      setPages(page(SITE_1), page(SITE_2, { sendNotifications: false }));

      const result: PickedStatusPagesReachResult =
        await PickedStatusPagesReachBuilder.build({
          projectId: PROJECT_ID,
          props: props(),
          request: request([SITE_1, SITE_2], RECORD),
          kind: each.kind,
        });

      expect(result).toEqual({ nothingSentReason: null });
      expect(
        JSON.stringify(PickedStatusPagesReach.toJSON(result)),
      ).not.toContain("Site");
      expect(
        JSON.stringify(PickedStatusPagesReach.toJSON(result)),
      ).not.toContain(SITE_1);
    });

    test("a page it is not on yet must be one the caller may read", async () => {
      readablePageIds = [SITE_1];
      pagesTheRecordIsOn = [SITE_1];

      await expect(
        reach([SITE_1, SITE_2], { recordId: RECORD }),
      ).rejects.toThrow(
        "One or more of these status pages were not found in this project.",
      );
      expect(pagesLoaded()).not.toHaveBeenCalled();
    });
  });

  describe("root and a master admin are asked nothing", () => {
    test.each([
      ["a master admin", { ...props([]), isMasterAdmin: true }],
      ["root", { isRoot: true }],
    ] as Array<[string, DatabaseCommonInteractionProps]>)(
      "%s",
      async (_name: string, callerProps: DatabaseCommonInteractionProps) => {
        expect(await reach([SITE_1], { callerProps: callerProps })).toBeNull();
        expect(
          await reach([SITE_1], { callerProps: callerProps, recordId: RECORD }),
        ).toBeNull();
        expect(createCheck()).not.toHaveBeenCalled();
        expect(updatableRead()).not.toHaveBeenCalled();
      },
    );
  });

  describe("the request body", () => {
    test(`names the pages picked, each once, and the ${each.recordName} an Edit edits under ${each.recordIdKey}`, () => {
      const parsed: PickedStatusPagesReachRequest =
        PickedStatusPagesReachBuilder.parseRequest(
          {
            statusPageIds: [SITE_1.toUpperCase(), ` ${SITE_2} `, SITE_1],
            [each.recordIdKey]: RECORD.toUpperCase(),
          },
          each.kind,
        );

      expect(
        parsed.statusPageIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([SITE_1, SITE_2]);
      expect(parsed.recordId?.toString()).toBe(RECORD);
    });

    test("another kind's key names nothing here", () => {
      expect(
        PickedStatusPagesReachBuilder.parseRequest(
          { statusPageIds: [SITE_1], announcementId: RECORD },
          each.kind,
        ).recordId,
      ).toBeNull();
    });

    test(`refuses a ${each.recordName} that is not named by an id, naming it`, () => {
      expect(() => {
        PickedStatusPagesReachBuilder.parseRequest(
          { statusPageIds: [SITE_1], [each.recordIdKey]: "not-an-id" },
          each.kind,
        );
      }).toThrow(
        `This request names the ${each.recordName} by something that is not an ID. Send the ID of the ${each.recordName} being edited as ${each.recordIdKey}, or leave it out.`,
      );
    });

    test(`refuses more pages than one ${each.recordName} can be on`, () => {
      const tooMany: Array<string> = [];

      for (
        let index: number = 0;
        index <= PickedStatusPagesReach.maxStatusPagesPerRequest;
        index++
      ) {
        tooMany.push(SITE_1);
      }

      expect(() => {
        PickedStatusPagesReachBuilder.parseRequest(
          { statusPageIds: tooMany },
          each.kind,
        );
      }).toThrow(
        `This request names more status pages than one ${each.recordName} can be on. Send at most ${PickedStatusPagesReach.maxStatusPagesPerRequest} IDs as statusPageIds.`,
      );
    });

    test.each([[{}], [null], [{ statusPageIds: SITE_1 }]] as Array<[unknown]>)(
      "refuses a body that names no list of pages: %j",
      (body: unknown) => {
        expect(() => {
          PickedStatusPagesReachBuilder.parseRequest(body, each.kind);
        }).toThrow(
          "This request names no status pages. Send the IDs of the status pages picked as statusPageIds.",
        );
      },
    );
  });
});

describe("the two kinds", () => {
  test("are asked of their own services, under their own keys", () => {
    expect(SCHEDULED_MAINTENANCE_RECORD.service).toBe(
      ScheduledMaintenanceService,
    );
    expect(SCHEDULED_MAINTENANCE_RECORD.modelType).toBe(ScheduledMaintenance);
    expect(SCHEDULED_MAINTENANCE_RECORD.recordIdKey).toBe(
      "scheduledMaintenanceId",
    );
    expect(SCHEDULED_MAINTENANCE_TEMPLATE_RECORD.service).toBe(
      ScheduledMaintenanceTemplateService,
    );
    expect(SCHEDULED_MAINTENANCE_TEMPLATE_RECORD.modelType).toBe(
      ScheduledMaintenanceTemplate,
    );
    expect(SCHEDULED_MAINTENANCE_TEMPLATE_RECORD.recordIdKey).toBe(
      "scheduledMaintenanceTemplateId",
    );
  });

  test("a template answers for a create of a template, not of an event", async () => {
    await PickedStatusPagesReachBuilder.build({
      projectId: PROJECT_ID,
      props: props(),
      request: request([SITE_1]),
      kind: SCHEDULED_MAINTENANCE_TEMPLATE_RECORD,
    });

    expect(
      ScheduledMaintenanceTemplateService.checkCallerMayCreate,
    ).toHaveBeenCalledTimes(1);
    expect(
      ScheduledMaintenanceService.checkCallerMayCreate,
    ).not.toHaveBeenCalled();
  });
});

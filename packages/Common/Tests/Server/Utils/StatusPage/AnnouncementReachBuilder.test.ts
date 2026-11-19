import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AnnouncementReachBuilder: whether an announcement on the status pages
 * picked on its form shows on one of them, and whether it notifies anyone -
 * or why not (#9775). Create Announcement's Schedule & Notifications line
 * says it: "Subscribers are notified when it starts showing." only while it
 * is true.
 *
 * It runs for real down to the services, over a small project held in
 * memory: status pages, which of them the caller may read, and the
 * announcement an Edit form edits. What is pinned:
 *
 *   - the answer, as the announcement job sends: a page picked that shows
 *     announcements and sends notifications notifies; pages that show it
 *     with notifications off are NotificationsOff; pages that hide
 *     announcements, archived pages, a blocked project's pages and no page
 *     at all are NoStatusPages - by the one rule a public note's composer
 *     is answered by (PublicNoteReachBuilder.getStatusPagesReason);
 *   - every page picked must be the project's; a page the caller may not
 *     read counts when the announcement is on it already, and the answer
 *     names none;
 *   - who may ask is decided for the announcement as the form will save it:
 *     on Create the checks a create of it runs (checkCallerMayCreate), on
 *     Edit an update of it (findOneUpdatableById) - never the table's
 *     permissions alone (TableHalfWriteGuard);
 *   - the body: ids that are ids, each page once, no more than the form
 *     could pick.
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

import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementService from "../../../../Server/Services/StatusPageAnnouncementService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import { UnreadableReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import AnnouncementReachBuilder, {
  AnnouncementReachRequest,
} from "../../../../Server/Utils/StatusPage/AnnouncementReachBuilder";
import PublicNoteReachBuilder from "../../../../Server/Utils/StatusPage/PublicNoteReachBuilder";
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
import AnnouncementReach, {
  AnnouncementNothingSentReason,
  AnnouncementReachResult,
} from "../../../../Types/StatusPage/AnnouncementReach";
import { PublicNoteNothingSentReason } from "../../../../Types/StatusPage/PublicNoteReach";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");

const ANNOUNCEMENT: string = "d0000000-0000-4000-8000-000000000001";

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const SITE_3: string = "b0000000-0000-4000-8000-000000000003";
const NOWHERE: string = "b0000000-0000-4000-8000-0000000000ff";

interface PageRow {
  id: string;
  name: string;
  projectId: ObjectID;
  showAnnouncements: boolean;
  sendNotifications: boolean;
  isArchived: boolean;
  // Of a project a master admin blocked: left out of every send.
  isOfBlockedProject: boolean;
}

let pages: Dictionary<PageRow> = {};
// The pages the caller may read with their own permissions; null: all.
let readablePageIds: Array<string> | null = null;
// The pages the announcement being edited is on.
let pagesTheAnnouncementIsOn: Array<string> = [];
// Whether the caller may update that announcement.
let isAnnouncementUpdatable: boolean = true;

function page(id: string, overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: id,
    name: `Site ${id.slice(-2)}`,
    projectId: PROJECT_ID,
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
  statusPage.showAnnouncementsOnStatusPage = row.showAnnouncements;
  statusPage.sendSubscriberNotifications = row.sendNotifications;
  return statusPage;
}

function createCheck(): jest.Mock {
  return StatusPageAnnouncementService.checkCallerMayCreate as unknown as jest.Mock;
}

function updatableRead(): jest.Mock {
  return StatusPageAnnouncementService.findOneUpdatableById as unknown as jest.Mock;
}

function pagesLoaded(): jest.Mock {
  return StatusPageSubscriberService.getStatusPagesToSendNotification as unknown as jest.Mock;
}

beforeEach(() => {
  setPages(page(SITE_1), page(SITE_2), page(SITE_3));
  readablePageIds = null;
  pagesTheAnnouncementIsOn = [SITE_1];
  isAnnouncementUpdatable = true;

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

  // The caller may create this announcement: the create's own checks pass.
  jest
    .spyOn(StatusPageAnnouncementService, "checkCallerMayCreate")
    .mockResolvedValue(undefined as never);

  // The announcement being edited, when the caller may update it.
  jest
    .spyOn(StatusPageAnnouncementService, "findOneUpdatableById")
    .mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<StatusPageAnnouncement | null> => {
      if (!isAnnouncementUpdatable || !sameId(data.id, ANNOUNCEMENT)) {
        return null;
      }

      const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
      announcement._id = ANNOUNCEMENT;
      announcement.statusPages = pagesTheAnnouncementIsOn.map(
        (id: string): StatusPage => {
          const statusPage: StatusPage = new StatusPage();
          statusPage._id = id;
          return statusPage;
        },
      );
      return announcement;
    }) as never);

  jest
    .spyOn(StatusPageAnnouncementService, "getUnwrittenByIdError")
    .mockResolvedValue(
      new NotAuthorizedException(
        "You do not have permission to update this announcement.",
      ) as never,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function request(
  statusPageIds: Array<string>,
  announcementId: string | null = null,
): AnnouncementReachRequest {
  return {
    statusPageIds: statusPageIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    announcementId: announcementId ? new ObjectID(announcementId) : null,
  };
}

async function reach(
  statusPageIds: Array<string>,
  options: {
    announcementId?: string | null;
    callerProps?: DatabaseCommonInteractionProps;
  } = {},
): Promise<AnnouncementNothingSentReason | null> {
  const result: AnnouncementReachResult = await AnnouncementReachBuilder.build({
    projectId: PROJECT_ID,
    props: options.callerProps || props(),
    request: request(statusPageIds, options.announcementId || null),
  });

  // Nothing but the reason ever travels.
  expect(Object.keys(AnnouncementReach.toJSON(result))).toEqual([
    "nothingSentReason",
  ]);

  return result.nothingSentReason;
}

describe("an announcement on the status pages picked, as its job sends", () => {
  test("shown and notifies: a page picked shows announcements and sends notifications", async () => {
    expect(await reach([SITE_1])).toBeNull();
  });

  test("pages that hide announcements: it shows nowhere - NoStatusPages, whatever they send", async () => {
    setPages(
      page(SITE_1, { showAnnouncements: false }),
      page(SITE_2, { showAnnouncements: false, sendNotifications: false }),
    );

    expect(await reach([SITE_1, SITE_2])).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
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
      page(SITE_1, { showAnnouncements: false }),
      page(SITE_2, { sendNotifications: false }),
      page(SITE_3),
    );

    expect(await reach([SITE_1, SITE_2, SITE_3])).toBeNull();
  });

  test("a page that hides announcements notifies nobody, though it sends notifications", async () => {
    setPages(
      page(SITE_1, { showAnnouncements: false }),
      page(SITE_2, { sendNotifications: false }),
    );

    // The job passes over SITE_1 for hiding announcements, SITE_2 for being off.
    expect(await reach([SITE_1, SITE_2])).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("no page picked: it shows nowhere, and no page is read", async () => {
    expect(await reach([])).toBe(PublicNoteNothingSentReason.NoStatusPages);
    expect(pagesLoaded()).not.toHaveBeenCalled();
  });

  test("an archived page shows nothing and sends nothing", async () => {
    setPages(page(SITE_1, { isArchived: true }));

    expect(await reach([SITE_1])).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("a blocked project's pages show nothing and send nothing", async () => {
    setPages(page(SITE_1, { isOfBlockedProject: true }));

    expect(await reach([SITE_1])).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("the pages are loaded as every subscriber notification loads them", async () => {
    await reach([SITE_1, SITE_2]);

    expect(pagesLoaded()).toHaveBeenCalledTimes(1);
    expect(
      (pagesLoaded().mock.calls[0]![0] as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([SITE_1, SITE_2]);
  });

  test("by the one rule a public note's composer is answered by", async () => {
    const rule: jest.Mock = jest.spyOn(
      PublicNoteReachBuilder,
      "getStatusPagesReason",
    ) as unknown as jest.Mock;

    setPages(
      page(SITE_1, { showAnnouncements: false }),
      page(SITE_2, { sendNotifications: false }),
    );

    await reach([SITE_1, SITE_2]);

    expect(rule).toHaveBeenCalledTimes(1);

    const asked: {
      projectId: ObjectID;
      showsEvent: (statusPage: StatusPage) => boolean;
    } = rule.mock.calls[0]![0] as {
      projectId: ObjectID;
      showsEvent: (statusPage: StatusPage) => boolean;
    };

    // A page shows the announcement when it shows announcements.
    expect(asked.showsEvent(toPage(page(SITE_1)))).toBe(true);
    expect(
      asked.showsEvent(toPage(page(SITE_1, { showAnnouncements: false }))),
    ).toBe(false);
    expect(String(asked.projectId)).toBe(PROJECT_ID.toString());
  });
});

describe("the pages picked", () => {
  test("another project's page is refused, and nothing is answered about it", async () => {
    setPages(page(SITE_1), page(SITE_2, { projectId: OTHER_PROJECT_ID }));

    await expect(reach([SITE_1, SITE_2])).rejects.toThrow(
      "One or more of these status pages were not found in this project.",
    );
    expect(pagesLoaded()).not.toHaveBeenCalled();
  });

  test("a page that does not exist is refused", async () => {
    await expect(reach([SITE_1, NOWHERE])).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  test("whether they belong to the project is read as root: a page the caller may not read is not refused for that", async () => {
    readablePageIds = [];

    // A Create's own checks decide whether they may name it (passing here).
    expect(await reach([SITE_1])).toBeNull();

    const projectRead: { props: DatabaseCommonInteractionProps } = (
      StatusPageService.findBy as unknown as jest.Mock
    ).mock.calls[0]![0] as { props: DatabaseCommonInteractionProps };

    expect(projectRead.props.isRoot).toBe(true);
  });
});

describe("who may ask: on Create, whoever may create this announcement", () => {
  test("asked as the create of an announcement on the pages picked, in the project, as the caller", async () => {
    const caller: DatabaseCommonInteractionProps = props();

    await reach([SITE_1, SITE_2], { callerProps: caller });

    expect(createCheck()).toHaveBeenCalledTimes(1);

    const asked: { data: StatusPageAnnouncement; props: unknown } =
      createCheck().mock.calls[0]![0] as {
        data: StatusPageAnnouncement;
        props: unknown;
      };

    expect(asked.data).toBeInstanceOf(StatusPageAnnouncement);
    expect(String(asked.data.projectId)).toBe(PROJECT_ID.toString());
    expect(
      (asked.data.statusPages || []).map((statusPage: StatusPage): string => {
        return String(statusPage._id);
      }),
    ).toEqual([SITE_1, SITE_2]);
    expect(asked.props).toBe(caller);
    expect(updatableRead()).not.toHaveBeenCalled();
  });

  test("a caller the create refuses - a permission limited to labels the pages do not carry - is refused, and no page is read", async () => {
    const refusal: CreateScopeException = new CreateScopeException(
      'This permission only lets you create announcements on status pages labelled "Internal".',
    );

    createCheck().mockRejectedValue(refusal as never);

    await expect(reach([SITE_1])).rejects.toBe(refusal);
    expect(pagesLoaded()).not.toHaveBeenCalled();
  });

  test("a page the caller may not read is refused as the create refuses it", async () => {
    createCheck().mockRejectedValue(
      new UnreadableReferenceException(
        "This announcement references records that are not in this project.",
      ) as never,
    );

    await expect(reach([SITE_1])).rejects.toBeInstanceOf(BadDataException);
    expect(pagesLoaded()).not.toHaveBeenCalled();
  });
});

describe("who may ask: on Edit, whoever may update this announcement", () => {
  test("asked as an update of that announcement, as the caller - and no create is asked", async () => {
    const caller: DatabaseCommonInteractionProps = props();

    expect(
      await reach([SITE_1], {
        announcementId: ANNOUNCEMENT,
        callerProps: caller,
      }),
    ).toBeNull();

    const asked: { id: ObjectID; props: unknown } = updatableRead().mock
      .calls[0]![0] as { id: ObjectID; props: unknown };

    expect(asked.id.toString()).toBe(ANNOUNCEMENT);
    expect(asked.props).toBe(caller);
    expect(createCheck()).not.toHaveBeenCalled();
  });

  test("a caller who may not update it is refused as the update would be, and no page is read", async () => {
    isAnnouncementUpdatable = false;

    await expect(
      reach([SITE_1], { announcementId: ANNOUNCEMENT }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(pagesLoaded()).not.toHaveBeenCalled();
  });

  test("an announcement that is not there is answered as missing", async () => {
    isAnnouncementUpdatable = false;
    (
      StatusPageAnnouncementService.getUnwrittenByIdError as unknown as jest.Mock
    ).mockResolvedValue(
      new NotFoundException("Status Page Announcement not found.") as never,
    );

    await expect(
      reach([SITE_1], { announcementId: ANNOUNCEMENT }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test("hidden pages: a page the caller may not read, already on the announcement, counts - and is named nowhere", async () => {
    readablePageIds = [SITE_2];
    pagesTheAnnouncementIsOn = [SITE_1, SITE_2];
    setPages(page(SITE_1), page(SITE_2, { sendNotifications: false }));

    const result: AnnouncementReachResult =
      await AnnouncementReachBuilder.build({
        projectId: PROJECT_ID,
        props: props(),
        request: request([SITE_1, SITE_2], ANNOUNCEMENT),
      });

    // SITE_1, which the caller may not read, shows it and notifies.
    expect(result).toEqual({ nothingSentReason: null });
    expect(JSON.stringify(AnnouncementReach.toJSON(result))).not.toContain(
      "Site",
    );
    expect(JSON.stringify(AnnouncementReach.toJSON(result))).not.toContain(
      SITE_1,
    );
  });

  test("hidden pages: one the caller may not read, switched off, is NotificationsOff, not NoStatusPages", async () => {
    readablePageIds = [SITE_2];
    pagesTheAnnouncementIsOn = [SITE_1, SITE_2];
    setPages(
      page(SITE_1, { sendNotifications: false }),
      page(SITE_2, { showAnnouncements: false }),
    );

    expect(
      await reach([SITE_1, SITE_2], { announcementId: ANNOUNCEMENT }),
    ).toBe(PublicNoteNothingSentReason.NotificationsOff);
  });

  test("a page the announcement is not on yet must be one the caller may read, as the update holds a page it adds", async () => {
    readablePageIds = [SITE_1];
    pagesTheAnnouncementIsOn = [SITE_1];

    await expect(
      reach([SITE_1, SITE_2], { announcementId: ANNOUNCEMENT }),
    ).rejects.toThrow(
      "One or more of these status pages were not found in this project.",
    );
    expect(pagesLoaded()).not.toHaveBeenCalled();
  });

  test("a page added that the caller may read is answered for", async () => {
    readablePageIds = [SITE_1, SITE_2];
    pagesTheAnnouncementIsOn = [SITE_1];
    setPages(
      page(SITE_1, { showAnnouncements: false }),
      page(SITE_2, { sendNotifications: false }),
    );

    expect(
      await reach([SITE_1, SITE_2], { announcementId: ANNOUNCEMENT }),
    ).toBe(PublicNoteNothingSentReason.NotificationsOff);
  });
});

describe("root and a master admin", () => {
  test.each([
    ["a master admin", { ...props([]), isMasterAdmin: true }],
    ["root", { isRoot: true }],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "%s is asked nothing",
    async (_name: string, callerProps: DatabaseCommonInteractionProps) => {
      expect(await reach([SITE_1], { callerProps: callerProps })).toBeNull();
      expect(
        await reach([SITE_1], {
          callerProps: callerProps,
          announcementId: ANNOUNCEMENT,
        }),
      ).toBeNull();
      expect(createCheck()).not.toHaveBeenCalled();
      expect(updatableRead()).not.toHaveBeenCalled();
    },
  );
});

describe("the request body", () => {
  test("names the pages picked, each once, as ids", () => {
    const parsed: AnnouncementReachRequest =
      AnnouncementReachBuilder.parseRequest({
        statusPageIds: [SITE_1.toUpperCase(), ` ${SITE_2} `, SITE_1],
      });

    expect(
      parsed.statusPageIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SITE_1, SITE_2]);
    expect(parsed.announcementId).toBeNull();
  });

  test("names the announcement an Edit edits", () => {
    expect(
      AnnouncementReachBuilder.parseRequest({
        statusPageIds: [SITE_1],
        announcementId: ANNOUNCEMENT.toUpperCase(),
      }).announcementId?.toString(),
    ).toBe(ANNOUNCEMENT);
    expect(
      AnnouncementReachBuilder.parseRequest({
        statusPageIds: [SITE_1],
        announcementId: null,
      }).announcementId,
    ).toBeNull();
  });

  test("an empty list is a list", () => {
    expect(
      AnnouncementReachBuilder.parseRequest({ statusPageIds: [] })
        .statusPageIds,
    ).toEqual([]);
  });

  test.each([
    [{}],
    [null],
    ["statusPageIds"],
    [[SITE_1]],
    [{ statusPageIds: SITE_1 }],
    [{ statusPageIds: { 0: SITE_1 } }],
  ] as Array<[unknown]>)(
    "refuses a body that names no list of pages: %j",
    (body: unknown) => {
      expect(() => {
        AnnouncementReachBuilder.parseRequest(body);
      }).toThrow(
        "This request names no status pages. Send the IDs of the status pages picked as statusPageIds.",
      );
    },
  );

  test.each([[["not-an-id"]], [[42]], [[""]], [[null]], [[[SITE_1]]]] as Array<
    [Array<unknown>]
  >)("refuses a page that is not named by an id: %j", (ids: Array<unknown>) => {
    expect(() => {
      AnnouncementReachBuilder.parseRequest({ statusPageIds: ids });
    }).toThrow(BadDataException);
  });

  test("refuses more pages than one announcement can be on", () => {
    const tooMany: Array<string> = [];

    for (
      let index: number = 0;
      index <= AnnouncementReach.maxStatusPagesPerRequest;
      index++
    ) {
      tooMany.push(SITE_1);
    }

    expect(() => {
      AnnouncementReachBuilder.parseRequest({ statusPageIds: tooMany });
    }).toThrow(
      `Send at most ${AnnouncementReach.maxStatusPagesPerRequest} IDs as statusPageIds.`,
    );
  });

  test.each([["not-an-id"], [42], [[ANNOUNCEMENT]]] as Array<[unknown]>)(
    "refuses an announcement that is not named by an id: %j",
    (announcementId: unknown) => {
      expect(() => {
        AnnouncementReachBuilder.parseRequest({
          statusPageIds: [SITE_1],
          announcementId: announcementId,
        });
      }).toThrow(BadDataException);
    },
  );
});

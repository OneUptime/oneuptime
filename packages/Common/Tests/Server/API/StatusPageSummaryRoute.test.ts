import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import MasterPasswordRequiredException from "../../../Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSummaryUtil, {
  StatusPageSummary,
} from "../../../Types/StatusPage/StatusPageSummary";
import StatusPageSummaryBuilder from "../../../Utils/StatusPage/StatusPageSummaryBuilder";
import {
  FAKE_STATUSES,
  FakeStatusPage,
  buildFakeOverview,
} from "../../Helpers/FakeStatusPageOverview";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * GET and POST /status-page-api/summary/:statusPageIdOrDomain - the page in
 * brief, for monitoring tools, another OneUptime's External Status Page
 * monitor among them.
 *
 * It is the overview, cut down, so these pin what makes it safe to serve:
 * the reader is checked exactly as the overview checks them, before anything
 * is read; it shares the overview's cache, so asking for it costs a page
 * nothing a visitor's view does not, and never serves a reader the page has
 * stopped letting in; and it answers what StatusPageSummaryBuilder makes of
 * the page's overview, and only that.
 */

const SUMMARY_ROUTE: string = "/status-page/summary/:statusPageIdOrDomain";
const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";
const PROJECT_ID: ObjectID = new ObjectID(
  "5e100000-0000-4000-8000-000000000001",
);

const PAGE: FakeStatusPage = {
  groups: [{ id: "5e100000-0000-4000-8000-0000000000c1", name: "Core" }],
  resources: [
    {
      id: "5e100000-0000-4000-8000-0000000000d1",
      name: "Checkout API",
      groupId: "5e100000-0000-4000-8000-0000000000c1",
      monitorId: "5e100000-0000-4000-8000-0000000000a1",
      statusId: FAKE_STATUSES.operational.id,
    },
    {
      id: "5e100000-0000-4000-8000-0000000000d2",
      name: "Database",
      monitorId: "5e100000-0000-4000-8000-0000000000a2",
      statusId: FAKE_STATUSES.offline.id,
    },
  ],
  maintenance: [
    {
      id: "5e100000-0000-4000-8000-0000000000e1",
      title: "Database upgrade",
      state: "ongoing",
      startsAt: new Date("2026-10-23T11:00:00.000Z"),
      endsAt: new Date("2026-10-23T13:00:00.000Z"),
      monitorIds: ["5e100000-0000-4000-8000-0000000000a2"],
    },
  ],
};

interface PageAccess {
  isPublicStatusPage?: boolean;
  isArchived?: boolean;
  ipWhitelist?: string;
  enableMasterPassword?: boolean;
  masterPassword?: HashedString;
}

let pageAccess: PageAccess = { isPublicStatusPage: true };
let buildSpy: jest.SpiedFunction<StatusPageAPI["buildOverviewResponse"]>;

function mockPage(): void {
  pageAccess = { isPublicStatusPage: true };

  // The page's project, which its overview is kept under.
  jest
    .spyOn(StatusPageService, "getProjectIdOfStatusPage")
    .mockResolvedValue(PROJECT_ID as never);

  // The read check's one query: the page's access settings.
  jest
    .spyOn(StatusPageService, "findOneById")
    .mockImplementation((): Promise<never> => {
      const page: StatusPage = new StatusPage();
      page.isPublicStatusPage = Boolean(pageAccess.isPublicStatusPage);
      page.isArchived = Boolean(pageAccess.isArchived);
      page.enableMasterPassword = Boolean(pageAccess.enableMasterPassword);
      if (pageAccess.ipWhitelist) {
        page.ipWhitelist = pageAccess.ipWhitelist;
      }
      if (pageAccess.masterPassword) {
        page.masterPassword = pageAccess.masterPassword;
      }
      return Promise.resolve(page as never);
    });

  // The overview the page draws, built as buildOverviewResponse builds it.
  buildSpy = jest
    .spyOn(StatusPageAPI.prototype, "buildOverviewResponse")
    .mockImplementation((): Promise<JSONObject> => {
      return Promise.resolve(buildFakeOverview(PAGE));
    });
}

function request(statusPageIdOrDomain: string): ExpressRequest {
  return {
    params: { statusPageIdOrDomain: statusPageIdOrDomain },
    body: {},
    query: {},
    cookies: {},
    headers: { "x-forwarded-for": "203.0.113.9" },
    socket: { remoteAddress: "203.0.113.9" },
    ip: "203.0.113.9",
    ips: [],
  } as unknown as ExpressRequest;
}

interface Answer {
  sent: JSONObject | undefined;
  error: unknown;
}

async function ask(data: {
  route?: string;
  method: "get" | "post";
  statusPageIdOrDomain: string;
}): Promise<Answer> {
  const sendJson: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  const callsBefore: number = sendJson.mock.calls.length;
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(data.method, data.route || SUMMARY_ROUTE)
    .handlerFunction(
      request(data.statusPageIdOrDomain),
      {
        send: jest.fn(),
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

  const sent: Array<unknown> | undefined = sendJson.mock.calls[callsBefore];

  return {
    sent: sent ? (sent[2] as JSONObject) : undefined,
    error: next.mock.calls[0]?.[0],
  };
}

function expectedSummary(): JSONObject {
  return StatusPageSummaryUtil.toJSON(
    StatusPageSummaryBuilder.fromOverview(buildFakeOverview(PAGE)),
  );
}

describe("the status page summary route", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
    mockPage();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("answers GET and POST, through the public route middleware", () => {
    for (const method of ["get", "post"]) {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        method,
        SUMMARY_ROUTE,
      );

      expect(route.middlewares).toEqual([
        UserMiddleware.getPublicRouteUserMiddleware,
      ]);
    }
  });

  it.each(["get", "post"] as const)(
    "answers %s for a public page with the summary of its overview, never kept by a shared cache",
    async (method: "get" | "post") => {
      const pageId: string = ObjectID.generate().toString();
      const answer: Answer = await ask({
        method: method,
        statusPageIdOrDomain: pageId,
      });

      expect(answer.error).toBeUndefined();
      expect(answer.sent).toEqual(expectedSummary());
      expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
    },
  );

  it("says what the page shows: each resource's status, and what is under maintenance", async () => {
    const answer: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: ObjectID.generate().toString(),
    });

    const summary: StatusPageSummary | null = StatusPageSummaryUtil.fromJSON(
      answer.sent,
    );

    expect(
      summary!.resources.map(
        (resource: StatusPageSummary["resources"][number]) => {
          return [
            resource.name,
            resource.groupName,
            resource.currentStatus?.name,
            resource.isUnderMaintenance,
          ];
        },
      ),
    ).toEqual([
      ["Checkout API", "Core", "Operational", false],
      ["Database", null, "Offline", true],
    ]);
    expect(
      summary!.ongoingScheduledMaintenance.map(
        (event: StatusPageSummary["ongoingScheduledMaintenance"][number]) => {
          return event.title;
        },
      ),
    ).toEqual(["Database upgrade"]);
  });

  it("finds a page by its verified custom domain", async () => {
    const pageId: ObjectID = ObjectID.generate();
    const domain: StatusPageDomain = new StatusPageDomain();
    domain.statusPageId = pageId;

    const findDomain: jest.SpiedFunction<
      typeof StatusPageDomainService.findOneBy
    > = jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockResolvedValue(domain as never);

    const answer: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: `status-${pageId.toString()}.example.com`,
    });

    expect(answer.error).toBeUndefined();
    expect(answer.sent).toEqual(expectedSummary());
    expect(findDomain).toHaveBeenCalledTimes(1);
    expect(
      (findDomain.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toMatchObject({ domain: { isVerified: true } });
  });

  it("answers a domain no page has with 404, and reads nothing", async () => {
    jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockResolvedValue(null as never);

    const answer: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: `nobody-${ObjectID.generate().toString()}.example.com`,
    });

    expect(answer.error).toBeInstanceOf(NotFoundException);
    expect(answer.sent).toBeUndefined();
    expect(buildSpy).not.toHaveBeenCalled();
    expect(StatusPageService.findOneById).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a private page, to a reader who has not signed in",
      { isPublicStatusPage: false },
      NotAuthenticatedException,
    ],
    [
      "a private page with a password, to a reader without it",
      {
        isPublicStatusPage: false,
        enableMasterPassword: true,
        masterPassword: new HashedString("not-sent"),
      },
      MasterPasswordRequiredException,
    ],
    [
      "a page whose IP allowlist leaves the reader out",
      { isPublicStatusPage: true, ipWhitelist: "10.0.0.0/8" },
      ForbiddenException,
    ],
    [
      "an archived page",
      { isPublicStatusPage: true, isArchived: true },
      NotFoundException,
    ],
  ])(
    "refuses %s, before anything is read",
    async (_name: string, access: PageAccess, refusal: unknown) => {
      pageAccess = access;

      const answer: Answer = await ask({
        method: "get",
        statusPageIdOrDomain: ObjectID.generate().toString(),
      });

      expect(answer.error).toBeInstanceOf(refusal as typeof Error);
      expect(answer.sent).toBeUndefined();
      expect(buildSpy).not.toHaveBeenCalled();
    },
  );

  it("lets in a reader on the page's IP allowlist", async () => {
    pageAccess = { isPublicStatusPage: true, ipWhitelist: "203.0.113.0/24" };

    const answer: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: ObjectID.generate().toString(),
    });

    expect(answer.error).toBeUndefined();
    expect(answer.sent).toEqual(expectedSummary());
  });

  it("shares the overview's cache: a page's overview and summary are built once", async () => {
    const pageId: string = ObjectID.generate().toString();

    await ask({
      route: OVERVIEW_ROUTE,
      method: "get",
      statusPageIdOrDomain: pageId,
    });
    await ask({ method: "get", statusPageIdOrDomain: pageId });
    await ask({ method: "post", statusPageIdOrDomain: pageId });

    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  it("asks who is reading on every request: a page gone private is refused from a warm cache", async () => {
    const pageId: string = ObjectID.generate().toString();

    const first: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: pageId,
    });
    expect(first.sent).toBeDefined();

    pageAccess = { isPublicStatusPage: false };

    const second: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: pageId,
    });

    expect(second.error).toBeInstanceOf(NotAuthenticatedException);
    expect(second.sent).toBeUndefined();
    expect(StatusPageService.findOneById).toHaveBeenCalledTimes(2);
  });

  it("hands a failed build on as an error, and sends nothing", async () => {
    buildSpy.mockRejectedValueOnce(new Error("page gone"));

    const answer: Answer = await ask({
      method: "get",
      statusPageIdOrDomain: ObjectID.generate().toString(),
    });

    expect((answer.error as Error).message).toBe("page gone");
    expect(answer.sent).toBeUndefined();
  });
});

describe("the announcements a status page lists", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("name the monitors they affect by id alone: a monitor's own name is the team's", async () => {
    jest.spyOn(StatusPageService, "hasReadAccess").mockResolvedValue({
      hasReadAccess: true,
    } as never);

    jest.spyOn(StatusPageService, "findOneBy").mockImplementation((() => {
      const page: StatusPage = new StatusPage();
      page._id = ObjectID.generate().toString();
      page.projectId = PROJECT_ID;
      page.showAnnouncementsOnStatusPage = true;
      return Promise.resolve(page);
    }) as never);

    const findAnnouncements: jest.SpiedFunction<
      typeof StatusPageAnnouncementService.findBy
    > = jest
      .spyOn(StatusPageAnnouncementService, "findBy")
      .mockResolvedValue([] as Array<StatusPageAnnouncement> as never);

    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(MonitorGroupService, "getMonitorIdsInMonitorGroups")
      .mockResolvedValue({} as never);

    await new StatusPageAPI().getAnnouncements(
      ObjectID.generate(),
      null,
      request(ObjectID.generate().toString()),
    );

    expect(findAnnouncements).toHaveBeenCalledTimes(1);
    expect(
      (findAnnouncements.mock.calls[0]![0] as { select: JSONObject }).select[
        "monitors"
      ],
    ).toEqual({ _id: true });
  });
});

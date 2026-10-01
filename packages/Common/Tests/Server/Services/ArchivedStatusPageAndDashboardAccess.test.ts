import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import DashboardService from "../../../Server/Services/DashboardService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import ObjectID from "../../../Types/ObjectID";
import {
  STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE,
  STATUS_PAGE_ARCHIVED_SENDS_NOTHING_MESSAGE,
  STATUS_PAGE_NOT_FOUND_MESSAGE,
} from "../../../Types/StatusPage/StatusPageArchive";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Email from "../../../Types/Email";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * An archived status page is offline and an archived dashboard is not public.
 * These pin the gates that make it so on the server:
 *
 *   - StatusPageService.hasReadAccess, which every public status page read
 *     goes through, answers an archived page exactly as a missing one -
 *     before the IP allowlist, a public flag or any session could let a
 *     request in;
 *   - the MCP server, the subscriber notifications (one query decides which
 *     pages notify) and the reports leave archived pages out;
 *   - DashboardService.hasReadAccess treats an archived dashboard as not
 *     public, whatever its public setting says.
 */

type AccessResult = { hasReadAccess: boolean; error?: unknown };

function request(): ExpressRequest {
  return {
    params: {},
    body: {},
    query: {},
    cookies: {},
    headers: { "x-forwarded-for": "203.0.113.7" },
    socket: { remoteAddress: "203.0.113.7" },
    ip: "203.0.113.7",
    ips: [],
  } as unknown as ExpressRequest;
}

function statusPage(values: Partial<StatusPage>): StatusPage {
  const page: StatusPage = new StatusPage();
  page.id = ObjectID.generate();
  page.projectId = ObjectID.generate();
  Object.assign(page, values);
  return page;
}

describe("an archived status page is not served", () => {
  let findOneById: SpyInstance<typeof StatusPageService.findOneById>;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serve(page: StatusPage): Promise<AccessResult> {
    findOneById = jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(page as never);

    return StatusPageService.hasReadAccess({
      statusPageId: page.id!,
      req: request(),
    });
  }

  it("answers an archived public page with the same not-found a missing page gets", async () => {
    const result: AccessResult = await serve(
      statusPage({ isPublicStatusPage: true, isArchived: true }),
    );

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(NotFoundException);
    expect((result.error as Error).message).toBe(STATUS_PAGE_NOT_FOUND_MESSAGE);
    expect(STATUS_PAGE_NOT_FOUND_MESSAGE).toBe("Status Page not found");
  });

  it("reads the archive flag along with the access settings", async () => {
    await serve(statusPage({ isPublicStatusPage: true, isArchived: false }));

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["isArchived"]).toBe(true);
  });

  it("is decided before the IP allowlist: an allowlisted visitor is refused too", async () => {
    const result: AccessResult = await serve(
      statusPage({
        isPublicStatusPage: true,
        isArchived: true,
        ipWhitelist: "203.0.113.7",
      }),
    );

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(NotFoundException);
  });

  it("refuses an archived private page the same way, so no sign-in can open it", async () => {
    const result: AccessResult = await serve(
      statusPage({
        isPublicStatusPage: false,
        isArchived: true,
        enableMasterPassword: true,
      }),
    );

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(NotFoundException);
  });

  it("serves a live public page exactly as before", async () => {
    const result: AccessResult = await serve(
      statusPage({ isPublicStatusPage: true, isArchived: false }),
    );

    expect(result).toEqual({ hasReadAccess: true });
  });

  it("unarchiving puts the page back: the same page, no longer archived, is served", async () => {
    const page: StatusPage = statusPage({
      isPublicStatusPage: true,
      isArchived: true,
    });

    expect((await serve(page)).hasReadAccess).toBe(false);

    page.isArchived = false;

    expect((await serve(page)).hasReadAccess).toBe(true);
  });
});

describe("an archived status page's MCP server is off", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("only finds a page that has MCP on and is not archived", async () => {
    const findOneBy: SpyInstance<typeof StatusPageService.findOneBy> = jest
      .spyOn(StatusPageService, "findOneBy")
      .mockResolvedValue(null);

    const statusPageId: ObjectID = ObjectID.generate();

    await expect(
      StatusPageService.isMcpServerEnabled(statusPageId.toString()),
    ).resolves.toBe(false);

    const query: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["enableMcpServer"]).toBe(true);
    expect(query["isArchived"]).toBe(false);
  });
});

describe("isStatusPageArchived", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    "is %s for a page whose isArchived is %s",
    async (expected: boolean, isArchived: boolean) => {
      jest
        .spyOn(StatusPageService, "findOneById")
        .mockResolvedValue(statusPage({ isArchived }) as never);

      await expect(
        StatusPageService.isStatusPageArchived(ObjectID.generate()),
      ).resolves.toBe(expected);
    },
  );

  it("is false for a page that does not exist", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(null);

    await expect(
      StatusPageService.isStatusPageArchived(ObjectID.generate()),
    ).resolves.toBe(false);
  });
});

describe("an archived status page sends nothing", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("leaves archived pages out of the one query every subscriber notification reads", async () => {
    const findBy: SpyInstance<typeof StatusPageService.findBy> = jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([]);

    await StatusPageSubscriberService.getStatusPagesToSendNotification([
      ObjectID.generate(),
    ]);

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["isArchived"]).toBe(false);
  });

  it("a test report for an archived page says why it was not sent", async () => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(Hostname.fromString("oneuptime.example"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([]);
    jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(statusPage({ isArchived: true }) as never);

    await expect(
      StatusPageService.sendEmailReport({ statusPageId: ObjectID.generate() }),
    ).rejects.toThrow(
      new BadDataException(STATUS_PAGE_ARCHIVED_SENDS_NOTHING_MESSAGE),
    );
  });

  it("a page that does not exist is still just not found", async () => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(Hostname.fromString("oneuptime.example"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([]);
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(null);

    await expect(
      StatusPageService.sendEmailReport({ statusPageId: ObjectID.generate() }),
    ).rejects.toThrow("Status page not found");
  });
});

describe("an archived status page takes no new subscribers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type BeforeCreate = (data: {
    data: StatusPageSubscriber;
    props: { isRoot: boolean };
  }) => Promise<unknown>;

  function subscribe(): Promise<unknown> {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.statusPageId = ObjectID.generate();
    subscriber.projectId = ObjectID.generate();
    subscriber.subscriberEmail = new Email("visitor@example.com");

    const onBeforeCreate: BeforeCreate = (
      StatusPageSubscriberService as unknown as {
        onBeforeCreate: BeforeCreate;
      }
    ).onBeforeCreate.bind(StatusPageSubscriberService);

    return onBeforeCreate({ data: subscriber, props: { isRoot: true } });
  }

  beforeEach(() => {
    /*
     * With billing on (as in CI), the plan is checked before the page: a paid
     * plan lets the check reach the page, so these tests read the same in
     * both billing modes.
     */
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    } as CurrentPlan);
    // Not subscribed yet, and the page is not one that notifies.
    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([]);
  });

  it("says the page is archived, rather than that it does not exist", async () => {
    jest
      .spyOn(StatusPageService, "isStatusPageArchived")
      .mockResolvedValue(true);

    await expect(subscribe()).rejects.toThrow(
      new BadDataException(STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE),
    );
  });

  it("a page that does not exist is still just not found", async () => {
    jest
      .spyOn(StatusPageService, "isStatusPageArchived")
      .mockResolvedValue(false);

    await expect(subscribe()).rejects.toThrow(
      new BadDataException("Status Page not found"),
    );
  });
});

describe("an archived monitor is not shown on status pages", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function resource(values: {
    monitorId?: ObjectID;
    monitorGroupId?: ObjectID;
    isArchived?: boolean;
    order: number;
  }): StatusPageResource {
    const row: StatusPageResource = new StatusPageResource();
    row._id = ObjectID.generate().toString();
    row.order = values.order;

    if (values.monitorId) {
      row.monitorId = values.monitorId;
      const monitor: Monitor = new Monitor();
      monitor._id = values.monitorId.toString();
      if (values.isArchived !== undefined) {
        monitor.isArchived = values.isArchived;
      }
      row.monitor = monitor;
    }

    if (values.monitorGroupId) {
      row.monitorGroupId = values.monitorGroupId;
    }

    return row;
  }

  it("drops resources whose monitor is archived, and keeps the rest in order", async () => {
    const live: StatusPageResource = resource({
      monitorId: ObjectID.generate(),
      isArchived: false,
      order: 2,
    });
    const archived: StatusPageResource = resource({
      monitorId: ObjectID.generate(),
      isArchived: true,
      order: 1,
    });
    const group: StatusPageResource = resource({
      monitorGroupId: ObjectID.generate(),
      order: 3,
    });

    const findBy: SpyInstance<typeof StatusPageResourceService.findBy> = jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([group, archived, live]);

    const resources: Array<StatusPageResource> =
      await StatusPageService.getStatusPageResources({
        statusPageId: ObjectID.generate(),
      });

    expect(resources).toEqual([live, group]);

    const select: Record<string, Record<string, unknown>> = (
      findBy.mock.calls[0]![0] as {
        select: Record<string, Record<string, unknown>>;
      }
    ).select;

    expect(select["monitor"]!["isArchived"]).toBe(true);
  });

  it("the monitors on the page - what incidents and reports are read from - leave the archived one out", async () => {
    const liveMonitorId: ObjectID = ObjectID.generate();
    const archivedMonitorId: ObjectID = ObjectID.generate();

    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([
        resource({ monitorId: liveMonitorId, isArchived: false, order: 1 }),
        resource({ monitorId: archivedMonitorId, isArchived: true, order: 2 }),
      ]);

    const onPage: {
      monitorsOnStatusPage: Array<ObjectID>;
    } = await StatusPageService.getMonitorIdsOnStatusPage({
      statusPageId: ObjectID.generate(),
    });

    expect(
      onPage.monitorsOnStatusPage.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([liveMonitorId.toString()]);
  });
});

describe("an archived dashboard is not public", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function dashboard(values: Partial<Dashboard>): Dashboard {
    const item: Dashboard = new Dashboard();
    item.id = ObjectID.generate();
    item.projectId = ObjectID.generate();
    Object.assign(item, values);
    return item;
  }

  async function open(item: Dashboard): Promise<AccessResult> {
    jest
      .spyOn(DashboardService, "findOneById")
      .mockResolvedValue(item as never);

    return DashboardService.hasReadAccess({
      dashboardId: item.id!,
      req: request(),
    });
  }

  it("refuses an archived dashboard even though it is set to public", async () => {
    const result: AccessResult = await open(
      dashboard({ isPublicDashboard: true, isArchived: true }),
    );

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(NotAuthenticatedException);
    expect((result.error as Error).message).toBe(
      "This dashboard is not available.",
    );
  });

  it("serves the same dashboard again once it is unarchived, public setting untouched", async () => {
    const item: Dashboard = dashboard({
      isPublicDashboard: true,
      isArchived: true,
    });

    expect((await open(item)).hasReadAccess).toBe(false);

    item.isArchived = false;

    expect((await open(item)).hasReadAccess).toBe(true);
  });

  it("reads the archive flag with the access settings", async () => {
    const findOneById: SpyInstance<typeof DashboardService.findOneById> = jest
      .spyOn(DashboardService, "findOneById")
      .mockResolvedValue(
        dashboard({ isPublicDashboard: true, isArchived: false }) as never,
      );

    await DashboardService.hasReadAccess({
      dashboardId: ObjectID.generate(),
      req: request(),
    });

    expect(
      (findOneById.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["isArchived"],
    ).toBe(true);
  });
});

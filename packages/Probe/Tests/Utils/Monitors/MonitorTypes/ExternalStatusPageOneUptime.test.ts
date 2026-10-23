process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];
delete process.env["REGISTER_PROBE_KEY"];

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import ExternalStatusPageMonitorUtil, {
  EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
} from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import { HttpMonitorExecutionContext } from "../../../../Utils/Monitors/HttpMonitorRequest";
import ProxyConfig from "../../../../Utils/ProxyConfig";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { MASTER_PASSWORD_REQUIRED_MESSAGE } from "Common/Types/StatusPage/MasterPassword";
import { STATUS_PAGE_NOT_FOUND_MESSAGE } from "Common/Types/StatusPage/StatusPageArchive";
import Sleep from "Common/Types/Sleep";
import {
  FAKE_STATUSES,
  FakeStatusPage,
  fakeSummaryJSON,
} from "Common/Tests/Helpers/FakeStatusPageOverview";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import dns from "dns";
import { Readable } from "stream";

/*
 * The External Status Page monitor reading a status page made with
 * OneUptime (issue #5176), against a fake OneUptime host that answers as one
 * does:
 *
 *   /status-page-api/summary/<domain or id>  the page's summary, built by
 *       the server's own code (StatusPageSummaryBuilder) from an overview
 *       built as the server builds it (FakeStatusPageOverview); or the
 *       status and body the server's read check answers a reader it does
 *       not let in: 401 for a private page or one with a password, 403 for
 *       an address its allowlist leaves out, 404 for no such page;
 *   /rss                                     the page's feed;
 *   /api/...                                 the API, which knows no
 *       Atlassian route (404);
 *   anything else                            the status page app (HTML).
 *
 * Only DNS and the network are faked: the probe's egress guard, its
 * redirects and response budget, Auto detection and the scoping all run as
 * they do on a probe.
 */

const DOMAIN: string = "status.upstream.example";
const PAGE_ID: string = "5e300000-0000-4000-8000-0000000000ff";
const PUBLIC_ADDRESS: string = "93.184.216.34";
const NOW: Date = new Date("2026-10-23T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

const id: (suffix: string) => string = (suffix: string): string => {
  return `5e300000-0000-4000-8000-${suffix.padStart(12, "0")}`;
};

// Monitors and monitor groups of the upstream project.
const M_API: string = id("a01");
const M_WEB: string = id("a02");
const M_DB_PRIMARY: string = id("a03");
const M_DB_REPLICA: string = id("a04");
const M_EU_API: string = id("a05");
const M_US_API: string = id("a06");
const G_DATABASES: string = id("b01");

// The page's groups and resources.
const PG_CORE: string = id("c01");
const PG_DATA: string = id("c02");
const PG_EU: string = id("c03");
const PG_US: string = id("c04");
const R_API: string = id("d01");
const R_WEB: string = id("d02");
const R_DATABASES: string = id("d03");
const R_EU_API: string = id("d04");
const R_US_API: string = id("d05");

type PageAccess = "public" | "private" | "password" | "ip-blocked" | "archived";

interface HostedPage {
  access: PageAccess;
  page: FakeStatusPage;
}

interface FakeAnswer {
  status: number;
  body: string;
  contentType: string;
}

/*
 * A host that serves OneUptime status pages: its own domain's page, and
 * pages under /status-page/<id>.
 */
class FakeOneUptimeHost {
  public readonly requests: Array<string> = [];
  public readonly headers: Array<Record<string, unknown>> = [];
  private readonly pagesByDomain: Map<string, HostedPage> = new Map();
  private readonly pagesById: Map<string, HostedPage> = new Map();
  private summaryAnswers: number = 0;
  // Older OneUptime: no summary route.
  public hasSummaryRoute: boolean = true;

  public serve(data: {
    domain?: string | undefined;
    id?: string | undefined;
    access?: PageAccess | undefined;
    page: FakeStatusPage;
  }): void {
    const hosted: HostedPage = {
      access: data.access || "public",
      page: data.page,
    };

    if (data.domain) {
      this.pagesByDomain.set(data.domain, hosted);
    }

    if (data.id) {
      this.pagesById.set(data.id, hosted);
    }
  }

  public get summaryRequestCount(): number {
    return this.summaryAnswers;
  }

  public answer(url: string): FakeAnswer {
    const path: string = new URL(url).pathname;

    if (path.startsWith("/status-page-api/summary/")) {
      this.summaryAnswers++;

      if (!this.hasSummaryRoute) {
        return this.html(404);
      }

      return this.summary(
        decodeURIComponent(path.slice("/status-page-api/summary/".length)),
      );
    }

    if (path.startsWith("/api/")) {
      return this.json(404, { message: "Not found" });
    }

    if (path === "/rss" || path.endsWith("/rss")) {
      return {
        status: 200,
        contentType: "application/rss+xml",
        body: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Upstream Updates</title>
<item><title>Scheduled Maintenance: Database upgrade</title><pubDate>${new Date(
          Date.now() + 3 * 24 * HOUR,
        ).toUTCString()}</pubDate></item>
</channel></rss>`,
      };
    }

    // The status page app, for any other path.
    return this.html(200);
  }

  private summary(statusPageIdOrDomain: string): FakeAnswer {
    const hosted: HostedPage | undefined = statusPageIdOrDomain.includes(".")
      ? this.pagesByDomain.get(statusPageIdOrDomain)
      : this.pagesById.get(statusPageIdOrDomain);

    if (!hosted || hosted.access === "archived") {
      return this.json(404, { message: STATUS_PAGE_NOT_FOUND_MESSAGE });
    }

    if (hosted.access === "private") {
      return this.json(401, {
        message:
          "You do not have access to this status page. Please login to view the status page.",
      });
    }

    if (hosted.access === "password") {
      return this.json(401, { message: MASTER_PASSWORD_REQUIRED_MESSAGE });
    }

    if (hosted.access === "ip-blocked") {
      return this.json(403, {
        message: `Your IP address ${PUBLIC_ADDRESS} is blocked from accessing this status page.`,
      });
    }

    return this.json(200, fakeSummaryJSON(hosted.page));
  }

  private json(status: number, body: unknown): FakeAnswer {
    return {
      status: status,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(body),
    };
  }

  private html(status: number): FakeAnswer {
    return {
      status: status,
      contentType: "text/html; charset=utf-8",
      body: "<!DOCTYPE html><html><head><title>Status</title></head><body><div id=\"root\"></div></body></html>",
    };
  }
}

let host: FakeOneUptimeHost;

function config(
  data: Partial<MonitorStepExternalStatusPageMonitor> = {},
): MonitorStepExternalStatusPageMonitor {
  return {
    statusPageUrl: `https://${DOMAIN}`,
    provider: ExternalStatusPageProviderType.OneUptime,
    timeout: 5000,
    retries: 2,
    ...data,
  };
}

async function check(
  data: Partial<MonitorStepExternalStatusPageMonitor> = {},
): Promise<ExternalStatusPageMonitorResponse> {
  const response: ExternalStatusPageMonitorResponse | null =
    await ExternalStatusPageMonitorUtil.fetch(config(data), {
      isOnlineCheckRequest: true,
    });

  expect(response).not.toBeNull();
  return response!;
}

function statuses(
  response: ExternalStatusPageMonitorResponse,
): Array<[string, string]> {
  return response.componentStatuses.map(
    (component: ExternalStatusPageComponentStatus): [string, string] => {
      return [component.name, component.status];
    },
  );
}

function component(
  response: ExternalStatusPageMonitorResponse,
  name: string,
): ExternalStatusPageComponentStatus {
  const found: ExternalStatusPageComponentStatus | undefined =
    response.componentStatuses.find(
      (candidate: ExternalStatusPageComponentStatus): boolean => {
        return candidate.name === name;
      },
    );

  expect({ name, found: Boolean(found) }).toEqual({ name, found: true });
  return found!;
}

// A department's page, the shape of the customer's: groups, a monitor group.
function departmentPage(
  overrides: Partial<FakeStatusPage> = {},
): FakeStatusPage {
  return {
    groups: [
      { id: PG_CORE, name: "Core" },
      { id: PG_DATA, name: "Data", parentId: PG_CORE },
    ],
    resources: [
      {
        id: R_API,
        name: "Checkout API",
        groupId: PG_CORE,
        monitorId: M_API,
        statusId: FAKE_STATUSES.operational.id,
      },
      {
        id: R_WEB,
        name: "Storefront",
        monitorId: M_WEB,
        statusId: FAKE_STATUSES.degraded.id,
      },
      {
        id: R_DATABASES,
        name: "Databases",
        groupId: PG_DATA,
        monitorGroupId: G_DATABASES,
      },
    ],
    monitorGroups: [
      {
        id: G_DATABASES,
        monitorIds: [M_DB_PRIMARY, M_DB_REPLICA],
        statusId: FAKE_STATUSES.operational.id,
      },
    ],
    ...overrides,
  };
}

const DATABASE_UPGRADE: NonNullable<FakeStatusPage["maintenance"]> = [
  {
    id: id("e01"),
    title: "Database upgrade",
    state: "ongoing",
    startsAt: new Date(NOW.getTime() - HOUR),
    endsAt: new Date(NOW.getTime() + HOUR),
    monitorIds: [M_DB_REPLICA],
  },
];

beforeEach(() => {
  host = new FakeOneUptimeHost();

  jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
  jest.spyOn(ProxyConfig, "getHttpsProxyAgent").mockReturnValue(null);
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  jest
    .spyOn(HttpMonitorExecutionContext.prototype, "sleep")
    .mockResolvedValue(undefined as never);

  // Every name the probe looks up is the fake host, on a public address.
  jest.spyOn(dns.promises, "lookup").mockImplementation((async () => {
    return [{ address: PUBLIC_ADDRESS, family: 4 }];
  }) as never);

  jest
    .spyOn(axios, "get")
    .mockImplementation(
      async (url: string, options?: AxiosRequestConfig): Promise<AxiosResponse> => {
        host.requests.push(url);
        host.headers.push({ ...(options?.headers as Record<string, unknown>) });

        const answer: FakeAnswer = host.answer(url);

        return {
          status: answer.status,
          statusText: String(answer.status),
          data: Readable.from([Buffer.from(answer.body)]),
          headers: { "content-type": answer.contentType },
          config: {},
          request: {},
        } as AxiosResponse;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a OneUptime status page, with the provider chosen", () => {
  test("reads the page's summary once, by the page's own domain, and nothing else", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(host.requests).toEqual([
      `https://${DOMAIN}/status-page-api/summary/${DOMAIN}`,
    ]);
    expect(host.headers[0]).toMatchObject({ Accept: "application/json" });
    expect(response.isOnline).toBe(true);
    expect(response.provider).toBe(ExternalStatusPageProviderType.OneUptime);
    expect(response.failureCause).toBe("");
    expect(response.totalAttempts).toBe(1);
  });

  test("reports each resource as a component: its name, its group, the value its status stands for and the page's own word for it", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(response.componentStatuses).toEqual([
      {
        name: "Checkout API",
        status: "operational",
        description: "Operational",
        groupName: "Core",
      },
      {
        name: "Storefront",
        status: "degraded_performance",
        description: "Degraded",
        groupName: undefined,
      },
      {
        name: "Databases",
        status: "operational",
        description: "Operational",
        groupName: "Core / Data",
      },
    ]);
    expect(response.activeIncidentCount).toBe(0);
    // The worst component, as the criteria compare it.
    expect(response.overallStatus).toBe("degraded_performance");
  });

  test("reads a page under OneUptime by the id in its address", async () => {
    host.serve({ id: PAGE_ID, page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://oneuptime.example/status-page/${PAGE_ID}/incidents`,
    });

    expect(host.requests).toEqual([
      `https://oneuptime.example/status-page-api/summary/${PAGE_ID}`,
    ]);
    expect(statuses(response)).toEqual([
      ["Checkout API", "operational"],
      ["Storefront", "degraded_performance"],
      ["Databases", "operational"],
    ]);
  });

  test("reads the page when the address given is its feed", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${DOMAIN}/rss`,
    });

    expect(response.provider).toBe(ExternalStatusPageProviderType.OneUptime);
    expect(host.requests).toEqual([
      `https://${DOMAIN}/status-page-api/summary/${DOMAIN}`,
    ]);
  });
});

describe("scheduled maintenance on a OneUptime status page", () => {
  test("a resource is under maintenance while an event in progress affects it, through a monitor in its group", async () => {
    host.serve({
      domain: DOMAIN,
      page: departmentPage({ maintenance: DATABASE_UPGRADE }),
    });

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(component(response, "Databases")).toEqual({
      name: "Databases",
      status: "under_maintenance",
      description: "Under maintenance: Database upgrade",
      groupName: "Core / Data",
    });
    expect(component(response, "Checkout API").status).toBe("operational");
  });

  test.each([
    ["left Operational", FAKE_STATUSES.operational.id],
    ["changed to Offline", FAKE_STATUSES.offline.id],
    ["changed to Degraded", FAKE_STATUSES.degraded.id],
  ])(
    "under maintenance whatever status the event left its monitors in: %s",
    async (_name: string, statusId: string) => {
      host.serve({
        domain: DOMAIN,
        page: departmentPage({
          resources: [
            {
              id: R_API,
              name: "Checkout API",
              monitorId: M_API,
              statusId: statusId,
            },
          ],
          maintenance: [{ ...DATABASE_UPGRADE[0]!, monitorIds: [M_API] }],
        }),
      });

      const response: ExternalStatusPageMonitorResponse = await check();

      expect(statuses(response)).toEqual([
        ["Checkout API", "under_maintenance"],
      ]);
      expect(response.overallStatus).toBe("under_maintenance");
    },
  );

  test("an event in a state of the project's own after Ongoing is still in progress", async () => {
    host.serve({
      domain: DOMAIN,
      page: departmentPage({
        maintenance: [{ ...DATABASE_UPGRADE[0]!, state: "verifying" }],
      }),
    });

    expect(component(await check(), "Databases").status).toBe(
      "under_maintenance",
    );
  });

  test.each(["scheduled", "confirmed", "ended", "reviewing", "completed", "archived"] as const)(
    "an event %s puts nothing under maintenance",
    async (
      state:
        | "scheduled"
        | "confirmed"
        | "ended"
        | "reviewing"
        | "completed"
        | "archived",
    ) => {
      host.serve({
        domain: DOMAIN,
        page: departmentPage({
          maintenance: [{ ...DATABASE_UPGRADE[0]!, state: state }],
        }),
      });

      expect(component(await check(), "Databases").status).toBe(
        "operational",
      );
    },
  );

  test("a page that does not show maintenance puts nothing under maintenance", async () => {
    host.serve({
      domain: DOMAIN,
      page: departmentPage({
        showsMaintenance: false,
        maintenance: DATABASE_UPGRADE,
      }),
    });

    expect(component(await check(), "Databases").status).toBe("operational");
  });

  test("names every event in progress that affects a resource", async () => {
    host.serve({
      domain: DOMAIN,
      page: departmentPage({
        maintenance: [
          DATABASE_UPGRADE[0]!,
          {
            ...DATABASE_UPGRADE[0]!,
            id: id("e02"),
            title: "Replica resync",
            monitorIds: [M_DB_PRIMARY],
          },
        ],
      }),
    });

    expect(component(await check(), "Databases").description).toBe(
      "Under maintenance: Database upgrade, Replica resync",
    );
  });
});

describe("scoping a OneUptime status page", () => {
  // Two resources of one name, in two groups.
  function regionalPage(): FakeStatusPage {
    return {
      groups: [
        { id: PG_EU, name: "Europe" },
        { id: PG_US, name: "United States" },
      ],
      resources: [
        {
          id: R_EU_API,
          name: "API",
          groupId: PG_EU,
          monitorId: M_EU_API,
          statusId: FAKE_STATUSES.offline.id,
        },
        {
          id: R_US_API,
          name: "API",
          groupId: PG_US,
          monitorId: M_US_API,
          statusId: FAKE_STATUSES.operational.id,
        },
      ],
      incidents: [
        {
          id: id("f01"),
          title: "EU API down",
          declaredAt: NOW,
          state: "Investigating",
          severity: "SEV-1",
          monitorIds: [M_EU_API],
        },
      ],
    };
  }

  test("a component name filter keeps the resource it names", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check({
      componentName: "checkout",
    });

    expect(statuses(response)).toEqual([["Checkout API", "operational"]]);
    expect(response.overallStatus).toBe("operational");
    expect(response.componentName).toBe("checkout");
  });

  test("a group filter keeps the group and the groups inside it", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });

    expect(statuses(await check({ componentGroupName: "Core" }))).toEqual([
      ["Checkout API", "operational"],
      ["Databases", "operational"],
    ]);
    expect(statuses(await check({ componentGroupName: "Data" }))).toEqual([
      ["Databases", "operational"],
    ]);
  });

  test("an incident counts for the resource it affects, not for another of the same name", async () => {
    host.serve({ domain: DOMAIN, page: regionalPage() });

    const all: ExternalStatusPageMonitorResponse = await check();
    expect(all.activeIncidentCount).toBe(1);
    expect(all.overallStatus).toBe("major_outage");

    const us: ExternalStatusPageMonitorResponse = await check({
      componentGroupName: "United States",
    });
    expect(statuses(us)).toEqual([["API", "operational"]]);
    expect(us.activeIncidentCount).toBe(0);
    expect(us.overallStatus).toBe("operational");

    const eu: ExternalStatusPageMonitorResponse = await check({
      componentGroupName: "Europe",
      componentName: "API",
    });
    expect(statuses(eu)).toEqual([["API", "major_outage"]]);
    expect(eu.activeIncidentCount).toBe(1);
  });

  test("a resource whose status the page hides reads unknown, and says why", async () => {
    host.serve({
      domain: DOMAIN,
      page: departmentPage({
        resources: [
          {
            id: R_WEB,
            name: "Storefront",
            monitorId: M_WEB,
            statusId: FAKE_STATUSES.offline.id,
            showCurrentStatus: false,
          },
        ],
      }),
    });

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(response.componentStatuses).toEqual([
      {
        name: "Storefront",
        status: "unknown",
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
        groupName: undefined,
      },
    ]);
    /*
     * The hidden status reaches no component. (The page's banner, which
     * counts every resource, is on the page for anyone to see, and stays in
     * the raw summary.)
     */
    expect(JSON.stringify(response.componentStatuses)).not.toContain(
      FAKE_STATUSES.offline.name,
    );
  });
});

describe("a OneUptime status page that does not let the probe in", () => {
  test.each([
    ["private", "private", EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE],
    [
      "protected by a password",
      "password",
      EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
    ],
    [
      "limited to its IP allowlist",
      "ip-blocked",
      EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
    ],
  ])(
    "a page %s: the check fails and says why, at once, with nothing else asked",
    async (_name: string, access: string, message: string) => {
      host.serve({
        domain: DOMAIN,
        access: access as PageAccess,
        page: departmentPage(),
      });

      const response: ExternalStatusPageMonitorResponse = await check();

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(message);
      expect(response.componentStatuses).toEqual([]);
      // A definite answer: not retried, and no reachability check after it.
      expect(response.totalAttempts).toBe(1);
      expect(host.requests).toEqual([
        `https://${DOMAIN}/status-page-api/summary/${DOMAIN}`,
      ]);
      // Nothing the server said is repeated.
      expect(JSON.stringify(response)).not.toContain(PUBLIC_ADDRESS);
    },
  );

  test("no such page: the reachability check, as for every provider chosen that cannot read a page", async () => {
    host.serve({ domain: "another.example", page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(response.provider).toBeUndefined();
    expect(response.overallStatus).toBe("reachable");
    expect(response.componentStatuses).toEqual([]);
    expect(host.requests).toEqual([
      `https://${DOMAIN}/status-page-api/summary/${DOMAIN}`,
      `https://${DOMAIN}/`,
    ]);
  });

  test("an archived page reads as one that does not exist", async () => {
    host.serve({ domain: DOMAIN, access: "archived", page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(response.provider).toBeUndefined();
    expect(response.componentStatuses).toEqual([]);
  });

  test("a OneUptime too old to have the summary: the reachability check", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });
    host.hasSummaryRoute = false;

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(response.provider).toBeUndefined();
    expect(response.overallStatus).toBe("reachable");
  });
});

describe("Auto detection of a OneUptime status page", () => {
  test("after incident.io and Atlassian, before the feed", async () => {
    host.serve({ domain: DOMAIN, page: departmentPage() });

    const response: ExternalStatusPageMonitorResponse = await check({
      provider: ExternalStatusPageProviderType.Auto,
    });

    expect(response.provider).toBe(ExternalStatusPageProviderType.OneUptime);
    expect(host.requests).toEqual([
      `https://${DOMAIN}/proxy/${DOMAIN}`,
      `https://${DOMAIN}/api/v2/status.json`,
      `https://${DOMAIN}/status-page-api/summary/${DOMAIN}`,
    ]);
    expect(statuses(response)).toEqual([
      ["Checkout API", "operational"],
      ["Storefront", "degraded_performance"],
      ["Databases", "operational"],
    ]);
  });

  test("detects maintenance a feed would have reported as an incident", async () => {
    host.serve({
      domain: DOMAIN,
      page: departmentPage({ maintenance: DATABASE_UPGRADE }),
    });

    const response: ExternalStatusPageMonitorResponse = await check({
      provider: ExternalStatusPageProviderType.Auto,
      statusPageUrl: `https://${DOMAIN}/rss`,
    });

    expect(response.provider).toBe(ExternalStatusPageProviderType.OneUptime);
    expect(response.activeIncidentCount).toBe(0);
    expect(component(response, "Databases").status).toBe("under_maintenance");
  });

  test.each(["private", "ip-blocked"] as const)(
    "a %s page is not taken for a OneUptime page: Auto moves on to the feed",
    async (access: "private" | "ip-blocked") => {
      host.serve({ domain: DOMAIN, access: access, page: departmentPage() });

      const response: ExternalStatusPageMonitorResponse = await check({
        provider: ExternalStatusPageProviderType.Auto,
      });

      expect(response.failureCause).not.toBe(
        EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
      );
      expect(response.provider).not.toBe(
        ExternalStatusPageProviderType.OneUptime,
      );
      expect(host.requests.slice(0, 3)).toEqual([
        `https://${DOMAIN}/proxy/${DOMAIN}`,
        `https://${DOMAIN}/api/v2/status.json`,
        `https://${DOMAIN}/status-page-api/summary/${DOMAIN}`,
      ]);
    },
  );

  test("an Atlassian Statuspage is detected before a OneUptime page is asked about", async () => {
    jest.spyOn(axios, "get").mockImplementation(
      async (url: string): Promise<AxiosResponse> => {
        host.requests.push(url);
        const path: string = new URL(url).pathname;
        const answers: Record<string, unknown> = {
          "/api/v2/status.json": {
            status: { indicator: "none", description: "All Systems Operational" },
          },
          "/api/v2/components.json": { components: [] },
          "/api/v2/incidents/unresolved.json": { incidents: [] },
        };
        const body: unknown = answers[path];

        return {
          status: body ? 200 : 404,
          statusText: body ? "OK" : "Not Found",
          data: Readable.from([Buffer.from(JSON.stringify(body || {}))]),
          headers: {},
          config: {},
          request: {},
        } as AxiosResponse;
      },
    );

    const response: ExternalStatusPageMonitorResponse = await check({
      provider: ExternalStatusPageProviderType.Auto,
    });

    expect(response.provider).toBe(
      ExternalStatusPageProviderType.AtlassianStatuspage,
    );
    expect(
      host.requests.some((url: string): boolean => {
        return new URL(url).pathname.startsWith("/status-page-api/");
      }),
    ).toBe(false);
  });

  test("a page that is neither: the summary is asked once, then the feed is read", async () => {
    // Nothing served under the summary: a feed-only status page.
    const response: ExternalStatusPageMonitorResponse = await check({
      provider: ExternalStatusPageProviderType.Auto,
      statusPageUrl: `https://${DOMAIN}/rss`,
    });

    expect(response.provider).toBe(ExternalStatusPageProviderType.RSS);
    expect(host.summaryRequestCount).toBe(1);
  });
});

describe("what a OneUptime status page's answer may not do", () => {
  test("an answer that is not a summary is not read as one", async () => {
    jest.spyOn(axios, "get").mockImplementation(
      async (url: string): Promise<AxiosResponse> => {
        host.requests.push(url);
        const isSummary: boolean = new URL(url).pathname.startsWith(
          "/status-page-api/summary/",
        );

        return {
          status: 200,
          statusText: "OK",
          data: Readable.from([
            Buffer.from(
              isSummary
                ? JSON.stringify({ resources: "not a list", activeIncidents: [] })
                : "<!DOCTYPE html><html></html>",
            ),
          ]),
          headers: {},
          config: {},
          request: {},
        } as AxiosResponse;
      },
    );

    const response: ExternalStatusPageMonitorResponse = await check();

    expect(response.provider).toBeUndefined();
    expect(response.overallStatus).toBe("reachable");
  });

  test("an address on a private network is refused before any request", async () => {
    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: "http://127.0.0.1:3000",
    });

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("loopback address");
    expect(host.requests).toEqual([]);
  });
});

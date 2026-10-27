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

import ExternalStatusPageMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import { HttpMonitorExecutionContext } from "../../../../Utils/Monitors/HttpMonitorRequest";
import ProxyConfig from "../../../../Utils/ProxyConfig";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import {
  CLOUDFLARE_PAGE,
  FixtureComponent,
  FixtureIncident,
  FixturePage,
  GITHUB_CHOSEN_COMPONENTS,
  GITHUB_INCIDENTS,
  GITHUB_PAGE,
  OPENAI_INCIDENTS,
  OPENAI_PAGE,
  atlassianComponentsJSON,
  atlassianStatusJSON,
  atlassianUnresolvedJSON,
  incidentIoProxyJSON,
  withStatuses,
} from "Common/Tests/Helpers/ExternalStatusPageFixtures";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import dns from "dns";
import { Readable } from "stream";

/*
 * THE EXTERNAL STATUS PAGE MONITOR, WATCHING SOME COMPONENTS OF A PAGE.
 *
 * Issue #5156: a customer's monitor of GitHub's status page depends on Git
 * Operations and Pull Requests (maybe Actions and Webhooks), and an
 * incident of Copilot took it offline. They asked whether one monitor's
 * single request could be filtered to several components. It can: a
 * monitor keeps the components it chose, by name, and one check - the
 * same requests as for the whole page - reports only theirs.
 *
 * Against fake hosts that answer as each provider does
 * (ExternalStatusPageFixtures): GitHub's and Cloudflare's Atlassian
 * Statuspages, OpenAI's incident.io page (with the Atlassian-shaped
 * status.json shim such pages serve too), a feed, and a plain page. Only
 * DNS and the network are faked: the probe's egress guard, its redirects
 * and response budget, Auto detection and the scoping all run as they do
 * on a probe.
 *
 * A monitor saved with one Component Name Filter is checked against the
 * rule it was saved under, written out here as the probe ran it before
 * (legacyScope): it watches exactly the same components, incidents and
 * overall status.
 */

const PUBLIC_ADDRESS: string = "93.184.216.34";
const HOUR: number = 60 * 60 * 1000;

const GITHUB_HOST: string = "www.githubstatus.com";
const OPENAI_HOST: string = "status.openai.com";
const CLOUDFLARE_HOST: string = "www.cloudflarestatus.com";
const FEED_HOST: string = "status.feed.example";
const PLAIN_HOST: string = "status.plain.example";

interface FakeAnswer {
  status: number;
  body: string;
  contentType: string;
}

interface HostedAtlassianPage {
  page: FixturePage;
  incidents: Array<FixtureIncident>;
  status?: { indicator: string; description: string } | undefined;
}

interface HostedIncidentIoPage {
  page: FixturePage;
  incidents: Array<FixtureIncident>;
}

class FakeStatusHosts {
  public readonly requests: Array<string> = [];
  public atlassian: Map<string, HostedAtlassianPage> = new Map();
  public incidentIo: Map<string, HostedIncidentIoPage> = new Map();
  public feedBody: string = "";

  public answer(url: string): FakeAnswer {
    const parsed: URL = new URL(url);
    const host: string = parsed.hostname;
    const path: string = parsed.pathname;

    const incidentIo: HostedIncidentIoPage | undefined =
      this.incidentIo.get(host);

    if (path === `/proxy/${host}`) {
      return incidentIo
        ? this.json(
            200,
            incidentIoProxyJSON(incidentIo.page, incidentIo.incidents),
          )
        : this.json(404, { error: "not found" });
    }

    const atlassian: HostedAtlassianPage | undefined = this.atlassian.get(host);

    if (path === "/api/v2/status.json") {
      if (atlassian) {
        return this.json(
          200,
          atlassianStatusJSON(atlassian.page, atlassian.status),
        );
      }

      // incident.io's pages serve an Atlassian-shaped status of their own.
      return incidentIo
        ? this.json(200, { status: { indicator: "none", description: "Fine" } })
        : this.html(404);
    }

    if (path === "/api/v2/components.json") {
      return atlassian
        ? this.json(200, atlassianComponentsJSON(atlassian.page))
        : this.html(404);
    }

    if (path === "/api/v2/incidents/unresolved.json") {
      return atlassian
        ? this.json(
            200,
            atlassianUnresolvedJSON(atlassian.page, atlassian.incidents),
          )
        : this.html(404);
    }

    if (path.startsWith("/status-page-api/summary/")) {
      return this.json(404, { message: "Not found" });
    }

    if (host === FEED_HOST && path === "/history.rss") {
      return {
        status: 200,
        contentType: "application/rss+xml",
        body: this.feedBody,
      };
    }

    if (host === FEED_HOST && path === "/history.atom") {
      return {
        status: 200,
        contentType: "application/atom+xml",
        body: this.feedBody,
      };
    }

    return this.html(200);
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
      body: "<!DOCTYPE html><html><head><title>Status</title></head><body></body></html>",
    };
  }
}

let hosts: FakeStatusHosts;

beforeEach(() => {
  hosts = new FakeStatusHosts();

  jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
  jest.spyOn(ProxyConfig, "getHttpsProxyAgent").mockReturnValue(null);
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  jest
    .spyOn(HttpMonitorExecutionContext.prototype, "sleep")
    .mockResolvedValue(undefined as never);

  // Every name the probe looks up is a fake host, on a public address.
  jest.spyOn(dns.promises, "lookup").mockImplementation((async () => {
    return [{ address: PUBLIC_ADDRESS, family: 4 }];
  }) as never);

  jest
    .spyOn(axios, "get")
    .mockImplementation(
      async (
        url: string,
        _options?: AxiosRequestConfig,
      ): Promise<AxiosResponse> => {
        hosts.requests.push(url);

        const answer: FakeAnswer = hosts.answer(url);

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

async function check(
  config: Partial<MonitorStepExternalStatusPageMonitor> & {
    statusPageUrl: string;
  },
): Promise<ExternalStatusPageMonitorResponse> {
  const response: ExternalStatusPageMonitorResponse | null =
    await ExternalStatusPageMonitorUtil.fetch(
      {
        provider: ExternalStatusPageProviderType.Auto,
        timeout: 5000,
        retries: 0,
        ...config,
      },
      { isOnlineCheckRequest: true },
    );

  expect(response).not.toBeNull();
  return response!;
}

function watched(response: ExternalStatusPageMonitorResponse): Array<string> {
  return response.componentStatuses.map(
    (component: ExternalStatusPageComponentStatus): string => {
      return component.name;
    },
  );
}

function serveGitHub(
  incidents: Array<FixtureIncident>,
  statuses: Record<string, string> = {},
): void {
  hosts.atlassian.set(GITHUB_HOST, {
    page: withStatuses(GITHUB_PAGE, statuses),
    incidents: incidents,
    status: Object.keys(statuses).length
      ? { indicator: "minor", description: "Partial System Outage" }
      : undefined,
  });
}

describe("GitHub's page, watched for Git Operations, Pull Requests, Actions and Webhooks", () => {
  test("an incident of Copilot leaves the monitor online: none of its components, no incident, the page's outage not theirs", async () => {
    serveGitHub([GITHUB_INCIDENTS.copilot, GITHUB_INCIDENTS.unattributed], {
      Copilot: "major_outage",
    });

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${GITHUB_HOST}`,
      componentNames: GITHUB_CHOSEN_COMPONENTS,
    });

    expect(response.provider).toBe(
      ExternalStatusPageProviderType.AtlassianStatuspage,
    );
    expect(watched(response)).toEqual([
      "Git Operations",
      "Webhooks",
      "Pull Requests",
      "Actions",
    ]);
    expect(response.activeIncidentCount).toBe(0);
    expect(response.activeIncidentNames).toEqual([]);
    expect(response.incidentsOutsideScopeCount).toBe(2);
    expect(response.overallStatus).toBe("operational");
    expect(response.unmatchedComponentNames).toEqual([]);
    // The scope it watched, echoed for the summary and the templates.
    expect(response.componentNames).toEqual(GITHUB_CHOSEN_COMPONENTS);
    expect(response.componentName).toBeUndefined();
  });

  test("an incident of Git Operations and Pull Requests: one incident, named, and their statuses", async () => {
    serveGitHub(
      [GITHUB_INCIDENTS.gitAndPullRequests, GITHUB_INCIDENTS.copilot],
      {
        "Git Operations": "partial_outage",
        "Pull Requests": "degraded_performance",
      },
    );

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${GITHUB_HOST}`,
      provider: ExternalStatusPageProviderType.AtlassianStatuspage,
      componentNames: GITHUB_CHOSEN_COMPONENTS,
    });

    expect(response.activeIncidentCount).toBe(1);
    expect(response.activeIncidentNames).toEqual([
      "Incident with Git Operations and Pull Requests",
    ]);
    expect(response.incidentsOutsideScopeCount).toBe(1);
    expect(
      response.componentStatuses.map(
        (component: ExternalStatusPageComponentStatus): [string, string] => {
          return [component.name, component.status];
        },
      ),
    ).toEqual([
      ["Git Operations", "partial_outage"],
      ["Webhooks", "operational"],
      ["Pull Requests", "degraded_performance"],
      ["Actions", "operational"],
    ]);
    expect(response.overallStatus).toBe("partial_outage");
  });

  test("asks the page what it asks for the whole page, and nothing more: one check, every component it chose", async () => {
    serveGitHub([GITHUB_INCIDENTS.copilot]);

    await check({
      statusPageUrl: `https://${GITHUB_HOST}`,
      componentNames: GITHUB_CHOSEN_COMPONENTS,
    });

    const scoped: Array<string> = [...hosts.requests];

    hosts.requests.length = 0;
    await check({ statusPageUrl: `https://${GITHUB_HOST}` });

    expect(scoped).toEqual(hosts.requests);
    expect(scoped).toEqual([
      // Auto asks incident.io first, then reads the Statuspage.
      `https://${GITHUB_HOST}/proxy/${GITHUB_HOST}`,
      `https://${GITHUB_HOST}/api/v2/status.json`,
      `https://${GITHUB_HOST}/api/v2/components.json`,
      `https://${GITHUB_HOST}/api/v2/incidents/unresolved.json`,
    ]);
  });

  test("the whole page, with nothing chosen: every incident, the page's own status", async () => {
    serveGitHub([GITHUB_INCIDENTS.copilot, GITHUB_INCIDENTS.unattributed], {
      Copilot: "major_outage",
    });

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${GITHUB_HOST}`,
    });

    expect(watched(response)).toHaveLength(GITHUB_PAGE.components.length);
    expect(response.activeIncidentCount).toBe(2);
    expect(response.incidentsOutsideScopeCount).toBe(0);
    expect(response.overallStatus).toBe("Partial System Outage");
    expect(response.componentNames).toEqual([]);
  });

  test("a chosen name the page does not have is said, and watches nothing", async () => {
    serveGitHub([]);

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${GITHUB_HOST}`,
      componentNames: ["Git Operations", "Webhook"],
    });

    expect(watched(response)).toEqual(["Git Operations"]);
    expect(response.unmatchedComponentNames).toEqual(["Webhook"]);
  });

  test("Copilot chosen watches Copilot, not Copilot AI Model Providers", async () => {
    serveGitHub([GITHUB_INCIDENTS.modelProviders]);

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${GITHUB_HOST}`,
      componentNames: ["Copilot"],
    });

    expect(watched(response)).toEqual(["Copilot"]);
    expect(response.activeIncidentCount).toBe(0);
    expect(response.componentName).toBe("Copilot");
  });
});

describe("OpenAI's incident.io page", () => {
  function serveOpenAi(
    incidents: Array<FixtureIncident>,
    statuses: Record<string, string> = {},
  ): void {
    hosts.incidentIo.set(OPENAI_HOST, {
      page: withStatuses(OPENAI_PAGE, statuses),
      incidents: incidents,
    });
  }

  test("watched for two ChatGPT components: their incident counts, the APIs' does not, nor one that names nothing", async () => {
    serveOpenAi(
      [
        OPENAI_INCIDENTS.conversations,
        OPENAI_INCIDENTS.embeddings,
        OPENAI_INCIDENTS.unattributed,
      ],
      { Conversations: "partial_outage", Embeddings: "degraded_performance" },
    );

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${OPENAI_HOST}`,
      componentNames: ["Login", "Conversations"],
    });

    // incident.io is asked first: the Statuspage-shaped shim is never read.
    expect(hosts.requests).toEqual([
      `https://${OPENAI_HOST}/proxy/${OPENAI_HOST}`,
    ]);
    expect(response.provider).toBe(ExternalStatusPageProviderType.IncidentIo);
    expect(
      response.componentStatuses.map(
        (component: ExternalStatusPageComponentStatus): Array<string> => {
          return [component.groupName || "", component.name, component.status];
        },
      ),
    ).toEqual([
      ["ChatGPT", "Login", "operational"],
      ["ChatGPT", "Conversations", "partial_outage"],
    ]);
    expect(response.activeIncidentNames).toEqual([
      "Elevated errors in ChatGPT conversations",
    ]);
    expect(response.incidentsOutsideScopeCount).toBe(2);
    expect(response.overallStatus).toBe("partial_outage");
  });

  test("a group and its chosen components: one of another group is said, not watched", async () => {
    serveOpenAi([OPENAI_INCIDENTS.embeddings]);

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${OPENAI_HOST}`,
      provider: ExternalStatusPageProviderType.IncidentIo,
      componentGroupName: "ChatGPT",
      componentNames: ["Login", "Embeddings"],
    });

    expect(watched(response)).toEqual(["Login"]);
    expect(response.unmatchedComponentNames).toEqual(["Embeddings"]);
    expect(response.activeIncidentCount).toBe(0);
  });

  test("a pattern watches every component it matches", async () => {
    serveOpenAi([]);

    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${OPENAI_HOST}`,
      componentNames: ["Codex*"],
    });

    expect(watched(response)).toEqual(["Codex Web", "Codex API"]);
  });
});

describe("Cloudflare's page: one name in two groups", () => {
  test("an incident of one group's API does not count for the other's", async () => {
    hosts.atlassian.set(CLOUDFLARE_HOST, {
      page: CLOUDFLARE_PAGE,
      incidents: [
        {
          id: "i1",
          name: "Developer Platform API errors",
          componentIds: ["c8ksm3wq5t2n"],
        },
      ],
    });

    const sites: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${CLOUDFLARE_HOST}`,
      componentGroupName: "Cloudflare Sites and Services",
      componentNames: ["API"],
    });
    const platform: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${CLOUDFLARE_HOST}`,
      componentGroupName: "Developer Platform",
      componentNames: ["API"],
    });

    expect(sites.activeIncidentCount).toBe(0);
    expect(sites.incidentsOutsideScopeCount).toBe(1);
    expect(platform.activeIncidentCount).toBe(1);
  });
});

describe("a feed: the chosen names are looked for in its items' titles", () => {
  function rss(items: Array<[string, number]>): string {
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Status</title>${items
      .map(([title, offset]: [string, number]): string => {
        return `<item><title>${title}</title><pubDate>${new Date(
          Date.now() + offset,
        ).toUTCString()}</pubDate></item>`;
      })
      .join("")}</channel></rss>`;
  }

  function atom(items: Array<[string, number]>): string {
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Status</title>${items
      .map(([title, offset]: [string, number]): string => {
        return `<entry><title>${title}</title><updated>${new Date(
          Date.now() + offset,
        ).toISOString()}</updated></entry>`;
      })
      .join("")}</feed>`;
  }

  const ITEMS: Array<[string, number]> = [
    ["Incident with Git Operations", -HOUR],
    ["Incident with Copilot", -2 * HOUR],
    // Over a day old: not active.
    ["Incident with Pull Requests", -3 * 24 * HOUR],
  ];

  test.each([
    ["RSS", ExternalStatusPageProviderType.RSS, "/history.rss", rss],
    ["Atom", ExternalStatusPageProviderType.Atom, "/history.atom", atom],
  ])(
    "%s: an item counts when its title holds a chosen name",
    async (
      _name: string,
      provider: ExternalStatusPageProviderType,
      path: string,
      body: (items: Array<[string, number]>) => string,
    ) => {
      hosts.feedBody = body(ITEMS);

      const response: ExternalStatusPageMonitorResponse = await check({
        statusPageUrl: `https://${FEED_HOST}${path}`,
        provider: provider,
        componentNames: ["git operations", "Pull Requests"],
      });

      expect(response.provider).toBe(provider);
      expect(watched(response)).toEqual(["Incident with Git Operations"]);
      expect(response.activeIncidentCount).toBe(1);
      expect(response.incidentsOutsideScopeCount).toBe(1);
      expect(response.overallStatus).toBe("degraded_performance");
      // A feed's names are not components: none is said to be missing.
      expect(response.unmatchedComponentNames).toBeUndefined();

      const whole: ExternalStatusPageMonitorResponse = await check({
        statusPageUrl: `https://${FEED_HOST}${path}`,
        provider: provider,
      });

      expect(whole.activeIncidentCount).toBe(2);
      expect(whole.incidentsOutsideScopeCount).toBe(0);
    },
  );
});

describe("a page only the reachability check can read", () => {
  test("lists no components, so every chosen one is said to be missing", async () => {
    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${PLAIN_HOST}`,
      componentNames: ["Git Operations", "Pull Requests"],
    });

    expect(response.isOnline).toBe(true);
    expect(response.provider).toBeUndefined();
    expect(response.overallStatus).toBe("reachable");
    expect(response.unmatchedComponentNames).toEqual([
      "Git Operations",
      "Pull Requests",
    ]);
  });

  test("with nothing chosen, nothing is said to be missing", async () => {
    const response: ExternalStatusPageMonitorResponse = await check({
      statusPageUrl: `https://${PLAIN_HOST}`,
    });

    expect(response.unmatchedComponentNames).toBeUndefined();
  });
});

/*
 * The rule a monitor with one Component Name Filter was saved under, as the
 * probe ran it before it could watch several components: a component is in
 * scope when its group contains the group filter and its name contains the
 * name filter, ignoring case; with either filter set, an incident counts
 * when one of the components it names is in scope, by name; the overall
 * status is the page's own without filters, and otherwise the worst of the
 * components in scope, degraded when an incident in scope is open while
 * they all say operational.
 */
interface LegacyResult {
  components: Array<string>;
  activeIncidentCount: number;
  overallStatus: string;
}

function legacyScope(data: {
  page: FixturePage;
  incidents: Array<FixtureIncident>;
  pageOverallStatus: string | undefined;
  componentGroupName: string | undefined;
  componentName: string | undefined;
}): LegacyResult {
  const contains: (
    value: string | undefined,
    filter: string | undefined,
  ) => boolean = (
    value: string | undefined,
    filter: string | undefined,
  ): boolean => {
    if (!filter) {
      return true;
    }

    return (
      Boolean(value) && value!.toLowerCase().includes(filter.toLowerCase())
    );
  };

  const groupOf: (component: FixtureComponent) => string | undefined = (
    component: FixtureComponent,
  ): string | undefined => {
    return data.page.groups.find((group: { id: string }): boolean => {
      return group.id === component.groupId;
    })?.name;
  };

  const isScoped: boolean =
    Boolean(data.componentGroupName) || Boolean(data.componentName);
  const targeted: Array<FixtureComponent> = data.page.components.filter(
    (component: FixtureComponent): boolean => {
      return (
        contains(groupOf(component), data.componentGroupName) &&
        contains(component.name, data.componentName)
      );
    },
  );
  const targetedNames: Set<string> = new Set(
    targeted.map((component: FixtureComponent): string => {
      return component.name.toLowerCase();
    }),
  );
  const nameOf: (id: string) => string = (id: string): string => {
    return (
      data.page.components.find((component: FixtureComponent): boolean => {
        return component.id === id;
      })?.name || ""
    );
  };
  const activeIncidentCount: number = isScoped
    ? data.incidents.filter((incident: FixtureIncident): boolean => {
        return incident.componentIds.some((id: string): boolean => {
          return targetedNames.has(nameOf(id).toLowerCase());
        });
      }).length
    : data.incidents.length;

  const rank: (status: string) => number = (status: string): number => {
    return (
      (
        {
          operational: 0,
          under_maintenance: 1,
          maintenance: 1,
          degraded_performance: 2,
          degraded: 2,
          partial_outage: 3,
          major_outage: 4,
          full_outage: 4,
          critical: 4,
        } as Record<string, number>
      )[status.toLowerCase()] ?? 2
    );
  };

  let overallStatus: string;

  if (!isScoped && data.pageOverallStatus) {
    overallStatus = data.pageOverallStatus;
  } else {
    let worst: string = "operational";

    for (const component of targeted) {
      const status: string = component.status || "operational";

      if (rank(status) > rank(worst)) {
        worst = status;
      }
    }

    overallStatus =
      rank(worst) === 0 && activeIncidentCount > 0
        ? "degraded_performance"
        : worst;
  }

  return {
    components: targeted.map((component: FixtureComponent): string => {
      return component.name;
    }),
    activeIncidentCount: activeIncidentCount,
    overallStatus: overallStatus,
  };
}

describe("a monitor saved with one Component Name Filter watches what it watched before", () => {
  const FILTERS: Array<string | undefined> = [
    undefined,
    "Git",
    "git operations",
    "Requests",
    "Copilot",
    "pages",
    "API",
    "s",
    "Visit",
    "Chat",
    "Codex",
    "nothing like it",
  ];
  const GROUPS: Array<string | undefined> = [undefined, "APIs", "chat", "Sora"];

  const github: { page: FixturePage; incidents: Array<FixtureIncident> } = {
    page: withStatuses(GITHUB_PAGE, {
      Copilot: "major_outage",
      "Pull Requests": "degraded_performance",
      Pages: "under_maintenance",
    }),
    incidents: [
      GITHUB_INCIDENTS.copilot,
      GITHUB_INCIDENTS.modelProviders,
      GITHUB_INCIDENTS.gitAndPullRequests,
      GITHUB_INCIDENTS.actionsIssuesAndApi,
      GITHUB_INCIDENTS.unattributed,
    ],
  };
  const openAi: { page: FixturePage; incidents: Array<FixtureIncident> } = {
    page: withStatuses(OPENAI_PAGE, {
      Conversations: "partial_outage",
      Embeddings: "degraded_performance",
    }),
    incidents: [
      OPENAI_INCIDENTS.conversations,
      OPENAI_INCIDENTS.embeddings,
      OPENAI_INCIDENTS.unattributed,
    ],
  };

  test.each(FILTERS)(
    "GitHub's Statuspage, filter %p",
    async (filter: string | undefined) => {
      hosts.atlassian.set(GITHUB_HOST, {
        page: github.page,
        incidents: github.incidents,
        status: { indicator: "major", description: "Major System Outage" },
      });

      for (const group of [undefined, "Core"]) {
        const response: ExternalStatusPageMonitorResponse = await check({
          statusPageUrl: `https://${GITHUB_HOST}`,
          provider: ExternalStatusPageProviderType.AtlassianStatuspage,
          componentGroupName: group,
          componentName: filter,
        });

        expect({
          filter,
          group,
          components: watched(response),
          activeIncidentCount: response.activeIncidentCount,
          overallStatus: response.overallStatus,
        }).toEqual({
          filter,
          group,
          ...legacyScope({
            page: github.page,
            incidents: github.incidents,
            pageOverallStatus: "Major System Outage",
            componentGroupName: group,
            componentName: filter,
          }),
        });
        // It keeps its filter, and says it.
        expect(response.componentName).toBe(filter);
      }
    },
  );

  test.each(GROUPS)(
    "OpenAI's incident.io page, group %p, every filter",
    async (group: string | undefined) => {
      hosts.incidentIo.set(OPENAI_HOST, openAi);

      for (const filter of FILTERS) {
        const response: ExternalStatusPageMonitorResponse = await check({
          statusPageUrl: `https://${OPENAI_HOST}`,
          provider: ExternalStatusPageProviderType.IncidentIo,
          componentGroupName: group,
          componentName: filter,
        });

        expect({
          filter,
          group,
          components: watched(response),
          activeIncidentCount: response.activeIncidentCount,
          overallStatus: response.overallStatus,
        }).toEqual({
          filter,
          group,
          ...legacyScope({
            page: openAi.page,
            incidents: openAi.incidents,
            pageOverallStatus: undefined,
            componentGroupName: group,
            componentName: filter,
          }),
        });
      }
    },
  );

  test("a stored step, read as the server hands it to the probe, scopes the same", async () => {
    hosts.atlassian.set(GITHUB_HOST, {
      page: github.page,
      incidents: github.incidents,
    });

    const stored: JSONObject = {
      statusPageUrl: `https://${GITHUB_HOST}`,
      provider: ExternalStatusPageProviderType.AtlassianStatuspage,
      componentName: "Copilot",
      timeout: 5000,
      retries: 0,
    };

    const response: ExternalStatusPageMonitorResponse | null =
      await ExternalStatusPageMonitorUtil.fetch(
        stored as unknown as MonitorStepExternalStatusPageMonitor,
        { isOnlineCheckRequest: true },
      );

    expect(watched(response!)).toEqual([
      "Copilot",
      "Copilot AI Model Providers",
    ]);
    expect(response!.activeIncidentCount).toBe(2);
    expect(response!.componentNames).toEqual(["*Copilot*"]);
  });
});

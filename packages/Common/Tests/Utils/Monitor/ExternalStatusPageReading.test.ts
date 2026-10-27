import { JSONObject } from "../../../Types/JSON";
import StatusPageSummaryUtil, {
  StatusPageSummary,
} from "../../../Types/StatusPage/StatusPageSummary";
import ExternalStatusPageReading, {
  EXTERNAL_STATUS_PAGE_MAX_COMPONENTS,
  EXTERNAL_STATUS_PAGE_MAX_INCIDENTS,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
  EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
  ExternalStatusPageComponent,
  ExternalStatusPageContents,
  ExternalStatusPageIncident,
} from "../../../Utils/Monitor/ExternalStatusPageReading";
import {
  CLOUDFLARE_PAGE,
  GITHUB_INCIDENTS,
  GITHUB_PAGE,
  OPENAI_INCIDENTS,
  OPENAI_PAGE,
  atlassianComponentsJSON,
  atlassianStatusJSON,
  atlassianUnresolvedJSON,
  componentId,
  incidentIoProxyJSON,
  withStatuses,
} from "../../Helpers/ExternalStatusPageFixtures";
import {
  FAKE_STATUSES,
  FakeStatusPage,
  fakeSummaryJSON,
} from "../../Helpers/FakeStatusPageOverview";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A STATUS PAGE SAYS, AS THE PROBE AND THE COMPONENT PICKER READ IT.
 *
 * One reading for both (ExternalStatusPageReading), so the component a
 * person picks in Create Monitor is, by name and group, the component the
 * probe watches. Each provider is read from answers in the shapes it
 * serves (ExternalStatusPageFixtures: GitHub's and Cloudflare's Atlassian
 * Statuspages, OpenAI's incident.io page; FakeStatusPageOverview: a
 * OneUptime status page), incidents with and without the components they
 * affect among them.
 */

function names(components: Array<ExternalStatusPageComponent>): Array<string> {
  return components.map((component: ExternalStatusPageComponent): string => {
    return component.name;
  });
}

describe("the addresses a page is read at", () => {
  test("Atlassian Statuspage's API, under the page's own address, a slash at its end or not", () => {
    for (const url of [
      "https://www.githubstatus.com",
      "https://www.githubstatus.com/",
      "https://www.githubstatus.com///",
    ]) {
      expect(ExternalStatusPageReading.getAtlassianUrls(url)).toEqual({
        status: "https://www.githubstatus.com/api/v2/status.json",
        components: "https://www.githubstatus.com/api/v2/components.json",
        unresolvedIncidents:
          "https://www.githubstatus.com/api/v2/incidents/unresolved.json",
      });
    }
  });

  test("incident.io's proxy, on the page's origin and keyed by its host", () => {
    expect(
      ExternalStatusPageReading.getIncidentIoUrl("https://status.openai.com"),
    ).toBe("https://status.openai.com/proxy/status.openai.com");
    expect(
      ExternalStatusPageReading.getIncidentIoUrl(
        "https://status.openai.com:8443/incidents?x=1",
      ),
    ).toBe("https://status.openai.com:8443/proxy/status.openai.com");
    // An address given without a scheme is read as https.
    expect(
      ExternalStatusPageReading.getIncidentIoUrl("status.openai.com"),
    ).toBe("https://status.openai.com/proxy/status.openai.com");
    expect(ExternalStatusPageReading.getIncidentIoUrl("http://")).toBeNull();
  });
});

describe("an Atlassian Statuspage", () => {
  test("is one when its status has an indicator, and says its own status in its words", () => {
    expect(
      ExternalStatusPageReading.readAtlassianPageStatus(
        atlassianStatusJSON(GITHUB_PAGE),
      ),
    ).toBe("All Systems Operational");
    expect(
      ExternalStatusPageReading.readAtlassianPageStatus({
        status: { indicator: "minor" },
      }),
    ).toBe("minor");

    for (const answer of [
      { status: {} },
      { status: { description: "All Systems Operational" } },
      { page: {} },
      "<html></html>",
      null,
      [],
    ]) {
      expect(
        ExternalStatusPageReading.readAtlassianPageStatus(answer),
      ).toBeNull();
    }
  });

  test("lists GitHub's twelve components as its page does, each by its id", () => {
    const components: Array<ExternalStatusPageComponent> | null =
      ExternalStatusPageReading.readAtlassianComponents(
        atlassianComponentsJSON(GITHUB_PAGE),
      );

    expect(names(components!)).toEqual([
      "Git Operations",
      "Webhooks",
      "Visit www.githubstatus.com for more information",
      "API Requests",
      "Issues",
      "Pull Requests",
      "Actions",
      "Packages",
      "Pages",
      "Copilot",
      "Codespaces",
      "Copilot AI Model Providers",
    ]);
    expect(components![0]).toEqual({
      name: "Git Operations",
      status: "operational",
      description: undefined,
      groupName: undefined,
      key: "8l4ygp009s5s",
    });
  });

  test("names each component's group, and leaves the group headers out", () => {
    const components: Array<ExternalStatusPageComponent> =
      ExternalStatusPageReading.readAtlassianComponents(
        atlassianComponentsJSON(CLOUDFLARE_PAGE),
      )!;

    expect(
      components.map((component: ExternalStatusPageComponent): string => {
        return `${component.groupName} / ${component.name}`;
      }),
    ).toEqual([
      "Cloudflare Sites and Services / API",
      "Cloudflare Sites and Services / Dashboard",
      "Cloudflare Sites and Services / Workers",
      "Cloudflare Sites and Services / Workers KV",
      "Cloudflare Sites and Services / Workers AI",
      "Europe / Amsterdam, Netherlands - (AMS)",
      "Europe / Frankfurt, Germany - (FRA)",
      "Developer Platform / API",
    ]);
    // One name in two groups: two components, told apart by their ids.
    expect(
      components
        .filter((component: ExternalStatusPageComponent): boolean => {
          return component.name === "API";
        })
        .map((component: ExternalStatusPageComponent): string | undefined => {
          return component.key;
        }),
    ).toEqual(["yh6f0r4529hb", "c8ksm3wq5t2n"]);
  });

  test("says each component's status as the page has it now", () => {
    const components: Array<ExternalStatusPageComponent> =
      ExternalStatusPageReading.readAtlassianComponents(
        atlassianComponentsJSON(
          withStatuses(GITHUB_PAGE, {
            Copilot: "major_outage",
            "Pull Requests": "degraded_performance",
          }),
        ),
      )!;

    expect(
      components
        .filter((component: ExternalStatusPageComponent): boolean => {
          return component.status !== "operational";
        })
        .map((component: ExternalStatusPageComponent): [string, string] => {
          return [component.name, component.status];
        }),
    ).toEqual([
      ["Pull Requests", "degraded_performance"],
      ["Copilot", "major_outage"],
    ]);
  });

  test("an answer that is not a list of components is none", () => {
    for (const answer of [{}, { components: "x" }, "<html></html>", null]) {
      expect(
        ExternalStatusPageReading.readAtlassianComponents(answer),
      ).toBeNull();
    }

    // What is not a component, in a list of them, is skipped.
    expect(
      ExternalStatusPageReading.readAtlassianComponents({
        components: [
          null,
          "Git Operations",
          { name: "No status" },
          { status: "operational" },
          { name: "   ", status: "operational" },
          { id: "x", name: "Webhooks", status: "operational" },
        ],
      }),
    ).toEqual([
      {
        name: "Webhooks",
        status: "operational",
        description: undefined,
        groupName: undefined,
        key: "x",
      },
    ]);
  });

  test("reads each active incident with the components it names, by id and by name", () => {
    const incidents: Array<ExternalStatusPageIncident> =
      ExternalStatusPageReading.readAtlassianIncidents(
        atlassianUnresolvedJSON(GITHUB_PAGE, [
          GITHUB_INCIDENTS.copilot,
          GITHUB_INCIDENTS.gitAndPullRequests,
          GITHUB_INCIDENTS.unattributed,
        ]),
      );

    expect(incidents).toEqual([
      {
        name: "Incident with Copilot",
        affectedComponentNames: ["Copilot"],
        affectedComponentKeys: [componentId(GITHUB_PAGE, "Copilot")],
      },
      {
        name: "Incident with Git Operations and Pull Requests",
        affectedComponentNames: ["Git Operations", "Pull Requests"],
        affectedComponentKeys: [
          componentId(GITHUB_PAGE, "Git Operations"),
          componentId(GITHUB_PAGE, "Pull Requests"),
        ],
      },
      // An incident posted before the page said what it affects.
      {
        name: "Disruption with some GitHub services",
        affectedComponentNames: [],
        affectedComponentKeys: undefined,
      },
    ]);
  });

  test("an incident without a name, or an answer without incidents, reads as it should", () => {
    expect(
      ExternalStatusPageReading.readAtlassianIncidents({
        incidents: [{ components: [{ name: "Webhooks" }] }, 7],
      }),
    ).toEqual([
      {
        name: EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
        affectedComponentNames: ["Webhooks"],
        affectedComponentKeys: undefined,
      },
    ]);

    for (const answer of [{}, { incidents: {} }, null, "x"]) {
      expect(ExternalStatusPageReading.readAtlassianIncidents(answer)).toEqual(
        [],
      );
    }
  });
});

describe("an incident.io page", () => {
  test("lists OpenAI's components with their groups, those outside a group too", () => {
    const contents: ExternalStatusPageContents | null =
      ExternalStatusPageReading.readIncidentIo(
        incidentIoProxyJSON(OPENAI_PAGE, []),
      );

    expect(
      contents!.components.map(
        (component: ExternalStatusPageComponent): string => {
          return `${component.groupName || "-"} / ${component.name}`;
        },
      ),
    ).toEqual([
      "APIs / Chat Completions",
      "APIs / Responses",
      "APIs / Embeddings",
      "APIs / Fine-tuning",
      "ChatGPT / Login",
      "ChatGPT / Conversations",
      "ChatGPT / File uploads",
      "Codex / Codex Web",
      "Codex / Codex API",
      "- / Sora",
    ]);
    expect(contents!.components[0]!.key).toBe(
      componentId(OPENAI_PAGE, "Chat Completions"),
    );
    expect(contents!.incidents).toEqual([]);
  });

  test("gives the components affected now their status, the rest operational", () => {
    const contents: ExternalStatusPageContents =
      ExternalStatusPageReading.readIncidentIo(
        incidentIoProxyJSON(
          withStatuses(OPENAI_PAGE, {
            Conversations: "partial_outage",
            Embeddings: "degraded_performance",
          }),
          [],
        ),
      )!;

    expect(
      contents.components
        .filter((component: ExternalStatusPageComponent): boolean => {
          return component.status !== "operational";
        })
        .map((component: ExternalStatusPageComponent): [string, string] => {
          return [component.name, component.status];
        }),
    ).toEqual([
      ["Embeddings", "degraded_performance"],
      ["Conversations", "partial_outage"],
    ]);
  });

  test("reads each ongoing incident with the components it affects, by id and by name", () => {
    const contents: ExternalStatusPageContents =
      ExternalStatusPageReading.readIncidentIo(
        incidentIoProxyJSON(OPENAI_PAGE, [
          OPENAI_INCIDENTS.conversations,
          OPENAI_INCIDENTS.unattributed,
        ]),
      )!;

    expect(contents.incidents).toEqual([
      {
        name: "Elevated errors in ChatGPT conversations",
        affectedComponentNames: ["Conversations"],
        affectedComponentKeys: [componentId(OPENAI_PAGE, "Conversations")],
      },
      {
        name: "We are investigating reports of issues",
        affectedComponentNames: [],
        affectedComponentKeys: undefined,
      },
    ]);
  });

  test("a flattened answer, with nothing under summary, is read the same", () => {
    const nested: JSONObject = incidentIoProxyJSON(OPENAI_PAGE, [
      OPENAI_INCIDENTS.embeddings,
    ]);
    const summary: JSONObject = nested["summary"] as JSONObject;
    const flattened: JSONObject = {
      summary: { components: summary["components"] },
      structure: summary["structure"],
      affected_components: summary["affected_components"],
      ongoing_incidents: summary["ongoing_incidents"],
    };

    expect(ExternalStatusPageReading.readIncidentIo(flattened)).toEqual(
      ExternalStatusPageReading.readIncidentIo(nested),
    );
  });

  test("an answer that does not look like incident.io's is none", () => {
    for (const answer of [
      {},
      { summary: {} },
      { page: { name: "x" }, status: { indicator: "none" } },
      null,
      [],
      "<html></html>",
    ]) {
      expect(ExternalStatusPageReading.readIncidentIo(answer)).toBeNull();
    }
  });

  test("an affected component the page does not list is kept by its id", () => {
    const contents: ExternalStatusPageContents =
      ExternalStatusPageReading.readIncidentIo({
        summary: {
          components: [{ id: "c1", name: "API" }],
          affected_components: [{ component_id: "c9", status: "major_outage" }],
          ongoing_incidents: [
            { name: "Outage", affected_components: [{ component_id: "c9" }] },
          ],
        },
      })!;

    expect(contents.components).toEqual([
      {
        name: "API",
        status: "operational",
        groupName: undefined,
        key: "c1",
      },
      { name: "c9", status: "major_outage", groupName: undefined, key: "c9" },
    ]);
    expect(contents.incidents[0]!.affectedComponentKeys).toEqual(["c9"]);
  });
});

describe("a OneUptime status page", () => {
  const page: FakeStatusPage = {
    groups: [{ id: "5e300000-0000-4000-8000-000000000c01", name: "Core" }],
    resources: [
      {
        id: "5e300000-0000-4000-8000-000000000d01",
        name: "Checkout API",
        groupId: "5e300000-0000-4000-8000-000000000c01",
        monitorId: "5e300000-0000-4000-8000-000000000a01",
        statusId: FAKE_STATUSES.operational.id,
      },
      {
        id: "5e300000-0000-4000-8000-000000000d02",
        name: "Storefront",
        monitorId: "5e300000-0000-4000-8000-000000000a02",
        statusId: FAKE_STATUSES.degraded.id,
      },
    ],
  };

  function summaryOf(fake: FakeStatusPage): StatusPageSummary {
    return StatusPageSummaryUtil.fromJSON(fakeSummaryJSON(fake))!;
  }

  test("reads each resource as a component, keyed by its id, in the value its status stands for", () => {
    const contents: ExternalStatusPageContents =
      ExternalStatusPageReading.readOneUptimeSummary(summaryOf(page));

    expect(contents.components).toEqual([
      {
        key: "5e300000-0000-4000-8000-000000000d01",
        name: "Checkout API",
        groupName: "Core",
        status: "operational",
        description: "Operational",
      },
      {
        key: "5e300000-0000-4000-8000-000000000d02",
        name: "Storefront",
        groupName: undefined,
        status: "degraded_performance",
        description: "Degraded",
      },
    ]);
  });

  test("a resource whose status the page hides says so", () => {
    const summary: StatusPageSummary = summaryOf(page);
    summary.resources[0]!.currentStatus = null;

    expect(
      ExternalStatusPageReading.readOneUptimeSummary(summary).components[0],
    ).toEqual(
      expect.objectContaining({
        status: "unknown",
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
      }),
    );
  });

  test("an incident affects the resources it names, by their ids", () => {
    const summary: StatusPageSummary = summaryOf(page);
    summary.activeIncidents = [
      {
        id: "i1",
        title: "Checkout errors",
        declaredAt: null,
        state: null,
        severity: null,
        affectedResourceIds: ["5e300000-0000-4000-8000-000000000d01"],
      },
      {
        id: "i2",
        title: "",
        declaredAt: null,
        state: null,
        severity: null,
        affectedResourceIds: [],
      },
    ];

    expect(
      ExternalStatusPageReading.readOneUptimeSummary(summary).incidents,
    ).toEqual([
      {
        name: "Checkout errors",
        affectedComponentNames: ["Checkout API"],
        affectedComponentKeys: ["5e300000-0000-4000-8000-000000000d01"],
      },
      {
        name: EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
        affectedComponentNames: [],
        affectedComponentKeys: [],
      },
    ]);
  });
});

describe("what a page may list", () => {
  test("at most so many components, and so many incidents", () => {
    const components: Array<JSONObject> = [];
    const incidents: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index < EXTERNAL_STATUS_PAGE_MAX_COMPONENTS + 50;
      index++
    ) {
      components.push({
        id: `c${index}`,
        name: `Component ${index}`,
        status: "operational",
      });
    }

    for (
      let index: number = 0;
      index < EXTERNAL_STATUS_PAGE_MAX_INCIDENTS + 50;
      index++
    ) {
      incidents.push({ name: `Incident ${index}`, components: [] });
    }

    expect(
      ExternalStatusPageReading.readAtlassianComponents({ components })!,
    ).toHaveLength(EXTERNAL_STATUS_PAGE_MAX_COMPONENTS);
    expect(
      ExternalStatusPageReading.readAtlassianIncidents({ incidents }),
    ).toHaveLength(EXTERNAL_STATUS_PAGE_MAX_INCIDENTS);
    expect(
      ExternalStatusPageReading.readIncidentIo({
        summary: { components, ongoing_incidents: incidents },
      })!.components,
    ).toHaveLength(EXTERNAL_STATUS_PAGE_MAX_COMPONENTS);
  });
});

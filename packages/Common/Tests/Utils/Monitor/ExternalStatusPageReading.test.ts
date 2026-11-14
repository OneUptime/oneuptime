import { JSONObject } from "../../../Types/JSON";
import StatusPageSummaryUtil, {
  StatusPageSummary,
} from "../../../Types/StatusPage/StatusPageSummary";
import ExternalStatusPageReading, {
  EXTERNAL_STATUS_PAGE_MAX_COMPONENTS,
  EXTERNAL_STATUS_PAGE_MAX_INCIDENTS,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE,
  EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
  EXTERNAL_STATUS_PAGE_UNNAMED_INCIDENT,
  ExternalStatusPageComponent,
  ExternalStatusPageContents,
  ExternalStatusPageIncident,
  ExternalStatusPageOneUptimeNote,
} from "../../../Utils/Monitor/ExternalStatusPageReading";
import { fillTemplate } from "../../../Types/Translator";
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

  test("a resource whose monitoring is off reads as unknown, and says the page shows it as not monitored", () => {
    const contents: ExternalStatusPageContents =
      ExternalStatusPageReading.readOneUptimeSummary(
        summaryOf({
          ...page,
          resources: [
            page.resources[0]!,
            {
              ...page.resources[1]!,
              statusId: FAKE_STATUSES.offline.id,
              isMonitoringOff: true,
            },
          ],
        }),
      );

    expect(contents.components).toEqual([
      {
        key: "5e300000-0000-4000-8000-000000000d01",
        name: "Checkout API",
        groupName: "Core",
        status: "operational",
        description: "Operational",
      },
      {
        // Never the Offline it was left at: nothing checks it.
        key: "5e300000-0000-4000-8000-000000000d02",
        name: "Storefront",
        groupName: undefined,
        status: "unknown",
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
        isMonitored: false,
      },
    ]);

    // Only a component nothing checks is marked: the rest carry no flag.
    expect("isMonitored" in contents.components[0]!).toBe(false);
  });

  test("not monitored is said even when the page sends a status with it", () => {
    const summary: StatusPageSummary = summaryOf(page);
    summary.resources[1]!.isMonitored = false;

    // The Degraded it still carries is not read.
    expect(
      ExternalStatusPageReading.readOneUptimeSummary(summary).components[1],
    ).toEqual(
      expect.objectContaining({
        status: "unknown",
        description: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
      }),
    );
  });

  test("maintenance in progress on a resource whose monitoring is off reads as under maintenance", () => {
    const summary: StatusPageSummary = summaryOf({
      ...page,
      resources: [{ ...page.resources[0]!, isMonitoringOff: true }],
      maintenance: [
        {
          id: "5e300000-0000-4000-8000-000000000e01",
          title: "Checkout upgrade",
          state: "ongoing",
          startsAt: new Date(Date.now() - 60 * 60 * 1000),
          monitorIds: ["5e300000-0000-4000-8000-000000000a01"],
        },
      ],
    });

    expect(summary.resources[0]!.isMonitored).toBe(false);
    expect(
      ExternalStatusPageReading.readOneUptimeSummary(summary).components[0],
    ).toEqual(
      expect.objectContaining({
        status: "under_maintenance",
        description: "Under maintenance: Checkout upgrade",
      }),
    );
  });

  test("a resource whose status is hidden, and that is monitored, still says its status is not shown", () => {
    const summary: StatusPageSummary = summaryOf({
      ...page,
      resources: [{ ...page.resources[0]!, showCurrentStatus: false }],
    });

    expect(summary.resources[0]!.isMonitored).toBe(true);
    expect(
      ExternalStatusPageReading.readOneUptimeSummary(summary).components[0]
        ?.description,
    ).toBe(EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN);
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

/*
 * ONEUPTIME'S OWN NOTES, READ BACK (#6990).
 *
 * A OneUptime page's resource with no status of its own is described by a
 * note the probe writes in OneUptime's words. The monitor's summary draws
 * that note in the reader's language: readOneUptimeNote reads it back from
 * the description as its English (a translation key) and the page's words
 * in it. Anything else - the page's status name, another page's words - is
 * no note.
 */
describe("OneUptime's own notes on a component, read back", () => {
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
      {
        id: "5e300000-0000-4000-8000-000000000d03",
        name: "Search",
        monitorId: "5e300000-0000-4000-8000-000000000a03",
        statusId: FAKE_STATUSES.offline.id,
        isMonitoringOff: true,
      },
      {
        id: "5e300000-0000-4000-8000-000000000d04",
        name: "Orders database",
        monitorId: "5e300000-0000-4000-8000-000000000a04",
        statusId: FAKE_STATUSES.operational.id,
      },
    ],
    maintenance: [
      {
        id: "5e300000-0000-4000-8000-000000000e01",
        title: "Database upgrade",
        state: "ongoing",
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        monitorIds: ["5e300000-0000-4000-8000-000000000a04"],
      },
      {
        id: "5e300000-0000-4000-8000-000000000e02",
        title: "Replica resync",
        state: "ongoing",
        startsAt: new Date(Date.now() - 30 * 60 * 1000),
        monitorIds: ["5e300000-0000-4000-8000-000000000a04"],
      },
    ],
  };

  function descriptions(): Array<string | undefined> {
    const summary: StatusPageSummary = StatusPageSummaryUtil.fromJSON(
      fakeSummaryJSON(page),
    )!;
    // The page hides the Storefront's status.
    summary.resources[1]!.currentStatus = null;

    return ExternalStatusPageReading.readOneUptimeSummary(
      summary,
    ).components.map((component: ExternalStatusPageComponent) => {
      return component.description;
    });
  }

  test("the notes are translation keys, worded as the probe writes them", () => {
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN).toBe(
      "The status page does not show this resource's status.",
    );
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED).toBe(
      "The status page shows this resource as not monitored.",
    );
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF).toBe(
      "Under maintenance: {{events}}",
    );
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE).toBe(
      "Under maintenance",
    );
  });

  test("the probe writes each note as before: the English, the events' titles joined", () => {
    expect(descriptions()).toEqual([
      "Operational",
      EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
      EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
      "Under maintenance: Database upgrade, Replica resync",
    ]);
  });

  test("every note the probe writes reads back as its key, the page's words as written", () => {
    expect(
      descriptions().map((description: string | undefined) => {
        return ExternalStatusPageReading.readOneUptimeNote(description);
      }),
    ).toEqual([
      // The page's own status name: no note.
      null,
      {
        template: EXTERNAL_STATUS_PAGE_ONEUPTIME_STATUS_NOT_SHOWN,
        values: {},
      },
      {
        template: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
        values: {},
      },
      {
        template: EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
        values: { events: "Database upgrade, Replica resync" },
      },
    ]);
  });

  test("a note read back and filled again is the description the probe wrote", () => {
    for (const description of descriptions()) {
      const note: ExternalStatusPageOneUptimeNote | null =
        ExternalStatusPageReading.readOneUptimeNote(description);

      if (!note) {
        continue;
      }

      expect(fillTemplate(note.template, note.values)).toBe(description);
    }
  });

  test("a note with space around it is still the note", () => {
    expect(
      ExternalStatusPageReading.readOneUptimeNote(
        `  ${EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED}\n`,
      ),
    ).toEqual({
      template: EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
      values: {},
    });
  });

  test("anything else is no note", () => {
    for (const description of [
      undefined,
      "",
      "Operational",
      "Degraded",
      // The note alone only repeats the status, which the summary says once.
      EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE,
      // No event named after it.
      "Under maintenance: ",
      "Under maintenance:   ",
      // Not the note: other casing, or more words around it.
      "under maintenance: Database upgrade",
      "The status page shows this resource as not monitored",
      "The status page shows this resource as not monitored. Ask its owner.",
      "Note: The status page does not show this resource's status.",
    ]) {
      expect({
        description,
        note: ExternalStatusPageReading.readOneUptimeNote(description),
      }).toEqual({ description, note: null });
    }
  });

  test("an event's title keeps whatever it holds, a colon or the note's own words", () => {
    expect(
      ExternalStatusPageReading.readOneUptimeNote(
        "Under maintenance: Phase 2: Under maintenance: replicas",
      ),
    ).toEqual({
      template: EXTERNAL_STATUS_PAGE_ONEUPTIME_UNDER_MAINTENANCE_OF,
      values: { events: "Phase 2: Under maintenance: replicas" },
    });
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

/*
 * Why a OneUptime page turned the probe away (#7222): the probe stores the
 * English, which monitor criteria and logs compare, and the summary reads
 * it back - exactly those words, nothing like them - to draw it in the
 * reader's language.
 */
describe("OneUptime's failure causes, read back", () => {
  test("the probe's words, as it always wrote them", () => {
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE).toBe(
      "This status page is private: only people who sign in to it, or who know its password, can read it. Only a public status page can be watched.",
    );
    expect(EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE).toBe(
      "This status page lets in only the IP addresses on its allowlist, and this probe's address is not one of them. Add the probe's address to the allowlist, or watch the page from a probe inside that network.",
    );
  });

  test("each reads back as itself", () => {
    for (const cause of [
      EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE,
      EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE,
    ]) {
      expect(ExternalStatusPageReading.readOneUptimeFailureCause(cause)).toBe(
        cause,
      );
    }
  });

  test("with space round it, it still reads back, trimmed", () => {
    expect(
      ExternalStatusPageReading.readOneUptimeFailureCause(
        ` ${EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE}\n`,
      ),
    ).toBe(EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE);
  });

  test("words close to them, but not the same, are not OneUptime's", () => {
    for (const cause of [
      EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE.slice(0, -1),
      `${EXTERNAL_STATUS_PAGE_ONEUPTIME_PRIVATE_MESSAGE} (HTTP 401)`,
      EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE.toUpperCase(),
      `Error: ${EXTERNAL_STATUS_PAGE_ONEUPTIME_IP_NOT_ALLOWED_MESSAGE}`,
      EXTERNAL_STATUS_PAGE_ONEUPTIME_NOT_MONITORED,
    ]) {
      expect(
        ExternalStatusPageReading.readOneUptimeFailureCause(cause),
      ).toBeNull();
    }
  });

  test("any other cause, or none, is not OneUptime's", () => {
    for (const cause of [
      "HTTP status 503",
      "Request timed out",
      "",
      "   ",
      undefined,
    ]) {
      expect(
        ExternalStatusPageReading.readOneUptimeFailureCause(cause),
      ).toBeNull();
    }
  });
});

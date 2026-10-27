import ExternalStatusPageReading, {
  ExternalStatusPageComponent,
  ExternalStatusPageContents,
  ExternalStatusPageIncident,
} from "../../../Utils/Monitor/ExternalStatusPageReading";
import ExternalStatusPageScope, {
  EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAME_LENGTH,
  EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAMES,
  ExternalStatusPageScopeResult,
} from "../../../Utils/Monitor/ExternalStatusPageScope";
import { ExternalStatusPageComponentStatus } from "../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import {
  CLOUDFLARE_PAGE,
  FixtureIncident,
  FixturePage,
  GITHUB_CHOSEN_COMPONENTS,
  GITHUB_INCIDENTS,
  GITHUB_PAGE,
  OPENAI_INCIDENTS,
  OPENAI_PAGE,
  atlassianComponentsJSON,
  atlassianUnresolvedJSON,
  incidentIoProxyJSON,
  withStatuses,
} from "../../Helpers/ExternalStatusPageFixtures";
import { fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ON A STATUS PAGE A MONITOR WATCHES (ExternalStatusPageScope).
 *
 * Issue #5156: a monitor of GitHub's status page that depends on Git
 * Operations and Pull Requests (and maybe Actions and Webhooks) must not go
 * offline for an incident of Copilot. With components chosen, Component
 * Status sees only them, Active Incidents counts only the incidents that
 * affect at least one of them - an incident that names no component is not
 * one of them - and the overall status is theirs. The whole page, with
 * nothing chosen, is as it always was: every incident counts and the
 * page's own status is the overall status. What the scope leaves out is
 * said: the chosen names no component has, and the incidents elsewhere.
 */

function atlassian(
  page: FixturePage,
  incidents: Array<FixtureIncident>,
): ExternalStatusPageContents {
  return {
    components: ExternalStatusPageReading.readAtlassianComponents(
      atlassianComponentsJSON(page),
    )!,
    incidents: ExternalStatusPageReading.readAtlassianIncidents(
      atlassianUnresolvedJSON(page, incidents),
    ),
  };
}

function incidentIo(
  page: FixturePage,
  incidents: Array<FixtureIncident>,
): ExternalStatusPageContents {
  return ExternalStatusPageReading.readIncidentIo(
    incidentIoProxyJSON(page, incidents),
  )!;
}

function scope(
  contents: ExternalStatusPageContents,
  data: {
    componentNames?: Array<string>;
    componentGroupName?: string;
    pageOverallStatus?: string;
  } = {},
): ExternalStatusPageScopeResult {
  return ExternalStatusPageScope.apply({
    components: contents.components,
    incidents: contents.incidents,
    componentNames: data.componentNames || [],
    componentGroupName: data.componentGroupName,
    pageOverallStatus: data.pageOverallStatus,
  });
}

function watched(result: ExternalStatusPageScopeResult): Array<string> {
  return result.componentStatuses.map(
    (component: ExternalStatusPageComponentStatus): string => {
      return component.name;
    },
  );
}

const GITHUB_WITH_INCIDENTS: ExternalStatusPageContents = atlassian(
  withStatuses(GITHUB_PAGE, { Copilot: "major_outage" }),
  [
    GITHUB_INCIDENTS.copilot,
    GITHUB_INCIDENTS.modelProviders,
    GITHUB_INCIDENTS.unattributed,
  ],
);

describe("GitHub's page, watched for the four components the customer depends on", () => {
  test("an incident of Copilot leaves the monitor online: it counts none, and says one is elsewhere", () => {
    const result: ExternalStatusPageScopeResult = scope(GITHUB_WITH_INCIDENTS, {
      componentNames: GITHUB_CHOSEN_COMPONENTS,
      pageOverallStatus: "Partial System Outage",
    });

    expect(watched(result)).toEqual([
      "Git Operations",
      "Webhooks",
      "Pull Requests",
      "Actions",
    ]);
    expect(result.activeIncidentCount).toBe(0);
    expect(result.activeIncidentNames).toEqual([]);
    // Copilot's, the model providers', and the one that names nothing.
    expect(result.incidentsOutsideScopeCount).toBe(3);
    // Theirs, not the page's.
    expect(result.overallStatus).toBe("operational");
    expect(result.unmatchedComponentNames).toEqual([]);
  });

  test("an incident of Git Operations and Pull Requests counts once, by its name", () => {
    const result: ExternalStatusPageScopeResult = scope(
      atlassian(
        withStatuses(GITHUB_PAGE, { "Git Operations": "partial_outage" }),
        [GITHUB_INCIDENTS.gitAndPullRequests, GITHUB_INCIDENTS.copilot],
      ),
      { componentNames: GITHUB_CHOSEN_COMPONENTS },
    );

    expect(result.activeIncidentCount).toBe(1);
    expect(result.activeIncidentNames).toEqual([
      "Incident with Git Operations and Pull Requests",
    ]);
    expect(result.incidentsOutsideScopeCount).toBe(1);
    expect(result.overallStatus).toBe("partial_outage");
  });

  test("an incident counts when it affects at least one chosen component, among others", () => {
    const result: ExternalStatusPageScopeResult = scope(
      atlassian(GITHUB_PAGE, [GITHUB_INCIDENTS.actionsIssuesAndApi]),
      { componentNames: ["Actions"] },
    );

    expect(result.activeIncidentCount).toBe(1);
    // Every component it names is open, while all say operational: degraded.
    expect(result.overallStatus).toBe("degraded_performance");
  });

  test("an incident that names no component is not counted for chosen components", () => {
    const result: ExternalStatusPageScopeResult = scope(
      atlassian(GITHUB_PAGE, [GITHUB_INCIDENTS.unattributed]),
      { componentNames: GITHUB_CHOSEN_COMPONENTS },
    );

    expect(result.activeIncidentCount).toBe(0);
    expect(result.incidentsOutsideScopeCount).toBe(1);
  });

  test("Copilot chosen is Copilot alone, not Copilot AI Model Providers", () => {
    const result: ExternalStatusPageScopeResult = scope(GITHUB_WITH_INCIDENTS, {
      componentNames: ["Copilot"],
    });

    expect(watched(result)).toEqual(["Copilot"]);
    expect(result.activeIncidentNames).toEqual(["Incident with Copilot"]);
    expect(result.overallStatus).toBe("major_outage");
  });

  test("the component statuses are the chosen ones', as the page has them", () => {
    const result: ExternalStatusPageScopeResult = scope(
      atlassian(
        withStatuses(GITHUB_PAGE, {
          "Pull Requests": "degraded_performance",
          Copilot: "major_outage",
        }),
        [],
      ),
      { componentNames: ["Pull Requests", "Git Operations"] },
    );

    expect(
      result.componentStatuses.map(
        (component: ExternalStatusPageComponentStatus): [string, string] => {
          return [component.name, component.status];
        },
      ),
    ).toEqual([
      ["Git Operations", "operational"],
      ["Pull Requests", "degraded_performance"],
    ]);
    expect(result.overallStatus).toBe("degraded_performance");
  });
});

describe("the whole page, with nothing chosen", () => {
  test("counts every incident, the one that names no component too, and keeps the page's own status", () => {
    const result: ExternalStatusPageScopeResult = scope(GITHUB_WITH_INCIDENTS, {
      pageOverallStatus: "Partial System Outage",
    });

    expect(watched(result)).toHaveLength(GITHUB_PAGE.components.length);
    expect(result.activeIncidentCount).toBe(3);
    expect(result.activeIncidentNames).toEqual([
      "Incident with Copilot",
      "Grok 4.6 and Grok 4.7 Service Issues",
      "Disruption with some GitHub services",
    ]);
    expect(result.incidentsOutsideScopeCount).toBe(0);
    expect(result.overallStatus).toBe("Partial System Outage");
    expect(result.unmatchedComponentNames).toEqual([]);
  });

  test("a provider with no status of its own: the worst component's", () => {
    expect(scope(GITHUB_WITH_INCIDENTS).overallStatus).toBe("major_outage");
  });
});

describe("chosen names that pick no component", () => {
  test("are named, so a typo is not a monitor that is quietly healthy", () => {
    const result: ExternalStatusPageScopeResult = scope(GITHUB_WITH_INCIDENTS, {
      componentNames: ["Git Operations", "Webhook", "*Kubernetes*"],
    });

    expect(watched(result)).toEqual(["Git Operations"]);
    expect(result.unmatchedComponentNames).toEqual([
      "Webhook",
      "*Kubernetes*",
    ]);
  });

  test("a page that lists no components picks none of them", () => {
    const result: ExternalStatusPageScopeResult = scope(
      { components: [], incidents: [] },
      { componentNames: ["Git Operations"] },
    );

    expect(result.componentStatuses).toEqual([]);
    expect(result.unmatchedComponentNames).toEqual(["Git Operations"]);
    expect(result.overallStatus).toBe("operational");
  });
});

describe("a component group", () => {
  const openAi: ExternalStatusPageContents = incidentIo(
    withStatuses(OPENAI_PAGE, { Conversations: "partial_outage" }),
    [
      OPENAI_INCIDENTS.conversations,
      OPENAI_INCIDENTS.embeddings,
      OPENAI_INCIDENTS.unattributed,
    ],
  );

  test("alone, watches its components and their incidents, as it always did", () => {
    const result: ExternalStatusPageScopeResult = scope(openAi, {
      componentGroupName: "APIs",
    });

    expect(watched(result)).toEqual([
      "Chat Completions",
      "Responses",
      "Embeddings",
      "Fine-tuning",
    ]);
    expect(result.activeIncidentNames).toEqual([
      "Increased latency for Embeddings",
    ]);
    expect(result.incidentsOutsideScopeCount).toBe(2);
  });

  test("is matched as its name contains it, ignoring case", () => {
    expect(watched(scope(openAi, { componentGroupName: "chat" }))).toEqual([
      "Login",
      "Conversations",
      "File uploads",
    ]);
  });

  test("with chosen components, watches the chosen ones of the group", () => {
    const result: ExternalStatusPageScopeResult = scope(openAi, {
      componentGroupName: "ChatGPT",
      componentNames: ["Login", "Conversations", "Embeddings"],
    });

    expect(watched(result)).toEqual(["Login", "Conversations"]);
    expect(result.activeIncidentCount).toBe(1);
    // Embeddings is of another group: not watched, and said.
    expect(result.unmatchedComponentNames).toEqual(["Embeddings"]);
    expect(result.overallStatus).toBe("partial_outage");
  });

  test("that the page does not have watches nothing", () => {
    const result: ExternalStatusPageScopeResult = scope(openAi, {
      componentGroupName: "Sora",
    });

    expect(watched(result)).toEqual([]);
    expect(result.activeIncidentCount).toBe(0);
  });
});

describe("a pattern", () => {
  test("watches every component it matches, and their incidents", () => {
    const cloudflare: ExternalStatusPageContents = atlassian(CLOUDFLARE_PAGE, [
      {
        id: "i1",
        name: "Workers KV elevated errors",
        componentIds: ["tmh50tx2nprs"],
      },
    ]);

    const workersOnly: ExternalStatusPageScopeResult = scope(cloudflare, {
      componentNames: ["Workers"],
    });
    const everyWorkers: ExternalStatusPageScopeResult = scope(cloudflare, {
      componentNames: ["Workers*"],
    });

    expect(watched(workersOnly)).toEqual(["Workers"]);
    expect(workersOnly.activeIncidentCount).toBe(0);
    expect(watched(everyWorkers)).toEqual([
      "Workers",
      "Workers KV",
      "Workers AI",
    ]);
    expect(everyWorkers.activeIncidentCount).toBe(1);
  });

  test("of data centers, by the code in their names", () => {
    expect(
      watched(
        scope(atlassian(CLOUDFLARE_PAGE, []), {
          componentNames: ["*(FRA)", "*(AMS)"],
        }),
      ),
    ).toEqual(["Amsterdam, Netherlands - (AMS)", "Frankfurt, Germany - (FRA)"]);
  });
});

describe("one name in two groups", () => {
  const cloudflare: ExternalStatusPageContents = atlassian(CLOUDFLARE_PAGE, [
    // The Developer Platform's API, by its id.
    { id: "i2", name: "Developer Platform API errors", componentIds: ["c8ksm3wq5t2n"] },
  ]);

  test("an incident counts for the group's component it affects, told apart by its id", () => {
    expect(
      scope(cloudflare, {
        componentGroupName: "Cloudflare Sites and Services",
        componentNames: ["API"],
      }).activeIncidentCount,
    ).toBe(0);
    expect(
      scope(cloudflare, {
        componentGroupName: "Developer Platform",
        componentNames: ["API"],
      }).activeIncidentCount,
    ).toBe(1);
  });

  test("without a group, the name picks both", () => {
    const result: ExternalStatusPageScopeResult = scope(cloudflare, {
      componentNames: ["API"],
    });

    expect(watched(result)).toEqual(["API", "API"]);
    expect(result.activeIncidentCount).toBe(1);
  });

  test("a page whose components have no ids is read by names", () => {
    const components: Array<ExternalStatusPageComponent> =
      cloudflare.components.map(
        (component: ExternalStatusPageComponent): ExternalStatusPageComponent => {
          return { ...component, key: undefined };
        },
      );
    const incidents: Array<ExternalStatusPageIncident> = cloudflare.incidents;

    // By name, the incident's API is the group's API too.
    expect(
      scope(
        { components, incidents },
        {
          componentGroupName: "Cloudflare Sites and Services",
          componentNames: ["API"],
        },
      ).activeIncidentCount,
    ).toBe(1);
  });
});

describe("the overall status of the components in scope", () => {
  function overall(statuses: Array<string>, incidents: number = 0): string {
    return ExternalStatusPageScope.deriveOverallStatus(
      statuses.map((status: string, index: number): ExternalStatusPageComponent => {
        return { name: `c${index}`, status: status };
      }),
      incidents,
    );
  }

  test.each([
    [["operational", "operational"], 0, "operational"],
    [["operational", "under_maintenance"], 0, "under_maintenance"],
    [["under_maintenance", "degraded_performance"], 0, "degraded_performance"],
    [["degraded_performance", "partial_outage"], 0, "partial_outage"],
    [["partial_outage", "major_outage"], 0, "major_outage"],
    [["major_outage", "full_outage"], 0, "major_outage"],
    [["operational", "investigating"], 0, "investigating"],
    [["operational"], 2, "degraded_performance"],
    [["under_maintenance"], 1, "under_maintenance"],
    [[], 0, "operational"],
  ])(
    "%p with %p incidents: %p",
    (statuses: Array<string>, incidents: number, expected: string) => {
      expect(overall(statuses, incidents)).toBe(expected);
    },
  );
});

describe("the incident names a check reports", () => {
  test("are the first few, each cut short", () => {
    const many: Array<{ name: string }> = [];

    for (let index: number = 0; index < 50; index++) {
      many.push({ name: `Incident ${index}` });
    }

    expect(ExternalStatusPageScope.getReportedNames(many)).toHaveLength(
      EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAMES,
    );

    const long: Array<string> = ExternalStatusPageScope.getReportedNames([
      { name: "x".repeat(5000) },
      { name: "   " },
    ]);

    expect(long).toHaveLength(1);
    expect(long[0]).toHaveLength(
      EXTERNAL_STATUS_PAGE_MAX_REPORTED_INCIDENT_NAME_LENGTH,
    );
    expect(long[0]!.endsWith("…")).toBe(true);
  });
});

describe("a page of every size", () => {
  test("five thousand components and five hundred chosen names, in well under two seconds", () => {
    const components: Array<ExternalStatusPageComponent> = [];
    const incidents: Array<ExternalStatusPageIncident> = [];
    const chosen: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      components.push({
        name: `Data center ${index} (dc-${index})`,
        status: "operational",
        groupName: `Region ${index % 8}`,
        key: `k${index}`,
      });
    }

    for (let index: number = 0; index < 1000; index++) {
      incidents.push({
        name: `Incident ${index}`,
        affectedComponentNames: [`Data center ${index}`],
        affectedComponentKeys: [`k${index * 5}`],
      });
    }

    for (let index: number = 0; index < 499; index++) {
      chosen.push(`Data center ${index * 10} (dc-${index * 10})`);
    }

    chosen.push("*(dc-4999)");

    const run: { inMs: number; result: ExternalStatusPageScopeResult } =
      fastestRun({
        run: (): ExternalStatusPageScopeResult => {
          return ExternalStatusPageScope.apply({
            components,
            incidents,
            componentNames: chosen,
          });
        },
        limitInMs: 2000,
      });

    expect(run.result.componentStatuses).toHaveLength(500);
    // Incidents of every fifth component: those of the chosen tenth ones.
    expect(run.result.activeIncidentCount).toBe(499);
    expect(run.inMs).toBeLessThan(2000);
  });
});

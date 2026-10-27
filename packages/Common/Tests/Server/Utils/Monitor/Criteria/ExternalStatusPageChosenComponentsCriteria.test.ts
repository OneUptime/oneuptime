import ExternalStatusPageMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ExternalStatusPageMonitorCriteria";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorResponse from "../../../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "../../../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ExternalStatusPageReading from "../../../../../Utils/Monitor/ExternalStatusPageReading";
import ExternalStatusPageScope, {
  ExternalStatusPageScopeResult,
} from "../../../../../Utils/Monitor/ExternalStatusPageScope";
import {
  FixtureIncident,
  FixturePage,
  GITHUB_CHOSEN_COMPONENTS,
  GITHUB_INCIDENTS,
  GITHUB_PAGE,
  atlassianComponentsJSON,
  atlassianUnresolvedJSON,
  withStatuses,
} from "../../../../Helpers/ExternalStatusPageFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUE #5156, AS THE CRITERIA JUDGE IT.
 *
 * A monitor of GitHub's status page, made with the criteria every new
 * External Status Page monitor starts with - offline, and an incident, when
 * the page cannot be read, has an active incident, or a component reports
 * Degraded Performance, Partial Outage, Major Outage or Full Outage; online
 * when the page is read and has no active incident - and watching only the
 * components the customer depends on. The probe's reading is made as the
 * probe makes it (ExternalStatusPageReading, ExternalStatusPageScope), from
 * GitHub's components and incidents (ExternalStatusPageFixtures).
 *
 * The incident's root cause names what tripped it: the incident counted,
 * by the page's name for it, and the component.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();

function defaultCriteria(): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: MonitorType.ExternalStatusPage,
      monitorName: "GitHub",
      onlineMonitorStatusId: ONLINE_STATUS_ID,
      offlineMonitorStatusId: OFFLINE_STATUS_ID,
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

// GitHub's page as the probe reads it for a monitor's scope.
function check(data: {
  page?: FixturePage;
  incidents: Array<FixtureIncident>;
  statuses?: Record<string, string>;
  componentNames?: Array<string>;
}): ProbeMonitorResponse {
  const page: FixturePage = withStatuses(
    data.page || GITHUB_PAGE,
    data.statuses || {},
  );
  const scope: ExternalStatusPageScopeResult = ExternalStatusPageScope.apply({
    components: ExternalStatusPageReading.readAtlassianComponents(
      atlassianComponentsJSON(page),
    )!,
    incidents: ExternalStatusPageReading.readAtlassianIncidents(
      atlassianUnresolvedJSON(page, data.incidents),
    ),
    componentNames: data.componentNames || [],
    pageOverallStatus: "Partial System Outage",
  });

  const response: ExternalStatusPageMonitorResponse = {
    isOnline: true,
    overallStatus: scope.overallStatus,
    componentStatuses: scope.componentStatuses,
    activeIncidentCount: scope.activeIncidentCount,
    activeIncidentNames: scope.activeIncidentNames,
    incidentsOutsideScopeCount: scope.incidentsOutsideScopeCount,
    unmatchedComponentNames: scope.unmatchedComponentNames,
    componentNames: data.componentNames || [],
    responseTimeInMs: 120,
    failureCause: "",
    provider: ExternalStatusPageProviderType.AtlassianStatuspage,
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    responseTimeInMs: 120,
    externalStatusPageResponse: response,
    monitoredAt: new Date(),
  };
}

// What each filter of a criteria found, met or not.
async function findings(
  instance: MonitorCriteriaInstance,
  dataToProcess: ProbeMonitorResponse,
): Promise<Array<string | null>> {
  const results: Array<string | null> = [];

  for (const filter of instance.data?.filters || []) {
    results.push(
      await ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
        { dataToProcess: dataToProcess, criteriaFilter: filter },
      ),
    );
  }

  return results;
}

/*
 * The status the monitor ends up in - the first criteria that matches wins -
 * and what the filters that matched found.
 */
async function judge(
  dataToProcess: ProbeMonitorResponse,
): Promise<{ status: string; found: Array<string> }> {
  for (const instance of defaultCriteria()) {
    const results: Array<string | null> = await findings(
      instance,
      dataToProcess,
    );
    const met: boolean =
      instance.data?.filterCondition === FilterCondition.Any
        ? results.some(Boolean)
        : results.every(Boolean);

    if (!met) {
      continue;
    }

    return {
      status:
        instance.data?.monitorStatusId?.toString() ===
        OFFLINE_STATUS_ID.toString()
          ? "offline, with an incident"
          : "online",
      found: results.filter((result: string | null): result is string => {
        return Boolean(result);
      }),
    };
  }

  return { status: "no criteria matched", found: [] };
}

describe("GitHub's page, watched for Git Operations, Pull Requests, Actions and Webhooks", () => {
  test("an incident of Copilot, and Copilot in a major outage: online", async () => {
    expect(
      (
        await judge(
          check({
            incidents: [GITHUB_INCIDENTS.copilot],
            statuses: { Copilot: "major_outage" },
            componentNames: GITHUB_CHOSEN_COMPONENTS,
          }),
        )
      ).status,
    ).toBe("online");
  });

  test("the same page watched whole: offline, as before", async () => {
    const judged: { status: string; found: Array<string> } = await judge(
      check({
        incidents: [GITHUB_INCIDENTS.copilot],
        statuses: { Copilot: "major_outage" },
      }),
    );

    expect(judged.status).toBe("offline, with an incident");
    expect(judged.found[0]).toContain('Incident: "Incident with Copilot".');
  });

  test("an incident that names no component: online while components are chosen", async () => {
    expect(
      (
        await judge(
          check({
            incidents: [GITHUB_INCIDENTS.unattributed],
            componentNames: GITHUB_CHOSEN_COMPONENTS,
          }),
        )
      ).status,
    ).toBe("online");
  });

  test("an incident of Git Operations and Pull Requests: offline, and the root cause names it", async () => {
    const judged: { status: string; found: Array<string> } = await judge(
      check({
        incidents: [
          GITHUB_INCIDENTS.gitAndPullRequests,
          GITHUB_INCIDENTS.copilot,
        ],
        componentNames: GITHUB_CHOSEN_COMPONENTS,
      }),
    );

    expect(judged.status).toBe("offline, with an incident");
    expect(judged.found).toEqual([
      'External Status Page Active Incidents was 1, above the 0 threshold. Incident: "Incident with Git Operations and Pull Requests".',
    ]);
  });

  test("Pull Requests degraded, with no incident yet: offline, and the root cause names the component", async () => {
    const judged: { status: string; found: Array<string> } = await judge(
      check({
        incidents: [],
        statuses: { "Pull Requests": "degraded_performance" },
        componentNames: GITHUB_CHOSEN_COMPONENTS,
      }),
    );

    expect(judged.status).toBe("offline, with an incident");
    expect(judged.found).toHaveLength(1);
    expect(judged.found[0]).toContain('Component "Pull Requests"');
  });
});

describe("the incidents a criteria's message names", () => {
  const ACTIVE_INCIDENTS_ABOVE_ZERO: {
    checkOn: CheckOn;
    filterType: FilterType;
    value: number;
  } = {
    checkOn: CheckOn.ExternalStatusPageActiveIncidents,
    filterType: FilterType.GreaterThan,
    value: 0,
  };

  async function message(
    response: Partial<ExternalStatusPageMonitorResponse>,
  ): Promise<string | null> {
    return ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
      {
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
          monitorStepId: ObjectID.generate(),
          probeId: ObjectID.generate(),
          failureCause: "",
          isOnline: true,
          externalStatusPageResponse: {
            isOnline: true,
            overallStatus: "operational",
            componentStatuses: [],
            activeIncidentCount: 0,
            responseTimeInMs: 100,
            failureCause: "",
            ...response,
          },
          monitoredAt: new Date(),
        },
        criteriaFilter: ACTIVE_INCIDENTS_ABOVE_ZERO,
      },
    );
  }

  test.each([
    [["A"], 1, 'Incident: "A".'],
    [["A", "B"], 2, 'Incidents: "A" and "B".'],
    [["A", "B", "C"], 3, 'Incidents: "A", "B" and "C".'],
    [["A", "B", "C", "D", "E"], 5, 'Incidents: "A", "B", "C" and 2 more.'],
    // The probe names the first twenty; the count says how many there are.
    [["A", "B", "C"], 30, 'Incidents: "A", "B", "C" and 27 more.'],
  ])(
    "%p of %p: %p",
    async (names: Array<string>, count: number, expected: string) => {
      expect(
        await message({
          activeIncidentNames: names,
          activeIncidentCount: count,
        }),
      ).toBe(
        `External Status Page Active Incidents was ${count}, above the 0 threshold. ${expected}`,
      );
    },
  );

  test("a probe that names none says the count alone", async () => {
    expect(await message({ activeIncidentCount: 2 })).toBe(
      "External Status Page Active Incidents was 2, above the 0 threshold.",
    );
    expect(
      await message({ activeIncidentCount: 2, activeIncidentNames: [" ", ""] }),
    ).toBe(
      "External Status Page Active Incidents was 2, above the 0 threshold.",
    );
  });

  test("a criteria not met names nothing", async () => {
    expect(
      await message({ activeIncidentCount: 0, activeIncidentNames: ["A"] }),
    ).toBeNull();
  });

  test("a criteria met on no incidents names none of them", async () => {
    expect(
      await ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
        {
          dataToProcess: {
            projectId: ObjectID.generate(),
            monitorId: ObjectID.generate(),
            monitorStepId: ObjectID.generate(),
            probeId: ObjectID.generate(),
            failureCause: "",
            isOnline: true,
            externalStatusPageResponse: {
              isOnline: true,
              overallStatus: "operational",
              componentStatuses: [],
              activeIncidentCount: 0,
              activeIncidentNames: ["A stale name"],
              responseTimeInMs: 100,
              failureCause: "",
            },
            monitoredAt: new Date(),
          },
          criteriaFilter: {
            checkOn: CheckOn.ExternalStatusPageActiveIncidents,
            filterType: FilterType.EqualTo,
            value: 0,
          },
        },
      ),
    ).toBe(
      "External Status Page Active Incidents was 0, equal to the 0 threshold.",
    );
  });
});

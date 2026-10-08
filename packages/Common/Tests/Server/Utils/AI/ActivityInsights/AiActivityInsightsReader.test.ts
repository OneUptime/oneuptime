import AiActivityInsightsReader, {
  AI_ACTIVITY_INSIGHTS_JOB_SCAN_LIMIT,
  AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT,
  AiActivityInsightsScope,
  isPreventiveInsightAboutScope,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsReader";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import RunnerJobService from "../../../../../Server/Services/RunnerJobService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  AI_ACTIVITY_INSIGHTS_MAX_FIXES,
  AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS,
  AiActivityInsights,
  AiActivityProblem,
} from "../../../../../Types/AI/AiActivityInsights";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import RunbookStepType from "../../../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../../Types/Runbook/RunnerJobStatus";
import UserType from "../../../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AiActivityInsightsReader gathers what an AI Insights page summarises for
 * one scope, deciding what the insights may say about everything other
 * than the scope itself: incidents, alerts and preventive findings follow
 * the caller's own read access; AI runs, suggestions, jobs, reports, the
 * incidents' monitor ids and exception owners are read as root and leave
 * only as statuses, dates, counts and opaque groupings. These tests drive
 * it against stubbed services the way the permission layer would answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-09-22T10:00:00.000Z");
const WINDOW_START: Date = new Date("2026-08-24T00:00:00.000Z");

const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const HIDDEN_INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
const SECOND_ALERT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);
const INCIDENT_MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000002",
);

const RUN_INCIDENT: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);
const RUN_HIDDEN: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000002",
);
const RUN_ALERT: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000003",
);
const RUN_SECOND_ALERT: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000004",
);
const RUN_TRIAGE: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000005",
);
// A fix's run: its job names it, but it is no investigation.
const RUN_REMEDIATION: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000006",
);

const FIX_OWN: ObjectID = new ObjectID("eeeeeeee-0000-4000-8000-000000000001");
const FIX_FROM_JOB: ObjectID = new ObjectID(
  "eeeeeeee-0000-4000-8000-000000000002",
);

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
} as DatabaseCommonInteractionProps;

function scope(
  overrides: Partial<AiActivityInsightsScope> = {},
): AiActivityInsightsScope {
  return {
    projectId: PROJECT_ID,
    props: CALLER,
    scopeId: CLUSTER_ID,
    commandJobQuery: {
      kubernetesClusterId: CLUSTER_ID,
      stepType: RunbookStepType.Kubectl,
    },
    subjectRelation: "kubernetesClusters",
    ownFixQuery: { kubernetesClusterId: CLUSTER_ID },
    scopeLabelKeys: ["k8s.cluster.name"],
    scopeNames: ["oneuptime-test"],
    ...overrides,
  };
}

// The ids a QueryHelper.any(...) filter asks for.
function idsIn(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (filter as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  const values: unknown = Object.values(parameters)[0];

  return Array.isArray(values)
    ? values.map((value: unknown) => {
        return String(value);
      })
    : [];
}

function queryOf(call: Array<unknown>): Record<string, unknown> {
  return (call[0] as { query: Record<string, unknown> }).query;
}

function propsOf(call: Array<unknown>): DatabaseCommonInteractionProps {
  return (call[0] as { props: DatabaseCommonInteractionProps }).props;
}

function isRoot(call: Array<unknown>): boolean {
  return JSON.stringify(propsOf(call)) === JSON.stringify({ isRoot: true });
}

function isCaller(call: Array<unknown>): boolean {
  return propsOf(call) === CALLER;
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("AiActivityInsightsReader.read", () => {
  let jobFind: jest.SpyInstance;
  let incidentFind: jest.SpyInstance;
  let alertFind: jest.SpyInstance;
  let runFind: jest.SpyInstance;
  let suggestionFind: jest.SpyInstance;
  let insightFind: jest.SpyInstance;
  let exceptionFind: jest.SpyInstance;
  let incidentFeedFind: jest.SpyInstance;
  let alertFeedFind: jest.SpyInstance;

  beforeEach(() => {
    jobFind = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
    incidentFind = jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    alertFind = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    runFind = jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    suggestionFind = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
    insightFind = jest.spyOn(AIInsightService, "findBy").mockResolvedValue([]);
    exceptionFind = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([]);
    incidentFeedFind = jest
      .spyOn(IncidentFeedService, "findBy")
      .mockResolvedValue([]);
    alertFeedFind = jest
      .spyOn(AlertFeedService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * One cluster's month: a run of a readable incident, a run of an incident
   * the caller may not read (private), two alert runs from one monitor, an
   * insight's triage run with no subject, and two fixes.
   */
  function serveMonth(): void {
    jobFind.mockResolvedValue([
      {
        aiRunId: RUN_ALERT,
        origin: RunnerJobOrigin.AiInvestigation,
        status: RunnerJobStatus.Succeeded,
      },
      {
        aiRunId: RUN_ALERT,
        origin: RunnerJobOrigin.AiInvestigation,
        status: RunnerJobStatus.Failed,
      },
      {
        aiRunId: RUN_TRIAGE,
        origin: RunnerJobOrigin.AiInvestigation,
        status: RunnerJobStatus.TimedOut,
      },
      {
        autoRemediationSuggestionId: FIX_FROM_JOB,
        aiRunId: RUN_REMEDIATION,
        origin: RunnerJobOrigin.AiRemediation,
        status: RunnerJobStatus.Succeeded,
      },
      // The AI agent page's connection test: not AI's work.
      {
        origin: RunnerJobOrigin.AiInvestigation,
        status: RunnerJobStatus.Failed,
      },
    ]);

    /*
     * Linked subjects, read whole: the caller's labels leave out the hidden
     * incident, which the run names but the caller cannot read by id either.
     */
    incidentFind.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;
      const select: Record<string, unknown> = (
        args as { select: Record<string, unknown> }
      ).select;

      if (query["kubernetesClusters"]) {
        return [
          {
            id: INCIDENT_ID,
            title: "Checkout is down",
            incidentNumber: 42,
            incidentNumberWithPrefix: "INC-42",
            seriesLabels: { "k8s.namespace.name": "shop" },
            createdAt: minutesAgo(12),
          },
        ];
      }

      // The monitors of the readable incidents, as root.
      if (select["monitors"]) {
        return [{ id: INCIDENT_ID, monitors: [{ id: INCIDENT_MONITOR_ID }] }];
      }

      return [];
    });

    alertFind.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      if (query["kubernetesClusters"]) {
        return [];
      }

      return [
        {
          id: ALERT_ID,
          title: "Replica mismatch - Deployment: home",
          alertNumber: 7,
          monitorId: MONITOR_ID,
          seriesLabels: {
            "k8s.cluster.name": "oneuptime-test",
            "k8s.namespace.name": "shop",
            "k8s.deployment.name": "home",
          },
        },
        {
          id: SECOND_ALERT_ID,
          title: "Replica mismatch - Deployment: worker",
          alertNumber: 8,
          monitorId: MONITOR_ID,
          seriesLabels: {
            "k8s.namespace.name": "shop",
            "k8s.deployment.name": "worker",
          },
        },
      ];
    });

    runFind.mockResolvedValue([
      {
        id: RUN_INCIDENT,
        status: AIRunStatus.Completed,
        analysisTldr: "The checkout database ran out of connections.",
        createdAt: minutesAgo(10),
        completedAt: minutesAgo(5),
        triggeredByIncidentId: INCIDENT_ID,
      },
      {
        id: RUN_HIDDEN,
        status: AIRunStatus.Completed,
        analysisTldr: "A private finding.",
        createdAt: minutesAgo(20),
        triggeredByIncidentId: HIDDEN_INCIDENT_ID,
      },
      {
        id: RUN_ALERT,
        status: AIRunStatus.Completed,
        createdAt: minutesAgo(30),
        completedAt: minutesAgo(25),
        triggeredByAlertId: ALERT_ID,
      },
      {
        id: RUN_SECOND_ALERT,
        status: AIRunStatus.Error,
        createdAt: minutesAgo(40),
        triggeredByAlertId: SECOND_ALERT_ID,
      },
      {
        id: RUN_TRIAGE,
        status: AIRunStatus.Completed,
        analysisTldr: "A triage finding.",
        createdAt: minutesAgo(50),
      },
    ]);

    suggestionFind.mockImplementation(async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;

      if (query["kubernetesClusterId"]) {
        return [
          {
            id: FIX_OWN,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
            createdAt: minutesAgo(15),
            alertId: ALERT_ID,
          },
        ];
      }

      return [
        {
          id: FIX_FROM_JOB,
          status: AutoRemediationSuggestionStatus.Suggested,
          createdAt: minutesAgo(16),
          incidentId: HIDDEN_INCIDENT_ID,
        },
      ];
    });

    alertFeedFind.mockResolvedValue([
      {
        aiRunId: RUN_ALERT,
        alertId: ALERT_ID,
        feedInfoInMarkdown:
          "**Summary** — The home deployment's image tag does not exist, so its pods never start [C1].",
      },
    ]);
  }

  test("reads the window's commands of the scope as root, and counts AI's own", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    const query: Record<string, unknown> = queryOf(jobFind.mock.calls[0]!);
    expect(query["kubernetesClusterId"]).toBe(CLUSTER_ID);
    expect(query["stepType"]).toBe(RunbookStepType.Kubectl);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["createdAt"]).toBeDefined();
    expect(isRoot(jobFind.mock.calls[0]!)).toBe(true);
    expect((jobFind.mock.calls[0]![0] as { limit: number }).limit).toBe(
      AI_ACTIVITY_INSIGHTS_JOB_SCAN_LIMIT,
    );
    // Never the output.
    expect(
      (jobFind.mock.calls[0]![0] as { select: Record<string, unknown> }).select[
        "output"
      ],
    ).toBeUndefined();

    // Four of AI's commands; the connection test is not one of them.
    expect(insights.totals.commands).toBe(4);
    expect(insights.totals.failedCommands).toBe(1);
    expect(insights.totals.timedOutCommands).toBe(1);
  });

  test("finds linked incidents and alerts of the window under the caller's props", async () => {
    await AiActivityInsightsReader.read(scope(), NOW);

    for (const spy of [incidentFind, alertFind]) {
      const linked: Array<unknown> = spy.mock.calls.find(
        (call: Array<unknown>): boolean => {
          return Boolean(queryOf(call)["kubernetesClusters"]);
        },
      )!;

      expect(isCaller(linked)).toBe(true);
      expect(queryOf(linked)["projectId"]).toBe(PROJECT_ID);
      expect(queryOf(linked)["createdAt"]).toBeDefined();
      expect(
        (queryOf(linked)["kubernetesClusters"] as Array<ObjectID>).map(
          (id: ObjectID) => {
            return id.toString();
          },
        ),
      ).toEqual([CLUSTER_ID.toString()]);
      expect((linked[0] as { limit: number }).limit).toBe(
        AI_ACTIVITY_INSIGHTS_LINKED_SUBJECT_LIMIT,
      );
    }
  });

  test("an empty scope reads no run, no subject and no report, and says nothing", async () => {
    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    expect(runFind).not.toHaveBeenCalled();
    expect(incidentFeedFind).not.toHaveBeenCalled();
    expect(alertFeedFind).not.toHaveBeenCalled();
    expect(insights.totals.investigations).toBe(0);
    expect(insights.totals.occurrences).toBe(0);
    expect(insights.problems).toEqual([]);
    expect(insights.insights).toEqual([]);
    expect(insights.isPartial).toBe(false);
  });

  test("reads the runs that ran commands here and those of linked subjects, as root, investigations of this project in the window only", async () => {
    serveMonth();

    await AiActivityInsightsReader.read(scope(), NOW);

    expect(runFind).toHaveBeenCalledTimes(2);
    for (const call of runFind.mock.calls) {
      const query: Record<string, unknown> = queryOf(call);
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["runType"]).toBe(AIRunType.Investigation);
      expect(query["createdAt"]).toBeDefined();
      expect(isRoot(call)).toBe(true);
      expect((call[0] as { limit: number }).limit).toBe(
        AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS,
      );
    }

    const byJobs: Record<string, unknown> = runFind.mock.calls
      .map(queryOf)
      .find((query: Record<string, unknown>): boolean => {
        return Boolean(query["_id"]);
      })!;
    // Every run a job names; the run type above keeps fixes' runs out.
    expect(idsIn(byJobs["_id"]).sort()).toEqual(
      [
        RUN_ALERT.toString(),
        RUN_TRIAGE.toString(),
        RUN_REMEDIATION.toString(),
      ].sort(),
    );

    const byIncidents: Record<string, unknown> = runFind.mock.calls
      .map(queryOf)
      .find((query: Record<string, unknown>): boolean => {
        return Boolean(query["triggeredByIncidentId"]);
      })!;
    expect(idsIn(byIncidents["triggeredByIncidentId"])).toEqual([
      INCIDENT_ID.toString(),
    ]);
  });

  test("leaves out an investigation whose incident the caller cannot read, from the totals too", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    // Four of the five runs: the private incident's is gone.
    expect(insights.totals.investigations).toBe(4);
    const serialized: string = JSON.stringify(insights);
    expect(serialized).not.toContain(HIDDEN_INCIDENT_ID.toString());
    expect(serialized).not.toContain("A private finding.");
    // The subjectless triage run counts, but files under no problem.
    expect(serialized).not.toContain("A triage finding.");
  });

  test("reads the linked incidents and alerts whole under the caller's props, with when each was created", async () => {
    serveMonth();

    await AiActivityInsightsReader.read(scope(), NOW);

    for (const spy of [incidentFind, alertFind]) {
      const linked: Array<unknown> = spy.mock.calls.find(
        (call: Array<unknown>): boolean => {
          return Boolean(queryOf(call)["kubernetesClusters"]);
        },
      )!;

      expect(isCaller(linked)).toBe(true);
      expect((linked[0] as { select: Record<string, unknown> }).select).toEqual(
        expect.objectContaining({
          _id: true,
          createdAt: true,
          title: true,
          seriesLabels: true,
        }),
      );
    }

    const linkedAlerts: Array<unknown> = alertFind.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return Boolean(queryOf(call)["kubernetesClusters"]);
      },
    )!;
    expect(
      (linkedAlerts[0] as { select: Record<string, unknown> }).select,
    ).toEqual(
      expect.objectContaining({ monitorId: true, alertNumberWithPrefix: true }),
    );
  });

  test("reads the runs' other subjects by id under the caller's props, and the monitors of every readable incident as root", async () => {
    serveMonth();

    await AiActivityInsightsReader.read(scope(), NOW);

    // The linked incident is not read again: only the one a run names.
    const titleRead: Array<unknown> = incidentFind.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return Boolean(queryOf(call)["_id"]) && !isRoot(call);
      },
    )!;
    expect(isCaller(titleRead)).toBe(true);
    expect(idsIn(queryOf(titleRead)["_id"])).toEqual([
      HIDDEN_INCIDENT_ID.toString(),
    ]);
    expect(
      (titleRead[0] as { select: Record<string, unknown> }).select,
    ).toEqual(
      expect.objectContaining({ title: true, seriesLabels: true, createdAt: true }),
    );

    // Monitors only of the incidents the caller could read.
    const monitorRead: Array<unknown> = incidentFind.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return Boolean(
          (call[0] as { select: Record<string, unknown> }).select["monitors"],
        );
      },
    )!;
    expect(isRoot(monitorRead)).toBe(true);
    expect(idsIn(queryOf(monitorRead)["_id"])).toEqual([
      INCIDENT_ID.toString(),
    ]);

    const alertRead: Array<unknown> = alertFind.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return Boolean(queryOf(call)["_id"]);
      },
    )!;
    expect(isCaller(alertRead)).toBe(true);
    expect(
      (alertRead[0] as { select: Record<string, unknown> }).select,
    ).toEqual(expect.objectContaining({ monitorId: true, seriesLabels: true }));
  });

  test("groups the alerts of one monitor into one recurring problem, with what each fired for", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    const replica: AiActivityProblem = insights.problems.find(
      (problem: AiActivityProblem): boolean => {
        return problem.investigationCount === 2;
      },
    )!;

    expect(replica.title).toBe("Replica mismatch");
    expect(replica.isRecurring).toBe(true);
    expect(replica.subjectCount).toBe(2);
    expect(replica.occurrenceCount).toBe(2);
    expect(replica.latestSubject).toEqual({
      kind: "alert",
      id: ALERT_ID.toString(),
      title: "Replica mismatch - Deployment: home",
      number: 7,
    });
    expect(
      replica.objects.map((object: { value: string }) => {
        return object.value;
      }),
    ).toEqual(["home", "worker"]);
    // The opaque key never carries the monitor's id.
    expect(replica.key).not.toContain(MONITOR_ID.toString());
    expect(JSON.stringify(insights)).not.toContain(MONITOR_ID.toString());
    expect(JSON.stringify(insights)).not.toContain(
      INCIDENT_MONITOR_ID.toString(),
    );

    // "shop" is in all three readable subjects: a hotspot. The cluster is not.
    expect(insights.hotspots).toEqual([
      expect.objectContaining({
        name: "Namespace",
        value: "shop",
        occurrenceCount: 3,
        investigationCount: 3,
        problemCount: 2,
      }),
    ]);
  });

  test("everything that came up here is the linked incidents and alerts, and the investigated ones", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    // The linked incident (with its prefixed number), and the two alerts.
    expect(insights.totals.occurrences).toBe(3);
    const incidentProblem: AiActivityProblem = insights.problems.find(
      (problem: AiActivityProblem): boolean => {
        return problem.latestSubject.kind === "incident";
      },
    )!;
    expect(incidentProblem.latestSubject.numberWithPrefix).toBe("INC-42");
    expect(incidentProblem.firstSeenAt).toBe(minutesAgo(12).toISOString());
  });

  test("each problem's newest completed investigation's report is read, as root: its Summary when the TL;DR call failed, and its first suggested step", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    const replica: AiActivityProblem = insights.problems.find(
      (problem: AiActivityProblem): boolean => {
        return problem.investigationCount === 2;
      },
    )!;
    expect(replica.latestFinding).toEqual({
      aiRunId: RUN_ALERT.toString(),
      text: "The home deployment's image tag does not exist, so its pods never start.",
      source: "report",
      at: minutesAgo(25).toISOString(),
    });

    const incidentProblem: AiActivityProblem = insights.problems.find(
      (problem: AiActivityProblem): boolean => {
        return problem.latestSubject.kind === "incident";
      },
    )!;
    expect(incidentProblem.latestFinding!.source).toBe("tldr");

    // One report per problem: the incident's run for its step, the alert's for both.
    expect(idsIn(queryOf(incidentFeedFind.mock.calls[0]!)["aiRunId"])).toEqual(
      [RUN_INCIDENT.toString()],
    );
    expect(idsIn(queryOf(alertFeedFind.mock.calls[0]!)["aiRunId"])).toEqual([
      RUN_ALERT.toString(),
    ]);
    expect(isRoot(alertFeedFind.mock.calls[0]!)).toBe(true);
    expect(isRoot(incidentFeedFind.mock.calls[0]!)).toBe(true);
    // The private incident's run is never asked about.
    expect(JSON.stringify(incidentFeedFind.mock.calls)).not.toContain(
      RUN_HIDDEN.toString(),
    );
  });

  test("a problem's suggested step is the first one its report names, with no citation markers", async () => {
    serveMonth();
    incidentFeedFind.mockResolvedValue([
      {
        aiRunId: RUN_INCIDENT,
        incidentId: INCIDENT_ID,
        feedInfoInMarkdown:
          "**Summary** — The checkout database ran out of connections [C1].\n\n**Suggested next steps**\n- Raise the pool to 50 connections [C2].\n- Then look at the slow query.",
      },
    ]);

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    const incidentProblem: AiActivityProblem = insights.problems.find(
      (problem: AiActivityProblem): boolean => {
        return problem.latestSubject.kind === "incident";
      },
    )!;
    // The TL;DR stays the finding; the report adds the step.
    expect(incidentProblem.latestFinding!.text).toBe(
      "The checkout database ran out of connections.",
    );
    expect(incidentProblem.latestNextStep).toBe(
      "Raise the pool to 50 connections.",
    );
  });

  test("reads the window's fixes as root — the scope's own rounds and those whose commands ran here — without rationale or plan", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    expect(suggestionFind).toHaveBeenCalledTimes(2);
    for (const call of suggestionFind.mock.calls) {
      expect(isRoot(call)).toBe(true);
      expect(queryOf(call)["projectId"]).toBe(PROJECT_ID);
      expect(queryOf(call)["createdAt"]).toBeDefined();
      const select: Record<string, unknown> = (
        call[0] as { select: Record<string, unknown> }
      ).select;
      expect(select["rationaleMarkdown"]).toBeUndefined();
      expect(select["commandPlan"]).toBeUndefined();
    }

    const fromJobs: Record<string, unknown> = suggestionFind.mock.calls
      .map(queryOf)
      .find((query: Record<string, unknown>): boolean => {
        return Boolean(query["_id"]);
      })!;
    expect(idsIn(fromJobs["_id"])).toEqual([FIX_FROM_JOB.toString()]);

    expect(insights.fixOutcomes).toEqual(
      expect.objectContaining({
        total: 2,
        appliedAutomatically: 1,
        awaitingApproval: 1,
        failed: 1,
      }),
    );
  });

  test("links insights to readable incidents and alerts only", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    const serialized: string = JSON.stringify(insights.insights);
    // The failed fix's alert is readable; the waiting fix's incident is not.
    expect(serialized).toContain(ALERT_ID.toString());
    expect(serialized).not.toContain(HIDDEN_INCIDENT_ID.toString());
  });

  test("reads when a person approved each fix, never its rationale or plan", async () => {
    serveMonth();

    await AiActivityInsightsReader.read(scope(), NOW);

    for (const call of suggestionFind.mock.calls) {
      expect((call[0] as { select: Record<string, unknown> }).select).toEqual(
        expect.objectContaining({ approvedAt: true }),
      );
    }
  });

  test("a role that may not read incidents or alerts at all sees only subjectless runs", async () => {
    serveMonth();
    incidentFind.mockRejectedValue(new NotAuthorizedException("No."));
    alertFind.mockRejectedValue(new NotAuthorizedException("No."));

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    expect(insights.totals.investigations).toBe(1);
    expect(insights.problems).toEqual([]);
    expect(alertFeedFind).not.toHaveBeenCalled();
  });

  test("any other failure is not swallowed", async () => {
    incidentFind.mockRejectedValue(new Error("database is down"));

    await expect(AiActivityInsightsReader.read(scope(), NOW)).rejects.toThrow(
      "database is down",
    );
  });

  test("says when a bound cut the window short", async () => {
    jobFind.mockResolvedValue(
      Array.from({ length: AI_ACTIVITY_INSIGHTS_JOB_SCAN_LIMIT }, () => {
        return {
          origin: RunnerJobOrigin.AiInvestigation,
          status: RunnerJobStatus.Succeeded,
        };
      }),
    );

    expect((await AiActivityInsightsReader.read(scope(), NOW)).isPartial).toBe(
      true,
    );

    jobFind.mockResolvedValue([]);
    suggestionFind.mockResolvedValue(
      Array.from({ length: AI_ACTIVITY_INSIGHTS_MAX_FIXES }, () => {
        return {
          id: ObjectID.generate(),
          status: AutoRemediationSuggestionStatus.Dismissed,
          createdAt: minutesAgo(1),
        };
      }),
    );

    expect((await AiActivityInsightsReader.read(scope(), NOW)).isPartial).toBe(
      true,
    );
  });

  describe("preventive insights", () => {
    function insight(
      overrides: Partial<Record<keyof AIInsight, unknown>>,
    ): AIInsight {
      return {
        id: ObjectID.generate(),
        title: "Error-log spike: 6.0x normal volume",
        insightType: AIInsightType.ErrorLogSpike,
        severity: AIInsightSeverity.High,
        status: AIInsightStatus.ActionRequired,
        fingerprint: `error-log-spike:${CLUSTER_ID.toString()}`,
        lastSeenAt: minutesAgo(5),
        occurrenceCount: 3,
        ...overrides,
      } as unknown as AIInsight;
    }

    test("are read under the caller's props: open ones naming the scope, and open exception ones", async () => {
      await AiActivityInsightsReader.read(scope(), NOW);

      expect(insightFind).toHaveBeenCalledTimes(2);
      for (const call of insightFind.mock.calls) {
        expect(isCaller(call)).toBe(true);
        expect(queryOf(call)["projectId"]).toBe(PROJECT_ID);
        expect(idsIn(queryOf(call)["status"]).sort()).toEqual(
          [
            AIInsightStatus.ActionRequired,
            AIInsightStatus.Detected,
            AIInsightStatus.FixOpened,
          ].sort(),
        );
      }

      const byFingerprint: Record<string, unknown> = insightFind.mock.calls
        .map(queryOf)
        .find((query: Record<string, unknown>): boolean => {
          return Boolean(query["fingerprint"]);
        })!;
      expect(
        Object.values(
          (
            byFingerprint["fingerprint"] as {
              objectLiteralParameters: Record<string, unknown>;
            }
          ).objectLiteralParameters,
        ),
      ).toEqual([`%${CLUSTER_ID.toString()}%`]);
    });

    test("keep only findings about the scope itself, the most severe first", async () => {
      const exceptionId: ObjectID = ObjectID.generate();
      const otherExceptionId: ObjectID = ObjectID.generate();
      const spike: AIInsight = insight({});
      const drift: AIInsight = insight({
        insightType: AIInsightType.MetricDrift,
        severity: AIInsightSeverity.Low,
        fingerprint: `metric-drift:k8s.pod.cpu.usage:${CLUSTER_ID.toString()}`,
      });
      // A search hit that is another entity's: the id only appears in it.
      const lookalike: AIInsight = insight({
        fingerprint: `error-log-spike:${CLUSTER_ID.toString()}-other`,
      });
      const exception: AIInsight = insight({
        insightType: AIInsightType.NewException,
        severity: AIInsightSeverity.Medium,
        fingerprint: "new-exception:abc",
        telemetryExceptionId: exceptionId,
      });
      const otherException: AIInsight = insight({
        insightType: AIInsightType.ExceptionSpike,
        fingerprint: "exception-spike:def",
        telemetryExceptionId: otherExceptionId,
      });

      insightFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        return query["fingerprint"]
          ? [spike, drift, lookalike]
          : [exception, otherException];
      });
      exceptionFind.mockResolvedValue([
        { id: exceptionId, primaryEntityId: CLUSTER_ID },
      ]);

      const insights: AiActivityInsights = await AiActivityInsightsReader.read(
        scope(),
        NOW,
      );

      expect(
        insights.preventiveInsights.map((row: { id: string }) => {
          return row.id;
        }),
      ).toEqual([
        spike.id!.toString(),
        exception.id!.toString(),
        drift.id!.toString(),
      ]);

      // The exceptions' owners, as root, limited to the scope's own.
      const exceptionQuery: Record<string, unknown> = queryOf(
        exceptionFind.mock.calls[0]!,
      );
      expect(isRoot(exceptionFind.mock.calls[0]!)).toBe(true);
      expect(exceptionQuery["projectId"]).toBe(PROJECT_ID);
      expect(exceptionQuery["primaryEntityId"]).toBe(CLUSTER_ID);
      expect(idsIn(exceptionQuery["_id"]).sort()).toEqual(
        [exceptionId.toString(), otherExceptionId.toString()].sort(),
      );
    });

    test("a role that may not read them gets none, and the page still works", async () => {
      insightFind.mockRejectedValue(new NotAuthorizedException("No."));

      const insights: AiActivityInsights = await AiActivityInsightsReader.read(
        scope(),
        NOW,
      );

      expect(insights.preventiveInsights).toEqual([]);
      expect(exceptionFind).not.toHaveBeenCalled();
    });
  });

  test("tenant isolation: every read is scoped to the caller's project", async () => {
    serveMonth();

    await AiActivityInsightsReader.read(scope(), NOW);

    for (const spy of [
      jobFind,
      incidentFind,
      alertFind,
      runFind,
      suggestionFind,
      insightFind,
      alertFeedFind,
    ]) {
      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) {
        expect(String(queryOf(call)["projectId"])).toBe(PROJECT_ID.toString());
      }
    }
  });

  test("the window it reads starts where the insights' window does", async () => {
    serveMonth();

    const insights: AiActivityInsights = await AiActivityInsightsReader.read(
      scope(),
      NOW,
    );

    expect(insights.windowStart).toBe(WINDOW_START.toISOString());
    const createdAt: { objectLiteralParameters: Record<string, unknown> } =
      queryOf(jobFind.mock.calls[0]!)["createdAt"] as {
        objectLiteralParameters: Record<string, unknown>;
      };
    expect(Object.values(createdAt.objectLiteralParameters)).toEqual([
      WINDOW_START,
    ]);
  });
});

describe("isPreventiveInsightAboutScope", () => {
  const scopeId: string = CLUSTER_ID.toString();
  const owners: Map<string, string> = new Map<string, string>([
    ["exception-1", scopeId],
    ["exception-2", ObjectID.generate().toString()],
  ]);

  test.each([
    [AIInsightType.ErrorLogSpike, `error-log-spike:${scopeId}`, true],
    [
      AIInsightType.ErrorLogSpike,
      `error-log-spike:${scopeId.toUpperCase()}`,
      true,
    ],
    [AIInsightType.ErrorLogSpike, "error-log-spike:project", false],
    [AIInsightType.ErrorLogSpike, `error-log-spike:${scopeId}x`, false],
    [AIInsightType.MetricDrift, `metric-drift:cpu:usage:${scopeId}`, true],
    [AIInsightType.MetricDrift, `metric-drift:${scopeId}:other`, false],
    [AIInsightType.TraceLatencyRegression, `latency:${scopeId}:GET /`, true],
    [AIInsightType.TraceLatencyRegression, `latency:other:${scopeId}`, false],
  ])(
    "%s %s → %s",
    (insightType: AIInsightType, fingerprint: string, expected: boolean) => {
      expect(
        isPreventiveInsightAboutScope({
          insight: { insightType, fingerprint } as AIInsight,
          scopeId,
          exceptionOwners: owners,
        }),
      ).toBe(expected);
    },
  );

  test("an exception finding is the scope's when its exception is", () => {
    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      expect(
        isPreventiveInsightAboutScope({
          insight: {
            insightType,
            telemetryExceptionId: new ObjectID(
              "99999999-0000-4000-8000-000000000001",
            ),
          } as unknown as AIInsight,
          scopeId,
          exceptionOwners: new Map<string, string>([
            ["99999999-0000-4000-8000-000000000001", scopeId],
          ]),
        }),
      ).toBe(true);
      expect(
        isPreventiveInsightAboutScope({
          insight: {
            insightType,
            telemetryExceptionId: new ObjectID(
              "99999999-0000-4000-8000-000000000002",
            ),
          } as unknown as AIInsight,
          scopeId,
          exceptionOwners: owners,
        }),
      ).toBe(false);
      expect(
        isPreventiveInsightAboutScope({
          insight: { insightType } as AIInsight,
          scopeId,
          exceptionOwners: owners,
        }),
      ).toBe(false);
    }
  });

  test("an insight type a newer server added is never claimed", () => {
    expect(
      isPreventiveInsightAboutScope({
        insight: {
          insightType: "SomethingNew",
          fingerprint: `something:${scopeId}`,
        } as unknown as AIInsight,
        scopeId,
        exceptionOwners: owners,
      }),
    ).toBe(false);
  });
});

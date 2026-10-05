import AiActivityInsightsBuilder, {
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivitySubjectInput,
  toPublicProblemKey,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsBuilder";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import {
  AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS,
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS,
  AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS,
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityInsights,
  AiActivityPreventiveInsight,
  AiActivityProblem,
} from "../../../../../Types/AI/AiActivityInsights";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of every AI Insights page. These tests pin how it reads
 * what OneUptime AI did on a scope: problems grouped by what raised them,
 * the parts of the scope they keep coming back to, what the investigations
 * concluded (the TL;DR, else the report's own summary), how fixes turned
 * out, the trend, and what deserves attention — all derived, nothing
 * invented, the same input always giving the same insights.
 */

// A fixed "now": Tuesday, 2026-09-22, 10:00 UTC.
const NOW: Date = new Date("2026-09-22T10:00:00.000Z");

const DAY: number = 24 * 60 * 60 * 1000;
const HOUR: number = 60 * 60 * 1000;

const CLUSTER_NAME: string = "oneuptime-test";
const SCOPE_LABEL_KEYS: Array<string> = [
  "resource.oneuptime.kubernetes.cluster.id",
  "oneuptime.kubernetes.cluster.id",
  "resource.k8s.cluster.name",
  "k8s.cluster.name",
];

const REPLICA_MONITOR: string = "aaaaaaaa-0000-4000-8000-000000000001";
const CPU_MONITOR: string = "aaaaaaaa-0000-4000-8000-000000000002";
const PENDING_MONITOR: string = "aaaaaaaa-0000-4000-8000-000000000003";

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function deploymentLabels(deployment: string, namespace: string): JSONObject {
  return {
    "resource.k8s.cluster.name": CLUSTER_NAME,
    "resource.k8s.namespace.name": namespace,
    "resource.k8s.deployment.name": deployment,
  };
}

function alert(
  id: string,
  overrides: Partial<AiActivitySubjectInput> = {},
): AiActivitySubjectInput {
  return {
    kind: "alert",
    id,
    title: `Alert ${id}`,
    monitorIds: [],
    ...overrides,
  };
}

function incident(
  id: string,
  overrides: Partial<AiActivitySubjectInput> = {},
): AiActivitySubjectInput {
  return {
    kind: "incident",
    id,
    title: `Incident ${id}`,
    monitorIds: [],
    ...overrides,
  };
}

let runSequence: number = 0;

function run(
  createdAt: Date,
  subject: AiActivitySubjectInput | undefined,
  overrides: Partial<AiActivityInvestigationInput> = {},
): AiActivityInvestigationInput {
  runSequence++;
  return {
    aiRunId: `run-${runSequence}`,
    status: AIRunStatus.Completed,
    createdAt,
    completedAt: new Date(createdAt.getTime() + 4 * 60 * 1000),
    subject,
    ...overrides,
  };
}

function fix(
  createdAt: Date,
  overrides: Partial<AiActivityFixInput> = {},
): AiActivityFixInput {
  runSequence++;
  return {
    id: `fix-${runSequence}`,
    status: AutoRemediationSuggestionStatus.Suggested,
    createdAt,
    ...overrides,
  };
}

function preventive(
  overrides: Partial<AiActivityPreventiveInsight> = {},
): AiActivityPreventiveInsight {
  runSequence++;
  return {
    id: `insight-${runSequence}`,
    title: "Error-log spike: 6.0x normal volume",
    insightType: AIInsightType.ErrorLogSpike,
    severity: AIInsightSeverity.High,
    status: AIInsightStatus.ActionRequired,
    lastSeenAt: hoursAgo(1).toISOString(),
    occurrenceCount: 3,
    ...overrides,
  };
}

function input(
  overrides: Partial<AiActivityInsightsInput> = {},
): AiActivityInsightsInput {
  return {
    now: NOW,
    windowInDays: AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS,
    investigations: [],
    fixes: [],
    commands: { total: 0, failed: 0, timedOut: 0 },
    preventiveInsights: [],
    scopeLabelKeys: SCOPE_LABEL_KEYS,
    scopeNames: [CLUSTER_NAME],
    isPartial: false,
    ...overrides,
  };
}

function build(
  overrides: Partial<AiActivityInsightsInput> = {},
): AiActivityInsights {
  return AiActivityInsightsBuilder.build(input(overrides));
}

function attentionOf(
  insights: AiActivityInsights,
  kind: AiActivityAttentionKind,
): Array<AiActivityAttentionItem> {
  return insights.attention.filter((item: AiActivityAttentionItem): boolean => {
    return item.kind === kind;
  });
}

/*
 * The cluster from the screenshot that started all this: the same
 * replica-mismatch monitor fired for two deployments, a CPU alert on a pod,
 * a Pending-pods alert, and two manual incidents.
 */
function screenshotCluster(): Array<AiActivityInvestigationInput> {
  return [
    run(
      hoursAgo(0.5),
      alert("cpu-1", {
        title:
          "[K8s] Pod CPU Saturating Container Limit (>90%) - oneuptime-test - Pod: kubernetes-agent-647589c54f-496r8 | Namespace: oneuptime-agent",
        monitorIds: [CPU_MONITOR],
        seriesLabels: {
          "resource.k8s.cluster.name": CLUSTER_NAME,
          "resource.k8s.namespace.name": "oneuptime-agent",
          "resource.k8s.pod.name": "kubernetes-agent-647589c54f-496r8",
        },
      }),
    ),
    run(hoursAgo(0.6), incident("incident-2", { title: "ghfghgf", number: 2 })),
    run(
      hoursAgo(1),
      alert("replica-home", {
        title:
          "[K8s] Deployment Replica Mismatch - oneuptime-test - Deployment: oneuptime-home | Namespace: default",
        monitorIds: [REPLICA_MONITOR],
        seriesLabels: deploymentLabels("oneuptime-home", "default"),
      }),
    ),
    run(
      hoursAgo(1.1),
      alert("replica-worker", {
        title:
          "[K8s] Deployment Replica Mismatch - oneuptime-test - Deployment: oneuptime-worker | Namespace: default",
        monitorIds: [REPLICA_MONITOR],
        seriesLabels: deploymentLabels("oneuptime-worker", "default"),
      }),
    ),
    run(
      hoursAgo(1.2),
      alert("pending", {
        title: "[K8s] Pods Stuck in Pending - oneuptime-test",
        monitorIds: [PENDING_MONITOR],
        seriesLabels: {
          "resource.k8s.cluster.name": CLUSTER_NAME,
          "resource.k8s.namespace.name": "default",
        },
      }),
    ),
    run(hoursAgo(1.3), incident("incident-1", { title: "sdfdsf", number: 1 })),
  ];
}

describe("AiActivityInsightsBuilder.getWindowStart", () => {
  test("a window of n days starts at UTC midnight n-1 days before today", () => {
    expect(
      AiActivityInsightsBuilder.getWindowStart(NOW, 30).toISOString(),
    ).toBe("2026-08-24T00:00:00.000Z");
    expect(AiActivityInsightsBuilder.getWindowStart(NOW, 1).toISOString()).toBe(
      "2026-09-22T00:00:00.000Z",
    );
    expect(AiActivityInsightsBuilder.getWindowStart(NOW, 7).toISOString()).toBe(
      "2026-09-16T00:00:00.000Z",
    );
  });

  test("is the same just after midnight and just before the next one", () => {
    const early: Date = new Date("2026-09-22T00:00:01.000Z");
    const late: Date = new Date("2026-09-22T23:59:59.999Z");
    expect(AiActivityInsightsBuilder.getWindowStart(early, 30)).toEqual(
      AiActivityInsightsBuilder.getWindowStart(late, 30),
    );
  });

  test("a window shorter than a day is today", () => {
    expect(AiActivityInsightsBuilder.getWindowStart(NOW, 0).toISOString()).toBe(
      "2026-09-22T00:00:00.000Z",
    );
    expect(
      AiActivityInsightsBuilder.getWindowStart(NOW, -4).toISOString(),
    ).toBe("2026-09-22T00:00:00.000Z");
  });
});

describe("AiActivityInsightsBuilder.stripSeriesIdentity", () => {
  test("takes off the identity SeriesContextEnricher appended", () => {
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "[K8s] Deployment Replica Mismatch - oneuptime-test - Deployment: oneuptime-home | Namespace: default",
        deploymentLabels("oneuptime-home", "default"),
      ),
    ).toBe("[K8s] Deployment Replica Mismatch - oneuptime-test");
  });

  test("takes off one label as well as three", () => {
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "Disk almost full - Host: db-01",
        { "host.name": "db-01" },
      ),
    ).toBe("Disk almost full");
  });

  test("recognises a long value shown by its end", () => {
    const pod: string = `checkout-${"x".repeat(80)}-7d9f-2xk`;
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        `Pod restarting - Pod: ...${pod.slice(pod.length - 61)}`,
        { "k8s.pod.name": pod },
      ),
    ).toBe("Pod restarting");
  });

  test("leaves a suffix that is not this subject's identity", () => {
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "Replica mismatch - Deployment: other-app",
        deploymentLabels("oneuptime-home", "default"),
      ),
    ).toBe("Replica mismatch - Deployment: other-app");
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "Replica mismatch - Deployment: oneuptime-home | Owner: payments",
        deploymentLabels("oneuptime-home", "default"),
      ),
    ).toBe("Replica mismatch - Deployment: oneuptime-home | Owner: payments");
  });

  test("leaves a title that merely contains a dash, or names no label", () => {
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "Checkout - payments down",
        deploymentLabels("oneuptime-home", "default"),
      ),
    ).toBe("Checkout - payments down");
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "Checkout is down",
        deploymentLabels("oneuptime-home", "default"),
      ),
    ).toBe("Checkout is down");
  });

  test("leaves every title alone when the subject has no series identity", () => {
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "CPU high - Host: db-01",
        undefined,
      ),
    ).toBe("CPU high - Host: db-01");
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(
        "CPU high - Host: db-01",
        {},
      ),
    ).toBe("CPU high - Host: db-01");
  });

  test("never strips the whole title, and reads an empty one as empty", () => {
    expect(
      AiActivityInsightsBuilder.stripSeriesIdentity(" - Host: db-01", {
        "host.name": "db-01",
      }),
    ).toBe("- Host: db-01");
    expect(AiActivityInsightsBuilder.stripSeriesIdentity("", undefined)).toBe(
      "",
    );
  });
});

describe("AiActivityInsightsBuilder.getScopeObjects", () => {
  const scope: { scopeLabelKeys: Array<string>; scopeNames: Array<string> } = {
    scopeLabelKeys: SCOPE_LABEL_KEYS,
    scopeNames: [CLUSTER_NAME],
  };

  test("names the parts of the scope, most identifying first", () => {
    expect(
      AiActivityInsightsBuilder.getScopeObjects(
        {
          "resource.k8s.cluster.name": CLUSTER_NAME,
          "resource.k8s.namespace.name": "shop",
          "resource.k8s.pod.name": "web-7d9f",
          "resource.k8s.container.name": "app",
          "resource.k8s.node.name": "node-a",
        },
        scope,
      ),
    ).toEqual([
      { name: "Container", value: "app" },
      { name: "Pod", value: "web-7d9f" },
      { name: "Namespace", value: "shop" },
      { name: "Node", value: "node-a" },
    ]);
  });

  test("leaves out the labels that name the scope itself, with or without the resource. prefix", () => {
    expect(
      AiActivityInsightsBuilder.getScopeObjects(
        {
          "k8s.cluster.name": CLUSTER_NAME,
          "resource.oneuptime.kubernetes.cluster.id":
            "11111111-1111-4111-8111-111111111111",
          "k8s.namespace.name": "shop",
        },
        scope,
      ),
    ).toEqual([{ name: "Namespace", value: "shop" }]);
  });

  test("leaves out any label whose value is the scope's own name, in any case", () => {
    expect(
      AiActivityInsightsBuilder.getScopeObjects(
        { "host.name": "OneUptime-Test", "k8s.namespace.name": "shop" },
        scope,
      ),
    ).toEqual([{ name: "Namespace", value: "shop" }]);
  });

  test("leaves out ids and qualifiers that are not a part of anything", () => {
    expect(
      AiActivityInsightsBuilder.getScopeObjects(
        {
          "k8s.pod.uid": "5b3f-uid",
          "container.id": "abc123",
          state: "used",
          direction: "transmit",
          cpu: "cpu0",
          power_state: "poweredOn",
          "pve.scope": "qemu",
          mountpoint: "/var",
        },
        scope,
      ),
    ).toEqual([{ name: "Mount", value: "/var" }]);
  });

  test("a subject without series labels is about nothing in particular", () => {
    expect(AiActivityInsightsBuilder.getScopeObjects(undefined, scope)).toEqual(
      [],
    );
    expect(AiActivityInsightsBuilder.getScopeObjects({}, scope)).toEqual([]);
  });
});

describe("AiActivityInsightsBuilder.getProblemKey", () => {
  test("one monitor is one problem, whatever it fired for", () => {
    expect(
      AiActivityInsightsBuilder.getProblemKey(
        alert("a", {
          title: "Replica mismatch - Deployment: home",
          monitorIds: [REPLICA_MONITOR],
        }),
      ),
    ).toBe(
      AiActivityInsightsBuilder.getProblemKey(
        incident("b", {
          title: "Something else",
          monitorIds: [REPLICA_MONITOR],
        }),
      ),
    );
  });

  test("several monitors are one problem in any order, repeats and blanks ignored", () => {
    expect(
      AiActivityInsightsBuilder.getProblemKey(
        incident("a", { monitorIds: [CPU_MONITOR, REPLICA_MONITOR, ""] }),
      ),
    ).toBe(
      AiActivityInsightsBuilder.getProblemKey(
        incident("b", {
          monitorIds: [REPLICA_MONITOR, CPU_MONITOR, REPLICA_MONITOR],
        }),
      ),
    );
  });

  test("without a monitor, the title — its case, spacing and series identity aside", () => {
    expect(
      AiActivityInsightsBuilder.getProblemKey(
        incident("a", { title: "Checkout  is DOWN" }),
      ),
    ).toBe(
      AiActivityInsightsBuilder.getProblemKey(
        incident("b", { title: "checkout is down" }),
      ),
    );
    expect(
      AiActivityInsightsBuilder.getProblemKey(
        alert("a", {
          title: "Disk full - Host: db-01",
          seriesLabels: { "host.name": "db-01" },
        }),
      ),
    ).toBe(
      AiActivityInsightsBuilder.getProblemKey(
        alert("b", {
          title: "Disk full - Host: db-02",
          seriesLabels: { "host.name": "db-02" },
        }),
      ),
    );
  });

  test("a subject with neither a monitor nor a title is a problem of its own", () => {
    expect(
      AiActivityInsightsBuilder.getProblemKey(incident("a", { title: "" })),
    ).not.toBe(
      AiActivityInsightsBuilder.getProblemKey(incident("b", { title: "" })),
    );
  });

  test("its public form is opaque and stable", () => {
    const key: string = AiActivityInsightsBuilder.getProblemKey(
      alert("a", { monitorIds: [REPLICA_MONITOR] }),
    );

    expect(toPublicProblemKey(key)).toMatch(/^problem-[0-9a-f]{8}$/);
    expect(toPublicProblemKey(key)).toBe(toPublicProblemKey(key));
    expect(toPublicProblemKey(key)).not.toContain(REPLICA_MONITOR);
    expect(toPublicProblemKey(key)).not.toBe(
      toPublicProblemKey(
        AiActivityInsightsBuilder.getProblemKey(
          alert("b", { monitorIds: [CPU_MONITOR] }),
        ),
      ),
    );
  });
});

describe("AiActivityInsightsBuilder.groupProblems", () => {
  test("groups by what raised the subject: most investigated first, then newest", () => {
    const groups: Array<{ key: string; runs: Array<{ aiRunId: string }> }> =
      AiActivityInsightsBuilder.groupProblems(
        input({ investigations: screenshotCluster() }),
      );

    expect(
      groups.map((group: { runs: Array<{ aiRunId: string }> }) => {
        return group.runs.length;
      }),
    ).toEqual([2, 1, 1, 1, 1]);
    expect(groups[0]!.key).toBe(`monitor:${REPLICA_MONITOR}`);
    // Of the problems seen once, the newest first.
    expect(groups[1]!.key).toBe(`monitor:${CPU_MONITOR}`);
  });

  test("leaves out runs with no subject and runs from before the window", () => {
    const groups: Array<unknown> = AiActivityInsightsBuilder.groupProblems(
      input({
        investigations: [
          run(hoursAgo(1), undefined),
          run(daysAgo(40), alert("old", { monitorIds: [CPU_MONITOR] })),
        ],
      }),
    );
    expect(groups).toEqual([]);
  });
});

describe("AiActivityInsightsBuilder.getRunsNeedingReportSummary", () => {
  test("names each problem's newest completed run that has no TL;DR", () => {
    const newest: AiActivityInvestigationInput = run(
      hoursAgo(1),
      alert("a", { monitorIds: [CPU_MONITOR] }),
    );
    const older: AiActivityInvestigationInput = run(
      hoursAgo(5),
      alert("b", { monitorIds: [CPU_MONITOR] }),
      { tldr: "An older finding." },
    );

    expect(
      AiActivityInsightsBuilder.getRunsNeedingReportSummary(
        input({ investigations: [older, newest] }),
      ),
    ).toEqual([newest.aiRunId]);
  });

  test("names nothing for a problem whose newest completed run has a TL;DR or a summary already", () => {
    expect(
      AiActivityInsightsBuilder.getRunsNeedingReportSummary(
        input({
          investigations: [
            run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
              tldr: "Found it.",
            }),
            run(hoursAgo(2), alert("b", { monitorIds: [REPLICA_MONITOR] }), {
              reportSummary: "Found it in the report.",
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("skips runs still running or failed, to the newest completed one", () => {
    const completed: AiActivityInvestigationInput = run(
      hoursAgo(3),
      alert("c", { monitorIds: [CPU_MONITOR] }),
    );

    expect(
      AiActivityInsightsBuilder.getRunsNeedingReportSummary(
        input({
          investigations: [
            run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
              status: AIRunStatus.Running,
            }),
            run(hoursAgo(2), alert("b", { monitorIds: [CPU_MONITOR] }), {
              status: AIRunStatus.Error,
            }),
            completed,
          ],
        }),
      ),
    ).toEqual([completed.aiRunId]);
  });

  test(`only for the ${AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS} problems shown`, () => {
    const investigations: Array<AiActivityInvestigationInput> = Array.from(
      { length: AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS + 5 },
      (_: unknown, index: number) => {
        return run(
          hoursAgo(index + 1),
          incident(`i-${index}`, { title: `P${index}` }),
        );
      },
    );

    expect(
      AiActivityInsightsBuilder.getRunsNeedingReportSummary(
        input({ investigations }),
      ),
    ).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS);
  });
});

describe("AiActivityInsightsBuilder.build", () => {
  describe("with nothing to go on", () => {
    test("says so with zeros and empty lists, a day per window day, and no attention", () => {
      const insights: AiActivityInsights = build({ isPartial: false });

      expect(insights.windowInDays).toBe(30);
      expect(insights.windowStart).toBe("2026-08-24T00:00:00.000Z");
      expect(insights.generatedAt).toBe(NOW.toISOString());
      expect(insights.totals).toEqual({
        investigations: 0,
        completedInvestigations: 0,
        failedInvestigations: 0,
        activeInvestigations: 0,
        problems: 0,
        recurringProblems: 0,
        fixes: 0,
        commands: 0,
        failedCommands: 0,
        timedOutCommands: 0,
      });
      expect(insights.attention).toEqual([]);
      expect(insights.problems).toEqual([]);
      expect(insights.hotspots).toEqual([]);
      expect(insights.preventiveInsights).toEqual([]);
      expect(insights.fixOutcomes.total).toBe(0);
      expect(insights.trend).toHaveLength(30);
      expect(insights.trend[0]!.date).toBe("2026-08-24");
      expect(insights.trend[29]!.date).toBe("2026-09-22");
      expect(insights.isPartial).toBe(false);
    });

    test("passes on that the reader could not read everything", () => {
      expect(build({ isPartial: true }).isPartial).toBe(true);
    });
  });

  describe("totals", () => {
    test("count the window's investigations by how they ended, and the commands as read", () => {
      const insights: AiActivityInsights = build({
        investigations: [
          run(hoursAgo(1), alert("a")),
          run(hoursAgo(2), alert("b"), { status: AIRunStatus.Error }),
          run(hoursAgo(3), alert("c"), { status: AIRunStatus.Stale }),
          run(hoursAgo(4), alert("d"), { status: AIRunStatus.Running }),
          run(hoursAgo(5), alert("e"), { status: AIRunStatus.Queued }),
          run(hoursAgo(6), alert("f"), {
            status: AIRunStatus.WaitingForApproval,
          }),
          run(hoursAgo(7), alert("g"), { status: AIRunStatus.Cancelled }),
          run(hoursAgo(8), undefined),
          // Before the window: not counted at all.
          run(daysAgo(31), alert("h")),
        ],
        commands: { total: 40, failed: 6, timedOut: 2 },
      });

      expect(insights.totals).toEqual(
        expect.objectContaining({
          investigations: 8,
          completedInvestigations: 2,
          failedInvestigations: 2,
          activeInvestigations: 3,
          commands: 40,
          failedCommands: 6,
          timedOutCommands: 2,
        }),
      );
    });

    test("never go below zero", () => {
      expect(
        build({ commands: { total: -1, failed: -2, timedOut: -3 } }).totals,
      ).toEqual(
        expect.objectContaining({
          commands: 0,
          failedCommands: 0,
          timedOutCommands: 0,
        }),
      );
    });

    test("count problems, recurring ones and the window's fixes", () => {
      const insights: AiActivityInsights = build({
        investigations: screenshotCluster(),
        fixes: [fix(hoursAgo(1)), fix(hoursAgo(2)), fix(daysAgo(45))],
      });

      expect(insights.totals.problems).toBe(5);
      expect(insights.totals.recurringProblems).toBe(1);
      expect(insights.totals.fixes).toBe(2);
    });
  });

  describe("problems", () => {
    test("name the problem without the series identity, and what it fired for", () => {
      const problem: AiActivityProblem = build({
        investigations: screenshotCluster(),
      }).problems[0]!;

      expect(problem.title).toBe(
        "[K8s] Deployment Replica Mismatch - oneuptime-test",
      );
      expect(problem.investigationCount).toBe(2);
      expect(problem.subjectCount).toBe(2);
      expect(problem.isRecurring).toBe(true);
      expect(problem.latestSubject).toEqual({
        kind: "alert",
        id: "replica-home",
        title:
          "[K8s] Deployment Replica Mismatch - oneuptime-test - Deployment: oneuptime-home | Namespace: default",
      });
      expect(problem.objects).toEqual([
        { name: "Deployment", value: "oneuptime-home", count: 1 },
        { name: "Deployment", value: "oneuptime-worker", count: 1 },
      ]);
      expect(problem.firstSeenAt).toBe(hoursAgo(1.1).toISOString());
      expect(problem.lastSeenAt).toBe(hoursAgo(1).toISOString());
      expect(problem.key).toMatch(/^problem-/);
    });

    test("a problem seen once is not recurring, and keeps its incident number", () => {
      const problems: Array<AiActivityProblem> = build({
        investigations: screenshotCluster(),
      }).problems;
      const manual: AiActivityProblem = problems.find(
        (problem: AiActivityProblem): boolean => {
          return problem.title === "ghfghgf";
        },
      )!;

      expect(manual.isRecurring).toBe(false);
      expect(manual.latestSubject).toEqual({
        kind: "incident",
        id: "incident-2",
        title: "ghfghgf",
        number: 2,
      });
      expect(manual.objects).toEqual([]);
    });

    test("the same alert investigated again counts each time, but as one subject", () => {
      const subject: AiActivitySubjectInput = alert("flapping", {
        monitorIds: [CPU_MONITOR],
        seriesLabels: { "k8s.pod.name": "web-1" },
      });
      const problem: AiActivityProblem = build({
        investigations: [
          run(hoursAgo(1), subject),
          run(hoursAgo(2), subject),
          run(hoursAgo(3), subject),
        ],
      }).problems[0]!;

      expect(problem.investigationCount).toBe(3);
      expect(problem.subjectCount).toBe(1);
      expect(problem.objects).toEqual([
        { name: "Pod", value: "web-1", count: 1 },
      ]);
    });

    test("name at most three parts, the most frequent first", () => {
      const investigations: Array<AiActivityInvestigationInput> = [
        "a",
        "b",
        "b",
        "c",
        "c",
        "c",
        "d",
      ].map((pod: string, index: number) => {
        return run(
          hoursAgo(index + 1),
          alert(`alert-${index}`, {
            monitorIds: [CPU_MONITOR],
            seriesLabels: { "k8s.pod.name": pod },
          }),
        );
      });

      expect(
        build({ investigations }).problems[0]!.objects.map(
          (object: { value: string; count: number }) => {
            return [object.value, object.count];
          },
        ),
      ).toEqual([
        ["c", 3],
        ["b", 2],
        ["a", 1],
      ]);
    });

    test(`at most ${AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS}, the most investigated first`, () => {
      const investigations: Array<AiActivityInvestigationInput> = [];

      for (let index: number = 0; index < 14; index++) {
        investigations.push(
          run(
            hoursAgo(index + 1),
            incident(`i-${index}`, { title: `P${index}` }),
          ),
        );
      }

      investigations.push(
        run(hoursAgo(40), incident("again-1", { title: "P13" })),
      );

      const problems: Array<AiActivityProblem> = build({
        investigations,
      }).problems;

      expect(problems).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS);
      expect(problems[0]!.title).toBe("P13");
      expect(problems[0]!.investigationCount).toBe(2);
    });

    test("leave out investigations with no incident or alert", () => {
      const insights: AiActivityInsights = build({
        investigations: [run(hoursAgo(1), undefined, { tldr: "Triage." })],
      });

      expect(insights.problems).toEqual([]);
      expect(insights.totals.investigations).toBe(1);
    });

    describe("what the investigations concluded", () => {
      test("the newest completed investigation's TL;DR", () => {
        const subject: AiActivitySubjectInput = alert("a", {
          monitorIds: [CPU_MONITOR],
        });
        const newest: AiActivityInvestigationInput = run(hoursAgo(1), subject, {
          tldr: "The CPU limit is too low for the new release.",
        });

        expect(
          build({
            investigations: [
              newest,
              run(hoursAgo(2), subject, { tldr: "An older finding." }),
            ],
          }).problems[0]!.latestFinding,
        ).toEqual({
          aiRunId: newest.aiRunId,
          text: "The CPU limit is too low for the new release.",
          source: "tldr",
          at: newest.completedAt!.toISOString(),
        });
      });

      test("its report's own summary when its TL;DR call failed", () => {
        const newest: AiActivityInvestigationInput = run(
          hoursAgo(1),
          alert("a", { monitorIds: [CPU_MONITOR] }),
          { reportSummary: "The pod hits its 500m CPU limit at every deploy." },
        );

        expect(
          build({ investigations: [newest] }).problems[0]!.latestFinding,
        ).toEqual(
          expect.objectContaining({
            aiRunId: newest.aiRunId,
            text: "The pod hits its 500m CPU limit at every deploy.",
            source: "report",
          }),
        );
      });

      test("the TL;DR over the report's summary on the same run", () => {
        expect(
          build({
            investigations: [
              run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
                tldr: "TL;DR.",
                reportSummary: "Summary.",
              }),
            ],
          }).problems[0]!.latestFinding!.source,
        ).toBe("tldr");
      });

      test("an older finding when the newest investigations have none", () => {
        const subject: AiActivitySubjectInput = alert("a", {
          monitorIds: [CPU_MONITOR],
        });
        const older: AiActivityInvestigationInput = run(hoursAgo(3), subject, {
          tldr: "Found it the first time.",
        });

        expect(
          build({
            investigations: [
              run(hoursAgo(1), subject, { status: AIRunStatus.Running }),
              run(hoursAgo(2), subject),
              older,
            ],
          }).problems[0]!.latestFinding!.aiRunId,
        ).toBe(older.aiRunId);
      });

      test("never from an investigation that did not complete, and none at all without one", () => {
        expect(
          build({
            investigations: [
              run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
                status: AIRunStatus.Error,
                tldr: "A half-written finding.",
              }),
            ],
          }).problems[0]!.latestFinding,
        ).toBeUndefined();
      });

      test("blank text is no finding", () => {
        expect(
          build({
            investigations: [
              run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
                tldr: "   ",
                reportSummary: "",
              }),
            ],
          }).problems[0]!.latestFinding,
        ).toBeUndefined();
      });
    });

    test("count what people and the grader said of its findings", () => {
      const subject: AiActivitySubjectInput = incident("a", {
        monitorIds: [CPU_MONITOR],
      });

      expect(
        build({
          investigations: [
            run(hoursAgo(1), subject, {
              humanVerdict: AIRunHumanVerdict.Confirmed,
              autoGrade: AIRunAutoGrade.Match,
            }),
            run(hoursAgo(2), subject, {
              humanVerdict: AIRunHumanVerdict.Rejected,
              autoGrade: AIRunAutoGrade.Mismatch,
            }),
            run(hoursAgo(3), subject, { autoGrade: AIRunAutoGrade.Partial }),
            run(hoursAgo(4), subject),
          ],
        }).problems[0]!.verdicts,
      ).toEqual({
        confirmed: 1,
        rejected: 1,
        matched: 1,
        partlyMatched: 1,
        mismatched: 1,
      });
    });

    test("count the fixes proposed for its incidents and alerts, and how they went", () => {
      const insights: AiActivityInsights = build({
        investigations: [
          run(hoursAgo(1), incident("inc-a", { monitorIds: [CPU_MONITOR] })),
          run(hoursAgo(2), alert("alert-b", { monitorIds: [CPU_MONITOR] })),
          run(
            hoursAgo(3),
            alert("alert-other", { monitorIds: [PENDING_MONITOR] }),
          ),
        ],
        fixes: [
          fix(hoursAgo(1), {
            incidentId: "inc-a",
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          }),
          fix(hoursAgo(1), {
            alertId: "alert-b",
            status: AutoRemediationSuggestionStatus.Approved,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          }),
          fix(hoursAgo(1), { alertId: "alert-b" }),
          fix(hoursAgo(1), {
            alertId: "alert-b",
            status: AutoRemediationSuggestionStatus.Dismissed,
          }),
          // Another problem's, and one whose subject is not here at all.
          fix(hoursAgo(1), { alertId: "alert-other" }),
          fix(hoursAgo(1), { incidentId: "unknown" }),
        ],
      });

      const cpu: AiActivityProblem = insights.problems.find(
        (problem: AiActivityProblem): boolean => {
          return problem.investigationCount === 2;
        },
      )!;

      expect(cpu.fixes).toEqual({
        proposed: 4,
        applied: 2,
        verified: 1,
        failed: 1,
        awaitingApproval: 1,
      });
    });
  });

  describe("hotspots", () => {
    test("the parts of the scope in two investigations or more, most first", () => {
      const insights: AiActivityInsights = build({
        investigations: screenshotCluster(),
      });

      expect(insights.hotspots).toEqual([
        {
          name: "Namespace",
          value: "default",
          investigationCount: 3,
          problemCount: 2,
          lastSeenAt: hoursAgo(1).toISOString(),
        },
      ]);
    });

    test("never the scope itself", () => {
      const names: Array<string> = build({
        investigations: screenshotCluster(),
      }).hotspots.map((hotspot: { value: string }) => {
        return hotspot.value;
      });

      expect(names).not.toContain(CLUSTER_NAME);
    });

    test("ties go to the part seen in more problems, then the most recent", () => {
      const insights: AiActivityInsights = build({
        investigations: [
          run(
            hoursAgo(1),
            alert("a", {
              monitorIds: [CPU_MONITOR],
              seriesLabels: { "k8s.node.name": "node-a" },
            }),
          ),
          run(
            hoursAgo(2),
            alert("b", {
              monitorIds: [REPLICA_MONITOR],
              seriesLabels: { "k8s.node.name": "node-a" },
            }),
          ),
          run(
            hoursAgo(3),
            alert("c", {
              monitorIds: [CPU_MONITOR],
              seriesLabels: { "k8s.node.name": "node-b" },
            }),
          ),
          run(
            hoursAgo(4),
            alert("d", {
              monitorIds: [CPU_MONITOR],
              seriesLabels: { "k8s.node.name": "node-b" },
            }),
          ),
        ],
      });

      expect(
        insights.hotspots.map(
          (hotspot: { value: string; problemCount: number }) => {
            return [hotspot.value, hotspot.problemCount];
          },
        ),
      ).toEqual([
        ["node-a", 2],
        ["node-b", 1],
      ]);
    });

    test(`at most ${AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS}`, () => {
      const investigations: Array<AiActivityInvestigationInput> = [];

      for (let index: number = 0; index < 12; index++) {
        for (const copy of [0, 1]) {
          investigations.push(
            run(
              hoursAgo(index * 2 + copy + 1),
              alert(`a-${index}-${copy}`, {
                monitorIds: [CPU_MONITOR],
                seriesLabels: { "k8s.pod.name": `pod-${index}` },
              }),
            ),
          );
        }
      }

      expect(build({ investigations }).hotspots).toHaveLength(
        AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
      );
    });
  });

  test("fix outcomes count every fix of the window by where it ended up", () => {
    expect(
      build({
        fixes: [
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.Planning,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.Suggested,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.Approved,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.Approved,
            verificationStatus: AutoRemediationVerificationStatus.Pending,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Skipped,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.Dismissed,
          }),
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.NoneApplicable,
          }),
          fix(hoursAgo(1), { status: "SomethingNewer" }),
          fix(daysAgo(60), {
            status: AutoRemediationSuggestionStatus.Suggested,
          }),
        ],
      }).fixOutcomes,
    ).toEqual({
      total: 9,
      planning: 1,
      awaitingApproval: 1,
      appliedAutomatically: 2,
      appliedAfterApproval: 2,
      dismissed: 1,
      noFixFound: 1,
      verified: 1,
      failed: 1,
      verifying: 1,
    });
  });

  test("the trend counts each UTC day's investigations, failures and fixes", () => {
    const insights: AiActivityInsights = build({
      investigations: [
        run(new Date("2026-09-22T09:00:00.000Z"), alert("a")),
        run(new Date("2026-09-22T00:00:00.000Z"), alert("b"), {
          status: AIRunStatus.Error,
        }),
        run(new Date("2026-09-21T23:59:59.000Z"), alert("c"), {
          status: AIRunStatus.Stale,
        }),
        run(new Date("2026-08-24T00:00:00.000Z"), undefined),
        run(new Date("2026-08-23T23:59:59.000Z"), alert("before")),
      ],
      fixes: [
        fix(new Date("2026-09-21T12:00:00.000Z")),
        fix(new Date("2026-09-21T13:00:00.000Z")),
      ],
    });

    expect(insights.trend[29]).toEqual({
      date: "2026-09-22",
      investigations: 2,
      failedInvestigations: 1,
      fixes: 0,
    });
    expect(insights.trend[28]).toEqual({
      date: "2026-09-21",
      investigations: 1,
      failedInvestigations: 1,
      fixes: 2,
    });
    expect(insights.trend[0]).toEqual({
      date: "2026-08-24",
      investigations: 1,
      failedInvestigations: 0,
      fixes: 0,
    });
    expect(
      insights.trend.reduce((sum: number, day: { investigations: number }) => {
        return sum + day.investigations;
      }, 0),
    ).toBe(4);
  });

  test(`preventive insights: at most ${AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS}, the most severe and most recent first`, () => {
    const insights: AiActivityInsights = build({
      preventiveInsights: [
        preventive({
          id: "low",
          severity: AIInsightSeverity.Low,
          lastSeenAt: hoursAgo(0.1).toISOString(),
        }),
        preventive({
          id: "high-old",
          severity: AIInsightSeverity.High,
          lastSeenAt: hoursAgo(10).toISOString(),
        }),
        preventive({
          id: "medium",
          severity: AIInsightSeverity.Medium,
          lastSeenAt: hoursAgo(1).toISOString(),
        }),
        preventive({
          id: "high-new",
          severity: AIInsightSeverity.High,
          lastSeenAt: hoursAgo(2).toISOString(),
        }),
        preventive({ id: "unknown", severity: "Critical" }),
        preventive({ id: "low-2", severity: AIInsightSeverity.Low }),
      ],
    });

    expect(
      insights.preventiveInsights.map(
        (insight: AiActivityPreventiveInsight) => {
          return insight.id;
        },
      ),
    ).toEqual(["high-new", "high-old", "medium", "low", "low-2"]);
  });

  describe("attention", () => {
    test("nothing when nothing needs it", () => {
      expect(
        build({
          investigations: [
            run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
              tldr: "Fine.",
            }),
          ],
          fixes: [
            fix(hoursAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
          ],
          commands: { total: 10, failed: 1, timedOut: 0 },
        }).attention,
      ).toEqual([]);
    });

    test("fixes that did not fix it come first, linked to their readable incident", () => {
      const items: Array<AiActivityAttentionItem> = build({
        investigations: [run(hoursAgo(1), incident("inc-a"))],
        fixes: [
          fix(hoursAgo(1), {
            incidentId: "inc-a",
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          }),
          fix(hoursAgo(2), {
            status: AutoRemediationSuggestionStatus.Approved,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          }),
        ],
      }).attention;

      expect(items[0]).toEqual({
        kind: AiActivityAttentionKind.FixesFailed,
        severity: AiActivityAttentionSeverity.High,
        count: 1,
        total: 2,
        subject: { kind: "incident", id: "inc-a", title: "Incident inc-a" },
      });
    });

    test("never links an incident or alert the caller could not read", () => {
      const items: Array<AiActivityAttentionItem> = build({
        fixes: [
          fix(hoursAgo(1), {
            incidentId: "hidden",
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          }),
          fix(hoursAgo(1), { alertId: "hidden-alert" }),
        ],
      }).attention;

      for (const item of items) {
        expect(item.subject).toBeUndefined();
      }
      expect(items).toHaveLength(2);
    });

    test("a problem investigated three times is worth a look; five times, or three this week, urgently", () => {
      const subject: (id: string) => AiActivitySubjectInput = (
        id: string,
      ): AiActivitySubjectInput => {
        return alert(id, {
          monitorIds: [REPLICA_MONITOR],
          title: "Replica mismatch",
        });
      };

      const spreadOut: AiActivityAttentionItem = attentionOf(
        build({
          investigations: [
            run(daysAgo(10), subject("a")),
            run(daysAgo(12), subject("b")),
            run(daysAgo(14), subject("c")),
          ],
        }),
        AiActivityAttentionKind.RecurringProblem,
      )[0]!;

      expect(spreadOut.severity).toBe(AiActivityAttentionSeverity.Medium);
      expect(spreadOut.count).toBe(3);
      expect(spreadOut.recentCount).toBe(0);
      expect(spreadOut.title).toBe("Replica mismatch");
      expect(spreadOut.subject).toEqual({
        kind: "alert",
        id: "a",
        title: "Replica mismatch",
      });

      const thisWeek: AiActivityAttentionItem = attentionOf(
        build({
          investigations: [
            run(daysAgo(1), subject("a")),
            run(daysAgo(2), subject("b")),
            run(daysAgo(3), subject("c")),
          ],
        }),
        AiActivityAttentionKind.RecurringProblem,
      )[0]!;
      expect(thisWeek.severity).toBe(AiActivityAttentionSeverity.High);
      expect(thisWeek.recentCount).toBe(3);

      const often: AiActivityAttentionItem = attentionOf(
        build({
          investigations: [10, 11, 12, 13, 14].map((days: number) => {
            return run(daysAgo(days), subject(`s-${days}`));
          }),
        }),
        AiActivityAttentionKind.RecurringProblem,
      )[0]!;
      expect(often.severity).toBe(AiActivityAttentionSeverity.High);
    });

    test("twice is a recurring problem on the list, not yet worth attention; at most two make it", () => {
      expect(
        attentionOf(
          build({ investigations: screenshotCluster() }),
          AiActivityAttentionKind.RecurringProblem,
        ),
      ).toEqual([]);

      const investigations: Array<AiActivityInvestigationInput> = [];
      for (const monitor of [CPU_MONITOR, REPLICA_MONITOR, PENDING_MONITOR]) {
        for (const days of [10, 11, 12]) {
          investigations.push(
            run(
              daysAgo(days),
              alert(`${monitor}-${days}`, { monitorIds: [monitor] }),
            ),
          );
        }
      }

      expect(
        attentionOf(
          build({ investigations }),
          AiActivityAttentionKind.RecurringProblem,
        ),
      ).toHaveLength(2);
    });

    test("open High and Medium preventive insights, at most two; Low ones wait in their card", () => {
      const items: Array<AiActivityAttentionItem> = attentionOf(
        build({
          preventiveInsights: [
            preventive({ id: "low", severity: AIInsightSeverity.Low }),
            preventive({ id: "medium", severity: AIInsightSeverity.Medium }),
            preventive({
              id: "high",
              severity: AIInsightSeverity.High,
              occurrenceCount: 7,
            }),
            preventive({ id: "high-2", severity: AIInsightSeverity.High }),
          ],
        }),
        AiActivityAttentionKind.PreventiveInsight,
      );

      expect(
        items.map((item: AiActivityAttentionItem) => {
          return [item.insightId, item.severity];
        }),
      ).toEqual([
        ["high", AiActivityAttentionSeverity.High],
        ["high-2", AiActivityAttentionSeverity.High],
      ]);
      expect(items[0]!.count).toBe(7);
      expect(items[0]!.title).toBe("Error-log spike: 6.0x normal volume");
      expect(items[0]!.insightSeverity).toBe(AIInsightSeverity.High);
    });

    test("fixes waiting for approval, linked to the newest one's incident or alert", () => {
      expect(
        attentionOf(
          build({
            investigations: [run(hoursAgo(1), alert("alert-a"))],
            fixes: [
              fix(hoursAgo(1), { alertId: "alert-a" }),
              fix(hoursAgo(2), { alertId: "alert-other" }),
            ],
          }),
          AiActivityAttentionKind.FixesAwaitingApproval,
        ),
      ).toEqual([
        {
          kind: AiActivityAttentionKind.FixesAwaitingApproval,
          severity: AiActivityAttentionSeverity.Medium,
          count: 2,
          subject: { kind: "alert", id: "alert-a", title: "Alert alert-a" },
        },
      ]);
    });

    test("failed investigations: worth a look, urgent when most of them fail", () => {
      const some: AiActivityAttentionItem = attentionOf(
        build({
          investigations: [
            run(hoursAgo(1), alert("a"), { status: AIRunStatus.Error }),
            run(hoursAgo(2), alert("b")),
            run(hoursAgo(3), alert("c")),
          ],
        }),
        AiActivityAttentionKind.InvestigationsFailed,
      )[0]!;

      expect(some).toEqual({
        kind: AiActivityAttentionKind.InvestigationsFailed,
        severity: AiActivityAttentionSeverity.Medium,
        count: 1,
        total: 3,
        subject: { kind: "alert", id: "a", title: "Alert a" },
      });

      expect(
        attentionOf(
          build({
            investigations: [
              run(hoursAgo(1), undefined, { status: AIRunStatus.Error }),
              run(hoursAgo(2), alert("b"), { status: AIRunStatus.Stale }),
              run(hoursAgo(3), alert("c"), { status: AIRunStatus.Error }),
              run(hoursAgo(4), alert("d")),
            ],
          }),
          AiActivityAttentionKind.InvestigationsFailed,
        )[0]!.severity,
      ).toBe(AiActivityAttentionSeverity.High);
    });

    test("commands the agent never ran", () => {
      expect(
        attentionOf(
          build({ commands: { total: 20, failed: 3, timedOut: 4 } }),
          AiActivityAttentionKind.CommandsTimedOut,
        ),
      ).toEqual([
        {
          kind: AiActivityAttentionKind.CommandsTimedOut,
          severity: AiActivityAttentionSeverity.Medium,
          count: 4,
          total: 20,
        },
      ]);
    });

    test("findings people rejected, or the grader found wrong", () => {
      expect(
        attentionOf(
          build({
            investigations: [
              run(hoursAgo(1), incident("a"), {
                humanVerdict: AIRunHumanVerdict.Rejected,
              }),
              run(hoursAgo(2), incident("b"), {
                autoGrade: AIRunAutoGrade.Mismatch,
              }),
              run(hoursAgo(3), incident("c"), {
                humanVerdict: AIRunHumanVerdict.Confirmed,
              }),
            ],
          }),
          AiActivityAttentionKind.FindingsRejected,
        ),
      ).toEqual([
        {
          kind: AiActivityAttentionKind.FindingsRejected,
          severity: AiActivityAttentionSeverity.Low,
          count: 2,
          total: 3,
          subject: { kind: "incident", id: "a", title: "Incident a" },
        },
      ]);
    });

    test("one part of the scope in most investigations", () => {
      const investigations: Array<AiActivityInvestigationInput> = [
        "a",
        "b",
        "c",
      ].map((id: string, index: number) => {
        return run(
          hoursAgo(index + 1),
          alert(id, {
            monitorIds: [`monitor-${id}`],
            seriesLabels: { "k8s.namespace.name": "payments" },
          }),
        );
      });
      investigations.push(run(hoursAgo(9), alert("d")));

      expect(
        attentionOf(build({ investigations }), AiActivityAttentionKind.Hotspot),
      ).toEqual([
        {
          kind: AiActivityAttentionKind.Hotspot,
          severity: AiActivityAttentionSeverity.Low,
          count: 3,
          total: 4,
          object: { name: "Namespace", value: "payments" },
        },
      ]);

      // Not when it is a small share of what AI looked at.
      for (const id of ["e", "f", "g", "h"]) {
        investigations.push(run(hoursAgo(10), alert(id)));
      }
      expect(
        attentionOf(build({ investigations }), AiActivityAttentionKind.Hotspot),
      ).toEqual([]);
    });

    test(`most important first, at most ${AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS}`, () => {
      const subject: (id: string) => AiActivitySubjectInput = (
        id: string,
      ): AiActivitySubjectInput => {
        return alert(id, {
          monitorIds: [REPLICA_MONITOR],
          seriesLabels: { "k8s.namespace.name": "payments" },
        });
      };

      const insights: AiActivityInsights = build({
        investigations: [
          run(daysAgo(10), subject("a"), {
            humanVerdict: AIRunHumanVerdict.Rejected,
          }),
          run(daysAgo(11), subject("b"), { status: AIRunStatus.Error }),
          run(daysAgo(12), subject("c")),
        ],
        fixes: [
          fix(hoursAgo(1), { alertId: "a" }),
          fix(hoursAgo(2), {
            alertId: "b",
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          }),
        ],
        commands: { total: 5, failed: 0, timedOut: 1 },
        preventiveInsights: [
          preventive({ severity: AIInsightSeverity.Medium }),
        ],
      });

      expect(insights.attention).toHaveLength(
        AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS,
      );
      expect(
        insights.attention.map((item: AiActivityAttentionItem) => {
          return item.kind;
        }),
      ).toEqual([
        AiActivityAttentionKind.FixesFailed,
        AiActivityAttentionKind.RecurringProblem,
        AiActivityAttentionKind.PreventiveInsight,
        AiActivityAttentionKind.FixesAwaitingApproval,
        AiActivityAttentionKind.InvestigationsFailed,
        AiActivityAttentionKind.CommandsTimedOut,
      ]);
    });
  });

  test("the same rows give the same insights, in whatever order they come", () => {
    const investigations: Array<AiActivityInvestigationInput> =
      screenshotCluster();

    const first: AiActivityInsights = build({ investigations });
    const second: AiActivityInsights = build({
      investigations: [...investigations].reverse(),
    });

    expect(second).toEqual(first);
  });
});

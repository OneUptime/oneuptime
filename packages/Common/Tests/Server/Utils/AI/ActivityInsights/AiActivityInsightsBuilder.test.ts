import AiActivityInsightsBuilder, {
  AiActivityFixInput,
  AiActivityInsightsInput,
  AiActivityInvestigationInput,
  AiActivityOccurrence,
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
  AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE,
  AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS,
  AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS,
  AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_RISK_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_MAX_STOPPED_INSIGHTS,
  AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS,
  AiActivityHotspot,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivityTimeOfDay,
} from "../../../../../Types/AI/AiActivityInsights";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of every AI Insights page. These tests pin how it reads a
 * scope's month: every incident and alert that came up, grouped into
 * problems by what raised them, how often each happened and whether it is
 * getting worse, when in the day it tends to start, the parts of the scope
 * behind them, what the investigations concluded (the TL;DR, else the
 * report's own summary) and the step they suggest, how fixes turned out,
 * the trend — and, above all, the insights the page leads with, ranked. All
 * derived, nothing invented, the same input always giving the same
 * insights.
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
const MEMORY_MONITOR: string = "aaaaaaaa-0000-4000-8000-000000000004";

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

// A UTC day before NOW at a given hour and minute.
function dayAt(daysBack: number, hourUtc: number, minute: number = 5): Date {
  const day: Date = daysAgo(daysBack);
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hourUtc,
      minute,
    ),
  );
}

function deploymentLabels(deployment: string, namespace: string): JSONObject {
  return {
    "resource.k8s.cluster.name": CLUSTER_NAME,
    "resource.k8s.namespace.name": namespace,
    "resource.k8s.deployment.name": deployment,
  };
}

function nodeLabels(node: string): JSONObject {
  return {
    "resource.k8s.cluster.name": CLUSTER_NAME,
    "resource.k8s.node.name": node,
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

function insightsOf(
  insights: AiActivityInsights,
  kind: AiActivityInsightKind,
): Array<AiActivityInsight> {
  return insights.insights.filter((insight: AiActivityInsight): boolean => {
    return insight.kind === kind;
  });
}

/*
 * The alerts of one monitor at the given days back (and hours), each
 * created then: everything that came up for that problem.
 */
function firings(data: {
  prefix: string;
  monitorId: string;
  at: Array<Date>;
  title?: string | undefined;
  seriesLabels?: JSONObject | undefined;
}): Array<AiActivitySubjectInput> {
  return data.at.map((createdAt: Date, index: number) => {
    return alert(`${data.prefix}-${index}`, {
      monitorIds: [data.monitorId],
      title: data.title || `Problem ${data.prefix}`,
      createdAt,
      ...(data.seriesLabels ? { seriesLabels: data.seriesLabels } : {}),
    });
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

  test("names the parts of the scope, most identifying first, with the label each was read from", () => {
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
      { name: "Container", value: "app", key: "k8s.container.name" },
      { name: "Pod", value: "web-7d9f", key: "k8s.pod.name" },
      { name: "Namespace", value: "shop", key: "k8s.namespace.name" },
      { name: "Node", value: "node-a", key: "k8s.node.name" },
    ]);
  });

  test("the label is the same with or without the resource. prefix", () => {
    expect(
      AiActivityInsightsBuilder.getScopeObjects(
        { "k8s.node.name": "node-a" },
        scope,
      ),
    ).toEqual(
      AiActivityInsightsBuilder.getScopeObjects(
        { "resource.k8s.node.name": "node-a" },
        scope,
      ),
    );
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
    ).toEqual([
      { name: "Namespace", value: "shop", key: "k8s.namespace.name" },
    ]);
  });

  test("leaves out any label whose value is the scope's own name, in any case", () => {
    expect(
      AiActivityInsightsBuilder.getScopeObjects(
        { "host.name": "OneUptime-Test", "k8s.namespace.name": "shop" },
        scope,
      ),
    ).toEqual([
      { name: "Namespace", value: "shop", key: "k8s.namespace.name" },
    ]);
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
    ).toEqual([{ name: "Mount", value: "/var", key: "mountpoint" }]);
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

describe("AiActivityInsightsBuilder.getOccurrences", () => {
  function ids(occurrences: Array<AiActivityOccurrence>): Array<string> {
    return occurrences.map((occurrence: AiActivityOccurrence): string => {
      return occurrence.subject.id;
    });
  }

  test("every incident and alert of the window once, newest first, with when it came up and its problem", () => {
    const occurrences: Array<AiActivityOccurrence> =
      AiActivityInsightsBuilder.getOccurrences(
        input({
          occurrences: [
            alert("a", { monitorIds: [CPU_MONITOR], createdAt: hoursAgo(5) }),
            alert("b", { monitorIds: [CPU_MONITOR], createdAt: hoursAgo(2) }),
            // The same alert read twice: once.
            alert("b", { monitorIds: [CPU_MONITOR], createdAt: hoursAgo(2) }),
          ],
          // Its investigation adds nothing new.
          investigations: [
            run(
              hoursAgo(1),
              alert("b", { monitorIds: [CPU_MONITOR], createdAt: hoursAgo(2) }),
            ),
          ],
        }),
      );

    expect(ids(occurrences)).toEqual(["b", "a"]);
    expect(occurrences[0]!.at).toEqual(hoursAgo(2));
    expect(occurrences[0]!.problemKey).toBe(`monitor:${CPU_MONITOR}`);
  });

  test("leaves out what came up before the window, and what has no time to place it", () => {
    expect(
      ids(
        AiActivityInsightsBuilder.getOccurrences(
          input({
            occurrences: [
              alert("old", { createdAt: daysAgo(40) }),
              alert("timeless"),
              alert("now", { createdAt: hoursAgo(1) }),
            ],
          }),
        ),
      ),
    ).toEqual(["now"]);
  });

  test("an investigated incident the reader did not list came up when it was created", () => {
    const occurrences: Array<AiActivityOccurrence> =
      AiActivityInsightsBuilder.getOccurrences(
        input({
          investigations: [
            run(hoursAgo(3), incident("i", { createdAt: hoursAgo(4) })),
          ],
        }),
      );

    expect(ids(occurrences)).toEqual(["i"]);
    expect(occurrences[0]!.at).toEqual(hoursAgo(4));
  });

  test("one from before the window that AI investigated in it came up, here, when it was first investigated", () => {
    const old: AiActivitySubjectInput = incident("old", {
      createdAt: daysAgo(40),
    });
    const occurrences: Array<AiActivityOccurrence> =
      AiActivityInsightsBuilder.getOccurrences(
        input({
          investigations: [run(hoursAgo(2), old), run(hoursAgo(10), old)],
        }),
      );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.at).toEqual(hoursAgo(10));
  });

  test("one with no creation time came up when it was first investigated", () => {
    const occurrences: Array<AiActivityOccurrence> =
      AiActivityInsightsBuilder.getOccurrences(
        input({
          investigations: [
            run(hoursAgo(1), alert("x")),
            run(hoursAgo(6), alert("x")),
          ],
        }),
      );

    expect(occurrences[0]!.at).toEqual(hoursAgo(6));
  });

  test("runs from before the window, or about no incident or alert, add nothing", () => {
    expect(
      AiActivityInsightsBuilder.getOccurrences(
        input({
          investigations: [
            run(daysAgo(45), alert("old")),
            run(hoursAgo(1), undefined),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("ties on time are ordered by id, so the same rows always read the same", () => {
    expect(
      ids(
        AiActivityInsightsBuilder.getOccurrences(
          input({
            occurrences: [
              alert("z", { createdAt: hoursAgo(1) }),
              alert("a", { createdAt: hoursAgo(1) }),
            ],
          }),
        ),
      ),
    ).toEqual(["a", "z"]);
  });
});

describe("AiActivityInsightsBuilder.groupProblems", () => {
  test("groups by what raised the subject: the most often it came up first", () => {
    const groups: Array<{ key: string; runs: Array<{ aiRunId: string }> }> =
      AiActivityInsightsBuilder.groupProblems(
        input({
          occurrences: firings({
            prefix: "cpu",
            monitorId: CPU_MONITOR,
            at: [hoursAgo(1), hoursAgo(2), hoursAgo(3)],
          }),
          investigations: [
            run(hoursAgo(1), alert("cpu-0", { monitorIds: [CPU_MONITOR] })),
            run(hoursAgo(4), alert("r-1", { monitorIds: [REPLICA_MONITOR] })),
            run(hoursAgo(5), alert("r-1", { monitorIds: [REPLICA_MONITOR] })),
            run(hoursAgo(6), alert("r-2", { monitorIds: [REPLICA_MONITOR] })),
            run(hoursAgo(0.5), alert("p", { monitorIds: [PENDING_MONITOR] })),
          ],
        }),
      );

    // Three times, then twice (investigated three times), then once.
    expect(
      groups.map((group: { key: string }): string => {
        return group.key;
      }),
    ).toEqual([
      `monitor:${CPU_MONITOR}`,
      `monitor:${REPLICA_MONITOR}`,
      `monitor:${PENDING_MONITOR}`,
    ]);
  });

  test("of problems that came up as often, the most investigated first, then the newest", () => {
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

  test("a problem nobody investigated is no group: there is nothing it was found to be", () => {
    expect(
      AiActivityInsightsBuilder.groupProblems(
        input({
          occurrences: firings({
            prefix: "x",
            monitorId: CPU_MONITOR,
            at: [hoursAgo(1), hoursAgo(2)],
          }),
        }),
      ),
    ).toEqual([]);
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

describe("AiActivityInsightsBuilder.getRunsNeedingReport", () => {
  test("names each problem's newest completed run, for the step its report suggests", () => {
    const newest: AiActivityInvestigationInput = run(
      hoursAgo(1),
      alert("a", { monitorIds: [CPU_MONITOR] }),
      { tldr: "The CPU limit is too low." },
    );
    const older: AiActivityInvestigationInput = run(
      hoursAgo(5),
      alert("b", { monitorIds: [CPU_MONITOR] }),
    );

    expect(
      AiActivityInsightsBuilder.getRunsNeedingReport(
        input({ investigations: [older, newest] }),
      ),
    ).toEqual([newest.aiRunId]);
  });

  test("and when its TL;DR call failed, for its finding too", () => {
    const newest: AiActivityInvestigationInput = run(
      hoursAgo(1),
      alert("a", { monitorIds: [CPU_MONITOR] }),
    );

    expect(
      AiActivityInsightsBuilder.getRunsNeedingReport(
        input({ investigations: [newest] }),
      ),
    ).toEqual([newest.aiRunId]);
  });

  test("names nothing for a run whose finding and step are already known", () => {
    expect(
      AiActivityInsightsBuilder.getRunsNeedingReport(
        input({
          investigations: [
            run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
              tldr: "Found it.",
              nextStep: "Raise the limit.",
            }),
            run(hoursAgo(2), alert("b", { monitorIds: [REPLICA_MONITOR] }), {
              reportSummary: "Found it in the report.",
              nextStep: "Add a replica.",
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
      AiActivityInsightsBuilder.getRunsNeedingReport(
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

  test("a problem none of whose investigations completed names nothing", () => {
    expect(
      AiActivityInsightsBuilder.getRunsNeedingReport(
        input({
          investigations: [
            run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
              status: AIRunStatus.Stale,
            }),
          ],
        }),
      ),
    ).toEqual([]);
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
      AiActivityInsightsBuilder.getRunsNeedingReport(input({ investigations })),
    ).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS);
  });
});

describe("AiActivityInsightsBuilder.getTimeOfDay", () => {
  function at(days: Array<[number, number]>): Array<Date> {
    return days.map(([daysBack, hour]: [number, number]): Date => {
      return dayAt(daysBack, hour);
    });
  }

  test("says nothing for fewer than five times", () => {
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 2],
          [2, 2],
          [3, 2],
          [4, 2],
        ]),
      ),
    ).toBeUndefined();
  });

  test("says nothing for fewer than three days, however many times", () => {
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 2],
          [1, 2],
          [1, 3],
          [2, 2],
          [2, 2],
          [2, 3],
        ]),
      ),
    ).toBeUndefined();
  });

  test("names the busiest stretch, as tightly as it happened, with how much of it fell there", () => {
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 1],
          [5, 2],
          [6, 14],
        ]),
      ),
    ).toEqual({
      startHourUtc: 1,
      hours: 3,
      count: 5,
      total: 6,
      days: 5,
      totalDays: 6,
    });
  });

  test("a problem that keeps to two hours is said as two hours, from the first", () => {
    const timeOfDay: AiActivityTimeOfDay | undefined =
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 13],
          [2, 14],
          [3, 13],
          [4, 14],
          [5, 13],
        ]),
      );

    expect(timeOfDay).toEqual(
      expect.objectContaining({ startHourUtc: 13, hours: 2 }),
    );
  });

  test("a stretch may wrap past midnight", () => {
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 23],
          [2, 0],
          [3, 1],
          [4, 23],
          [5, 0],
        ]),
      ),
    ).toEqual(
      expect.objectContaining({ startHourUtc: 23, hours: 3, count: 5 }),
    );
  });

  test("a problem that fires all day long has no time of day", () => {
    const dates: Array<[number, number]> = [];

    for (const daysBack of [1, 2, 3, 4]) {
      for (const hour of [0, 6, 12, 18]) {
        dates.push([daysBack, hour]);
      }
    }

    expect(AiActivityInsightsBuilder.getTimeOfDay(at(dates))).toBeUndefined();
  });

  test("most of the days must fall in the stretch, not just most of the times", () => {
    // A burst at 14:00 on one day, and the rest at night on others.
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 14],
          [1, 14],
          [1, 14],
          [1, 14],
          [1, 14],
          [1, 14],
          [2, 3],
          [3, 3],
          [4, 9],
        ]),
      ),
    ).toBeUndefined();
  });

  test("three of four days, and three of five times, are just enough", () => {
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 2],
          [2, 2],
          [3, 2],
          [4, 10],
          [4, 16],
        ]),
      ),
    ).toEqual(
      expect.objectContaining({
        startHourUtc: 2,
        hours: 1,
        count: 3,
        total: 5,
        days: 3,
        totalDays: 4,
      }),
    );
  });

  test("two of four days are not", () => {
    expect(
      AiActivityInsightsBuilder.getTimeOfDay(
        at([
          [1, 2],
          [2, 2],
          [2, 2],
          [3, 10],
          [4, 16],
        ]),
      ),
    ).toBeUndefined();
  });
});

describe("AiActivityInsightsBuilder.isBehindTheTrouble", () => {
  test.each([
    // [occurrences of it, problems, everything, behind?]
    [3, 2, 6, true],
    [3, 2, 5, true],
    [3, 2, 7, false],
    [3, 3, 9, true],
    [2, 2, 3, false],
    [5, 1, 8, false],
    [6, 3, 6, false],
    [0, 0, 0, false],
  ])(
    "%i of everything in %i problems, out of %i: %s",
    (
      occurrenceCount: number,
      problemCount: number,
      occurrences: number,
      expected: boolean,
    ) => {
      expect(
        AiActivityInsightsBuilder.isBehindTheTrouble({
          occurrenceCount,
          problemCount,
          occurrences,
        }),
      ).toBe(expected);
    },
  );

  test("pickBehindTheTrouble: the one behind the most problems, then the most incidents, then the list's order", () => {
    const candidates: Array<{
      name: string;
      occurrenceCount: number;
      problemCount: number;
    }> = [
      { name: "namespace", occurrenceCount: 9, problemCount: 2 },
      { name: "node", occurrenceCount: 7, problemCount: 3 },
      { name: "pod", occurrenceCount: 7, problemCount: 3 },
      { name: "everything", occurrenceCount: 12, problemCount: 5 },
      { name: "lonely", occurrenceCount: 8, problemCount: 1 },
    ];

    expect(
      AiActivityInsightsBuilder.pickBehindTheTrouble(candidates, 12)?.name,
    ).toBe("node");
    expect(
      AiActivityInsightsBuilder.pickBehindTheTrouble([], 12),
    ).toBeUndefined();
    expect(
      AiActivityInsightsBuilder.pickBehindTheTrouble(
        [{ name: "lonely", occurrenceCount: 8, problemCount: 1 }],
        12,
      ),
    ).toBeUndefined();
  });
});

describe("AiActivityInsightsBuilder.rankInsights", () => {
  function insight(
    kind: AiActivityInsightKind,
    tone: AiActivityInsightTone,
    count: number = 1,
  ): AiActivityInsight {
    return { kind, tone, count };
  }

  function order(insights: Array<AiActivityInsight>): Array<string> {
    return insights.map((item: AiActivityInsight): string => {
      return `${item.tone}:${item.kind}:${item.count}`;
    });
  }

  test("by tone, then kind, then the larger count", () => {
    expect(
      order(
        AiActivityInsightsBuilder.rankInsights([
          insight(
            AiActivityInsightKind.FixedAutomatically,
            AiActivityInsightTone.Positive,
          ),
          insight(AiActivityInsightKind.Hotspot, AiActivityInsightTone.Pattern),
          insight(
            AiActivityInsightKind.FixesAwaitingApproval,
            AiActivityInsightTone.Warning,
          ),
          insight(
            AiActivityInsightKind.RiskSpotted,
            AiActivityInsightTone.Critical,
          ),
          insight(
            AiActivityInsightKind.RecurringProblem,
            AiActivityInsightTone.Critical,
            4,
          ),
          insight(
            AiActivityInsightKind.RecurringProblem,
            AiActivityInsightTone.Critical,
            9,
          ),
          insight(
            AiActivityInsightKind.FixesDidNotHelp,
            AiActivityInsightTone.Critical,
          ),
        ]),
      ),
    ).toEqual([
      "Critical:RecurringProblem:9",
      "Critical:RecurringProblem:4",
      "Critical:FixesDidNotHelp:1",
      "Critical:RiskSpotted:1",
      "Warning:FixesAwaitingApproval:1",
      "Pattern:Hotspot:1",
      "Positive:FixedAutomatically:1",
    ]);
  });

  test(`at most ${AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS}`, () => {
    const many: Array<AiActivityInsight> = Array.from(
      { length: 12 },
      (_: unknown, index: number) => {
        return insight(
          AiActivityInsightKind.RiskSpotted,
          AiActivityInsightTone.Critical,
          index,
        );
      },
    );

    expect(AiActivityInsightsBuilder.rankInsights(many)).toHaveLength(
      AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS,
    );
  });

  test("keeps the best pattern and the best good news when they would be cut, in place of the least important", () => {
    const critical: Array<AiActivityInsight> = Array.from(
      { length: AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS },
      (_: unknown, index: number) => {
        return insight(
          AiActivityInsightKind.RiskSpotted,
          AiActivityInsightTone.Critical,
          100 - index,
        );
      },
    );

    const ranked: Array<AiActivityInsight> =
      AiActivityInsightsBuilder.rankInsights([
        ...critical,
        insight(
          AiActivityInsightKind.ProblemStopped,
          AiActivityInsightTone.Positive,
          2,
        ),
        insight(
          AiActivityInsightKind.FixedAutomatically,
          AiActivityInsightTone.Positive,
          9,
        ),
        insight(
          AiActivityInsightKind.Hotspot,
          AiActivityInsightTone.Pattern,
          5,
        ),
      ]);

    expect(ranked).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS);
    // The six most important warnings, then the pattern, then the good news.
    expect(order(ranked).slice(-2)).toEqual([
      "Pattern:Hotspot:5",
      "Positive:ProblemStopped:2",
    ]);
    expect(order(ranked).slice(0, 6)).toEqual(
      order(critical.slice(0, AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS - 2)),
    );
  });

  test("never drops the pattern it kept to make room for good news", () => {
    const ranked: Array<AiActivityInsight> =
      AiActivityInsightsBuilder.rankInsights([
        ...Array.from(
          { length: AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS - 1 },
          (_: unknown, index: number) => {
            return insight(
              AiActivityInsightKind.RecurringProblem,
              AiActivityInsightTone.Warning,
              50 - index,
            );
          },
        ),
        insight(AiActivityInsightKind.Hotspot, AiActivityInsightTone.Pattern),
        insight(
          AiActivityInsightKind.FixedAutomatically,
          AiActivityInsightTone.Positive,
        ),
      ]);

    expect(
      ranked.map((item: AiActivityInsight): string => {
        return item.kind;
      }),
    ).toEqual(
      expect.arrayContaining([
        AiActivityInsightKind.Hotspot,
        AiActivityInsightKind.FixedAutomatically,
      ]),
    );
    expect(ranked).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS);
  });

  test("leaves a short list as it is, only ordered", () => {
    expect(
      order(
        AiActivityInsightsBuilder.rankInsights([
          insight(
            AiActivityInsightKind.ReadyForAutomaticFixes,
            AiActivityInsightTone.Positive,
          ),
          insight(
            AiActivityInsightKind.NotInvestigated,
            AiActivityInsightTone.Pattern,
          ),
        ]),
      ),
    ).toEqual([
      "Pattern:NotInvestigated:1",
      "Positive:ReadyForAutomaticFixes:1",
    ]);
    expect(AiActivityInsightsBuilder.rankInsights([])).toEqual([]);
  });
});

describe("AiActivityInsightsBuilder.build", () => {
  describe("with nothing to go on", () => {
    test("says so with zeros and empty lists, a day per window day, and no insight", () => {
      const insights: AiActivityInsights = build({ isPartial: false });

      expect(insights.windowInDays).toBe(30);
      expect(insights.windowStart).toBe("2026-08-24T00:00:00.000Z");
      expect(insights.generatedAt).toBe(NOW.toISOString());
      expect(insights.totals).toEqual({
        occurrences: 0,
        investigations: 0,
        completedInvestigations: 0,
        failedInvestigations: 0,
        activeInvestigations: 0,
        confirmedFindings: 0,
        rejectedFindings: 0,
        problems: 0,
        recurringProblems: 0,
        fixes: 0,
        commands: 0,
        failedCommands: 0,
        timedOutCommands: 0,
      });
      expect(insights.insights).toEqual([]);
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

    test("incidents and alerts nobody investigated make no problem and no insight", () => {
      const insights: AiActivityInsights = build({
        occurrences: firings({
          prefix: "x",
          monitorId: CPU_MONITOR,
          at: [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(4)],
        }),
      });

      expect(insights.totals.occurrences).toBe(4);
      expect(insights.problems).toEqual([]);
      expect(insights.insights).toEqual([]);
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

    test("count everything that came up: the reader's incidents and alerts, and the investigated ones it did not list", () => {
      const insights: AiActivityInsights = build({
        occurrences: [
          alert("a", { createdAt: hoursAgo(1) }),
          alert("b", { createdAt: hoursAgo(2) }),
        ],
        investigations: [
          run(hoursAgo(1), alert("a", { createdAt: hoursAgo(1) })),
          run(hoursAgo(3), incident("c", { createdAt: hoursAgo(4) })),
        ],
      });

      expect(insights.totals.occurrences).toBe(3);
    });

    test("count the findings people confirmed or the grader matched, and the ones they did not", () => {
      const insights: AiActivityInsights = build({
        investigations: [
          run(hoursAgo(1), alert("a"), {
            humanVerdict: AIRunHumanVerdict.Confirmed,
          }),
          run(hoursAgo(2), alert("b"), { autoGrade: AIRunAutoGrade.Match }),
          run(hoursAgo(3), alert("c"), { autoGrade: AIRunAutoGrade.Partial }),
          run(hoursAgo(4), alert("d"), {
            humanVerdict: AIRunHumanVerdict.Rejected,
          }),
          run(hoursAgo(5), alert("e"), { autoGrade: AIRunAutoGrade.Mismatch }),
          run(hoursAgo(6), alert("f")),
        ],
      });

      expect(insights.totals.confirmedFindings).toBe(3);
      expect(insights.totals.rejectedFindings).toBe(2);
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
      expect(problem.occurrenceCount).toBe(2);
      expect(problem.isRecurring).toBe(true);
      expect(problem.latestSubject).toEqual({
        kind: "alert",
        id: "replica-home",
        title:
          "[K8s] Deployment Replica Mismatch - oneuptime-test - Deployment: oneuptime-home | Namespace: default",
      });
      expect(problem.objects).toEqual([
        {
          name: "Deployment",
          value: "oneuptime-home",
          key: "k8s.deployment.name",
          count: 1,
        },
        {
          name: "Deployment",
          value: "oneuptime-worker",
          key: "k8s.deployment.name",
          count: 1,
        },
      ]);
      expect(problem.firstSeenAt).toBe(hoursAgo(1.1).toISOString());
      expect(problem.lastSeenAt).toBe(hoursAgo(1).toISOString());
      expect(problem.key).toMatch(/^problem-/);
    });

    test("count every time it came up, investigated or not, and when", () => {
      const problem: AiActivityProblem = build({
        occurrences: firings({
          prefix: "cpu",
          monitorId: CPU_MONITOR,
          at: [
            daysAgo(1),
            daysAgo(2),
            daysAgo(3),
            daysAgo(4),
            daysAgo(8),
            daysAgo(12),
            daysAgo(20),
          ],
        }),
        investigations: [
          run(daysAgo(1), alert("cpu-0", { monitorIds: [CPU_MONITOR] })),
        ],
      }).problems[0]!;

      expect(problem.occurrenceCount).toBe(7);
      expect(problem.investigationCount).toBe(1);
      expect(problem.subjectCount).toBe(1);
      expect(problem.recentOccurrenceCount).toBe(4);
      expect(problem.previousOccurrenceCount).toBe(2);
      expect(problem.firstSeenAt).toBe(daysAgo(20).toISOString());
      expect(problem.lastSeenAt).toBe(daysAgo(1).toISOString());
      expect(problem.isRecurring).toBe(true);
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
      expect(manual.occurrenceCount).toBe(1);
      expect(manual.latestSubject).toEqual({
        kind: "incident",
        id: "incident-2",
        title: "ghfghgf",
        number: 2,
      });
      expect(manual.objects).toEqual([]);
    });

    test("the same alert investigated again counts each investigation, but came up once", () => {
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
      expect(problem.occurrenceCount).toBe(1);
      expect(problem.isRecurring).toBe(false);
      expect(problem.objects).toEqual([
        { name: "Pod", value: "web-1", key: "k8s.pod.name", count: 1 },
      ]);
    });

    test("name at most three parts, the most frequent first, counted over everything that came up", () => {
      const occurrences: Array<AiActivitySubjectInput> = [
        "a",
        "b",
        "b",
        "c",
        "c",
        "c",
        "d",
      ].map((pod: string, index: number) => {
        return alert(`alert-${index}`, {
          monitorIds: [CPU_MONITOR],
          seriesLabels: { "k8s.pod.name": pod },
          createdAt: hoursAgo(index + 1),
        });
      });

      expect(
        build({
          occurrences,
          investigations: [run(hoursAgo(1), occurrences[0])],
        }).problems[0]!.objects.map(
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

    test(`at most ${AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS}, the most frequent first`, () => {
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
      expect(problems[0]!.occurrenceCount).toBe(2);
    });

    test("leave out investigations with no incident or alert", () => {
      const insights: AiActivityInsights = build({
        investigations: [run(hoursAgo(1), undefined, { tldr: "Triage." })],
      });

      expect(insights.problems).toEqual([]);
      expect(insights.totals.investigations).toBe(1);
    });

    test("say when in the day a problem tends to start, when it keeps to one", () => {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "night",
        monitorId: MEMORY_MONITOR,
        at: [1, 2, 3, 4, 5].map((daysBack: number): Date => {
          return dayAt(daysBack, 2);
        }),
      });

      const problem: AiActivityProblem = build({
        occurrences,
        investigations: [run(dayAt(1, 2, 10), occurrences[0])],
      }).problems[0]!;

      expect(problem.timeOfDay).toEqual({
        startHourUtc: 2,
        hours: 1,
        count: 5,
        total: 5,
        days: 5,
        totalDays: 5,
      });
    });

    test("say nothing of the time of day of a problem that keeps to none", () => {
      expect(
        build({ investigations: screenshotCluster() }).problems[0]!.timeOfDay,
      ).toBeUndefined();
    });

    describe("what the investigations concluded", () => {
      test("the newest completed investigation's TL;DR, and the first step its report suggests", () => {
        const subject: AiActivitySubjectInput = alert("a", {
          monitorIds: [CPU_MONITOR],
        });
        const newest: AiActivityInvestigationInput = run(hoursAgo(1), subject, {
          tldr: "The CPU limit is too low for the new release.",
          nextStep: "Raise the CPU limit of web to 1 core.",
        });

        const problem: AiActivityProblem = build({
          investigations: [
            newest,
            run(hoursAgo(2), subject, {
              tldr: "An older finding.",
              nextStep: "An older step.",
            }),
          ],
        }).problems[0]!;

        expect(problem.latestFinding).toEqual({
          aiRunId: newest.aiRunId,
          text: "The CPU limit is too low for the new release.",
          source: "tldr",
          at: newest.completedAt!.toISOString(),
        });
        expect(problem.latestNextStep).toBe(
          "Raise the CPU limit of web to 1 core.",
        );
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

      test("an older finding when the newest investigations have none, with that one's step", () => {
        const subject: AiActivitySubjectInput = alert("a", {
          monitorIds: [CPU_MONITOR],
        });
        const older: AiActivityInvestigationInput = run(hoursAgo(3), subject, {
          tldr: "Found it the first time.",
          nextStep: "Do the thing.",
        });

        const problem: AiActivityProblem = build({
          investigations: [
            run(hoursAgo(1), subject, { status: AIRunStatus.Running }),
            run(hoursAgo(2), subject, { nextStep: "A step with no finding." }),
            older,
          ],
        }).problems[0]!;

        expect(problem.latestFinding!.aiRunId).toBe(older.aiRunId);
        expect(problem.latestNextStep).toBe("Do the thing.");
      });

      test("no step without a finding to go with it", () => {
        expect(
          build({
            investigations: [
              run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
                nextStep: "Restart it.",
              }),
            ],
          }).problems[0]!.latestNextStep,
        ).toBeUndefined();
      });

      test("never from an investigation that did not complete, and none at all without one", () => {
        expect(
          build({
            investigations: [
              run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
                status: AIRunStatus.Error,
                tldr: "A half-written finding.",
                nextStep: "A half-written step.",
              }),
            ],
          }).problems[0]!,
        ).toEqual(
          expect.not.objectContaining({
            latestFinding: expect.anything(),
          }),
        );
      });

      test("blank text is no finding and no step", () => {
        const problem: AiActivityProblem = build({
          investigations: [
            run(hoursAgo(1), alert("a", { monitorIds: [CPU_MONITOR] }), {
              tldr: "   ",
              reportSummary: "",
              nextStep: "  ",
            }),
          ],
        }).problems[0]!;

        expect(problem.latestFinding).toBeUndefined();
        expect(problem.latestNextStep).toBeUndefined();
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

    test("count the fixes proposed for its incidents and alerts, investigated or not, and how they went", () => {
      const insights: AiActivityInsights = build({
        occurrences: [
          alert("alert-not-investigated", {
            monitorIds: [CPU_MONITOR],
            createdAt: hoursAgo(5),
          }),
        ],
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
          fix(hoursAgo(1), { alertId: "alert-not-investigated" }),
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
        proposed: 5,
        applied: 2,
        verified: 1,
        failed: 1,
        awaitingApproval: 2,
      });
    });
  });

  describe("hotspots", () => {
    test("the parts of the scope in two incidents or alerts or more, most first", () => {
      const insights: AiActivityInsights = build({
        investigations: screenshotCluster(),
      });

      expect(insights.hotspots).toEqual([
        {
          name: "Namespace",
          value: "default",
          key: "k8s.namespace.name",
          occurrenceCount: 3,
          investigationCount: 3,
          problemCount: 2,
          lastSeenAt: hoursAgo(1).toISOString(),
        },
      ]);
    });

    test("count everything that came up there, and how often AI investigated it", () => {
      const hotspot: AiActivityHotspot = build({
        occurrences: [
          alert("a", {
            monitorIds: [CPU_MONITOR],
            seriesLabels: nodeLabels("node-a"),
            createdAt: hoursAgo(1),
          }),
          alert("b", {
            monitorIds: [REPLICA_MONITOR],
            seriesLabels: nodeLabels("node-a"),
            createdAt: hoursAgo(2),
          }),
          alert("c", {
            monitorIds: [REPLICA_MONITOR],
            seriesLabels: nodeLabels("node-a"),
            createdAt: hoursAgo(3),
          }),
        ],
        investigations: [
          run(
            hoursAgo(1),
            alert("a", {
              monitorIds: [CPU_MONITOR],
              seriesLabels: nodeLabels("node-a"),
              createdAt: hoursAgo(1),
            }),
          ),
          run(
            hoursAgo(0.5),
            alert("a", {
              monitorIds: [CPU_MONITOR],
              seriesLabels: nodeLabels("node-a"),
              createdAt: hoursAgo(1),
            }),
          ),
        ],
      }).hotspots[0]!;

      expect(hotspot).toEqual({
        name: "Node",
        value: "node-a",
        key: "k8s.node.name",
        occurrenceCount: 3,
        investigationCount: 2,
        problemCount: 2,
        lastSeenAt: hoursAgo(1).toISOString(),
      });
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

    test("none for a scope with no parts of its own", () => {
      expect(
        build({ investigations: screenshotCluster(), includeHotspots: false })
          .hotspots,
      ).toEqual([]);
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

  describe("insights: a problem that keeps coming back", () => {
    test("three times, still this week: worth acting on, with how often and when", () => {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "replica",
        monitorId: REPLICA_MONITOR,
        title: "Replica mismatch",
        at: [daysAgo(1), daysAgo(9), daysAgo(20)],
      });

      const recurring: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [run(daysAgo(1), occurrences[0])],
        }),
        AiActivityInsightKind.RecurringProblem,
      )[0]!;

      expect(recurring).toEqual(
        expect.objectContaining({
          tone: AiActivityInsightTone.Warning,
          count: 3,
          total: 3,
          recentCount: 1,
          previousCount: 1,
          title: "Replica mismatch",
          firstSeenAt: daysAgo(20).toISOString(),
          lastSeenAt: daysAgo(1).toISOString(),
        }),
      );
      expect(recurring.problemKey).toMatch(/^problem-/);
    });

    test("getting worse — three or more this week, more than the week before — needs attention now", () => {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "cpu",
        monitorId: CPU_MONITOR,
        at: [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(10)],
      });

      expect(
        insightsOf(
          build({
            occurrences,
            investigations: [run(daysAgo(1), occurrences[0])],
          }),
          AiActivityInsightKind.RecurringProblem,
        )[0]!.tone,
      ).toBe(AiActivityInsightTone.Critical);
    });

    test("as bad as the week before is not getting worse", () => {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "cpu",
        monitorId: CPU_MONITOR,
        at: [
          daysAgo(1),
          daysAgo(2),
          daysAgo(3),
          daysAgo(8),
          daysAgo(9),
          daysAgo(10),
        ],
      });

      const recurring: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [run(daysAgo(1), occurrences[0])],
        }),
        AiActivityInsightKind.RecurringProblem,
      )[0]!;

      expect(recurring.tone).toBe(AiActivityInsightTone.Warning);
      expect([recurring.recentCount, recurring.previousCount]).toEqual([3, 3]);
    });

    test("twice is not yet a pattern, and a problem quiet all week is not coming back", () => {
      const twice: Array<AiActivitySubjectInput> = firings({
        prefix: "twice",
        monitorId: CPU_MONITOR,
        at: [daysAgo(1), daysAgo(2)],
      });
      const quiet: Array<AiActivitySubjectInput> = firings({
        prefix: "quiet",
        monitorId: REPLICA_MONITOR,
        at: [daysAgo(8), daysAgo(9), daysAgo(10), daysAgo(11)],
      });

      expect(
        insightsOf(
          build({
            occurrences: [...twice, ...quiet],
            investigations: [
              run(daysAgo(1), twice[0]),
              run(daysAgo(8), quiet[0]),
            ],
          }),
          AiActivityInsightKind.RecurringProblem,
        ),
      ).toEqual([]);
    });

    test("carries what the investigation found and the step it suggests, where, when, and the incidents and alerts behind it", () => {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "mem",
        monitorId: MEMORY_MONITOR,
        title: "High memory",
        seriesLabels: {
          "resource.k8s.cluster.name": CLUSTER_NAME,
          "resource.k8s.pod.name": "api-1",
        },
        at: [1, 2, 3, 4, 5].map((daysBack: number): Date => {
          return dayAt(daysBack, 2);
        }),
      });
      const found: AiActivityInvestigationInput = run(
        dayAt(2, 2, 30),
        occurrences[1],
        {
          tldr: "api-1 is OOM-killed: its 512Mi limit is below its usage.",
          nextStep: "Raise api-1's memory limit to 1Gi.",
        },
      );

      const recurring: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [
            // The newest investigation failed; the one before found it.
            run(dayAt(1, 2, 30), occurrences[0], {
              status: AIRunStatus.Error,
            }),
            found,
          ],
        }),
        AiActivityInsightKind.RecurringProblem,
      )[0]!;

      expect(recurring.finding).toEqual({
        aiRunId: found.aiRunId,
        text: "api-1 is OOM-killed: its 512Mi limit is below its usage.",
        source: "tldr",
        at: found.completedAt!.toISOString(),
      });
      expect(recurring.nextStep).toBe("Raise api-1's memory limit to 1Gi.");
      expect(recurring.timeOfDay).toEqual(
        expect.objectContaining({ startHourUtc: 2, days: 5, totalDays: 5 }),
      );
      expect(recurring.objects).toEqual([
        { name: "Pod", value: "api-1", key: "k8s.pod.name" },
      ]);
      // The incident or alert it opens is the one whose investigation found it.
      expect(recurring.subject).toEqual({
        kind: "alert",
        id: "mem-1",
        title: "High memory",
      });
      // The newest few behind it, and how many in all.
      expect(
        recurring.evidence!.map((subject: { id: string }) => {
          return subject.id;
        }),
      ).toEqual(["mem-0", "mem-1", "mem-2"]);
      expect(recurring.evidence).toHaveLength(
        AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE,
      );
      expect(recurring.evidenceCount).toBe(5);
    });

    test("with nothing found yet, it opens the latest incident or alert investigated", () => {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "x",
        monitorId: CPU_MONITOR,
        at: [daysAgo(1), daysAgo(2), daysAgo(3)],
      });

      const recurring: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [
            run(daysAgo(2), occurrences[1], { status: AIRunStatus.Error }),
          ],
        }),
        AiActivityInsightKind.RecurringProblem,
      )[0]!;

      expect(recurring.finding).toBeUndefined();
      expect(recurring.nextStep).toBeUndefined();
      expect(recurring.subject!.id).toBe("x-1");
    });

    test(`at most ${AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS}, the most frequent first`, () => {
      const problems: Array<Array<AiActivitySubjectInput>> = [
        firings({
          prefix: "three",
          monitorId: CPU_MONITOR,
          at: [daysAgo(1), daysAgo(2), daysAgo(3)],
        }),
        firings({
          prefix: "five",
          monitorId: REPLICA_MONITOR,
          at: [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(4), daysAgo(5)],
        }),
        firings({
          prefix: "four",
          monitorId: PENDING_MONITOR,
          at: [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(4)],
        }),
      ];

      const recurring: Array<AiActivityInsight> = insightsOf(
        build({
          occurrences: problems.flat(),
          investigations: problems.map(
            (
              subjects: Array<AiActivitySubjectInput>,
            ): AiActivityInvestigationInput => {
              return run(daysAgo(1), subjects[0]);
            },
          ),
        }),
        AiActivityInsightKind.RecurringProblem,
      );

      expect(recurring).toHaveLength(
        AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS,
      );
      expect(
        recurring.map((insight: AiActivityInsight): number => {
          return insight.count;
        }),
      ).toEqual([5, 4]);
    });

    test("never links an incident or alert the caller could not read", () => {
      // Everything handed to the builder is readable: nothing else can be named.
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: "r",
        monitorId: CPU_MONITOR,
        at: [daysAgo(1), daysAgo(2), daysAgo(3)],
      });
      const recurring: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [run(daysAgo(1), occurrences[0])],
          fixes: [fix(daysAgo(1), { alertId: "hidden" })],
        }),
        AiActivityInsightKind.RecurringProblem,
      )[0]!;

      for (const subject of recurring.evidence!) {
        expect(["r-0", "r-1", "r-2"]).toContain(subject.id);
      }
    });
  });

  describe("insights: one part behind the trouble", () => {
    function cluster(): Array<AiActivitySubjectInput> {
      return [
        ...firings({
          prefix: "cpu",
          monitorId: CPU_MONITOR,
          seriesLabels: nodeLabels("node-a"),
          at: [hoursAgo(1), hoursAgo(5)],
        }),
        ...firings({
          prefix: "replica",
          monitorId: REPLICA_MONITOR,
          seriesLabels: nodeLabels("node-a"),
          at: [hoursAgo(3)],
        }),
        ...firings({
          prefix: "pending",
          monitorId: PENDING_MONITOR,
          seriesLabels: nodeLabels("node-b"),
          at: [hoursAgo(4)],
        }),
      ];
    }

    test("a part behind several problems and most of what came up", () => {
      const occurrences: Array<AiActivitySubjectInput> = cluster();
      const hotspot: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [run(hoursAgo(1), occurrences[0])],
        }),
        AiActivityInsightKind.Hotspot,
      )[0]!;

      expect(hotspot).toEqual({
        kind: AiActivityInsightKind.Hotspot,
        tone: AiActivityInsightTone.Pattern,
        count: 3,
        total: 4,
        problemCount: 2,
        object: { name: "Node", value: "node-a", key: "k8s.node.name" },
        lastSeenAt: hoursAgo(1).toISOString(),
        subject: { kind: "alert", id: "cpu-0", title: "Problem cpu" },
        evidence: [
          { kind: "alert", id: "cpu-0", title: "Problem cpu" },
          { kind: "alert", id: "replica-0", title: "Problem replica" },
          { kind: "alert", id: "cpu-1", title: "Problem cpu" },
        ],
        evidenceCount: 3,
      });
    });

    test("not a part behind everything: the only node says nothing", () => {
      const occurrences: Array<AiActivitySubjectInput> = cluster().map(
        (subject: AiActivitySubjectInput): AiActivitySubjectInput => {
          return { ...subject, seriesLabels: nodeLabels("node-a") };
        },
      );

      expect(
        insightsOf(
          build({
            occurrences,
            investigations: [run(hoursAgo(1), occurrences[0])],
          }),
          AiActivityInsightKind.Hotspot,
        ),
      ).toEqual([]);
    });

    test("not a part behind one problem only: that problem says it", () => {
      const occurrences: Array<AiActivitySubjectInput> = [
        ...firings({
          prefix: "cpu",
          monitorId: CPU_MONITOR,
          seriesLabels: nodeLabels("node-a"),
          at: [hoursAgo(1), hoursAgo(2), hoursAgo(3)],
        }),
        ...firings({
          prefix: "other",
          monitorId: PENDING_MONITOR,
          seriesLabels: nodeLabels("node-b"),
          at: [hoursAgo(4)],
        }),
      ];

      expect(
        insightsOf(
          build({
            occurrences,
            investigations: [run(hoursAgo(1), occurrences[0])],
          }),
          AiActivityInsightKind.Hotspot,
        ),
      ).toEqual([]);
    });

    test("three different problems are enough, even under half of everything", () => {
      const occurrences: Array<AiActivitySubjectInput> = [
        ...[CPU_MONITOR, REPLICA_MONITOR, PENDING_MONITOR].flatMap(
          (monitorId: string, index: number) => {
            return firings({
              prefix: `on-a-${index}`,
              monitorId,
              seriesLabels: nodeLabels("node-a"),
              at: [hoursAgo(index + 1)],
            });
          },
        ),
        ...firings({
          prefix: "elsewhere",
          monitorId: MEMORY_MONITOR,
          seriesLabels: nodeLabels("node-b"),
          at: [1, 2, 3, 4, 5, 6, 7].map((hours: number): Date => {
            return hoursAgo(hours + 10);
          }),
        }),
      ];

      const hotspot: AiActivityInsight = insightsOf(
        build({
          occurrences,
          investigations: [run(hoursAgo(1), occurrences[0])],
        }),
        AiActivityInsightKind.Hotspot,
      )[0]!;

      expect(hotspot.object!.value).toBe("node-a");
      expect([hotspot.count, hotspot.total, hotspot.problemCount]).toEqual([
        3, 10, 3,
      ]);
    });

    test("of several, the part behind the most problems", () => {
      /*
       * The namespace is in more incidents (5 of 7, two problems); the node
       * is in fewer (3 of 7) but behind three different problems.
       */
      const labels: (node: string, namespace?: string) => JSONObject = (
        node: string,
        namespace?: string,
      ): JSONObject => {
        return {
          "resource.k8s.cluster.name": CLUSTER_NAME,
          ...(namespace ? { "resource.k8s.namespace.name": namespace } : {}),
          "resource.k8s.node.name": node,
        };
      };
      const occurrences: Array<AiActivitySubjectInput> = [
        ...firings({
          prefix: "a",
          monitorId: CPU_MONITOR,
          seriesLabels: labels("node-a", "shop"),
          at: [hoursAgo(1)],
        }),
        ...firings({
          prefix: "b",
          monitorId: REPLICA_MONITOR,
          seriesLabels: labels("node-a", "shop"),
          at: [hoursAgo(2)],
        }),
        ...firings({
          prefix: "c",
          monitorId: PENDING_MONITOR,
          seriesLabels: labels("node-a"),
          at: [hoursAgo(3)],
        }),
        ...firings({
          prefix: "d",
          monitorId: CPU_MONITOR,
          seriesLabels: labels("node-b", "shop"),
          at: [hoursAgo(4), hoursAgo(5), hoursAgo(7)],
        }),
        ...firings({
          prefix: "e",
          monitorId: MEMORY_MONITOR,
          seriesLabels: labels("node-c"),
          at: [hoursAgo(6)],
        }),
      ];

      const insights: AiActivityInsights = build({
        occurrences,
        investigations: [run(hoursAgo(1), occurrences[0])],
      });

      // The namespace leads the list of where problems happen...
      expect(insights.hotspots[0]!.value).toBe("shop");
      // ...but the insight names the node behind the most problems.
      expect(
        insightsOf(insights, AiActivityInsightKind.Hotspot)[0]!.object!.value,
      ).toBe("node-a");
    });

    test("none for a scope with no parts of its own", () => {
      const occurrences: Array<AiActivitySubjectInput> = cluster();

      expect(
        insightsOf(
          build({
            occurrences,
            investigations: [run(hoursAgo(1), occurrences[0])],
            includeHotspots: false,
          }),
          AiActivityInsightKind.Hotspot,
        ),
      ).toEqual([]);
    });
  });

  describe("insights: a problem that stopped", () => {
    function stopped(data: {
      at: Array<Date>;
      fixedAt: Date;
      fix?: Partial<AiActivityFixInput> | undefined;
      prefix?: string | undefined;
      monitorId?: string | undefined;
    }): Partial<AiActivityInsightsInput> {
      const occurrences: Array<AiActivitySubjectInput> = firings({
        prefix: data.prefix || "disk",
        monitorId: data.monitorId || PENDING_MONITOR,
        title: "Node disk pressure",
        at: data.at,
      });

      return {
        occurrences,
        investigations: [run(data.at[0]!, occurrences[0])],
        fixes: [
          fix(data.fixedAt, {
            alertId: occurrences[0]!.id,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
            ...(data.fix || {}),
          }),
        ],
      };
    }

    test("it kept coming back, a fix held, and nothing since: good news, in place of 'keeps coming back'", () => {
      const insights: AiActivityInsights = build(
        stopped({
          at: [daysAgo(4), daysAgo(5), daysAgo(6)],
          fixedAt: new Date(daysAgo(4).getTime() + HOUR),
        }),
      );

      expect(
        insightsOf(insights, AiActivityInsightKind.ProblemStopped),
      ).toEqual([
        {
          kind: AiActivityInsightKind.ProblemStopped,
          tone: AiActivityInsightTone.Positive,
          count: 3,
          problemKey: insights.problems[0]!.key,
          title: "Node disk pressure",
          fixedAt: new Date(daysAgo(4).getTime() + HOUR).toISOString(),
          lastSeenAt: daysAgo(4).toISOString(),
          subject: { kind: "alert", id: "disk-0", title: "Node disk pressure" },
          evidence: [
            { kind: "alert", id: "disk-0", title: "Node disk pressure" },
          ],
          evidenceCount: 1,
        },
      ]);
      // Three this week, but it stopped: it is not said to keep coming back.
      expect(
        insightsOf(insights, AiActivityInsightKind.RecurringProblem),
      ).toEqual([]);
    });

    test("an approved fix counts from when it was approved", () => {
      const approvedAt: Date = daysAgo(4);

      expect(
        insightsOf(
          build(
            stopped({
              at: [daysAgo(5), daysAgo(6), daysAgo(7)],
              fixedAt: daysAgo(5),
              fix: {
                status: AutoRemediationSuggestionStatus.Approved,
                approvedAt,
              },
            }),
          ),
          AiActivityInsightKind.ProblemStopped,
        )[0]!.fixedAt,
      ).toBe(approvedAt.toISOString());
    });

    test("not when it came back after the fix", () => {
      expect(
        insightsOf(
          build(
            stopped({
              at: [daysAgo(4), daysAgo(8), daysAgo(9)],
              fixedAt: daysAgo(6),
            }),
          ),
          AiActivityInsightKind.ProblemStopped,
        ),
      ).toEqual([]);
    });

    test("not until three days have passed since the fix", () => {
      expect(
        insightsOf(
          build(
            stopped({
              at: [daysAgo(2), daysAgo(5), daysAgo(6)],
              fixedAt: new Date(daysAgo(2).getTime() + HOUR),
            }),
          ),
          AiActivityInsightKind.ProblemStopped,
        ),
      ).toEqual([]);
    });

    test.each([
      [
        "not checked yet",
        { verificationStatus: AutoRemediationVerificationStatus.Pending },
      ],
      [
        "checked, and it did not help",
        { verificationStatus: AutoRemediationVerificationStatus.Failed },
      ],
      ["never checked", { verificationStatus: undefined }],
      [
        "only proposed",
        {
          status: AutoRemediationSuggestionStatus.Suggested,
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        },
      ],
    ])(
      "not after a fix that was %s",
      (_: string, override: Partial<AiActivityFixInput>) => {
        expect(
          insightsOf(
            build(
              stopped({
                at: [daysAgo(5), daysAgo(6), daysAgo(7)],
                fixedAt: daysAgo(4),
                fix: override,
              }),
            ),
            AiActivityInsightKind.ProblemStopped,
          ),
        ).toEqual([]);
      },
    );

    test("not for a problem that only came up twice", () => {
      expect(
        insightsOf(
          build(stopped({ at: [daysAgo(5), daysAgo(6)], fixedAt: daysAgo(4) })),
          AiActivityInsightKind.ProblemStopped,
        ),
      ).toEqual([]);
    });

    test(`at most ${AI_ACTIVITY_INSIGHTS_MAX_STOPPED_INSIGHTS}`, () => {
      const parts: Array<Partial<AiActivityInsightsInput>> = [
        CPU_MONITOR,
        REPLICA_MONITOR,
        PENDING_MONITOR,
      ].map((monitorId: string, index: number) => {
        return stopped({
          prefix: `p${index}`,
          monitorId,
          at: [daysAgo(5), daysAgo(6), daysAgo(7)],
          fixedAt: daysAgo(4),
        });
      });

      expect(
        insightsOf(
          build({
            occurrences: parts.flatMap(
              (
                part: Partial<AiActivityInsightsInput>,
              ): Array<AiActivitySubjectInput> => {
                return part.occurrences || [];
              },
            ),
            investigations: parts.flatMap(
              (
                part: Partial<AiActivityInsightsInput>,
              ): Array<AiActivityInvestigationInput> => {
                return part.investigations || [];
              },
            ),
            fixes: parts.flatMap(
              (
                part: Partial<AiActivityInsightsInput>,
              ): Array<AiActivityFixInput> => {
                return part.fixes || [];
              },
            ),
          }),
          AiActivityInsightKind.ProblemStopped,
        ),
      ).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_STOPPED_INSIGHTS);
    });
  });

  describe("insights: fixes", () => {
    test("fixes that did not solve the problem, out of the ones applied, with their readable incidents", () => {
      const fixes: AiActivityInsight = insightsOf(
        build({
          investigations: [run(hoursAgo(1), incident("inc-a"))],
          fixes: [
            fix(hoursAgo(1), {
              incidentId: "inc-a",
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
            fix(hoursAgo(2), {
              incidentId: "hidden",
              status: AutoRemediationSuggestionStatus.Approved,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
            fix(hoursAgo(3), {
              status: AutoRemediationSuggestionStatus.Approved,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
          ],
        }),
        AiActivityInsightKind.FixesDidNotHelp,
      )[0]!;

      expect(fixes).toEqual({
        kind: AiActivityInsightKind.FixesDidNotHelp,
        tone: AiActivityInsightTone.Critical,
        count: 2,
        total: 3,
        subject: { kind: "incident", id: "inc-a", title: "Incident inc-a" },
        evidence: [{ kind: "incident", id: "inc-a", title: "Incident inc-a" }],
        // The hidden incident is counted, never named.
        evidenceCount: 2,
      });
    });

    test("fixes nobody could read the incident of are still said, with nothing linked", () => {
      const fixes: AiActivityInsight = insightsOf(
        build({
          fixes: [
            fix(hoursAgo(1), {
              incidentId: "hidden",
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
          ],
        }),
        AiActivityInsightKind.FixesDidNotHelp,
      )[0]!;

      expect(fixes.count).toBe(1);
      expect(fixes.subject).toBeUndefined();
      expect(fixes.evidence).toBeUndefined();
    });

    test("fixes waiting for approval, the newest one's incident or alert to open", () => {
      const waiting: AiActivityInsight = insightsOf(
        build({
          investigations: [
            run(hoursAgo(1), alert("older")),
            run(hoursAgo(1), alert("newer")),
          ],
          fixes: [
            fix(hoursAgo(5), { alertId: "older" }),
            fix(hoursAgo(1), { alertId: "newer" }),
          ],
        }),
        AiActivityInsightKind.FixesAwaitingApproval,
      )[0]!;

      expect(waiting.tone).toBe(AiActivityInsightTone.Warning);
      expect(waiting.count).toBe(2);
      expect(waiting.subject!.id).toBe("newer");
    });

    test("fixes AI applied on its own, and how many held", () => {
      const automatic: AiActivityInsight = insightsOf(
        build({
          fixes: [
            fix(hoursAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
            fix(hoursAgo(2), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Pending,
            }),
            fix(hoursAgo(3), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Verified,
            }),
            // Applied on its own, and did not help: said elsewhere.
            fix(hoursAgo(4), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
              verificationStatus: AutoRemediationVerificationStatus.Failed,
            }),
          ],
        }),
        AiActivityInsightKind.FixedAutomatically,
      )[0]!;

      expect(automatic).toEqual(
        expect.objectContaining({
          tone: AiActivityInsightTone.Positive,
          count: 3,
          verifiedCount: 2,
        }),
      );
    });

    test("a fix applied on its own that did not help is no good news", () => {
      const insights: AiActivityInsights = build({
        fixes: [
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Failed,
          }),
        ],
      });

      expect(
        insights.insights.map((insight: AiActivityInsight): string => {
          return insight.kind;
        }),
      ).toEqual([AiActivityInsightKind.FixesDidNotHelp]);
    });

    describe("your team approved every fix AI proposed", () => {
      function approved(
        count: number,
        verification:
          | AutoRemediationVerificationStatus
          | undefined = AutoRemediationVerificationStatus.Verified,
      ): Array<AiActivityFixInput> {
        return Array.from({ length: count }, (_: unknown, index: number) => {
          return fix(hoursAgo(index + 1), {
            status: AutoRemediationSuggestionStatus.Approved,
            approvedAt: hoursAgo(index + 0.5),
            verificationStatus: verification,
          });
        });
      }

      test("three approved, none dismissed, none applied on its own, none failed: AI could do it itself", () => {
        const ready: AiActivityInsight = insightsOf(
          build({
            fixes: [
              ...approved(2),
              ...approved(1, AutoRemediationVerificationStatus.Pending),
            ],
          }),
          AiActivityInsightKind.ReadyForAutomaticFixes,
        )[0]!;

        expect(ready).toEqual(
          expect.objectContaining({
            tone: AiActivityInsightTone.Positive,
            count: 3,
            verifiedCount: 2,
          }),
        );
      });

      test.each([
        ["only two were approved", approved(2)],
        [
          "one was dismissed",
          [
            ...approved(3),
            fix(hoursAgo(1), {
              status: AutoRemediationSuggestionStatus.Dismissed,
            }),
          ],
        ],
        [
          "AI already applies some on its own",
          [
            ...approved(3),
            fix(hoursAgo(1), {
              status: AutoRemediationSuggestionStatus.AutoExecuted,
            }),
          ],
        ],
        [
          "one of them did not help",
          [
            ...approved(3),
            ...approved(1, AutoRemediationVerificationStatus.Failed),
          ],
        ],
      ])("not when %s", (_: string, fixes: Array<AiActivityFixInput>) => {
        expect(
          insightsOf(
            build({ fixes }),
            AiActivityInsightKind.ReadyForAutomaticFixes,
          ),
        ).toEqual([]);
      });
    });
  });

  describe("insights: risks spotted before anything paged", () => {
    test("open High and Medium findings, at most two; Low ones wait in their card", () => {
      const risks: Array<AiActivityInsight> = insightsOf(
        build({
          preventiveInsights: [
            preventive({
              id: "low",
              severity: AIInsightSeverity.Low,
              lastSeenAt: hoursAgo(0.1).toISOString(),
            }),
            preventive({
              id: "medium",
              severity: AIInsightSeverity.Medium,
              occurrenceCount: undefined,
            }),
            preventive({ id: "high", severity: AIInsightSeverity.High }),
            preventive({ id: "high-2", severity: AIInsightSeverity.High }),
          ],
        }),
        AiActivityInsightKind.RiskSpotted,
      );

      expect(risks).toHaveLength(AI_ACTIVITY_INSIGHTS_MAX_RISK_INSIGHTS);
      expect(
        risks.map((risk: AiActivityInsight): string => {
          return `${risk.insightId}:${risk.tone}`;
        }),
      ).toEqual(["high:Critical", "high-2:Critical"]);
      expect(risks[0]).toEqual({
        kind: AiActivityInsightKind.RiskSpotted,
        tone: AiActivityInsightTone.Critical,
        count: 3,
        title: "Error-log spike: 6.0x normal volume",
        insightId: "high",
        insightSeverity: AIInsightSeverity.High,
        insightType: AIInsightType.ErrorLogSpike,
        lastSeenAt: hoursAgo(1).toISOString(),
      });
    });

    test("a Medium one is worth acting on, and one seen without a count is seen once", () => {
      const risk: AiActivityInsight = insightsOf(
        build({
          preventiveInsights: [
            preventive({
              severity: AIInsightSeverity.Medium,
              occurrenceCount: undefined,
            }),
          ],
        }),
        AiActivityInsightKind.RiskSpotted,
      )[0]!;

      expect(risk.tone).toBe(AiActivityInsightTone.Warning);
      expect(risk.count).toBe(1);
    });
  });

  describe("insights, together", () => {
    test("the screenshot's cluster: the problem coming back leads, the node behind it, the risk, and AI's own fix", () => {
      const memory: Array<AiActivitySubjectInput> = firings({
        prefix: "mem",
        monitorId: MEMORY_MONITOR,
        title: "[K8s] High Memory Utilization (>85%) - oneuptime-test",
        seriesLabels: nodeLabels("db-pool-rqyt"),
        at: [1, 1, 2, 2, 3, 3, 4, 5, 6, 12].map((daysBack: number): Date => {
          return dayAt(daysBack, 2);
        }),
      });
      const cpu: Array<AiActivitySubjectInput> = firings({
        prefix: "cpu",
        monitorId: CPU_MONITOR,
        seriesLabels: nodeLabels("db-pool-rqyt"),
        at: [daysAgo(1), daysAgo(9)],
      });
      const other: Array<AiActivitySubjectInput> = firings({
        prefix: "other",
        monitorId: PENDING_MONITOR,
        seriesLabels: nodeLabels("default-pool"),
        at: [daysAgo(3), daysAgo(4)],
      });

      const insights: AiActivityInsights = build({
        occurrences: [...memory, ...cpu, ...other],
        investigations: [
          run(dayAt(1, 2, 30), memory[0], {
            tldr: "The api pod is OOM-killed every two hours.",
            nextStep: "Raise its memory limit to 1Gi.",
          }),
          run(daysAgo(1), cpu[0]),
          run(daysAgo(3), other[0]),
        ],
        fixes: [
          fix(dayAt(1, 2, 20), {
            alertId: memory[0]!.id,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Verified,
          }),
        ],
        preventiveInsights: [preventive({ id: "spike" })],
      });

      expect(
        insights.insights.map((insight: AiActivityInsight): string => {
          return `${insight.tone}:${insight.kind}`;
        }),
      ).toEqual([
        "Critical:RecurringProblem",
        "Critical:RiskSpotted",
        "Pattern:Hotspot",
        "Positive:FixedAutomatically",
      ]);
      expect(insights.insights[0]!.nextStep).toBe(
        "Raise its memory limit to 1Gi.",
      );
      expect(insights.insights[2]!.object!.value).toBe("db-pool-rqyt");
    });

    test("insights a reader worked out itself are ranked with the builder's own", () => {
      const insights: AiActivityInsights = build({
        fixes: [
          fix(hoursAgo(1), {
            status: AutoRemediationSuggestionStatus.AutoExecuted,
          }),
        ],
        extraInsights: [
          {
            kind: AiActivityInsightKind.NotInvestigated,
            tone: AiActivityInsightTone.Critical,
            count: 7,
            total: 10,
            reason: "provider_missing",
          },
        ],
      });

      expect(
        insights.insights.map((insight: AiActivityInsight): string => {
          return insight.kind;
        }),
      ).toEqual([
        AiActivityInsightKind.NotInvestigated,
        AiActivityInsightKind.FixedAutomatically,
      ]);
      expect(insights.insights[0]!.reason).toBe("provider_missing");
    });

    test("the same rows give the same insights, in whatever order they come", () => {
      const occurrences: Array<AiActivitySubjectInput> = [
        ...firings({
          prefix: "a",
          monitorId: CPU_MONITOR,
          seriesLabels: nodeLabels("node-a"),
          at: [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(4)],
        }),
        ...firings({
          prefix: "b",
          monitorId: REPLICA_MONITOR,
          seriesLabels: nodeLabels("node-a"),
          at: [daysAgo(2), daysAgo(5), daysAgo(6)],
        }),
        ...firings({
          prefix: "c",
          monitorId: PENDING_MONITOR,
          seriesLabels: nodeLabels("node-b"),
          at: [daysAgo(1)],
        }),
      ];
      const investigations: Array<AiActivityInvestigationInput> = [
        run(daysAgo(1), occurrences[0], { tldr: "Finding A." }),
        run(daysAgo(2), occurrences[4], { tldr: "Finding B." }),
        run(daysAgo(1), occurrences[7]),
      ];
      const fixes: Array<AiActivityFixInput> = [
        fix(daysAgo(1), {
          alertId: occurrences[0]!.id,
          status: AutoRemediationSuggestionStatus.AutoExecuted,
          verificationStatus: AutoRemediationVerificationStatus.Verified,
        }),
        fix(daysAgo(2), { alertId: occurrences[4]!.id }),
      ];

      const forwards: AiActivityInsights = build({
        occurrences,
        investigations,
        fixes,
      });
      const backwards: AiActivityInsights = build({
        occurrences: [...occurrences].reverse(),
        investigations: [...investigations].reverse(),
        fixes: [...fixes].reverse(),
      });

      expect(backwards).toEqual(forwards);
    });
  });
});

import { beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getRemediationDecisionLines,
  getRemediationDecisionStatus,
  pickRemediationDecision,
  REMEDIATION_DECISION_STATUS_TEXT,
  RemediationDecision,
  RemediationDecisionLine,
  RemediationDecisionSignal,
  RemediationDecisionStatus,
  RemediationDecisionTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionHelper,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * What the Remediation card says about what auto-remediation did with an
 * incident or alert - one sentence per fix path, from the engine's
 * recorded decision:
 *
 * - the newest Evaluated decision is shown, and wins over a wait however
 *   their order; while remediation still waits for the AI investigation,
 *   the card says so;
 * - a signal linked to no cluster and no resource reads as ONE line -
 *   the answer to "why did it not fix itself?" - linking to each monitor,
 *   where it can be linked to what it watches; a lane whose resources the
 *   other lane found says nothing about being unlinked;
 * - each cluster, resource and rule outcome reads as its own sentence,
 *   with the tone of what happened (acted, needs attention, or just so),
 *   the blocking gap's "why" and "what to do", and a link to the page that
 *   changes it - the cluster's or resource's AI agent page, the AI
 *   settings page of the right kind of signal (where its switch and its
 *   rules are), Enable AI, the LLM providers;
 * - a lane that only says another lane took the signal is not drawn.
 */

const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_MONITOR_ID: string = "44444444-4444-4444-8444-444444444445";

function evaluated(
  entries: Array<AutoRemediationDecisionEntry>,
): RemediationDecision {
  return { stage: AutoRemediationDecisionStage.Evaluated, entries };
}

function linesOf(
  entries: Array<AutoRemediationDecisionEntry>,
  signal: RemediationDecisionSignal = "incident",
): Array<RemediationDecisionLine> {
  return getRemediationDecisionLines({
    decision: evaluated(entries),
    signal,
    translator: getGlobalTranslator(),
  });
}

function onlyLine(
  entry: AutoRemediationDecisionEntry,
  signal: RemediationDecisionSignal = "incident",
): RemediationDecisionLine {
  const lines: Array<RemediationDecisionLine> = linesOf([entry], signal);
  expect(lines).toHaveLength(1);
  return lines[0]!;
}

function hrefsOf(line: RemediationDecisionLine): Array<string> {
  return line.links.map((link: { route: { toString: () => string } }) => {
    return link.route.toString();
  });
}

const NOTHING_LINKED: Array<AutoRemediationDecisionEntry> = [
  {
    lane: AutoRemediationDecisionLane.KubernetesCluster,
    reason: AutoRemediationDecisionReason.ClusterNoneLinked,
    monitors: [
      { id: MONITOR_ID, name: "Checkout website" },
      { id: OTHER_MONITOR_ID, name: "" },
    ],
  },
  {
    lane: AutoRemediationDecisionLane.Resource,
    reason: AutoRemediationDecisionReason.ResourceNoneLinked,
    monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
  },
];

describe("pickRemediationDecision", () => {
  test("shows the newest evaluated decision", () => {
    const decision: RemediationDecision | null = pickRemediationDecision([
      {
        stage: "Evaluated",
        entries: [{ lane: "Rule", reason: "NoRulesConfigured" }],
        createdAt: "2026-10-05T10:00:00Z",
      },
      {
        stage: "Evaluated",
        entries: [{ lane: "Project", reason: "EnableAiOff" }],
        createdAt: "2026-10-05T11:00:00Z",
      },
    ]);

    expect(decision?.stage).toBe(AutoRemediationDecisionStage.Evaluated);
    expect(
      decision?.entries.map((e: AutoRemediationDecisionEntry) => {
        return e.reason;
      }),
    ).toEqual([AutoRemediationDecisionReason.EnableAiOff]);
  });

  test("an evaluation wins over a newer wait", () => {
    const decision: RemediationDecision | null = pickRemediationDecision([
      {
        stage: "WaitingForInvestigation",
        entries: [],
        createdAt: "2026-10-05T11:00:01Z",
      },
      {
        stage: "Evaluated",
        entries: [{ lane: "Rule", reason: "NoRulesConfigured" }],
        createdAt: "2026-10-05T11:00:00Z",
      },
    ]);

    expect(decision?.stage).toBe(AutoRemediationDecisionStage.Evaluated);
  });

  test("shows the wait until the evaluation lands, and nothing without either", () => {
    expect(
      pickRemediationDecision([
        {
          stage: "WaitingForInvestigation",
          entries: [],
          createdAt: new Date(),
        },
      ]),
    ).toEqual({
      stage: AutoRemediationDecisionStage.WaitingForInvestigation,
      entries: [],
    });
    expect(pickRemediationDecision([])).toBeNull();
    expect(pickRemediationDecision([{ stage: "SomethingElse" }])).toBeNull();
  });
});

describe("getRemediationDecisionLines", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/incidents`);
  });

  test("says remediation waits for the AI investigation", () => {
    const lines: Array<RemediationDecisionLine> = getRemediationDecisionLines({
      decision: {
        stage: AutoRemediationDecisionStage.WaitingForInvestigation,
        entries: [],
      },
      signal: "alert",
      translator: getGlobalTranslator(),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.tone).toBe("waiting");
    expect(lines[0]!.text).toBe(
      "Auto-remediation runs once OneUptime AI has finished investigating this alert, so it can act on the root cause analysis.",
    );
  });

  describe("linked to nothing", () => {
    test("reads as one line that says what to do, and links to each monitor", () => {
      const lines: Array<RemediationDecisionLine> = linesOf(NOTHING_LINKED);

      expect(lines).toHaveLength(1);
      expect(lines[0]!.tone).toBe("attention");
      expect(lines[0]!.text).toBe(
        "This incident is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
      );
      // What lets it fix this one, then how the next ones are linked.
      expect(lines[0]!.whatToDo).toBe(
        "Add the one it is about under Affected Resources, and OneUptime AI tries again. Link its monitor to what it watches, and every incident it raises from then on is linked for you.",
      );
      // The sentence is the why: no "Why:" repeats it.
      expect(lines[0]!.why).toBeUndefined();
      expect(
        lines[0]!.links.map((link: { text: string }) => {
          return link.text;
        }),
      ).toEqual(["Link Checkout website", "Link the monitor"]);
      expect(hrefsOf(lines[0]!)).toEqual([
        `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`,
        `/dashboard/${PROJECT_ID}/monitors/${OTHER_MONITOR_ID}`,
      ]);
    });

    /*
     * Issue #5293: an incident Ask AI declared had no monitor, and the line
     * said only that it was linked to nothing - in the engine's words - and
     * nothing about what would let OneUptime AI fix it.
     */
    test("says what to do for a signal without monitors - one Ask AI declared, say", () => {
      const line: RemediationDecisionLine = linesOf(
        NOTHING_LINKED.map((entry: AutoRemediationDecisionEntry) => {
          return { ...entry, monitors: [] };
        }),
        "alert",
      )[0]!;

      expect(line.text).toBe(
        "This alert is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
      );
      expect(line.whatToDo).toBe(
        "Add the one it is about under Affected Resources, and OneUptime AI tries again.",
      );
      expect(line.links).toEqual([]);
    });

    test("never words it as the engine does", () => {
      for (const monitors of [[], NOTHING_LINKED[0]!.monitors || []]) {
        for (const signal of ["incident", "alert"] as const) {
          const line: RemediationDecisionLine = linesOf(
            NOTHING_LINKED.map((entry: AutoRemediationDecisionEntry) => {
              return { ...entry, monitors };
            }),
            signal,
          )[0]!;

          const said: string = `${line.text} ${line.whatToDo || ""}`;

          expect(said).not.toContain("infrastructure resource");
          expect(said).not.toContain("Kubernetes cluster or");
          // Names the card the reader adds it on, as the page titles it.
          expect(said).toContain("Affected Resources");
        }
      }
    });

    test("says nothing about clusters when a linked resource took the signal", () => {
      const lines: Array<RemediationDecisionLine> = linesOf([
        NOTHING_LINKED[0]!,
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceRoundStarted,
          resourceType: "DockerHost",
          resourceId: RESOURCE_ID,
          resourceName: "web-1",
          remediationMode: "RequireApproval",
        },
      ]);

      expect(lines).toHaveLength(1);
      expect(lines[0]!.tone).toBe("acted");
    });

    test("says nothing about resources when a linked cluster took the signal", () => {
      const lines: Array<RemediationDecisionLine> = linesOf([
        {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          reason: AutoRemediationDecisionReason.ClusterFixesOff,
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterName: "prod-east",
        },
        NOTHING_LINKED[1]!,
      ]);

      expect(lines).toHaveLength(1);
      expect(lines[0]!.text).toBe(
        'Fixes are off for cluster "prod-east", so OneUptime AI only investigates there.',
      );
    });

    test("says only the cluster half when the resources were not checked", () => {
      const lines: Array<RemediationDecisionLine> = linesOf([
        NOTHING_LINKED[0]!,
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceSkippedLimit,
        },
      ]);

      expect(lines[0]!.text).toBe(
        "This incident is not linked to a Kubernetes cluster.",
      );
      expect(lines[0]!.tone).toBe("info");
    });
  });

  describe("Kubernetes clusters", () => {
    test.each([
      [
        KubernetesAiRemediationMode.RequireApproval,
        'OneUptime AI is composing a fix for cluster "prod-east". Nothing runs until you approve it.',
      ],
      [
        KubernetesAiRemediationMode.Automatic,
        'OneUptime AI is fixing cluster "prod-east". Safe fixes run on their own; a riskier one waits for your approval.',
      ],
      [
        KubernetesAiRemediationMode.BypassApproval,
        'OneUptime AI is fixing cluster "prod-east". Approvals are bypassed on this cluster, so its fixes run on their own.',
      ],
    ])(
      "says a round started in %s mode, and links to the cluster's AI agent page",
      (mode: string, text: string) => {
        const line: RemediationDecisionLine = onlyLine({
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          reason: AutoRemediationDecisionReason.ClusterRoundStarted,
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterName: "prod-east",
          remediationMode: mode,
        });

        expect(line.tone).toBe("acted");
        expect(line.text).toBe(text);
        expect(hrefsOf(line)).toEqual([
          `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`,
        ]);
        expect(line.links[0]!.text).toBe("Open the cluster's AI agent page");
      },
    );

    test("says which rule made a round ask first that would have run on its own", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterRoundStarted,
        kubernetesClusterId: CLUSTER_ID,
        kubernetesClusterName: "prod-east",
        remediationMode: KubernetesAiRemediationMode.RequireApproval,
        ruleName: "Payments ask first",
      });

      expect(line.tone).toBe("acted");
      expect(line.text).toBe(
        'OneUptime AI is composing a fix for cluster "prod-east". Nothing runs until you approve it, because AI rule "Payments ask first" asks before fixing.',
      );
      expect(hrefsOf(line)).toEqual([
        `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`,
      ]);
    });

    test("says why fixes cannot run yet, and what to do", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterNotReady,
        kubernetesClusterId: CLUSTER_ID,
        kubernetesClusterName: "prod-east",
        gaps: [
          {
            code: "remediation_write_access_missing",
            title: "The AI agent is read-only",
            description: "The chart was installed without write access",
            nextStep:
              "Upgrade the chart with aiAgent.remediation.enabled=true.",
          },
          {
            code: "ai_agent_not_connected",
            title: "Second gap",
            nextStep: "Second step",
          },
        ],
      });

      expect(line.tone).toBe("attention");
      expect(line.text).toBe(
        'Fixes are on for cluster "prod-east", but OneUptime AI cannot apply them yet.',
      );
      expect(line.why).toBe(
        "The AI agent is read-only. The chart was installed without write access",
      );
      expect(line.whatToDo).toBe(
        "Upgrade the chart with aiAgent.remediation.enabled=true.",
      );
      expect(hrefsOf(line)).toEqual([
        `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`,
      ]);
    });

    test("says fixes are off as a fact, not a problem", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterFixesOff,
        kubernetesClusterId: CLUSTER_ID,
        kubernetesClusterName: "prod-east",
      });

      expect(line.tone).toBe("info");
      expect(line.why).toBeUndefined();
      expect(hrefsOf(line)).toHaveLength(1);
    });

    test.each([
      [
        AutoRemediationDecisionReason.ClusterAlreadyHasRound,
        'Cluster "prod-east" already has an AI fix for this incident.',
        "info",
      ],
      [
        AutoRemediationDecisionReason.ClusterRoundNotStarted,
        'OneUptime AI could not start a fix for cluster "prod-east". The daily AI budget may be used up.',
        "attention",
      ],
      [
        AutoRemediationDecisionReason.ClusterSkippedLimit,
        'Cluster "prod-east" was not tried: this incident already has the most fixes one incident can get.',
        "info",
      ],
    ])(
      "says %s",
      (reason: AutoRemediationDecisionReason, text: string, tone: string) => {
        const line: RemediationDecisionLine = onlyLine({
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          reason,
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterName: "prod-east",
        });

        expect(line.text).toBe(text);
        expect(line.tone).toBe(tone);
      },
    );

    test("does not link a cluster whose id is not a real one", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterFixesOff,
        kubernetesClusterId: "not-a-uuid",
        kubernetesClusterName: "prod-east",
      });

      expect(line.links).toEqual([]);
    });
  });

  describe("infrastructure resources", () => {
    test("says which rule made a resource round ask first", () => {
      const line: RemediationDecisionLine = onlyLine(
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceRoundStarted,
          resourceType: "DockerHost",
          resourceId: RESOURCE_ID,
          resourceName: "web-1",
          remediationMode: KubernetesAiRemediationMode.RequireApproval,
          ruleName: "Staging asks",
        },
        "alert",
      );

      expect(line.tone).toBe("acted");
      expect(line.text).toBe(
        'OneUptime AI is composing a fix for Docker host "web-1". Nothing runs until you approve it, because AI rule "Staging asks" asks before fixing.',
      );
      expect(hrefsOf(line)).toEqual([
        `/dashboard/${PROJECT_ID}/docker/${RESOURCE_ID}/ai/agent`,
      ]);
    });

    test("names the kind of resource, and links to its own AI agent page", () => {
      const docker: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Resource,
        reason: AutoRemediationDecisionReason.ResourceRoundStarted,
        resourceType: "DockerHost",
        resourceId: RESOURCE_ID,
        resourceName: "web-1",
        remediationMode: "Automatic",
      });
      expect(docker.text).toBe(
        'OneUptime AI is fixing Docker host "web-1". Safe fixes run on their own; a riskier one waits for your approval.',
      );
      expect(hrefsOf(docker)).toEqual([
        `/dashboard/${PROJECT_ID}/docker/${RESOURCE_ID}/ai/agent`,
      ]);

      const host: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Resource,
        reason: AutoRemediationDecisionReason.ResourceFixesOff,
        resourceType: "Host",
        resourceId: RESOURCE_ID,
        resourceName: "web-host",
      });
      expect(host.text).toBe(
        'Fixes are off for host "web-host", so OneUptime AI only investigates there.',
      );
      expect(hrefsOf(host)).toEqual([
        `/dashboard/${PROJECT_ID}/host/${RESOURCE_ID}/ai/agent`,
      ]);
    });

    test("says a ready resource that was not chosen could be fixed too", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Resource,
        reason: AutoRemediationDecisionReason.ResourceNotChosen,
        resourceType: "DatabaseServer",
        resourceId: RESOURCE_ID,
        resourceName: "orders-db",
      });

      expect(line.tone).toBe("info");
      expect(line.text).toBe(
        'Database server "orders-db" could be fixed too, but OneUptime AI fixes one resource per incident.',
      );
    });

    test("says why a resource's fixes cannot run yet", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Resource,
        reason: AutoRemediationDecisionReason.ResourceNotReady,
        resourceType: "DockerHost",
        resourceId: RESOURCE_ID,
        resourceName: "web-1",
        gaps: [
          {
            code: "agent_offline",
            title: "The agent is offline",
            nextStep: "Start the agent.",
          },
        ],
      });

      expect(line.tone).toBe("attention");
      expect(line.why).toBe("The agent is offline");
      expect(line.whatToDo).toBe("Start the agent.");
    });

    test("links nothing for a resource kind it does not know", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Resource,
        reason: AutoRemediationDecisionReason.ResourceFixesOff,
        resourceType: "Mainframe",
        resourceId: RESOURCE_ID,
        resourceName: "big-iron",
      });

      expect(line.text).toBe(
        'Fixes are off for resource "big-iron", so OneUptime AI only investigates there.',
      );
      expect(line.links).toEqual([]);
    });
  });

  describe("AI rules", () => {
    test("links to the rules of the right kind of signal, on its AI settings page", () => {
      const incidentLine: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.NoRulesConfigured,
      });
      expect(incidentLine.text).toBe(
        "No AI rule is set up for this kind of incident. A rule can propose or start a runbook when a matching one is created.",
      );
      expect(hrefsOf(incidentLine)).toEqual([
        `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
      ]);
      expect(incidentLine.links[0]!.text).toBe("Incident AI rules");

      const alertLine: RemediationDecisionLine = onlyLine(
        {
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.NoRulesConfigured,
        },
        "alert",
      );
      expect(hrefsOf(alertLine)).toEqual([
        `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
      ]);
      expect(alertLine.links[0]!.text).toBe("Alert AI rules");
    });

    test("with rules set up and none matching, says nothing was fixed, and why", () => {
      const one: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.NotMatchedByAnyRule,
        rulesChecked: 1,
      });

      expect(one.tone).toBe("info");
      expect(one.text).toBe(
        "The 1 AI rule set up does not match this incident, so it was not fixed. With rules set up, OneUptime AI fixes only what matches a rule that fixes.",
      );
      expect(hrefsOf(one)).toEqual([
        `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
      ]);

      const many: RemediationDecisionLine = onlyLine(
        {
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.NotMatchedByAnyRule,
          rulesChecked: 3,
        },
        "alert",
      );

      expect(many.text).toBe(
        "None of the 3 AI rules set up match this alert, so it was not fixed. With rules set up, OneUptime AI fixes only what matches a rule that fixes.",
      );
      expect(hrefsOf(many)).toEqual([
        `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
      ]);
    });

    /*
     * Rules matched, and each only investigates ("Don't fix"): with rules
     * set up, OneUptime AI fixes only what matches a rule that fixes - the
     * line names the rule, or how many, and links to them.
     */
    test("with only rules that do not fix matching, says they only investigate, and links to them", () => {
      const one: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.MatchedRulesDoNotFix,
        rulesChecked: 1,
        ruleName: "Payments: investigate only",
      });

      expect(one.tone).toBe("info");
      expect(one.text).toBe(
        'AI rule "Payments: investigate only" matched this incident, and it only investigates, so it was not fixed.',
      );
      expect(hrefsOf(one)).toEqual([
        `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
      ]);

      const many: RemediationDecisionLine = onlyLine(
        {
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.MatchedRulesDoNotFix,
          rulesChecked: 2,
          ruleName: "Payments: investigate only",
        },
        "alert",
      );

      expect(many.text).toBe(
        "2 AI rules matched this alert, and they only investigate, so it was not fixed.",
      );
      expect(hrefsOf(many)).toEqual([
        `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
      ]);
      expect(many.links[0]!.text).toBe("Alert AI rules");
    });

    test("says a matching rule has OneUptime AI fix the signal, and whether it asks first", () => {
      const fixes: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.RuleMatchedAiFix,
        ruleName: "Production",
      });

      expect(fixes.tone).toBe("info");
      expect(fixes.text).toBe(
        'Rule "Production" matched, so OneUptime AI fixes this incident on what it is linked to.',
      );
      expect(fixes.links).toEqual([]);

      const asks: RemediationDecisionLine = onlyLine(
        {
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
          ruleName: "Payments",
        },
        "alert",
      );

      expect(asks.tone).toBe("info");
      expect(asks.text).toBe(
        'Rule "Payments" matched, so OneUptime AI fixes this alert on what it is linked to, and every fix waits for your approval.',
      );
    });

    test("says when the matching rules run runbooks only, so no cluster or host was fixed", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.NoAiFixRuleMatched,
      });

      expect(line.tone).toBe("info");
      expect(line.text).toBe(
        "No AI rule that matches this incident fixes with OneUptime AI, so OneUptime AI did not fix it on the clusters or hosts it is linked to.",
      );
      expect(hrefsOf(line)).toEqual([
        `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
      ]);
    });

    test("counts the rules that did not match", () => {
      expect(
        onlyLine({
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.NoRuleMatched,
          rulesChecked: 1,
        }).text,
      ).toBe("The 1 AI rule set up did not match this incident.");
      expect(
        onlyLine({
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.NoRuleMatched,
          rulesChecked: 4,
        }).text,
      ).toBe("None of the 4 AI rules set up matched this incident.");
    });

    test.each([
      [
        AutoRemediationDecisionReason.RuleRunbookProposed,
        'Rule "Restart checkout" proposed runbook "Restart pods". It starts when you approve it.',
        "acted",
      ],
      [
        AutoRemediationDecisionReason.RuleRunbookProposedByCircuitBreaker,
        'Rule "Restart checkout" proposed runbook "Restart pods" instead of starting it: the rule already started the most runbooks it may start in an hour.',
        "acted",
      ],
      [
        AutoRemediationDecisionReason.RuleRunbookStarted,
        'Rule "Restart checkout" started runbook "Restart pods".',
        "acted",
      ],
      [
        AutoRemediationDecisionReason.RuleRunbookNotStarted,
        'Rule "Restart checkout" could not start runbook "Restart pods". The runbook may be turned off or have no steps.',
        "attention",
      ],
      [
        AutoRemediationDecisionReason.RuleAiComposingCommands,
        'Rule "Restart checkout" matched: OneUptime AI is composing the commands that fix this incident.',
        "acted",
      ],
      [
        AutoRemediationDecisionReason.RuleAiPickingRunbook,
        'Rule "Restart checkout" matched: OneUptime AI is picking the runbook that fits this incident.',
        "acted",
      ],
      [
        AutoRemediationDecisionReason.RuleAiRunNotStarted,
        'Rule "Restart checkout" matched, but its AI run could not start. The daily AI budget may be used up.',
        "attention",
      ],
      [
        AutoRemediationDecisionReason.RuleAlreadyProposed,
        'Rule "Restart checkout" already proposed a fix for this incident.',
        "info",
      ],
      [
        AutoRemediationDecisionReason.RuleSkippedLimit,
        'Rule "Restart checkout" matched, but this incident already has the most fixes one incident can get.',
        "info",
      ],
      [
        AutoRemediationDecisionReason.RuleHasNoRunbooks,
        'Rule "Restart checkout" matched, but it has no runbook and does not use AI, so it did nothing.',
        "attention",
      ],
    ])(
      "says %s",
      (reason: AutoRemediationDecisionReason, text: string, tone: string) => {
        const line: RemediationDecisionLine = onlyLine({
          lane: AutoRemediationDecisionLane.Rule,
          reason,
          ruleId: "r-1",
          ruleName: "Restart checkout",
          runbookId: "b-1",
          runbookName: "Restart pods",
        });

        expect(line.text).toBe(text);
        expect(line.tone).toBe(tone);
      },
    );

    test("sends a rule without an LLM provider to the providers", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
        ruleName: "AI fixer",
      });

      expect(line.tone).toBe("attention");
      expect(hrefsOf(line)).toEqual([
        `/dashboard/${PROJECT_ID}/settings/llm-providers`,
      ]);
    });
  });

  describe("project", () => {
    test.each([
      [
        "incident" as RemediationDecisionSignal,
        '"Fix new incidents automatically" is off for this project, so OneUptime AI did not try to fix this incident.',
        `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
        "Incident AI settings",
      ],
      [
        "alert" as RemediationDecisionSignal,
        '"Fix new alerts automatically" is off for this project, so OneUptime AI did not try to fix this alert.',
        `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
        "Alert AI settings",
      ],
    ])(
      "says fixing new %ss is off - a choice, not a fault - and links to its switch",
      (
        signal: RemediationDecisionSignal,
        text: string,
        href: string,
        linkText: string,
      ) => {
        const line: RemediationDecisionLine = onlyLine(
          {
            lane: AutoRemediationDecisionLane.Project,
            reason: AutoRemediationDecisionReason.RemediationOff,
          },
          signal,
        );

        expect(line.tone).toBe("info");
        expect(line.text).toBe(text);
        expect(hrefsOf(line)).toEqual([href]);
        expect(line.links[0]!.text).toBe(linkText);
      },
    );

    test("says Enable AI is off, and links to the AI settings", () => {
      const line: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Project,
        reason: AutoRemediationDecisionReason.EnableAiOff,
      });

      expect(line.tone).toBe("attention");
      expect(line.text).toBe(
        "Enable AI is off for this project, so nothing is fixed automatically: no cluster or resource fix and no AI rule runs.",
      );
      expect(hrefsOf(line)).toEqual([
        `/dashboard/${PROJECT_ID}/settings/ai-features`,
      ]);
    });

    test("says an error stopped the evaluation", () => {
      expect(
        onlyLine(
          {
            lane: AutoRemediationDecisionLane.Project,
            reason: AutoRemediationDecisionReason.EvaluationFailed,
          },
          "alert",
        ).text,
      ).toBe(
        "Auto-remediation stopped on an error while checking this alert. What it did before the error is listed here.",
      );
    });

    /*
     * With no rule set up, OneUptime AI may run any of the project's
     * runbooks: it picks the one that fits and proposes it.
     */
    test.each([
      [
        "incident" as RemediationDecisionSignal,
        AutoRemediationDecisionReason.AiPickingRunbook,
        "OneUptime AI is picking the runbook that fits this incident. It proposes it for your approval.",
        "acted",
      ],
      [
        "alert" as RemediationDecisionSignal,
        AutoRemediationDecisionReason.AiPickingRunbook,
        "OneUptime AI is picking the runbook that fits this alert. It proposes it for your approval.",
        "acted",
      ],
      [
        "incident" as RemediationDecisionSignal,
        AutoRemediationDecisionReason.AiRunbookPickNotStarted,
        "OneUptime AI could not start picking a runbook for this incident. The daily AI budget may be used up.",
        "attention",
      ],
      [
        "alert" as RemediationDecisionSignal,
        AutoRemediationDecisionReason.AiRunbookPickNotStarted,
        "OneUptime AI could not start picking a runbook for this alert. The daily AI budget may be used up.",
        "attention",
      ],
    ])(
      "with no rule, on a new %s, says %s",
      (
        signal: RemediationDecisionSignal,
        reason: AutoRemediationDecisionReason,
        text: string,
        tone: string,
      ) => {
        const line: RemediationDecisionLine = onlyLine(
          { lane: AutoRemediationDecisionLane.Project, reason },
          signal,
        );

        expect(line.text).toBe(text);
        expect(line.tone).toBe(tone);
        expect(line.links).toEqual([]);
      },
    );
  });

  test("draws nothing for a lane that only says another lane took the signal", () => {
    expect(
      linesOf([
        {
          lane: AutoRemediationDecisionLane.KubernetesCluster,
          reason: AutoRemediationDecisionReason.ClusterSkippedForResourceRound,
        },
        {
          lane: AutoRemediationDecisionLane.Resource,
          reason: AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
        },
      ]),
    ).toEqual([]);
  });

  test("keeps the engine's order, one line per entry, each with its own key", () => {
    const lines: Array<RemediationDecisionLine> = linesOf([
      {
        lane: AutoRemediationDecisionLane.KubernetesCluster,
        reason: AutoRemediationDecisionReason.ClusterRoundStarted,
        kubernetesClusterId: CLUSTER_ID,
        kubernetesClusterName: "prod-east",
        remediationMode: "RequireApproval",
      },
      {
        lane: AutoRemediationDecisionLane.Resource,
        reason: AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
      },
      {
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.NoRuleMatched,
        rulesChecked: 2,
      },
    ]);

    expect(
      lines.map((line: RemediationDecisionLine) => {
        return line.tone;
      }),
    ).toEqual(["acted", "info"]);
    expect(
      new Set(
        lines.map((line: RemediationDecisionLine) => {
          return line.key;
        }),
      ).size,
    ).toBe(2);
  });
});

/*
 * The card's status pill: the decision in a few words, so "did it fix
 * itself?" is answered before a sentence is read. A wait says so; a line
 * that needs attention outranks one that acted, so the pill never hides a
 * blocked cluster behind "Action taken"; a decision whose lines only say
 * how things stand took no action.
 */
describe("getRemediationDecisionStatus", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/incidents`);
  });

  const PROJECT_REASONS: Array<AutoRemediationDecisionReason> = [
    AutoRemediationDecisionReason.EnableAiOff,
    AutoRemediationDecisionReason.RemediationOff,
    AutoRemediationDecisionReason.SuggestionLimitReached,
    AutoRemediationDecisionReason.EvaluationFailed,
  ];

  // Entries that name nothing they could link to, as the engine writes them.
  const UNLINKED_REASONS: Array<AutoRemediationDecisionReason> = [
    AutoRemediationDecisionReason.ClusterNoneLinked,
    AutoRemediationDecisionReason.ClusterLookupFailed,
    AutoRemediationDecisionReason.ClusterSkippedForResourceRound,
    AutoRemediationDecisionReason.ClusterSkippedLimit,
    AutoRemediationDecisionReason.ResourceNoneLinked,
    AutoRemediationDecisionReason.ResourceLookupFailed,
    AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
    AutoRemediationDecisionReason.ResourceSkippedForOtherRound,
    AutoRemediationDecisionReason.ResourceSkippedLimit,
  ];

  const ALL_REASONS: Array<AutoRemediationDecisionReason> = Object.values(
    AutoRemediationDecisionReason,
  );

  function laneOf(
    reason: AutoRemediationDecisionReason,
  ): AutoRemediationDecisionLane {
    if (PROJECT_REASONS.includes(reason)) {
      return AutoRemediationDecisionLane.Project;
    }

    if (reason.startsWith("Cluster")) {
      return AutoRemediationDecisionLane.KubernetesCluster;
    }

    if (reason.startsWith("Resource")) {
      return AutoRemediationDecisionLane.Resource;
    }

    return AutoRemediationDecisionLane.Rule;
  }

  // An entry with every field its lane can carry, as the engine records it.
  function entryFor(
    reason: AutoRemediationDecisionReason,
  ): AutoRemediationDecisionEntry {
    const lane: AutoRemediationDecisionLane = laneOf(reason);
    const isLinked: boolean = !UNLINKED_REASONS.includes(reason);
    const entry: AutoRemediationDecisionEntry = { lane, reason };

    if (lane === AutoRemediationDecisionLane.KubernetesCluster && isLinked) {
      entry.kubernetesClusterId = CLUSTER_ID;
      entry.kubernetesClusterName = "prod-east";
      entry.remediationMode = KubernetesAiRemediationMode.Automatic;
    }

    if (lane === AutoRemediationDecisionLane.Resource && isLinked) {
      entry.resourceType = "DockerHost";
      entry.resourceId = RESOURCE_ID;
      entry.resourceName = "web-1";
      entry.remediationMode = KubernetesAiRemediationMode.Automatic;
    }

    if (
      reason === AutoRemediationDecisionReason.ClusterNotReady ||
      reason === AutoRemediationDecisionReason.ResourceNotReady
    ) {
      entry.gaps = [
        { code: "agent_offline", title: "Offline", nextStep: "Start it." },
      ];
    }

    if (
      reason === AutoRemediationDecisionReason.ClusterNoneLinked ||
      reason === AutoRemediationDecisionReason.ResourceNoneLinked
    ) {
      entry.monitors = [{ id: MONITOR_ID, name: "Checkout website" }];
    }

    if (lane === AutoRemediationDecisionLane.Rule) {
      entry.ruleId = "r-1";
      entry.ruleName = "Restart checkout";
      entry.runbookId = "b-1";
      entry.runbookName = "Restart pods";
      entry.rulesChecked = 2;
    }

    return entry;
  }

  function statusOf(
    entries: Array<AutoRemediationDecisionEntry>,
    signal: RemediationDecisionSignal = "incident",
  ): RemediationDecisionStatus | null {
    return getRemediationDecisionStatus(linesOf(entries, signal));
  }

  function line(tone: RemediationDecisionTone): RemediationDecisionLine {
    return { key: tone, tone, text: `A ${tone} line.`, links: [] };
  }

  test("has nothing to say about no lines", () => {
    expect(getRemediationDecisionStatus([])).toBeNull();
  });

  test.each([
    ["waiting" as RemediationDecisionTone, "Waiting for investigation"],
    ["attention" as RemediationDecisionTone, "Needs attention"],
    ["acted" as RemediationDecisionTone, "Action taken"],
    ["info" as RemediationDecisionTone, "No action taken"],
  ])(
    "says a decision of %s lines in its own words",
    (tone: RemediationDecisionTone, text: string) => {
      expect(getRemediationDecisionStatus([line(tone)])).toEqual({
        tone,
        text,
      });
      expect(getRemediationDecisionStatus([line(tone), line(tone)])).toEqual({
        tone,
        text,
      });
    },
  );

  test.each([
    [["info", "acted"], "acted"],
    [["acted", "info"], "acted"],
    [["acted", "attention"], "attention"],
    [["attention", "acted", "info"], "attention"],
    [["info", "info", "attention"], "attention"],
    [["info", "waiting"], "waiting"],
    [["attention", "waiting", "acted"], "waiting"],
  ] as Array<[Array<RemediationDecisionTone>, RemediationDecisionTone]>)(
    "lines of %j take the pill of the one that matters most: %s",
    (
      tones: Array<RemediationDecisionTone>,
      expected: RemediationDecisionTone,
    ) => {
      expect(getRemediationDecisionStatus(tones.map(line))).toEqual({
        tone: expected,
        text: REMEDIATION_DECISION_STATUS_TEXT[expected],
      });
    },
  );

  test("the screenshot: fixing new incidents is off, so no action was taken", () => {
    expect(
      statusOf([
        {
          lane: AutoRemediationDecisionLane.Project,
          reason: AutoRemediationDecisionReason.RemediationOff,
        },
      ]),
    ).toEqual({ tone: "info", text: "No action taken" });
  });

  test("waits while remediation waits for the investigation", () => {
    expect(
      getRemediationDecisionStatus(
        getRemediationDecisionLines({
          decision: {
            stage: AutoRemediationDecisionStage.WaitingForInvestigation,
            entries: [],
          },
          signal: "alert",
          translator: getGlobalTranslator(),
        }),
      ),
    ).toEqual({ tone: "waiting", text: "Waiting for investigation" });
  });

  test("needs attention for a signal linked to nothing, though each half alone is only so", () => {
    expect(statusOf(NOTHING_LINKED)).toEqual({
      tone: "attention",
      text: "Needs attention",
    });
    expect(statusOf([NOTHING_LINKED[0]!])).toEqual({
      tone: "info",
      text: "No action taken",
    });
  });

  test("a fix that started still needs attention while another path is blocked", () => {
    expect(
      statusOf([
        entryFor(AutoRemediationDecisionReason.ClusterNotReady),
        entryFor(AutoRemediationDecisionReason.ResourceRoundStarted),
        entryFor(AutoRemediationDecisionReason.NoRuleMatched),
      ]),
    ).toEqual({ tone: "attention", text: "Needs attention" });
  });

  test("a fix that started is action taken, whatever else just stands", () => {
    expect(
      statusOf([
        entryFor(AutoRemediationDecisionReason.ClusterRoundStarted),
        entryFor(AutoRemediationDecisionReason.ResourceSkippedForClusterRound),
        entryFor(AutoRemediationDecisionReason.NoRulesConfigured),
      ]),
    ).toEqual({ tone: "acted", text: "Action taken" });
  });

  test("has nothing to say when every lane only says another lane took the signal", () => {
    expect(
      statusOf([
        entryFor(AutoRemediationDecisionReason.ClusterSkippedForResourceRound),
        entryFor(AutoRemediationDecisionReason.ResourceSkippedForClusterRound),
      ]),
    ).toBeNull();
  });

  /*
   * The engine classifies its own reasons (AutoRemediationDecisionHelper):
   * which ones acted and which need the reader. For every reason it
   * records, the pill of that one entry agrees with it.
   */
  test.each(ALL_REASONS)(
    "a decision of only %s gets the pill the engine's own classification says",
    (reason: AutoRemediationDecisionReason) => {
      const entry: AutoRemediationDecisionEntry = entryFor(reason);
      const lines: Array<RemediationDecisionLine> = linesOf([entry]);
      const status: RemediationDecisionStatus | null =
        getRemediationDecisionStatus(lines);

      if (lines.length === 0) {
        expect(status).toBeNull();
        return;
      }

      const expected: RemediationDecisionTone =
        AutoRemediationDecisionHelper.needsAttention(entry)
          ? "attention"
          : AutoRemediationDecisionHelper.isActed(entry)
            ? "acted"
            : "info";

      expect(status).toEqual({
        tone: expected,
        text: REMEDIATION_DECISION_STATUS_TEXT[expected],
      });
      expect(lines[0]!.tone).toBe(expected);
    },
  );

  test("every reason the engine records draws a line or is one of the silent ones", () => {
    const silent: Array<AutoRemediationDecisionReason> = ALL_REASONS.filter(
      (reason: AutoRemediationDecisionReason): boolean => {
        return linesOf([entryFor(reason)]).length === 0;
      },
    );

    expect(silent.sort()).toEqual(
      [
        AutoRemediationDecisionReason.ClusterSkippedForResourceRound,
        AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
      ].sort(),
    );
  });

  /*
   * Any mix of entries, in any order, for either kind of signal: the pill
   * needs attention exactly when the engine says an entry does (or the
   * signal is linked to nothing at all), says action was taken exactly when
   * one acted and none needs attention, and has nothing to say exactly when
   * there is no line.
   */
  test("agrees with the engine's classification for any mix of entries", () => {
    const random: SeededRandom = seededRandom(4701);
    const checked: Set<string> = new Set<string>();

    for (let round: number = 0; round < 600; round++) {
      const count: number = 1 + random(5);
      const entries: Array<AutoRemediationDecisionEntry> = shuffled(
        ALL_REASONS,
        random,
      )
        .slice(0, count)
        .map(entryFor);
      const signal: RemediationDecisionSignal =
        random(2) === 0 ? "incident" : "alert";
      const lines: Array<RemediationDecisionLine> = linesOf(entries, signal);
      const status: RemediationDecisionStatus | null =
        getRemediationDecisionStatus(lines);

      const isLinkedToNothing: boolean =
        entries.some((entry: AutoRemediationDecisionEntry): boolean => {
          return (
            entry.reason === AutoRemediationDecisionReason.ClusterNoneLinked
          );
        }) &&
        entries.some((entry: AutoRemediationDecisionEntry): boolean => {
          return (
            entry.reason === AutoRemediationDecisionReason.ResourceNoneLinked
          );
        });
      const needsAttention: boolean =
        isLinkedToNothing ||
        entries.some((entry: AutoRemediationDecisionEntry): boolean => {
          return AutoRemediationDecisionHelper.needsAttention(entry);
        });
      const acted: boolean = entries.some(
        (entry: AutoRemediationDecisionEntry): boolean => {
          return AutoRemediationDecisionHelper.isActed(entry);
        },
      );
      const expected: RemediationDecisionTone | null =
        lines.length === 0
          ? null
          : needsAttention
            ? "attention"
            : acted
              ? "acted"
              : "info";

      checked.add(String(expected));
      expect({ entries, status: status?.tone ?? null }).toEqual({
        entries,
        status: expected,
      });
    }

    // The sweep reached every pill a decision can have, and none.
    expect(Array.from(checked).sort()).toEqual(
      ["acted", "attention", "info", "null"].sort(),
    );
  });

  test("every pill's words are in the Dashboard's English locale file", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;

    for (const text of Object.values(REMEDIATION_DECISION_STATUS_TEXT)) {
      expect({ text, inLocale: english[text] }).toEqual({
        text,
        inLocale: text,
      });
    }
  });
});

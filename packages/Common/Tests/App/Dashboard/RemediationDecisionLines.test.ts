import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  getRemediationDecisionLines,
  pickRemediationDecision,
  RemediationDecision,
  RemediationDecisionLine,
  RemediationDecisionSignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import {
  AutoRemediationDecisionEntry,
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
    test("reads as one line that links to each monitor", () => {
      const lines: Array<RemediationDecisionLine> = linesOf(NOTHING_LINKED);

      expect(lines).toHaveLength(1);
      expect(lines[0]!.tone).toBe("attention");
      expect(lines[0]!.text).toBe(
        "This incident is not linked to a Kubernetes cluster or an infrastructure resource, so OneUptime AI had nothing it could fix. Link its monitor to the cluster, host, database or service it watches, and every incident it raises from then on will be linked to it.",
      );
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

    test("says it plainly, with no link, for a signal without monitors", () => {
      const line: RemediationDecisionLine = linesOf(
        NOTHING_LINKED.map((entry: AutoRemediationDecisionEntry) => {
          return { ...entry, monitors: [] };
        }),
        "alert",
      )[0]!;

      expect(line.text).toBe(
        "This alert is not linked to a Kubernetes cluster or an infrastructure resource, so OneUptime AI had nothing it could fix.",
      );
      expect(line.links).toEqual([]);
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
        'OneUptime AI is composing a fix for cluster "prod-east". Nothing runs until you approve it, because Auto Remediation Rule "Payments ask first" asks before fixing.',
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
        'OneUptime AI is composing a fix for Docker host "web-1". Nothing runs until you approve it, because Auto Remediation Rule "Staging asks" asks before fixing.',
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

  describe("Auto Remediation Rules", () => {
    test("links to the rules of the right kind of signal, on its AI settings page", () => {
      const incidentLine: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.NoRulesConfigured,
      });
      expect(incidentLine.text).toBe(
        "No Auto Remediation Rule is set up for this kind of incident. A rule can propose or start a runbook when a matching one is created.",
      );
      expect(hrefsOf(incidentLine)).toEqual([
        `/dashboard/${PROJECT_ID}/incidents/ai/settings`,
      ]);
      expect(incidentLine.links[0]!.text).toBe(
        "Incident Auto Remediation Rules",
      );

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
      expect(alertLine.links[0]!.text).toBe("Alert Auto Remediation Rules");
    });

    test("with rules set up and none matching, says nothing was fixed, and why", () => {
      const one: RemediationDecisionLine = onlyLine({
        lane: AutoRemediationDecisionLane.Rule,
        reason: AutoRemediationDecisionReason.NotMatchedByAnyRule,
        rulesChecked: 1,
      });

      expect(one.tone).toBe("info");
      expect(one.text).toBe(
        "The 1 Auto Remediation Rule set up does not match this incident, so it was not fixed. With rules set up, only what matches one is fixed.",
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
        "None of the 3 Auto Remediation Rules set up match this alert, so it was not fixed. With rules set up, only what matches one is fixed.",
      );
      expect(hrefsOf(many)).toEqual([
        `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
      ]);
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
        "No Auto Remediation Rule that matches this incident fixes with OneUptime AI, so OneUptime AI did not fix it on the clusters or hosts it is linked to.",
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
      ).toBe("The 1 Auto Remediation Rule set up did not match this incident.");
      expect(
        onlyLine({
          lane: AutoRemediationDecisionLane.Rule,
          reason: AutoRemediationDecisionReason.NoRuleMatched,
          rulesChecked: 4,
        }).text,
      ).toBe(
        "None of the 4 Auto Remediation Rules set up matched this incident.",
      );
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
        "Enable AI is off for this project, so nothing is fixed automatically: no cluster or resource fix and no Auto Remediation Rule runs.",
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

import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  getRemediationDecisionLines,
  RemediationDecision,
  RemediationDecisionLine,
  RemediationDecisionSignal,
  RemediationDecisionTone,
  RemediationSwitchesNow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import {
  getRemediationStepStatus,
  REMEDIATION_STEP_STATUS_TEXT,
  RemediationStepStatus,
  RemediationStepTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
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
 * EVERY REASON REMEDIATION STOPS REACHES THE AI CARD (block 43): "If no
 * remediation is happening because of some error, show why remediation
 * doesn't happen, so I know what things to fix as well."
 *
 * For every reason the engine writes down when it decides how to fix an
 * incident or alert (AutoRemediationDecisionReason), the Remediation step
 * draws a line - but for the two that only say another lane took the
 * signal - in the tone the engine's own classification gives it
 * (AutoRemediationDecisionHelper: acted, needs the reader, or just so), and
 * the step's pill says the same before a line is read: Needs attention
 * when any line needs the reader, Fixing... when one acted and none does,
 * and otherwise that no action was taken. Any mix of entries, for either
 * kind of record, keeps to it.
 */

const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const RUNBOOK_ID: string = "77777777-7777-4777-8777-777777777777";

const PROJECT_REASONS: Array<AutoRemediationDecisionReason> = [
  AutoRemediationDecisionReason.EnableAiOff,
  AutoRemediationDecisionReason.RemediationOff,
  AutoRemediationDecisionReason.SuggestionLimitReached,
  AutoRemediationDecisionReason.EvaluationFailed,
  AutoRemediationDecisionReason.AiPickingRunbook,
  AutoRemediationDecisionReason.AiRunbookPickNotStarted,
  AutoRemediationDecisionReason.AiFixingThroughMcpServers,
  AutoRemediationDecisionReason.AiMcpFixNotStarted,
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

// A lane that only says the other lane took the signal says nothing.
const SILENT_REASONS: Array<AutoRemediationDecisionReason> = [
  AutoRemediationDecisionReason.ClusterSkippedForResourceRound,
  AutoRemediationDecisionReason.ResourceSkippedForClusterRound,
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
    entry.ruleId = RULE_ID;
    entry.ruleName = "Restart checkout";
    entry.runbookId = RUNBOOK_ID;
    entry.runbookName = "Restart pods";
    entry.rulesChecked = 2;
  }

  return entry;
}

function evaluated(
  entries: Array<AutoRemediationDecisionEntry>,
): RemediationDecision {
  return { stage: AutoRemediationDecisionStage.Evaluated, entries };
}

function linesOf(
  entries: Array<AutoRemediationDecisionEntry>,
  signal: RemediationDecisionSignal = "incident",
  switchesNow?: RemediationSwitchesNow,
): Array<RemediationDecisionLine> {
  return getRemediationDecisionLines({
    decision: evaluated(entries),
    signal,
    translator: getGlobalTranslator(),
    ...(switchesNow ? { switchesNow } : {}),
  });
}

// The step's pill for a decision with no fix and no fix in the code.
function pillOf(
  entries: Array<AutoRemediationDecisionEntry>,
  lines: Array<RemediationDecisionLine>,
): RemediationStepStatus {
  return getRemediationStepStatus({
    isLoaded: true,
    decision: evaluated(entries),
    lines,
    fixes: [],
    investigationStage: "reported",
    codeFix: null,
    isOffByChoice: false,
  });
}

function toneOf(line: RemediationDecisionLine): RemediationDecisionTone {
  return line.tone;
}

// The tone the engine's own classification gives one entry.
function engineToneOf(
  entry: AutoRemediationDecisionEntry,
): RemediationDecisionTone {
  if (AutoRemediationDecisionHelper.needsAttention(entry)) {
    return "attention";
  }

  return AutoRemediationDecisionHelper.isActed(entry) ? "acted" : "info";
}

const PILL_BY_LINE_TONE: Record<
  RemediationDecisionTone,
  { tone: RemediationStepTone; text: string }
> = {
  attention: {
    tone: "attention",
    text: REMEDIATION_STEP_STATUS_TEXT.needsAttention,
  },
  acted: { tone: "live", text: REMEDIATION_STEP_STATUS_TEXT.fixing },
  info: { tone: "idle", text: REMEDIATION_STEP_STATUS_TEXT.noActionTaken },
  waiting: { tone: "waiting", text: REMEDIATION_STEP_STATUS_TEXT.waiting },
};

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

describe("every reason the engine records", () => {
  test("draws a line, but for the two that only say another lane took the signal", () => {
    const silent: Array<AutoRemediationDecisionReason> = ALL_REASONS.filter(
      (reason: AutoRemediationDecisionReason): boolean => {
        return linesOf([entryFor(reason)]).length === 0;
      },
    );

    expect(silent.sort()).toEqual([...SILENT_REASONS].sort());
    // Not vacuous: the enum holds every reason the engine writes.
    expect(ALL_REASONS.length).toBeGreaterThan(40);
  });

  test.each(
    ALL_REASONS.filter((reason: AutoRemediationDecisionReason) => {
      return !SILENT_REASONS.includes(reason);
    }),
  )(
    "%s: its line has words and the engine's tone, and the pill says the same",
    (reason: AutoRemediationDecisionReason) => {
      for (const signal of [
        "incident",
        "alert",
      ] as Array<RemediationDecisionSignal>) {
        const entry: AutoRemediationDecisionEntry = entryFor(reason);
        const lines: Array<RemediationDecisionLine> = linesOf([entry], signal);

        expect(lines.length).toBeGreaterThan(0);
        expect(lines[0]!.text.trim().length).toBeGreaterThan(10);
        // Never the engine's own name for the reason.
        expect(lines[0]!.text).not.toContain(reason);
        expect({ reason, signal, tone: lines[0]!.tone }).toEqual({
          reason,
          signal,
          tone: engineToneOf(entry),
        });

        const pill: RemediationStepStatus = pillOf([entry], lines);
        expect({ reason, signal, pill }).toEqual({
          reason,
          signal,
          pill: PILL_BY_LINE_TONE[lines[0]!.tone],
        });
      }
    },
  );

  /*
   * A switch that stopped fixing and is on now: the line asks the reader to
   * act - Try again decides again - so the pill needs attention, though the
   * engine wrote the reason down as a choice.
   */
  test("a switch off then and on now needs the reader: Try again", () => {
    const fixingOff: AutoRemediationDecisionEntry = entryFor(
      AutoRemediationDecisionReason.RemediationOff,
    );
    expect(engineToneOf(fixingOff)).toBe("info");

    const lines: Array<RemediationDecisionLine> = linesOf(
      [fixingOff],
      "incident",
      { isFixingOn: true },
    );
    expect(lines.map(toneOf)).toEqual(["attention"]);
    expect(pillOf([fixingOff], lines)).toEqual(PILL_BY_LINE_TONE.attention);

    const aiOff: AutoRemediationDecisionEntry = entryFor(
      AutoRemediationDecisionReason.EnableAiOff,
    );
    const aiLines: Array<RemediationDecisionLine> = linesOf([aiOff], "alert", {
      isAiOn: true,
    });
    expect(aiLines.map(toneOf)).toEqual(["attention"]);
  });
});

/*
 * Any mix of entries, in any order, for either kind of record: the pill
 * needs attention exactly when the engine says an entry does (or the record
 * is linked to nothing at all), says OneUptime AI is fixing exactly when an
 * entry acted and none needs the reader, and otherwise that no action was
 * taken.
 */
describe("any mix of entries", () => {
  test("keeps the pill to the engine's classification", () => {
    const random: SeededRandom = seededRandom(4301);
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
      const pill: RemediationStepStatus = pillOf(entries, lines);

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
      const expected: RemediationStepTone = needsAttention
        ? "attention"
        : acted
          ? "live"
          : "idle";

      checked.add(expected);
      expect({ entries, signal, pill: pill.tone }).toEqual({
        entries,
        signal,
        pill: expected,
      });
    }

    // The sweep reached every pill a decision alone can have.
    expect(Array.from(checked).sort()).toEqual(
      ["attention", "idle", "live"].sort(),
    );
  });
});

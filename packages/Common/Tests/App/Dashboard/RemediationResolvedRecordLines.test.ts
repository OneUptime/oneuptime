import { describe, expect, test } from "@jest/globals";
import {
  AFFECTED_RESOURCES_PLACE_ID,
  LINK_MONITOR_FOR_NEXT_TIME,
  TURN_FIXES_ON_WHAT_TO_DO,
  getRemediationDecisionLines,
  RemediationDecisionLine,
  RemediationDecisionSignal,
  RemediationSwitchesNow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import {
  getRemediationStepStatus,
  REMEDIATION_STEP_STATUS_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepStatus";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * WHAT THE REMEDIATION STEP SAYS OF A RESOLVED RECORD (#5303's follow-up).
 *
 * OneUptime AI decides again about an incident or alert only while it is
 * open: once it is linked to what it is about, once a cluster's or a
 * resource's Fixes are turned on, on Try again. A resolved record's step
 * said "Add the host, cluster or database it is about under Affected
 * Resources, and OneUptime AI tries again" all the same, with a button to
 * go and do it - for a record nothing would be tried again on.
 *
 *   - a resolved record's lines promise nothing: no "tries again", no place
 *     to go and link it;
 *   - what still helps is said: a record with monitors says how the next
 *     one it raises is linked;
 *   - nothing on it needs the reader any more: a line that asked for them
 *     only so OneUptime AI could try again on this record is a fact, so the
 *     step's pill is not "Needs attention";
 *   - an open record whose cluster's or resource's Fixes were off says that
 *     turning them on tries again - which it now does.
 */

const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";
const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";

function linesOf(data: {
  entries: Array<AutoRemediationDecisionEntry>;
  isRecordResolved?: boolean;
  signal?: RemediationDecisionSignal;
  switchesNow?: RemediationSwitchesNow;
}): Array<RemediationDecisionLine> {
  return getRemediationDecisionLines({
    decision: {
      stage: AutoRemediationDecisionStage.Evaluated,
      entries: data.entries,
    },
    signal: data.signal || "incident",
    translator: getGlobalTranslator(),
    ...(data.switchesNow ? { switchesNow: data.switchesNow } : {}),
    ...(data.isRecordResolved !== undefined
      ? { isRecordResolved: data.isRecordResolved }
      : {}),
  });
}

function said(lines: Array<RemediationDecisionLine>): string {
  return lines
    .map((line: RemediationDecisionLine): string => {
      return [line.text, line.why || "", line.whatToDo || ""].join(" ");
    })
    .join(" ");
}

const NOTHING_LINKED: Array<AutoRemediationDecisionEntry> = [
  {
    lane: AutoRemediationDecisionLane.KubernetesCluster,
    reason: AutoRemediationDecisionReason.ClusterNoneLinked,
  },
  {
    lane: AutoRemediationDecisionLane.Resource,
    reason: AutoRemediationDecisionReason.ResourceNoneLinked,
  },
];

const NOTHING_LINKED_WITH_A_MONITOR: Array<AutoRemediationDecisionEntry> = [
  {
    lane: AutoRemediationDecisionLane.KubernetesCluster,
    reason: AutoRemediationDecisionReason.ClusterNoneLinked,
    monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
  },
  {
    lane: AutoRemediationDecisionLane.Resource,
    reason: AutoRemediationDecisionReason.ResourceNoneLinked,
    monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
  },
];

const CLUSTER_FIXES_OFF: AutoRemediationDecisionEntry = {
  lane: AutoRemediationDecisionLane.KubernetesCluster,
  reason: AutoRemediationDecisionReason.ClusterFixesOff,
  kubernetesClusterId: CLUSTER_ID,
  kubernetesClusterName: "prod-eu",
};

function resourceFixesOff(
  resourceType: string,
  resourceName: string,
): AutoRemediationDecisionEntry {
  return {
    lane: AutoRemediationDecisionLane.Resource,
    reason: AutoRemediationDecisionReason.ResourceFixesOff,
    resourceType,
    resourceId: RESOURCE_ID,
    resourceName,
  };
}

describe("linked to nothing, once the record is resolved", () => {
  test("says what happened, and neither that OneUptime AI tries again nor where to go to link it", () => {
    const [line] = linesOf({
      entries: NOTHING_LINKED,
      isRecordResolved: true,
    }) as [RemediationDecisionLine];

    expect(line.text).toBe(
      "This incident is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
    );
    expect(line.whatToDo).toBeUndefined();
    expect(line.place).toBeUndefined();
    expect(line.links).toEqual([]);
    // A fact now: nothing on it needs the reader.
    expect(line.tone).toBe("info");
  });

  test("with a monitor: how the next one is linked, and the link to its monitor - never a try again", () => {
    goTo(`/dashboard/${PROJECT_ID}/incidents`);
    const [line] = linesOf({
      entries: NOTHING_LINKED_WITH_A_MONITOR,
      isRecordResolved: true,
    }) as [RemediationDecisionLine];

    expect(line.whatToDo).toBe(
      "Link its monitor to what it watches, and every incident it raises from then on is linked for you.",
    );
    expect(line.place).toBeUndefined();
    expect(
      line.links.map((link: { text: string }): string => {
        return link.text;
      }),
    ).toEqual(["Link Checkout website"]);
    expect(said([line])).not.toContain("tries again");
  });

  test("an alert's says alert", () => {
    const [line] = linesOf({
      entries: NOTHING_LINKED_WITH_A_MONITOR,
      isRecordResolved: true,
      signal: "alert",
    }) as [RemediationDecisionLine];

    expect(line.text).toBe(
      "This alert is not linked to a host, cluster or database, so OneUptime AI had nothing to fix.",
    );
    expect(line.whatToDo).toBe(
      "Link its monitor to what it watches, and every alert it raises from then on is linked for you.",
    );
  });

  test("the words of the resolved line are the second half of the open one's, word for word", () => {
    const open: RemediationDecisionLine = linesOf({
      entries: NOTHING_LINKED_WITH_A_MONITOR,
    })[0]!;
    const resolved: RemediationDecisionLine = linesOf({
      entries: NOTHING_LINKED_WITH_A_MONITOR,
      isRecordResolved: true,
    })[0]!;

    expect(open.whatToDo?.endsWith(` ${resolved.whatToDo}`)).toBe(true);
    expect(LINK_MONITOR_FOR_NEXT_TIME).toContain("{{signal}}");
  });

  test("while it is open, the line still asks for the link and says OneUptime AI tries again", () => {
    const [line] = linesOf({ entries: NOTHING_LINKED }) as [
      RemediationDecisionLine,
    ];

    expect(line.tone).toBe("attention");
    expect(line.whatToDo).toBe(
      "Add the host, cluster or database it is about under Affected Resources, and OneUptime AI tries again.",
    );
    expect(line.place?.placeId).toBe(AFFECTED_RESOURCES_PLACE_ID);
  });

  test("open is the default: a page that does not say is not taken for resolved", () => {
    expect(
      linesOf({ entries: NOTHING_LINKED, isRecordResolved: false })[0],
    ).toEqual(linesOf({ entries: NOTHING_LINKED })[0]);
  });
});

describe("a cluster's or a resource's Fixes were off", () => {
  test("while the record is open, turning them on tries again", () => {
    goTo(`/dashboard/${PROJECT_ID}/incidents`);
    const [line] = linesOf({ entries: [CLUSTER_FIXES_OFF] }) as [
      RemediationDecisionLine,
    ];

    expect(line.text).toBe(
      'Fixes are off for cluster "prod-eu", so OneUptime AI only investigates there.',
    );
    expect(line.whatToDo).toBe(
      "Turn its Fixes on, and OneUptime AI tries again.",
    );
    expect(TURN_FIXES_ON_WHAT_TO_DO).toBe(line.whatToDo);
    // Off is a choice: a fact, with the page where they are turned on.
    expect(line.tone).toBe("info");
    expect(
      line.links.map((link: { route: { toString: () => string } }) => {
        return link.route.toString();
      }),
    ).toEqual([`/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`]);
  });

  test.each([
    [AiResourceType.Host, "test01", `/host/${RESOURCE_ID}/ai/agent`],
    [AiResourceType.DockerHost, "web-1", `/docker/${RESOURCE_ID}/ai/agent`],
    [
      AiResourceType.DatabaseServer,
      "orders-db",
      `/databases/${RESOURCE_ID}/ai/agent`,
    ],
    // A cloud account's Fixes are on its own AI agent page too.
    [
      AiResourceType.AwsAccount,
      "prod (123456789012)",
      `/accounts/${RESOURCE_ID}/ai/agent`,
    ],
    [
      AiResourceType.GoogleCloudProject,
      "acme-prod",
      `/accounts/${RESOURCE_ID}/ai/agent`,
    ],
  ])(
    "%s: turning them on tries again, from its AI agent page",
    (resourceType: string, name: string, pagePath: string) => {
      goTo(`/dashboard/${PROJECT_ID}/incidents`);
      const [line] = linesOf({
        entries: [resourceFixesOff(resourceType, name)],
      }) as [RemediationDecisionLine];

      expect(line.whatToDo).toBe(
        "Turn its Fixes on, and OneUptime AI tries again.",
      );
      expect(line.links).toHaveLength(1);
      expect(line.links[0]!.route.toString().endsWith(pagePath)).toBe(true);
    },
  );

  test("once the record is resolved, turning them on is not said to try again", () => {
    const lines: Array<RemediationDecisionLine> = linesOf({
      entries: [CLUSTER_FIXES_OFF, resourceFixesOff(AiResourceType.Host, "a")],
      isRecordResolved: true,
    });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.whatToDo).toBeUndefined();
      // Where they are turned on is still linked, for the next one.
      expect(line.links).toHaveLength(1);
    }
  });
});

describe("a switch turned on since, once the record is resolved", () => {
  test.each([
    [
      AutoRemediationDecisionReason.RemediationOff,
      { isFixingOn: true },
      '"Fix new incidents automatically" was off when OneUptime AI checked this incident. It is on now.',
    ],
    [
      AutoRemediationDecisionReason.EnableAiOff,
      { isAiOn: true },
      "Enable AI was off when OneUptime AI checked this incident. It is on now.",
    ],
  ])(
    "%s says what happened as a fact: Try again is not offered on it",
    (
      reason: AutoRemediationDecisionReason,
      switchesNow: RemediationSwitchesNow,
      text: string,
    ) => {
      const entries: Array<AutoRemediationDecisionEntry> = [
        { lane: AutoRemediationDecisionLane.Project, reason },
      ];

      const open: RemediationDecisionLine = linesOf({
        entries,
        switchesNow,
      })[0]!;
      const resolved: RemediationDecisionLine = linesOf({
        entries,
        switchesNow,
        isRecordResolved: true,
      })[0]!;

      expect(open.tone).toBe("attention");
      expect(resolved.tone).toBe("info");
      expect(resolved.text).toBe(text);
      expect(resolved.text).toBe(open.text);
    },
  );

  test("a switch still off says so the same way, open or resolved: it is the project's to turn on", () => {
    const entries: Array<AutoRemediationDecisionEntry> = [
      {
        lane: AutoRemediationDecisionLane.Project,
        reason: AutoRemediationDecisionReason.EnableAiOff,
      },
    ];

    expect(linesOf({ entries, isRecordResolved: true })).toEqual(
      linesOf({ entries }),
    );
  });
});

describe("no line of a resolved record says OneUptime AI tries again", () => {
  /*
   * Every reason the engine records, each with every name it may carry, on
   * a resolved incident and a resolved alert, with the switches on and off.
   */
  const ALL_ENTRIES: Array<AutoRemediationDecisionEntry> = Object.values(
    AutoRemediationDecisionReason,
  ).map((reason: AutoRemediationDecisionReason) => {
    return {
      lane: reason.startsWith("Cluster")
        ? AutoRemediationDecisionLane.KubernetesCluster
        : reason.startsWith("Resource")
          ? AutoRemediationDecisionLane.Resource
          : reason.startsWith("Rule") ||
              reason.startsWith("NoRule") ||
              reason.includes("Rule")
            ? AutoRemediationDecisionLane.Rule
            : AutoRemediationDecisionLane.Project,
      reason,
      kubernetesClusterId: CLUSTER_ID,
      kubernetesClusterName: "prod-eu",
      resourceType: AiResourceType.Host,
      resourceId: RESOURCE_ID,
      resourceName: "test01",
      ruleName: "Checkout",
      runbookName: "Restart checkout",
      rulesChecked: 2,
      monitors: [{ id: MONITOR_ID, name: "Checkout website" }],
    };
  });

  test.each([
    ["incident", {}],
    ["incident", { isAiOn: true, isFixingOn: true }],
    ["alert", {}],
    ["alert", { isAiOn: true, isFixingOn: true }],
  ] as Array<[RemediationDecisionSignal, RemediationSwitchesNow]>)(
    "a resolved %s, switches %j",
    (
      signal: RemediationDecisionSignal,
      switchesNow: RemediationSwitchesNow,
    ) => {
      for (const entry of ALL_ENTRIES) {
        const lines: Array<RemediationDecisionLine> = linesOf({
          entries: [entry],
          isRecordResolved: true,
          signal,
          switchesNow,
        });

        expect({ reason: entry.reason, said: said(lines) }).toEqual({
          reason: entry.reason,
          said: expect.not.stringContaining("tries again"),
        });

        for (const line of lines) {
          expect({ reason: entry.reason, place: line.place }).toEqual({
            reason: entry.reason,
            place: undefined,
          });
        }
      }

      // Linked to nothing too, folded into its one line.
      expect(
        said(
          linesOf({
            entries: NOTHING_LINKED_WITH_A_MONITOR,
            isRecordResolved: true,
            signal,
            switchesNow,
          }),
        ),
      ).not.toContain("tries again");
    },
  );

  test("while open, only what a link or Fixes turned on decides again says it tries again", () => {
    const sayingTriesAgain: Array<string> = [];

    for (const entry of ALL_ENTRIES) {
      if (said(linesOf({ entries: [entry] })).includes("tries again")) {
        sayingTriesAgain.push(entry.reason);
      }
    }

    expect(sayingTriesAgain.sort()).toEqual(
      [
        AutoRemediationDecisionReason.ClusterFixesOff,
        AutoRemediationDecisionReason.ResourceFixesOff,
      ].sort(),
    );
    expect(said(linesOf({ entries: NOTHING_LINKED }))).toContain("tries again");
  });
});

describe("the step's pill for a resolved record", () => {
  test("linked to nothing: no action taken, not needs attention", () => {
    const decision: {
      stage: AutoRemediationDecisionStage;
      entries: Array<AutoRemediationDecisionEntry>;
    } = {
      stage: AutoRemediationDecisionStage.Evaluated,
      entries: NOTHING_LINKED,
    };

    const resolved: { text: string } = getRemediationStepStatus({
      isLoaded: true,
      decision,
      lines: linesOf({ entries: NOTHING_LINKED, isRecordResolved: true }),
      fixes: [],
      investigationStage: "reported",
      isOffByChoice: false,
    });
    const open: { text: string } = getRemediationStepStatus({
      isLoaded: true,
      decision,
      lines: linesOf({ entries: NOTHING_LINKED }),
      fixes: [],
      investigationStage: "reported",
      isOffByChoice: false,
    });

    expect(open.text).toBe(REMEDIATION_STEP_STATUS_TEXT.needsAttention);
    expect(resolved.text).toBe(REMEDIATION_STEP_STATUS_TEXT.noActionTaken);
  });
});

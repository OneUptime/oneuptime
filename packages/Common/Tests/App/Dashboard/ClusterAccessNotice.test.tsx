import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import ClusterAccessNotice, {
  CLUSTER_AI_AGENT_PAGE_LINK_TEXT,
  CLUSTER_KUBECTL_RUNNER_NAME,
  ClusterAccessNoticeRow,
  DATA_ONLY_RUN_TEXT,
  describeFinishedRunKubectlUsage,
  FinishedRunKubectlUsage,
  getClusterAccessSignature,
  getClusterAiAgentPageRoute,
  NO_KUBECTL_RUN_TEXT,
  parseClusterAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ClusterAccessNotice";
import { KubectlActivitySummary } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The notice sits above an investigation report and answers "could AI use
 * kubectl here?". It is fed the clusters' CURRENT readiness (the API
 * computes it at request time), so the one thing it must never do is turn
 * that into a claim about a run that finished earlier: turning investigation
 * off after a run must not make the report say the run "investigated with
 * OneUptime data only" above a usage line counting five kubectl commands.
 * What the run did comes from the run's own events (kubectlActivity).
 */

const CLUSTER_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const OTHER_CLUSTER_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";

const INVESTIGATION_DISABLED_GAP: KubernetesAiAccessGap = {
  code: "investigation_disabled",
  title: "Investigation is off",
  description: "AI may not run kubectl on this cluster.",
  nextStep:
    "Turn on 'Investigate with kubectl' on the cluster's AI agent page (AI → Agent).",
  blocks: "investigation",
};

const REMEDIATION_ONLY_GAP: KubernetesAiAccessGap = {
  code: "remediation_disabled",
  title: "Remediation is off",
  description: "AI only proposes.",
  nextStep: "Choose a remediation mode.",
  blocks: "remediation",
};

function makeStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-east",
    runner: null,
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

function unreachable(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return makeStatus({
    isInvestigationReady: false,
    gaps: [INVESTIGATION_DISABLED_GAP],
    ...overrides,
  });
}

function noticeText(): string {
  return screen.getByTestId("cluster-access-notice").textContent || "";
}

/*
 * A row's tone is carried by its icon alone: the notice draws no green,
 * amber or gray box of its own inside the investigation card.
 */
function toneIconClass(row: HTMLElement): string {
  return row.querySelector("svg")?.getAttribute("class") || "";
}

function activity(
  overrides: Partial<KubectlActivitySummary> = {},
): KubectlActivitySummary {
  return {
    executed: 0,
    succeeded: 0,
    notRun: 0,
    clusterToolCalls: 0,
    ...overrides,
  };
}

// A run whose every kubectl command ran and succeeded.
function ranCommands(count: number): KubectlActivitySummary {
  return activity({
    executed: count,
    succeeded: count,
    clusterToolCalls: count,
  });
}

function usageText(summary: KubectlActivitySummary): string {
  return describeFinishedRunKubectlUsage(summary)?.text || "";
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${CLUSTER_ID}/overview`);
});

afterEach(() => {
  cleanup();
});

describe("describeFinishedRunKubectlUsage", () => {
  test("says nothing when the run's usage is unknown", () => {
    expect(describeFinishedRunKubectlUsage(undefined)).toBeNull();
  });

  test("reports a data-only run", () => {
    expect(describeFinishedRunKubectlUsage(activity())).toEqual({
      text: DATA_ONLY_RUN_TEXT,
      tone: "none",
    });
  });

  test("counts the commands the run made, singular and plural", () => {
    expect(describeFinishedRunKubectlUsage(ranCommands(1))).toEqual({
      text: "OneUptime AI ran 1 read-only kubectl command during this investigation.",
      tone: "ran",
    });
    expect(describeFinishedRunKubectlUsage(ranCommands(5))).toEqual({
      text: "OneUptime AI ran 5 read-only kubectl commands during this investigation.",
      tone: "ran",
    });
  });

  test("never reports a negative or fractional count", () => {
    expect(usageText(activity({ executed: -3, succeeded: -3 }))).toBe(
      DATA_ONLY_RUN_TEXT,
    );
    expect(usageText(activity({ executed: 2.7, succeeded: 2.7 }))).toContain(
      "ran 2 ",
    );
  });

  /*
   * The review's scenario: the in-cluster Runner was evicted but still
   * read as online, and all three commands went unclaimed. Nothing ran,
   * so the notice must not say the run inspected the cluster.
   */
  test("never says a run ran commands that never reached kubectl", () => {
    const usage: FinishedRunKubectlUsage | null =
      describeFinishedRunKubectlUsage(activity({ notRun: 3 }));

    expect(usage?.tone).toBe("failed");
    expect(usage?.text).not.toContain("ran 3");
    expect(usage?.text).toBe(
      "OneUptime AI tried 3 read-only kubectl commands, but none ran on the cluster — the cluster's AI agent or Runner did not pick them up, or they were refused. This investigation used OneUptime data only; see Investigation activity for why.",
    );
    expect(usageText(activity({ notRun: 1 }))).toContain(
      "did not pick it up, or it was refused",
    );
  });

  test("does not present commands that all returned an error as an inspection", () => {
    const usage: FinishedRunKubectlUsage | null =
      describeFinishedRunKubectlUsage(activity({ executed: 3, succeeded: 0 }));

    expect(usage?.tone).toBe("failed");
    expect(usage?.text).not.toContain("ran 3 read-only");
    expect(usage?.text).toBe(
      "OneUptime AI tried 3 read-only kubectl commands, but none succeeded — kubectl returned an error for all 3 that ran. See Investigation activity for each result.",
    );
    expect(usageText(activity({ executed: 1, succeeded: 0, notRun: 2 }))).toBe(
      "OneUptime AI tried 3 read-only kubectl commands, but none succeeded — kubectl returned an error for the one that ran and 2 could not run. See Investigation activity for each result.",
    );
  });

  test("counts only commands that ran as run, and names the rest separately", () => {
    expect(
      describeFinishedRunKubectlUsage(
        activity({ executed: 3, succeeded: 1, notRun: 2 }),
      ),
    ).toEqual({
      text: "OneUptime AI ran 3 read-only kubectl commands during this investigation (2 returned an error; 2 more could not run — see Investigation activity).",
      tone: "ran",
    });
    expect(usageText(activity({ executed: 2, succeeded: 2, notRun: 1 }))).toBe(
      "OneUptime AI ran 2 read-only kubectl commands during this investigation (1 more could not run — see Investigation activity).",
    );
  });

  test("never trusts a succeeded count above the commands that ran", () => {
    expect(usageText(activity({ executed: 1, succeeded: 4 }))).toBe(
      "OneUptime AI ran 1 read-only kubectl command during this investigation.",
    );
  });

  /*
   * IP-1: the cluster's AI agent or Runner took the command, kubectl
   * finished, and the result never came back (a lost result POST, a pod
   * killed right after). It may have run, so it is never "did not pick it
   * up, or it was refused" — and never "ran" either.
   */
  test("never says a command whose result never came back was not picked up or refused", () => {
    const usage: FinishedRunKubectlUsage | null =
      describeFinishedRunKubectlUsage(activity({ unknown: 1 }));

    expect(usage?.tone).toBe("failed");
    expect(usage?.text).toBe(
      "OneUptime AI tried 1 read-only kubectl command, but no result came back from the cluster — the cluster's AI agent or Runner took it but never reported back, so whether it ran is unknown. This investigation used OneUptime data only; see Investigation activity for why.",
    );
    expect(usage?.text).not.toContain("did not pick");
    expect(usage?.text).not.toContain("refused");
    expect(usage?.text).not.toContain("none ran");
    expect(usageText(activity({ unknown: 2 }))).toContain(
      "the cluster's AI agent or Runner took them but never reported back, so whether they ran is unknown",
    );
  });

  test("names commands that could not run and commands whose result never came back apart", () => {
    expect(usageText(activity({ notRun: 1, unknown: 2 }))).toBe(
      "OneUptime AI tried 3 read-only kubectl commands, but no result came back from the cluster — 1 could not run (the cluster's AI agent or Runner did not pick it up, or it was refused), and 2 more were picked up but never reported back. This investigation used OneUptime data only; see Investigation activity for why.",
    );
    expect(
      usageText(activity({ executed: 1, succeeded: 0, notRun: 1, unknown: 1 })),
    ).toBe(
      "OneUptime AI tried 3 read-only kubectl commands, but none succeeded — kubectl returned an error for the one that ran and 1 could not run and 1 returned no result (whether it ran is unknown). See Investigation activity for each result.",
    );
    expect(
      describeFinishedRunKubectlUsage(
        activity({ executed: 2, succeeded: 2, unknown: 1 }),
      ),
    ).toEqual({
      text: "OneUptime AI ran 2 read-only kubectl commands during this investigation (1 more returned no result, so whether it ran is unknown — see Investigation activity).",
      tone: "ran",
    });
  });

  // Negative control: without the new bucket, the wording is unchanged.
  test("keeps the never-ran wording when every command was unclaimed or refused", () => {
    expect(usageText(activity({ notRun: 2, unknown: 0 }))).toBe(
      "OneUptime AI tried 2 read-only kubectl commands, but none ran on the cluster — the cluster's AI agent or Runner did not pick them up, or they were refused. This investigation used OneUptime data only; see Investigation activity for why.",
    );
  });

  /*
   * Regression: an incident linked to a cluster and to a Docker host whose
   * investigation ran docker commands through the host's AI agent, and no
   * kubectl, was reported as having "used OneUptime data only".
   */
  describe("a run that ran commands on other infrastructure", () => {
    function withInfrastructure(
      overrides: Partial<KubectlActivitySummary> = {},
      executed: number = 3,
    ): KubectlActivitySummary {
      return activity({
        ...overrides,
        infrastructure: {
          executed,
          succeeded: executed,
          notRun: 0,
          unknown: 0,
        },
      });
    }

    test("says only that no kubectl ran, never that the run used OneUptime data only", () => {
      expect(describeFinishedRunKubectlUsage(withInfrastructure())).toEqual({
        text: NO_KUBECTL_RUN_TEXT,
        tone: "none",
      });
    });

    test("ends a tried-kubectl sentence without the data-only claim", () => {
      expect(usageText(withInfrastructure({ notRun: 2 }))).toBe(
        "OneUptime AI tried 2 read-only kubectl commands, but none ran on the cluster — the cluster's AI agent or Runner did not pick them up, or they were refused. See Investigation activity for why.",
      );
      expect(usageText(withInfrastructure({ unknown: 1 }))).toBe(
        "OneUptime AI tried 1 read-only kubectl command, but no result came back from the cluster — the cluster's AI agent or Runner took it but never reported back, so whether it ran is unknown. See Investigation activity for why.",
      );
    });

    test("keeps the kubectl wording when no infrastructure command ran", () => {
      const noneRan: KubectlActivitySummary = activity({
        infrastructure: { executed: 0, succeeded: 0, notRun: 2, unknown: 1 },
      });

      expect(usageText(noneRan)).toBe(DATA_ONLY_RUN_TEXT);
      expect(
        usageText({
          ...noneRan,
          notRun: 2,
        }),
      ).toContain(
        "This investigation used OneUptime data only; see Investigation activity for why.",
      );
      expect(usageText(withInfrastructure({}, 0))).toBe(DATA_ONLY_RUN_TEXT);
    });

    test("leaves the wording of runs whose kubectl ran unchanged", () => {
      expect(
        usageText(
          withInfrastructure({
            executed: 2,
            succeeded: 2,
            clusterToolCalls: 2,
          }),
        ),
      ).toBe(
        "OneUptime AI ran 2 read-only kubectl commands during this investigation.",
      );
    });
  });
});

/*
 * A run's kubectl commands go to whatever reached the cluster when it ran:
 * the Kubernetes AI agent, the chart's previous in-cluster Runner, or an
 * advanced Runner an operator bound. The run's events do not say which,
 * and the cluster's current target may have changed since, so the notice
 * names both rather than blaming the wrong one.
 */
describe("who took a run's commands", () => {
  test("is named as the cluster's AI agent or Runner", () => {
    expect(CLUSTER_KUBECTL_RUNNER_NAME).toBe(
      "the cluster's AI agent or Runner",
    );
  });

  test("every sentence about commands that did not come back names both", () => {
    for (const summary of [
      activity({ notRun: 1 }),
      activity({ notRun: 3 }),
      activity({ unknown: 1 }),
      activity({ unknown: 2 }),
      activity({ notRun: 1, unknown: 1 }),
      activity({ notRun: 2, unknown: 3 }),
    ]) {
      const text: string = usageText(summary);
      expect(text).toContain(CLUSTER_KUBECTL_RUNNER_NAME);
      // Never the agent alone, never "the agent" as a stand-in for it.
      expect(text).not.toMatch(/the cluster's AI agent (?!or Runner)/);
      expect(text).not.toContain("the agent took");
      expect(text).not.toContain("the Runner took");
    }
  });

  test("says how many more were picked up but never reported back, in the right number", () => {
    expect(usageText(activity({ notRun: 1, unknown: 1 }))).toContain(
      "and 1 more was picked up but never reported back",
    );
    expect(usageText(activity({ notRun: 2, unknown: 3 }))).toContain(
      "2 could not run (the cluster's AI agent or Runner did not pick them up, or they were refused), and 3 more were picked up but never reported back",
    );
  });

  // Commands that reached kubectl need no one named: kubectl answered.
  test("is not named when every command reached kubectl", () => {
    for (const summary of [
      activity({ executed: 2, succeeded: 2 }),
      activity({ executed: 3, succeeded: 0 }),
      activity({ executed: 2, succeeded: 1, notRun: 1 }),
    ]) {
      expect(usageText(summary)).not.toContain(CLUSTER_KUBECTL_RUNNER_NAME);
    }
  });
});

describe("parseClusterAccess", () => {
  test("returns nothing for a missing or non-array field", () => {
    expect(parseClusterAccess(undefined)).toEqual([]);
    expect(parseClusterAccess(null)).toEqual([]);
    expect(parseClusterAccess({ clusterId: CLUSTER_ID })).toEqual([]);
  });

  test("keeps well-formed rows and drops malformed ones", () => {
    const good: KubernetesClusterAiAccessStatus = makeStatus();
    const rows: unknown = [
      good,
      null,
      "prod-east",
      { ...good, clusterId: "not-a-uuid" },
      { ...good, remediationMode: "Sometimes" },
      { ...good, gaps: "none" },
      { ...good, isInvestigationReady: "yes" },
      [good],
    ];

    expect(parseClusterAccess(rows)).toEqual([good]);
  });

  /*
   * A viewer who can read the incident but not the cluster gets only the
   * summary: no Runner, credential, allowlist, access method or last error.
   * That row must still be kept, and still explain itself.
   */
  test("keeps the summary row a viewer without cluster read receives", () => {
    const summary: ClusterAccessNoticeRow = {
      clusterId: CLUSTER_ID,
      clusterName: "prod-east",
      isInvestigationReady: false,
      isRemediationReady: false,
      remediationMode: KubernetesAiRemediationMode.RequireApproval,
      evaluatedAt: "2026-09-22T10:00:00.000Z",
      gaps: [
        {
          ...INVESTIGATION_DISABLED_GAP,
          description:
            "Someone who can view this Kubernetes cluster can see the details on its AI agent page.",
        },
      ],
    };

    expect(parseClusterAccess([summary])).toEqual([summary]);

    render(
      <ClusterAccessNotice
        clusterAccess={parseClusterAccess([summary])}
        isRunFinished={false}
      />,
    );

    const gapRow: HTMLElement = screen.getByTestId(
      "cluster-access-unreachable",
    );
    expect(gapRow).toHaveTextContent(
      'Investigating with OneUptime data only — no kubectl access to cluster "prod-east"',
    );
    expect(gapRow).toHaveTextContent("Why: Investigation is off.");
    expect(gapRow).toHaveTextContent(
      "What to do: Turn on 'Investigate with kubectl'",
    );
    expect(
      within(gapRow).getByText("Open the cluster's AI agent page"),
    ).toBeInTheDocument();
  });
});

/*
 * The panel commits a poll only when this signature changes. The API
 * stamps each row with the time it evaluated it and the Runner's latest
 * heartbeat, so the raw rows differ on every poll; the signature must not.
 */
describe("getClusterAccessSignature", () => {
  function signature(rows: Array<ClusterAccessNoticeRow>): string {
    return JSON.stringify(getClusterAccessSignature(rows));
  }

  function withRunner(
    overrides: Partial<KubernetesClusterAiAccessStatus> = {},
  ): KubernetesClusterAiAccessStatus {
    return makeStatus({
      runner: {
        id: OTHER_CLUSTER_ID,
        name: "kubernetes-agent/prod-east",
        isOnline: true,
        lastAliveAt: "2026-09-22T10:00:00.000Z",
        canRunAiCommands: true,
      },
      gaps: [INVESTIGATION_DISABLED_GAP],
      ...overrides,
    });
  }

  test("ignores the evaluation time, the Runner heartbeat and the last error", () => {
    const first: string = signature([withRunner()]);
    const second: string = signature([
      withRunner({
        evaluatedAt: "2026-09-22T10:00:30.123Z",
        lastError: "Exit code 1",
        runner: {
          id: OTHER_CLUSTER_ID,
          name: "kubernetes-agent/prod-east",
          isOnline: true,
          lastAliveAt: "2026-09-22T10:00:29.000Z",
          canRunAiCommands: true,
        },
      }),
    ]);

    expect(second).toBe(first);
  });

  test.each<[string, Partial<KubernetesClusterAiAccessStatus>]>([
    [
      "the remediation mode",
      { remediationMode: KubernetesAiRemediationMode.Disabled },
    ],
    ["investigation readiness", { isInvestigationReady: false }],
    ["remediation readiness", { isRemediationReady: false }],
    ["the cluster name", { clusterName: "prod-east-2" }],
    [
      "a gap's description under the same code",
      {
        gaps: [
          {
            ...INVESTIGATION_DISABLED_GAP,
            description: "AI may not run kubectl on this cluster any more.",
          },
        ],
      },
    ],
    [
      "a gap's next step",
      {
        gaps: [{ ...INVESTIGATION_DISABLED_GAP, nextStep: "Ask an admin." }],
      },
    ],
    ["the gaps themselves", { gaps: [] }],
  ])(
    "changes with %s",
    (_label: string, overrides: Partial<KubernetesClusterAiAccessStatus>) => {
      expect(signature([withRunner(overrides)])).not.toBe(
        signature([withRunner()]),
      );
    },
  );

  test("changes when a cluster is added", () => {
    expect(
      signature([
        withRunner(),
        makeStatus({ clusterId: OTHER_CLUSTER_ID, clusterName: "prod-west" }),
      ]),
    ).not.toBe(signature([withRunner()]));
  });
});

describe("ClusterAccessNotice", () => {
  test("renders nothing when the signal is not about any cluster", () => {
    const { container } = render(
      <ClusterAccessNotice
        clusterAccess={[]}
        isRunFinished={true}
        kubectlActivity={ranCommands(4)}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  describe("while the run is in progress", () => {
    test("speaks in the present tense about a reachable cluster", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={false}
        />,
      );

      expect(noticeText()).toContain(
        "OneUptime AI has read-only kubectl access to prod-east",
      );
      expect(noticeText()).toContain("fixes ask for your approval");
      expect(
        screen.queryByTestId("cluster-access-run-usage"),
      ).not.toBeInTheDocument();
    });

    test("says it is investigating with OneUptime data only when a cluster is unreachable", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[unreachable()]}
          isRunFinished={false}
        />,
      );

      expect(noticeText()).toContain(
        'Investigating with OneUptime data only — no kubectl access to cluster "prod-east"',
      );
      expect(noticeText()).toContain("Why: Investigation is off.");
      expect(noticeText()).toContain(
        "What to do: Turn on 'Investigate with kubectl'",
      );
    });

    test("ignores a command count while the run is still going", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={false}
          kubectlActivity={ranCommands(3)}
        />,
      );

      expect(
        screen.queryByTestId("cluster-access-run-usage"),
      ).not.toBeInTheDocument();
      expect(noticeText()).not.toContain("ran 3");
    });
  });

  describe("once the run has finished", () => {
    /*
     * The scenario from the review: the run made five kubectl calls, then an
     * admin turned investigation off. The report must still say the run ran
     * them, and say separately that AI cannot reach the cluster NOW.
     */
    test("reports the run's own kubectl usage even when access has since been removed", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[unreachable()]}
          isRunFinished={true}
          kubectlActivity={ranCommands(5)}
        />,
      );

      expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
        "OneUptime AI ran 5 read-only kubectl commands during this investigation.",
      );
      expect(noticeText()).not.toContain(
        "Investigated with OneUptime data only",
      );
      expect(noticeText()).not.toContain(DATA_ONLY_RUN_TEXT);

      const gapRow: HTMLElement = screen.getByTestId(
        "cluster-access-unreachable",
      );
      expect(gapRow).toHaveTextContent(
        'OneUptime AI cannot currently reach cluster "prod-east" with kubectl',
      );
      expect(gapRow).toHaveTextContent("Why: Investigation is off.");
      expect(gapRow).toHaveTextContent("What to do:");
    });

    // The mirror image: access granted after a run that never used kubectl.
    test("does not claim a data-only run had access that was granted afterwards", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={ranCommands(0)}
        />,
      );

      expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
        DATA_ONLY_RUN_TEXT,
      );
      expect(noticeText()).not.toContain("had read-only kubectl access");
      expect(screen.getByTestId("cluster-access-reachable")).toHaveTextContent(
        "OneUptime AI currently has read-only kubectl access to prod-east",
      );
    });

    test("reports a single command in the singular", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={ranCommands(1)}
        />,
      );

      expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
        "ran 1 read-only kubectl command during",
      );
    });

    /*
     * An older API replica, or a run whose events are unavailable: the
     * notice describes the configuration as it is now and makes no claim
     * either way about the run.
     */
    test("makes no claim about the run when its usage is unknown", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[
            makeStatus(),
            unreachable({
              clusterId: OTHER_CLUSTER_ID,
              clusterName: "prod-west",
            }),
          ]}
          isRunFinished={true}
        />,
      );

      expect(
        screen.queryByTestId("cluster-access-run-usage"),
      ).not.toBeInTheDocument();
      expect(noticeText()).not.toContain(" had ");
      expect(noticeText()).not.toContain(
        "Investigated with OneUptime data only",
      );
      expect(noticeText()).toContain(
        "OneUptime AI currently has read-only kubectl access to prod-east",
      );
      expect(noticeText()).toContain(
        'OneUptime AI cannot currently reach cluster "prod-west" with kubectl',
      );
    });

    test("a failed run is reported like a completed one", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[unreachable()]}
          isRunFinished={true}
          kubectlActivity={ranCommands(2)}
        />,
      );

      expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
        "ran 2 read-only kubectl commands",
      );
    });

    /*
     * The finding's scenario: the Runner pod was evicted but still read as
     * online, so every command went unclaimed. The panel used to show a
     * green "ran 3 read-only kubectl commands" above a report that
     * inspected nothing.
     */
    test("does not show a run whose kubectl calls never ran as an inspection", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={activity({ notRun: 3 })}
        />,
      );

      const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
      expect(usage).toHaveAttribute("data-tone", "failed");
      expect(toneIconClass(usage)).not.toContain("emerald");
      expect(toneIconClass(usage)).toContain("amber");
      expect(usage).not.toHaveTextContent("ran 3");
      expect(usage).toHaveTextContent("none ran on the cluster");
      expect(noticeText()).not.toContain("had read-only kubectl access");
    });

    test("says a run whose only command lost its result may have run it", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={activity({ unknown: 1 })}
        />,
      );

      const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
      expect(usage).toHaveAttribute("data-tone", "failed");
      expect(usage).toHaveTextContent("whether it ran is unknown");
      expect(usage).not.toHaveTextContent("did not pick");
      expect(usage).not.toHaveTextContent("refused");
    });

    test("does not show a run whose kubectl calls all returned an error as an inspection", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={activity({ executed: 3, succeeded: 0 })}
        />,
      );

      const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
      expect(usage).toHaveAttribute("data-tone", "failed");
      expect(toneIconClass(usage)).not.toContain("emerald");
      expect(toneIconClass(usage)).toContain("amber");
      expect(usage).toHaveTextContent("none succeeded");
      expect(usage).not.toHaveTextContent("ran 3 read-only");
    });

    test("keeps the inspection styling when at least one command succeeded, and names the rest", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={activity({ executed: 1, succeeded: 1, notRun: 2 })}
        />,
      );

      const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
      expect(usage).toHaveAttribute("data-tone", "ran");
      expect(toneIconClass(usage)).toContain("emerald");
      expect(usage).toHaveTextContent(
        "OneUptime AI ran 1 read-only kubectl command during this investigation (2 more could not run — see Investigation activity).",
      );
    });

    test("styles a data-only run as neither an inspection nor a failure", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={activity()}
        />,
      );

      const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
      expect(usage).toHaveAttribute("data-tone", "none");
      expect(toneIconClass(usage)).toContain("gray");
      expect(toneIconClass(usage)).not.toMatch(/emerald|amber/);
      expect(usage).toHaveTextContent(DATA_ONLY_RUN_TEXT);
    });

    test("never calls a run that ran commands on other infrastructure data-only", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={true}
          kubectlActivity={activity({
            clusterToolCalls: 3,
            infrastructure: {
              executed: 3,
              succeeded: 3,
              notRun: 0,
              unknown: 0,
            },
          })}
        />,
      );

      const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
      expect(usage).toHaveAttribute("data-tone", "none");
      expect(usage).toHaveTextContent(NO_KUBECTL_RUN_TEXT);
      expect(noticeText()).not.toContain("OneUptime data only");
    });
  });

  test("only gaps that block investigation explain an unreachable cluster", () => {
    render(
      <ClusterAccessNotice
        clusterAccess={[
          unreachable({
            gaps: [REMEDIATION_ONLY_GAP, INVESTIGATION_DISABLED_GAP],
          }),
        ]}
        isRunFinished={false}
      />,
    );

    const gapRow: HTMLElement = screen.getByTestId(
      "cluster-access-unreachable",
    );
    expect(gapRow).toHaveTextContent("Why: Investigation is off.");
    expect(gapRow).not.toHaveTextContent("Remediation is off");
    expect(gapRow).not.toHaveTextContent("more to fix");
  });

  test("counts the remaining investigation gaps beyond the first", () => {
    render(
      <ClusterAccessNotice
        clusterAccess={[
          unreachable({
            gaps: [
              INVESTIGATION_DISABLED_GAP,
              {
                code: "runner_offline",
                title: "Runner is offline",
                description: "No heartbeat.",
                nextStep: "Check the pod.",
                blocks: "both",
              },
            ],
          }),
        ]}
        isRunFinished={false}
      />,
    );

    expect(screen.getByTestId("cluster-access-unreachable")).toHaveTextContent(
      "(1 more to fix on the cluster's AI agent page.)",
    );
  });

  /*
   * The cluster's AI page is now two: AI → Insights and AI → Agent. The
   * notice's links go where access is fixed — the AI agent page — and not
   * to ".../ai", which only redirects there.
   */
  test("links every cluster to its AI agent page", () => {
    render(
      <ClusterAccessNotice
        clusterAccess={[
          makeStatus(),
          unreachable({
            clusterId: OTHER_CLUSTER_ID,
            clusterName: "prod-west",
          }),
        ]}
        isRunFinished={true}
        kubectlActivity={ranCommands(0)}
      />,
    );

    const reachableLink: HTMLElement = within(
      screen.getByTestId("cluster-access-reachable"),
    ).getByText("prod-east");
    expect(reachableLink.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`,
    );

    const fixLink: HTMLElement = within(
      screen.getByTestId("cluster-access-unreachable"),
    ).getByText(CLUSTER_AI_AGENT_PAGE_LINK_TEXT);
    expect(fixLink.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${OTHER_CLUSTER_ID}/ai/agent`,
    );
    expect(CLUSTER_AI_AGENT_PAGE_LINK_TEXT).toBe(
      "Open the cluster's AI agent page",
    );
  });

  test("the AI agent page route is the cluster's AI → Agent", () => {
    expect(getClusterAiAgentPageRoute(CLUSTER_ID).toString()).toBe(
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai/agent`,
    );
  });

  test("describes each remediation mode in plain words", () => {
    const cases: Array<[Partial<KubernetesClusterAiAccessStatus>, string]> = [
      [
        { remediationMode: KubernetesAiRemediationMode.Disabled },
        "fixes are off",
      ],
      [
        {
          remediationMode: KubernetesAiRemediationMode.Automatic,
          isRemediationReady: false,
        },
        "fixes are not ready",
      ],
      [
        { remediationMode: KubernetesAiRemediationMode.Automatic },
        "safe fixes run automatically",
      ],
      [
        { remediationMode: KubernetesAiRemediationMode.BypassApproval },
        "fixes run automatically, approvals bypassed",
      ],
      [
        { remediationMode: KubernetesAiRemediationMode.RequireApproval },
        "fixes ask for your approval",
      ],
    ];

    for (const [overrides, expected] of cases) {
      cleanup();
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus(overrides)]}
          isRunFinished={false}
        />,
      );
      expect(noticeText()).toContain(`(${expected})`);
    }
  });
});

/*
 * The notice used to add a green, amber or gray box per fact to a card that
 * already nested several. Each fact is now one line under a small icon, in
 * the card's own type, and only the icon carries the tone.
 */
describe("ClusterAccessNotice layout", () => {
  const BOX_CLASS: RegExp =
    /^(border|border-[a-z]+-\d+|ring-\d|ring-[a-z]+-\d+|shadow(-[a-z]+)?|rounded(-[a-z0-9]+)?|bg-[a-z0-9/-]+)$/;

  function boxClasses(element: Element): Array<string> {
    return (element.getAttribute("class") || "")
      .split(/\s+/)
      .filter((className: string): boolean => {
        return BOX_CLASS.test(className);
      });
  }

  function allRows(): Array<HTMLElement> {
    return [
      ...screen.queryAllByTestId("cluster-access-run-usage"),
      ...screen.queryAllByTestId("cluster-access-reachable"),
      ...screen.queryAllByTestId("cluster-access-unreachable"),
    ];
  }

  function renderEveryRow(isRunFinished: boolean): void {
    render(
      <ClusterAccessNotice
        clusterAccess={[
          makeStatus(),
          unreachable({
            clusterId: OTHER_CLUSTER_ID,
            clusterName: "staging-west",
          }),
        ]}
        isRunFinished={isRunFinished}
        kubectlActivity={
          isRunFinished ? activity({ executed: 1, succeeded: 1 }) : undefined
        }
      />,
    );
  }

  test.each([
    ["a finished run", true],
    ["a live run", false],
  ])(
    "draws every fact of %s as an icon and a sentence, with no box",
    (_label: string, isRunFinished: boolean) => {
      renderEveryRow(isRunFinished);

      const rows: Array<HTMLElement> = allRows();
      // The run's own usage line only exists once the run has finished.
      expect(rows).toHaveLength(isRunFinished ? 3 : 2);

      const notice: HTMLElement = screen.getByTestId("cluster-access-notice");
      expect(boxClasses(notice)).toEqual([]);

      for (const row of rows) {
        expect(boxClasses(row)).toEqual([]);
        // Every row opens with its icon, and nothing inside draws a box.
        expect(row.querySelector("svg")).not.toBeNull();
        for (const inner of Array.from(row.querySelectorAll("*"))) {
          if (inner.closest("a")) {
            continue;
          }
          expect(boxClasses(inner)).toEqual([]);
        }
      }
    },
  );

  test("keeps the text neutral and puts the tone on the icon alone", () => {
    renderEveryRow(true);

    const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
    const reachableRow: HTMLElement = screen.getByTestId(
      "cluster-access-reachable",
    );
    const unreachableRow: HTMLElement = screen.getByTestId(
      "cluster-access-unreachable",
    );

    expect(toneIconClass(usage)).toContain("emerald");
    expect(toneIconClass(reachableRow)).toContain("emerald");
    expect(toneIconClass(unreachableRow)).toContain("amber");

    for (const row of [usage, reachableRow, unreachableRow]) {
      for (const paragraph of Array.from(row.querySelectorAll("p"))) {
        const classes: string = paragraph.getAttribute("class") || "";
        expect(classes).toMatch(/text-gray-(600|900)/);
        expect(classes).not.toMatch(/emerald|amber/);
      }
    }
  });

  test("an unreachable cluster still says why, what to do and where to fix it", () => {
    renderEveryRow(true);

    const row: HTMLElement = screen.getByTestId("cluster-access-unreachable");
    expect(row).toHaveTextContent(
      'OneUptime AI cannot currently reach cluster "staging-west" with kubectl',
    );
    expect(row).toHaveTextContent(
      "Why: Investigation is off. AI may not run kubectl on this cluster.",
    );
    expect(row).toHaveTextContent(
      "What to do: Turn on 'Investigate with kubectl' on the cluster's AI agent page (AI → Agent).",
    );
    expect(
      within(row).getByRole("link", { name: CLUSTER_AI_AGENT_PAGE_LINK_TEXT }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${OTHER_CLUSTER_ID}/ai/agent`,
    );
  });

  test("never nests a block inside a paragraph", () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );

    try {
      renderEveryRow(true);

      expect(
        screen.getByTestId("cluster-access-notice").querySelectorAll("p div"),
      ).toHaveLength(0);
      expect(
        consoleError.mock.calls.some((args: Array<unknown>): boolean => {
          return args.some((value: unknown): boolean => {
            return (
              typeof value === "string" && value.includes("validateDOMNesting")
            );
          });
        }),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

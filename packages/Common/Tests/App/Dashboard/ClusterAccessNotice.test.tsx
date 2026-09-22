import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import ClusterAccessNotice, {
  DATA_ONLY_RUN_TEXT,
  describeFinishedRunKubectlUsage,
  parseClusterAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ClusterAccessNotice";
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
 * What the run did comes from the run's own events (clusterCommandCount).
 */

const CLUSTER_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const OTHER_CLUSTER_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";

const INVESTIGATION_DISABLED_GAP: KubernetesAiAccessGap = {
  code: "investigation_disabled",
  title: "Investigation is off",
  description: "AI may not run kubectl on this cluster.",
  nextStep:
    "Turn on 'Let AI investigate with kubectl' on the cluster's AI page.",
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
    expect(describeFinishedRunKubectlUsage(0)).toBe(DATA_ONLY_RUN_TEXT);
  });

  test("counts the commands the run made, singular and plural", () => {
    expect(describeFinishedRunKubectlUsage(1)).toBe(
      "OneUptime AI ran 1 read-only kubectl command during this investigation.",
    );
    expect(describeFinishedRunKubectlUsage(5)).toBe(
      "OneUptime AI ran 5 read-only kubectl commands during this investigation.",
    );
  });

  test("never reports a negative or fractional count", () => {
    expect(describeFinishedRunKubectlUsage(-3)).toBe(DATA_ONLY_RUN_TEXT);
    expect(describeFinishedRunKubectlUsage(2.7)).toContain("ran 2 ");
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
});

describe("ClusterAccessNotice", () => {
  test("renders nothing when the signal is not about any cluster", () => {
    const { container } = render(
      <ClusterAccessNotice
        clusterAccess={[]}
        isRunFinished={true}
        clusterCommandCount={4}
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
        "What to do: Turn on 'Let AI investigate with kubectl'",
      );
    });

    test("ignores a command count while the run is still going", () => {
      render(
        <ClusterAccessNotice
          clusterAccess={[makeStatus()]}
          isRunFinished={false}
          clusterCommandCount={3}
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
          clusterCommandCount={5}
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
          clusterCommandCount={0}
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
          clusterCommandCount={1}
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
          clusterCommandCount={2}
        />,
      );

      expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
        "ran 2 read-only kubectl commands",
      );
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
      "(1 more to fix on the cluster's AI page.)",
    );
  });

  test("links every cluster to its AI page", () => {
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
        clusterCommandCount={0}
      />,
    );

    const reachableLink: HTMLElement = within(
      screen.getByTestId("cluster-access-reachable"),
    ).getByText("prod-east");
    expect(reachableLink.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/ai`,
    );

    const fixLink: HTMLElement = within(
      screen.getByTestId("cluster-access-unreachable"),
    ).getByText("Give OneUptime AI access to this cluster");
    expect(fixLink.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/kubernetes/${OTHER_CLUSTER_ID}/ai`,
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

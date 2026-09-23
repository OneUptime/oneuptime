import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
  REMEDIATION_WRITE_ACCESS_NEXT_STEP,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the next step of every readiness gap is written for
 * wherever it is shown. The cluster's AI page shows it, and so does the
 * investigation panel on an incident or alert page (verbatim, for a viewer
 * who may read the cluster). So a next step never says "this page" or
 * "here", which on an incident page would point at the incident; one that
 * sends the operator to the AI page names it: "the cluster's AI page".
 *
 * Every gap is produced by the real status computation, one scenario per
 * branch, so a next step added or reworded later is checked too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
};

const CLOSED_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: false,
  isAutoRemediationEnabled: false,
  isAiCommandExecutionEnabled: false,
  hasLlmProvider: false,
};

// "this page" / "on this page" / "here" read as the incident on an incident page.
const PAGE_RELATIVE_WORDING: RegExp = /\bthis page\b|\bhere\b/i;

// Any mention of an AI page must say whose.
const AI_PAGE_MENTION: RegExp = /\bAI page\b/;
const NAMED_AI_PAGE: string = "the cluster's AI page";

function cluster(overrides: Record<string, unknown> = {}): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function agentRunner(overrides: Record<string, unknown> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
    connectionStatus: RunnerConnectionStatus.Connected,
    canRunAiCommands: true,
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
      },
    },
    ...overrides,
  } as unknown as Runner;
}

function dashboardRunner(overrides: Record<string, unknown> = {}): Runner {
  return agentRunner({
    name: "office-runner",
    hostInfo: {},
    ...overrides,
  });
}

interface Scenario {
  label: string;
  cluster: KubernetesCluster;
  // What the Runner lookup (bound id, or this cluster's agent by name) answers.
  runner: Runner | null;
  gates?: KubernetesClusterAiAccessProjectGates | undefined;
}

const SCENARIOS: Array<Scenario> = [
  {
    label: "no Runner bound and none registered",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: null,
  },
  {
    label: "no Runner bound, this cluster's agent registered",
    cluster: cluster({ aiAccessRunnerId: undefined }),
    runner: agentRunner(),
  },
  {
    label: "the bound Runner was just deleted",
    cluster: cluster(),
    runner: null,
  },
  {
    label: "the in-cluster Runner signed off",
    cluster: cluster(),
    runner: agentRunner({
      connectionStatus: RunnerConnectionStatus.Disconnected,
    }),
  },
  {
    label: "a dashboard Runner signed off",
    cluster: cluster(),
    runner: dashboardRunner({
      connectionStatus: RunnerConnectionStatus.Disconnected,
    }),
  },
  {
    label: "a Runner that never connected",
    cluster: cluster(),
    runner: dashboardRunner({ lastAlive: undefined }),
  },
  {
    label: "an offline in-cluster Runner",
    cluster: cluster(),
    runner: agentRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
  },
  {
    label: "an offline in-cluster Runner that holds more than the defaults",
    cluster: cluster(),
    runner: agentRunner({
      lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
      canRunRunbooks: true,
    }),
  },
  {
    label: "a Runner without the AI-commands capability",
    cluster: cluster(),
    runner: agentRunner({ canRunAiCommands: false }),
  },
  {
    label: "another cluster's agent Runner with a credential",
    cluster: cluster({ aiAccessCredentialId: CREDENTIAL_ID }),
    runner: agentRunner({
      name: "kubernetes-agent/staging",
      hostInfo: {
        kubernetes: {
          inCluster: true,
          allowWrites: true,
          clusterIdentifier: "staging",
        },
      },
    }),
  },
  {
    label: "an external Runner whose credential is gone",
    cluster: cluster({ aiAccessCredentialId: CREDENTIAL_ID }),
    runner: dashboardRunner(),
  },
  {
    label: "another cluster's agent Runner without a credential",
    cluster: cluster(),
    runner: agentRunner({
      name: "kubernetes-agent/staging",
      hostInfo: {
        kubernetes: {
          inCluster: true,
          allowWrites: true,
          clusterIdentifier: "staging",
        },
      },
    }),
  },
  {
    label: "an external Runner without a credential",
    cluster: cluster(),
    runner: dashboardRunner(),
  },
  {
    label: "a read-only in-cluster Runner asked to remediate",
    cluster: cluster(),
    runner: agentRunner({
      hostInfo: {
        kubernetes: {
          inCluster: true,
          allowWrites: false,
          clusterIdentifier: "prod-us",
        },
      },
    }),
  },
  {
    label: "both switches off, every project gate closed",
    cluster: cluster({
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    }),
    runner: agentRunner(),
    gates: CLOSED_GATES,
  },
];

// Every gap the status computation can produce today.
const PRODUCED_GAP_CODES: Array<KubernetesAiAccessGapCode> = [
  "no_runner_bound",
  "runner_missing",
  "runner_offline",
  "runner_ai_commands_disabled",
  "runner_cluster_mismatch",
  "credential_missing",
  "credential_on_agent_runner",
  "investigation_disabled",
  "remediation_disabled",
  "remediation_write_access_missing",
  "project_ai_disabled",
  "project_auto_remediation_disabled",
  "project_ai_command_execution_disabled",
  "llm_provider_missing",
];

describe("KubernetesClusterAiAccessService gap next steps", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function gapsOf(
    scenario: Scenario,
  ): Promise<Array<KubernetesAiAccessGap>> {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(scenario.runner);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: scenario.cluster,
        gates: scenario.gates || READY_GATES,
      });

    return status.gaps;
  }

  async function everyGap(): Promise<
    Array<{ scenario: string; gap: KubernetesAiAccessGap }>
  > {
    const all: Array<{ scenario: string; gap: KubernetesAiAccessGap }> = [];

    for (const scenario of SCENARIOS) {
      const gaps: Array<KubernetesAiAccessGap> = await gapsOf(scenario);

      if (gaps.length === 0) {
        throw new Error(`Scenario "${scenario.label}" produced no gap.`);
      }

      for (const gap of gaps) {
        all.push({ scenario: scenario.label, gap });
      }
    }

    return all;
  }

  it("the scenarios reach every gap the status can produce", async () => {
    const codes: Set<string> = new Set(
      (await everyGap()).map(
        (entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
          return entry.gap.code;
        },
      ),
    );

    expect([...codes].sort()).toEqual([...PRODUCED_GAP_CODES].sort());
  });

  it('no next step says "this page" or "here"', async () => {
    const offenders: Array<string> = (await everyGap())
      .filter((entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
        return PAGE_RELATIVE_WORDING.test(entry.gap.nextStep);
      })
      .map((entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
        return `${entry.scenario} / ${entry.gap.code}: ${entry.gap.nextStep}`;
      });

    expect(offenders).toEqual([]);
  });

  it("a next step that sends the operator to the AI page names it as the cluster's", async () => {
    const entries: Array<{ scenario: string; gap: KubernetesAiAccessGap }> = (
      await everyGap()
    ).filter((entry: { scenario: string; gap: KubernetesAiAccessGap }) => {
      return AI_PAGE_MENTION.test(entry.gap.nextStep);
    });

    // Most cluster-level steps are taken on the AI page.
    expect(entries.length).toBeGreaterThanOrEqual(8);

    for (const entry of entries) {
      expect(`${entry.gap.code}: ${entry.gap.nextStep}`).toContain(
        NAMED_AI_PAGE,
      );
      expect(entry.gap.nextStep).not.toContain("this cluster's AI page");
    }
  });

  it("every step taken on the AI page names it", async () => {
    const onTheAiPage: Array<KubernetesAiAccessGapCode> = [
      "no_runner_bound",
      "runner_missing",
      "credential_on_agent_runner",
      "runner_cluster_mismatch",
      "investigation_disabled",
      "remediation_disabled",
      "remediation_write_access_missing",
    ];

    for (const entry of await everyGap()) {
      if (onTheAiPage.includes(entry.gap.code)) {
        expect(`${entry.scenario}: ${entry.gap.nextStep}`).toContain(
          NAMED_AI_PAGE,
        );
      }
    }
  });

  /*
   * The dashboard tells "installed but not selected" apart from "no Runner
   * can reach this cluster" only by a quoted kubernetes-agent Runner name in
   * the no_runner_bound next step (AI.tsx getAiAccessConnectCardMode), so
   * the reworded step must still quote it.
   */
  it("still quotes the agent Runner's name in the 'installed but not selected' step", async () => {
    const gaps: Array<KubernetesAiAccessGap> = await gapsOf(SCENARIOS[1]!);

    expect(gaps[0]!.code).toBe("no_runner_bound");
    expect(gaps[0]!.nextStep).toContain('"kubernetes-agent/prod-us"');
    expect(gaps[0]!.nextStep).not.toContain("aiAccess.enabled=true");
  });

  it("negative control: the 'no Runner registered' step quotes no Runner name", async () => {
    const gaps: Array<KubernetesAiAccessGap> = await gapsOf(SCENARIOS[0]!);

    expect(gaps[0]!.code).toBe("no_runner_bound");
    expect(gaps[0]!.nextStep).not.toContain('"kubernetes-agent/');
  });
});

/*
 * The read-only gap names a section of the cluster's AI page. If the page
 * renames that card, this gap would send the operator looking for a title
 * that is not there.
 */
describe("the read-only gap names a section the AI page has", () => {
  const AI_PAGE_SOURCE: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI.tsx",
  );
  const SECTION_TITLE_REGEX: RegExp = /"Let AI apply fixes \(write access\)"/;

  it("quotes the write-access card's title", () => {
    const quoted: RegExpMatchArray | null =
      REMEDIATION_WRITE_ACCESS_NEXT_STEP.match(SECTION_TITLE_REGEX);

    expect(quoted).not.toBeNull();
  });

  it("which is the title of a card on the AI page", () => {
    const source: string = fs.readFileSync(AI_PAGE_SOURCE, "utf8");

    expect(source).toContain('title="Let AI apply fixes (write access)"');
  });
});

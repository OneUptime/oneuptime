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

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationSuggestionCard, {
  getCommandStepLabel,
  getCommandTargetLabel,
  getResourceCommandTierLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import ObjectID from "../../../Types/ObjectID";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * The remediation card for a RESOURCE round — AI fixes on a Docker or
 * Podman host, a Docker Swarm, Proxmox, VMware or Ceph cluster, a database
 * server or a host, through its resource AI agent:
 *
 * - the card names the fix an infrastructure fix and its source the
 *   resource's round, never "Rule: …";
 * - every ResourceCommand row names the resource it runs on ("Docker host
 *   web-1"), shows the program it runs ("docker", "systemctl", …) where a
 *   kubectl row shows "kubectl", and carries the resource command policy's
 *   tier in the same words and colours as a kubectl tier;
 * - the approval pill follows what happened to the command, as for kubectl;
 * - a kubectl row renders exactly as before.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";
const AGENT_ID: string = "0193c0de-5555-4aaa-8bbb-000000000005";
const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";

function resourceCommand(overrides: Partial<JSONObject> = {}): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Docker AI agent",
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceNameSnapshot: "web-1",
    resourceCommandTier: ResourceCommandTier.RiskyWrite,
    command: "docker stop web",
    rollbackCommand: "docker start web",
    timeoutInMs: 30000,
    rationale: "web leaks memory until it is restarted",
    expectedEffect: "the leak stops",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    wasAutoExecuted: false,
    ...overrides,
  };
}

function resourceSuggestion(
  status: AutoRemediationSuggestionStatus,
  commands: Array<JSONObject>,
  executionStatus?: AiRemediationPlanExecutionStatus | undefined,
): AutoRemediationSuggestion {
  const plan: JSONObject = { commands };
  if (executionStatus) {
    plan["executionStatus"] = executionStatus;
  }

  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    resourceType: AiResourceType.DockerHost,
    resourceId: new ObjectID(RESOURCE_ID),
    commandPlan: plan,
    createdAt: new Date("2026-09-22T10:00:00Z"),
  });
}

let getListSpy: ReturnType<typeof jest.spyOn>;

async function renderCard(
  row: AutoRemediationSuggestion,
  commandText: string,
): Promise<HTMLElement> {
  getListSpy.mockImplementation(
    async (): Promise<ListResult<AutoRemediationSuggestion>> => {
      return { data: [row], count: 1, skip: 0, limit: 10 };
    },
  );
  render(<RemediationSuggestionCard incidentId={INCIDENT_ID} />);
  const command: HTMLElement = await screen.findByText(commandText);
  const commandRow: HTMLElement | null = command.closest("li");

  if (!commandRow) {
    throw new Error("The command is not rendered inside a command row.");
  }

  return commandRow;
}

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the command row helpers", () => {
  test("a resource command names its resource, its program and its tier", () => {
    expect(
      getCommandTargetLabel({
        stepType: RunbookStepType.ResourceCommand,
        resourceType: AiResourceType.DatabaseServer,
        resourceNameSnapshot: "orders-db",
        runnerNameSnapshot: "Database AI agent",
      }),
    ).toBe("Database server orders-db");
    expect(
      getCommandStepLabel({
        stepType: RunbookStepType.ResourceCommand,
        command: "  systemctl restart nginx",
      }),
    ).toBe("systemctl");
    expect(getResourceCommandTierLabel(ResourceCommandTier.SafeWrite)).toBe(
      "safe change",
    );
    expect(getResourceCommandTierLabel(ResourceCommandTier.RiskyWrite)).toBe(
      "riskier change",
    );
    expect(getResourceCommandTierLabel(ResourceCommandTier.Read)).toBe(
      "read-only",
    );
  });

  test("an unknown resource type or a missing name never breaks the row", () => {
    expect(
      getCommandTargetLabel({
        stepType: RunbookStepType.ResourceCommand,
        resourceType: "Printer" as AiResourceType,
        runnerNameSnapshot: "x",
      }),
    ).toBe("resource (unknown)");
    expect(
      getCommandStepLabel({
        stepType: RunbookStepType.ResourceCommand,
        command: "",
      }),
    ).toBe("command");
  });

  test("kubectl and Runner rows keep their labels", () => {
    expect(
      getCommandTargetLabel({
        stepType: RunbookStepType.Kubectl,
        kubernetesClusterNameSnapshot: "prod-east",
        runnerNameSnapshot: "kubernetes-agent/prod-east",
      }),
    ).toBe("cluster prod-east");
    expect(
      getCommandTargetLabel({
        stepType: RunbookStepType.Bash,
        runnerNameSnapshot: "web-runner-1",
      }),
    ).toBe("web-runner-1");
    expect(
      getCommandStepLabel({
        stepType: RunbookStepType.Kubectl,
        command: "kubectl get pods",
      }),
    ).toBe("kubectl");
    expect(
      getCommandStepLabel({ stepType: RunbookStepType.SSH, command: "uptime" }),
    ).toBe(RunbookStepType.SSH);
  });
});

describe("RemediationSuggestionCard for a resource round", () => {
  test("a plan waiting for approval names the resource, the program and the tier — and needs approval", async () => {
    const row: HTMLElement = await renderCard(
      resourceSuggestion(AutoRemediationSuggestionStatus.Suggested, [
        resourceCommand(),
      ]),
      "docker stop web",
    );

    expect(screen.getByText("AI infrastructure fix")).toBeInTheDocument();
    expect(
      screen.getByText('AI remediation for Docker host "web-1"'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Rule:/)).not.toBeInTheDocument();

    expect(within(row).getByText("Docker host web-1")).toBeInTheDocument();
    expect(within(row).getByText("docker")).toBeInTheDocument();
    expect(within(row).getByText("riskier change")).toBeInTheDocument();
    expect(within(row).getByText("needs approval")).toBeInTheDocument();
    expect(within(row).queryByText("auto-approved")).not.toBeInTheDocument();
    expect(within(row).getByText("docker start web")).toBeInTheDocument();
    expect(screen.getByText("Approve & Run")).toBeInTheDocument();
  });

  test("a change a resource round ran unattended is labelled auto-approved, with its tier", async () => {
    const row: HTMLElement = await renderCard(
      resourceSuggestion(
        AutoRemediationSuggestionStatus.AutoExecuted,
        [
          resourceCommand({
            command: "systemctl restart nginx",
            resourceType: AiResourceType.Host,
            resourceNameSnapshot: "web-2",
            resourceCommandTier: ResourceCommandTier.SafeWrite,
            policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
            wasAutoExecuted: true,
            rollbackCommand: undefined,
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
              exitCode: 0,
            },
          }),
        ],
        AiRemediationPlanExecutionStatus.Completed,
      ),
      "systemctl restart nginx",
    );

    expect(within(row).getByText("Host web-2")).toBeInTheDocument();
    expect(within(row).getByText("systemctl")).toBeInTheDocument();
    expect(within(row).getByText("safe change")).toBeInTheDocument();
    expect(within(row).getByText("auto-approved")).toBeInTheDocument();
    expect(within(row).getByText("Succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Approve & Run")).not.toBeInTheDocument();
  });

  test("the card reads the resource columns of its suggestions", async () => {
    await renderCard(
      resourceSuggestion(AutoRemediationSuggestionStatus.Suggested, [
        resourceCommand(),
      ]),
      "docker stop web",
    );

    const select: Record<string, unknown> = (
      getListSpy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["resourceType"]).toBe(true);
    expect(select["resourceId"]).toBe(true);
  });

  test("negative control: a kubectl plan renders as before", async () => {
    const row: HTMLElement = await renderCard(
      Object.assign(new AutoRemediationSuggestion(), {
        _id: "0193c0de-6666-4aaa-8bbb-000000000006",
        status: AutoRemediationSuggestionStatus.Suggested,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        commandPlan: {
          commands: [
            {
              sequence: 1,
              stepType: RunbookStepType.Kubectl,
              runnerId: AGENT_ID,
              runnerNameSnapshot: "kubernetes-agent/prod-east",
              kubernetesClusterId: CLUSTER_ID,
              kubernetesClusterNameSnapshot: "prod-east",
              kubectlTier: KubectlCommandTier.SafeWrite,
              command: "kubectl rollout restart deployment/web -n web",
              timeoutInMs: 60000,
              rationale: "r",
              expectedEffect: "e",
              policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
            },
          ],
        },
        createdAt: new Date("2026-09-22T10:00:00Z"),
      }),
      "kubectl rollout restart deployment/web -n web",
    );

    expect(screen.getByText("AI kubectl fix")).toBeInTheDocument();
    expect(within(row).getByText("cluster prod-east")).toBeInTheDocument();
    expect(within(row).getByText("kubectl")).toBeInTheDocument();
    expect(within(row).getByText("safe change")).toBeInTheDocument();
  });
});

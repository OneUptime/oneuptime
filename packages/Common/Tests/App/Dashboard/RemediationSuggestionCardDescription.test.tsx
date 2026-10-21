import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
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
  REMEDIATION_CARD_DESCRIPTION,
  REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES,
  getRemediationCardDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * The remediation card's description says what an AI fix on the signal can
 * be. Commands run through a resource's AI agent (a Docker host, a
 * database server, a host, ...) are named once the card shows such a fix;
 * every other card — kubectl, Runner and runbook fixes — keeps its wording
 * word for word.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const RESOURCE_ID: string = "0193c0de-4444-4aaa-8bbb-000000000004";
const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";

function command(stepType: RunbookStepType): JSONObject {
  return {
    sequence: 1,
    stepType,
    runnerId: "0193c0de-5555-4aaa-8bbb-000000000005",
    runnerNameSnapshot: "agent",
    command: "restart it",
    timeoutInMs: 30000,
    rationale: "r",
    expectedEffect: "e",
    policyVerdict: "RequiresApproval",
    // Each step type's own target, as the plan parser requires it.
    ...(stepType === RunbookStepType.ResourceCommand
      ? {
          resourceType: AiResourceType.DockerHost,
          resourceId: RESOURCE_ID,
          resourceNameSnapshot: "web-1",
        }
      : {}),
    ...(stepType === RunbookStepType.Kubectl
      ? {
          kubernetesClusterId: CLUSTER_ID,
          kubernetesClusterNameSnapshot: "prod-east",
        }
      : {}),
  };
}

function suggestion(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: "Restart API pods",
    commandPlan: { commands: [command(RunbookStepType.Bash)] },
    createdAt: new Date("2026-09-22T10:00:00Z"),
    ...overrides,
  });
}

function resourceRound(): AutoRemediationSuggestion {
  return suggestion({
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    resourceType: AiResourceType.DockerHost,
    resourceId: new ObjectID(RESOURCE_ID),
    commandPlan: { commands: [command(RunbookStepType.ResourceCommand)] },
  });
}

function clusterRound(): AutoRemediationSuggestion {
  return suggestion({
    ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    commandPlan: { commands: [command(RunbookStepType.Kubectl)] },
  });
}

describe("getRemediationCardDescription", () => {
  test("the Kubernetes, Runner and runbook wording is unchanged", () => {
    expect(REMEDIATION_CARD_DESCRIPTION).toBe(
      "Fixes OneUptime AI proposed or applied for this signal — kubectl on a cluster, commands on a Runner, or a runbook. Approving runs exactly what is shown, under your name.",
    );
    expect(getRemediationCardDescription([clusterRound()])).toBe(
      REMEDIATION_CARD_DESCRIPTION,
    );
    expect(getRemediationCardDescription([suggestion()])).toBe(
      REMEDIATION_CARD_DESCRIPTION,
    );
    expect(
      getRemediationCardDescription([
        suggestion({
          suggestionType: AutoRemediationSuggestionType.Runbook,
          commandPlan: undefined,
        }),
      ]),
    ).toBe(REMEDIATION_CARD_DESCRIPTION);
    expect(getRemediationCardDescription([])).toBe(
      REMEDIATION_CARD_DESCRIPTION,
    );
  });

  test("a resource round, or any plan with a resource command, names the resource's AI agent", () => {
    expect(REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES).toContain(
      "commands through a resource's AI agent",
    );
    expect(REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES).toContain(
      "kubectl on a cluster",
    );
    expect(REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES).toContain(
      "commands on a Runner, or a runbook. Approving runs exactly what is shown, under your name.",
    );

    expect(
      getRemediationCardDescription([clusterRound(), resourceRound()]),
    ).toBe(REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES);
    // A resource round still Planning has no plan yet.
    expect(
      getRemediationCardDescription([
        suggestion({
          status: AutoRemediationSuggestionStatus.Planning,
          resourceType: AiResourceType.Host,
          resourceId: new ObjectID(RESOURCE_ID),
          commandPlan: undefined,
        }),
      ]),
    ).toBe(REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES);
    // A plan of resource commands whose round link is not loaded.
    expect(
      getRemediationCardDescription([
        suggestion({
          commandPlan: {
            commands: [command(RunbookStepType.ResourceCommand)],
          },
        }),
      ]),
    ).toBe(REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES);
  });
});

describe("RemediationSuggestionCard description", () => {
  let getListSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    getListSpy = jest.spyOn(ModelAPI, "getList");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  async function renderCard(
    rows: Array<AutoRemediationSuggestion>,
  ): Promise<string> {
    getListSpy.mockImplementation(
      async (): Promise<ListResult<AutoRemediationSuggestion>> => {
        return { data: rows, count: rows.length, skip: 0, limit: 10 };
      },
    );
    render(<RemediationSuggestionCard incidentId={INCIDENT_ID} />);

    return (await screen.findByTestId("card-description")).textContent || "";
  }

  test("a card showing a resource round names the resource's AI agent", async () => {
    expect(await renderCard([resourceRound()])).toBe(
      REMEDIATION_CARD_DESCRIPTION_WITH_RESOURCE_FIXES,
    );
  });

  test("negative control: a card of kubectl fixes reads as before", async () => {
    expect(await renderCard([clusterRound()])).toBe(
      REMEDIATION_CARD_DESCRIPTION,
    );
  });
});

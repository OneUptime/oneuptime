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

import RemediationStep from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  DEFAULT_RUNBOOK_PICK_NAME,
  isProjectRunbookPick,
} from "../../../Types/AutoRemediation/AutoRemediationFix";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * Who a runbook suggestion on the Remediation card is from. With no rule set
 * up, OneUptime AI proposes the project's runbook that fits each new
 * incident or alert itself: that pick is OneUptime AI's, and the card says
 * so - never "Rule: OneUptime AI", as if a rule of that name had made it. A
 * rule's pick names its rule, and so does one whose rule was deleted since
 * (its suggestion keeps the rule's name).
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000003",
);
const RULE_ID: string = "0193c0de-8888-4aaa-8bbb-000000000008";

function runbookPick(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: "0193c0de-6666-4aaa-8bbb-000000000006",
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookNameSnapshot: "Restart checkout",
    ruleNameSnapshot: DEFAULT_RUNBOOK_PICK_NAME,
    createdAt: new Date("2026-10-20T10:00:00Z"),
    ...overrides,
  });
}

let getListSpy: ReturnType<typeof jest.spyOn>;

async function renderCard(row: AutoRemediationSuggestion): Promise<void> {
  getListSpy.mockImplementation(
    async (): Promise<ListResult<AutoRemediationSuggestion>> => {
      return { data: [row], count: 1, skip: 0, limit: 10 };
    },
  );
  render(
    <RemediationStep investigationStage="reported" incidentId={INCIDENT_ID} />,
  );
  await screen.findByText("Restart checkout");
}

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("who a runbook suggestion is from", () => {
  test("the project's own pick is OneUptime AI's, not a rule's", async () => {
    await renderCard(runbookPick());

    expect(screen.getByText("OneUptime AI")).toBeInTheDocument();
    expect(screen.queryByText("Rule: OneUptime AI")).not.toBeInTheDocument();
  });

  test("a rule's pick names its rule", async () => {
    await renderCard(
      runbookPick({
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: "Fix database incidents",
      }),
    );

    expect(
      screen.getByText("Rule: Fix database incidents"),
    ).toBeInTheDocument();
  });

  test("a pick whose rule was deleted still names the rule it was for", async () => {
    await renderCard(
      runbookPick({
        autoRemediationRuleId: undefined,
        ruleNameSnapshot: "Fix database incidents",
      }),
    );

    expect(
      screen.getByText("Rule: Fix database incidents"),
    ).toBeInTheDocument();
  });

  test("the card reads which rule a suggestion is for", async () => {
    await renderCard(runbookPick());

    const select: Record<string, unknown> = (
      getListSpy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["autoRemediationRuleId"]).toBe(true);
    expect(select["ruleNameSnapshot"]).toBe(true);
  });
});

describe("isProjectRunbookPick", () => {
  test("is the pick made with no rule, no cluster and no resource, under OneUptime AI's name", () => {
    expect(DEFAULT_RUNBOOK_PICK_NAME).toBe("OneUptime AI");
    expect(isProjectRunbookPick({ ruleNameSnapshot: "OneUptime AI" })).toBe(
      true,
    );

    for (const other of [
      {
        autoRemediationRuleId: new ObjectID(RULE_ID),
        ruleNameSnapshot: "OneUptime AI",
      },
      { kubernetesClusterId: RULE_ID, ruleNameSnapshot: "OneUptime AI" },
      { resourceId: RULE_ID, ruleNameSnapshot: "OneUptime AI" },
      { ruleNameSnapshot: "Fix database incidents" },
      {},
    ]) {
      expect(isProjectRunbookPick(other)).toBe(false);
    }
  });
});

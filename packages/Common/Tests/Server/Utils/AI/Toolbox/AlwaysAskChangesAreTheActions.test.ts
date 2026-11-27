import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import { getAsksInEveryModeRefusal as getRunnerRefusal } from "../../../../../Server/Utils/AI/Toolbox/DataSecurityActionRunner";
import {
  getChangeWrite,
  IssueChange,
} from "../../../../../Server/Utils/AI/Toolbox/DataSecurityIssueActionTools";
import {
  ObservabilityTool,
  PreparedMutation,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  aiActionSentence,
  describeAIActionSentence,
} from "../../../../../Types/AI/AIActionWords";
import {
  ALWAYS_ASK_ACTIONS,
  ALWAYS_ASK_CHANGES,
  AlwaysAskChange,
  AlwaysAskWrite,
  DATA_SECURITY_ISSUE_TABLE_NAME,
  actionAlwaysAsks,
  getAsksInEveryModeRefusal,
  writeAlwaysAsks,
} from "../../../../../Types/AI/AIAlwaysAskChanges";
import { AI_SETUP_ACTION_TOOL_NAMES } from "../../../../../Types/AI/AISetupActions";
import {
  CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
  DATA_SECURITY_ACTION_TOOL_NAMES,
  DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
  FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
  JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
  RESPOND_ON_DATA_STORE_TOOL_NAME,
  SAVE_DATA_SECURITY_RULE_TOOL_NAME,
  SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
  SET_DATA_STORE_OWNERS_TOOL_NAME,
} from "../../../../../Types/AI/AIDataSecurityActions";
import { AI_DATA_SECURITY_ACTION_ASKS_BECAUSE } from "../../../../../Types/AI/AIDataSecurityActionWords";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * ASK AI'S ACTIONS ASK BY THE ONE LIST THE MCP SERVER HOLDS RECORDS TO
 * (#11177).
 *
 * Whether a call of one of Ask AI's Data Security actions asks a person in
 * every mode is decided from Types/AI/AIAlwaysAskChanges - the list the MCP
 * server holds every record's write to - by the write the call makes: so
 * Accept Risk asks in Ask AI because, and exactly as, a write of an issue's
 * status to Accepted is refused on the MCP server. These hold the two to
 * each other action by action, through AIToolbox.asksInEveryMode, as Ask
 * AI's turn and the MCP runner both ask it.
 */

const ISSUE_ID: string = "11177000-0000-4000-8000-0000000000c1";
const FINDING_ID: string = "11177000-0000-4000-8000-0000000000c2";
const STORE_ID: string = "11177000-0000-4000-8000-0000000000c3";

// A card that was prepared and gives no reason of its own to ask.
const PREPARED_WITHOUT_A_REASON: PreparedMutation = {
  arguments: {},
  effects: { changes: [aiActionSentence("Something changes.")] },
};

// A card that was prepared and says why it asks.
const PREPARED_WITH_A_REASON: PreparedMutation = {
  arguments: {},
  effects: {
    asksBecause: aiActionSentence(
      AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.confirmCanPage,
    ),
  },
};

// `null`: no card was prepared, as when a prepare fails.
function asks(
  name: string,
  args: JSONObject,
  prepared: PreparedMutation | null = PREPARED_WITHOUT_A_REASON,
): boolean {
  return AIToolbox.asksInEveryMode({
    name,
    args,
    prepared: prepared || undefined,
  });
}

describe("change_data_security_issue asks by the issue's write", () => {
  test("Accept Risk and Not an Issue ask, as their writes are refused on the MCP server", () => {
    for (const change of [IssueChange.AcceptRisk, IssueChange.NotAnIssue]) {
      expect({
        change,
        asks: asks(CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME, {
          dataSecurityIssueId: ISSUE_ID,
          change,
          reason: "Compensating control",
        }),
        refused: writeAlwaysAsks({
          tableName: DATA_SECURITY_ISSUE_TABLE_NAME,
          write: AlwaysAskWrite.Update,
          data: getChangeWrite(change),
        }),
      }).toEqual({ change, asks: true, refused: true });
    }
  });

  test("Reopen, Assign and Unassign follow the mode, as their writes are sent", () => {
    for (const change of [
      IssueChange.Reopen,
      IssueChange.Assign,
      IssueChange.Unassign,
    ]) {
      expect({
        change,
        asks: asks(CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME, {
          dataSecurityIssueId: ISSUE_ID,
          change,
          assignee: "Jane",
        }),
        refused: writeAlwaysAsks({
          tableName: DATA_SECURITY_ISSUE_TABLE_NAME,
          write: AlwaysAskWrite.Update,
          data: getChangeWrite(change),
        }),
      }).toEqual({ change, asks: false, refused: false });
    }
  });

  test("a change it does not know, or a card that could not be prepared, asks", () => {
    expect(
      asks(CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME, {
        dataSecurityIssueId: ISSUE_ID,
        change: "delete",
      }),
    ).toBe(true);
    expect(
      asks(
        CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
        { dataSecurityIssueId: ISSUE_ID, change: IssueChange.Reopen },
        null,
      ),
    ).toBe(true);
  });

  test("each change's write is the one its button sends", () => {
    expect(getChangeWrite(IssueChange.AcceptRisk)["status"]).toBe("Accepted");
    expect(getChangeWrite(IssueChange.NotAnIssue)["status"]).toBe(
      "Not an issue",
    );
    expect(getChangeWrite(IssueChange.Reopen)).toEqual({ status: "Open" });
    expect(getChangeWrite(IssueChange.Assign)).toEqual({
      assignedToUserId: null,
      assignedToTeamId: null,
    });
  });
});

describe("judge_data_security_finding asks by the finding's write", () => {
  test("Not Sensitive asks in every mode, whatever its card says", () => {
    expect(
      asks(JUDGE_DATA_SECURITY_FINDING_TOOL_NAME, {
        dataStoreFindingId: FINDING_ID,
        decision: "not-sensitive",
        reason: "Test data",
      }),
    ).toBe(true);
  });

  test("Confirm asks only where its card says a Critical issue pages someone", () => {
    expect(
      asks(JUDGE_DATA_SECURITY_FINDING_TOOL_NAME, {
        dataStoreFindingId: FINDING_ID,
        decision: "confirm",
      }),
    ).toBe(false);
    expect(
      asks(
        JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
        { dataStoreFindingId: FINDING_ID, decision: "confirm" },
        PREPARED_WITH_A_REASON,
      ),
    ).toBe(true);
  });

  test("a decision it does not know asks", () => {
    expect(
      asks(JUDGE_DATA_SECURITY_FINDING_TOOL_NAME, {
        dataStoreFindingId: FINDING_ID,
        decision: "ignore",
      }),
    ).toBe(true);
  });
});

describe("the actions every call of which asks", () => {
  test("ask in every mode for any call, as the list says", () => {
    for (const name of [
      SET_DATA_STORE_OWNERS_TOOL_NAME,
      SAVE_DATA_SECURITY_RULE_TOOL_NAME,
      DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
      RESPOND_ON_DATA_STORE_TOOL_NAME,
    ]) {
      expect({ name, asks: asks(name, { dataStoreId: STORE_ID }) }).toEqual({
        name,
        asks: true,
      });
      expect(actionAlwaysAsks(name)).toBe(true);
    }
  });

  test("a scrub, and Fix with AI, ask only where their card says why", () => {
    for (const name of [
      SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
      FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
    ]) {
      expect({ name, asks: asks(name, {}) }).toEqual({ name, asks: false });
      expect({
        name,
        asks: asks(name, {}, PREPARED_WITH_A_REASON),
      }).toEqual({ name, asks: true });
      expect({ name, asks: asks(name, {}, null) }).toEqual({
        name,
        asks: true,
      });
    }
  });
});

describe("the toolbox and the list name the same actions", () => {
  const tools: Array<ObservabilityTool> = AIToolbox.getTools();

  test("every action in the list is a mutation of Ask AI's that asks in every mode for some call", () => {
    for (const action of ALWAYS_ASK_ACTIONS) {
      const tool: ObservabilityTool | undefined =
        AIToolbox.getToolByName(action);

      expect({ action, isMutation: tool?.isMutation }).toEqual({
        action,
        isMutation: true,
      });
      expect({ action, asks: Boolean(tool?.asksInEveryMode) }).toEqual({
        action,
        asks: true,
      });
    }
  });

  test("every tool that may ask in every mode is in the list, a setup action, or asks only for a card that could not be prepared", () => {
    const unlisted: Array<string> = tools
      .filter((tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation && tool.asksInEveryMode);
      })
      .map((tool: ObservabilityTool): string => {
        return tool.name;
      })
      .filter((name: string): boolean => {
        return !ALWAYS_ASK_ACTIONS.includes(name);
      });

    // Fix with AI asks only when its card could not be prepared: nothing it makes asks.
    expect(unlisted).toEqual([FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME]);

    for (const tool of tools) {
      if (tool.setupAction) {
        expect(AI_SETUP_ACTION_TOOL_NAMES).toContain(tool.name);
      }
    }
  });

  test("every Data Security action that changes something is classified", () => {
    for (const action of DATA_SECURITY_ACTION_TOOL_NAMES) {
      expect({
        action,
        classified:
          ALWAYS_ASK_ACTIONS.includes(action) ||
          action === FIX_DATA_SECURITY_ISSUE_WITH_AI_TOOL_NAME,
      }).toEqual({ action, classified: true });
    }
  });

  test("every change an action makes names that action's card's own reason", () => {
    const reasons: Array<string> = Object.values(
      AI_DATA_SECURITY_ACTION_ASKS_BECAUSE,
    );

    for (const change of ALWAYS_ASK_CHANGES.filter(
      (each: AlwaysAskChange): boolean => {
        return each.madeByEveryCall || each.action !== undefined;
      },
    )) {
      if (change.card.startsWith("Ask AI's approval card")) {
        expect(reasons).toContain(change.asksBecause);
        // In English, as the MCP runner's refusal renders the card's sentence.
        expect(
          describeAIActionSentence(aiActionSentence(change.asksBecause)),
        ).toBe(change.asksBecause);
      }
    }
  });
});

describe("the refusal is written once", () => {
  test("the MCP runner refuses in the very sentence the list writes", () => {
    expect(getRunnerRefusal).toBe(getAsksInEveryModeRefusal);
  });
});

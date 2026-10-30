import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

import RemediationStep, {
  REMEDIATION_CARD_DESCRIPTION_WITH_MCP_FIXES,
  getRemediationCardDescription,
  isMcpFixInProgress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  RemediationDecisionLine,
  getRemediationDecisionLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";
import { describeFixKind } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentAlertAi/IncidentAlertAiLogs";
import ChatActivityFeed from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import { describeEvidenceTool } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
  AutoRemediationDecisionStage,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";

/*
 * A FIX THROUGH THE PROJECT'S EXTERNAL MCP SERVERS, where people see it.
 *
 *   - The Remediation card lists its changes in order - the server, the
 *     tool, what it is sent - each with where it stands (proposed, made,
 *     failed, not sent), what the server answered once it was made, and
 *     whether OneUptime AI made it without asking; "Approve & Run" makes
 *     exactly those changes.
 *   - The card's decision lines, the AI logs, the run's activity and its
 *     evidence name it in plain words.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "da1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const SUGGESTION_ID: string = "da1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02";
const SERVER_ID: string = "da1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03";

// A box's classes: a frame, a tinted background, rounded corners, a shadow.
const MCP_ROW_BOX_CLASS_NAME: RegExp =
  /(^|\s)(border(-\d+)?|rounded(-\w+)?|bg-[a-z]+-\d+|shadow(-\w+)?)(\s|$)/;

function call(
  sequence: number,
  status: ExternalMcpToolCallStatus,
  extra: Partial<ExternalMcpToolCall> = {},
): ExternalMcpToolCall {
  return {
    sequence,
    serverId: SERVER_ID,
    serverNameSnapshot: "AWS",
    toolName: "restart_service",
    arguments: { service: "api", force: true },
    status,
    ...extra,
  };
}

function mcpFix(
  status: AutoRemediationSuggestionStatus,
  calls: Array<ExternalMcpToolCall>,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: SUGGESTION_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    ruleNameSnapshot: "Fix the API",
    autoRemediationRuleId: new ObjectID("da1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04"),
    mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({ calls }),
    createdAt: new Date("2026-10-20T10:00:00Z"),
  });
}

function serve(row: AutoRemediationSuggestion): void {
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The card reads its decisions beside its suggestions: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: [row], count: 1, skip: 0, limit: 10 };
  }) as never);
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Remediation card", () => {
  beforeEach(() => {
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  });

  test("a proposed fix: each change, where it stands, and Approve & Run", async () => {
    serve(
      mcpFix(AutoRemediationSuggestionStatus.Suggested, [
        call(1, ExternalMcpToolCallStatus.Proposed),
        call(2, ExternalMcpToolCallStatus.Proposed, {
          toolName: "scale_service",
          arguments: { service: "api", count: 3 },
        }),
      ]),
    );

    await act(async () => {
      render(
        <RemediationStep
          investigationStage="reported"
          incidentId={INCIDENT_ID}
        />,
      );
    });

    expect(
      await screen.findByText("AI fix through MCP servers"),
    ).toBeInTheDocument();
    expect(screen.getByText("Rule: Fix the API")).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
    expect(
      screen.getByTestId("remediation-fixes-description"),
    ).toHaveTextContent(REMEDIATION_CARD_DESCRIPTION_WITH_MCP_FIXES);

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "remediation-mcp-tool-call",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("AWS");
    expect(rows[0]).toHaveTextContent("restart_service");
    expect(rows[0]).toHaveTextContent("Proposed");
    expect(within(rows[0]!).getByText(/"force": true/)).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("scale_service");

    // Approving sends exactly this suggestion to the approve route.
    const post: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    await act(async () => {
      fireEvent.click(screen.getByTestId("remediation-approve-button"));
    });

    const request: { url: { toString: () => string }; data: JSONObject } = post
      .mock.calls[0]![0] as never;
    expect(
      new URL(request.url.toString()).pathname.split("/").slice(-2),
    ).toEqual(["auto-remediation", "approve"]);
    expect(request.data).toEqual({ suggestionId: SUGGESTION_ID });
  });

  test("a fix made without asking: what each server answered, and the one that failed", async () => {
    serve(
      mcpFix(AutoRemediationSuggestionStatus.AutoExecuted, [
        call(1, ExternalMcpToolCallStatus.Succeeded, {
          wasMadeWithoutAsking: true,
          resultText: "restarted api",
        }),
        call(2, ExternalMcpToolCallStatus.Failed, {
          wasMadeWithoutAsking: true,
          errorMessage: "quota exceeded",
        }),
        call(3, ExternalMcpToolCallStatus.Skipped, {
          errorMessage: "Skipped because an earlier change failed.",
        }),
      ]),
    );

    await act(async () => {
      render(
        <RemediationStep
          investigationStage="reported"
          incidentId={INCIDENT_ID}
        />,
      );
    });

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "remediation-mcp-tool-call",
    );
    expect(rows[0]).toHaveAttribute("data-status", "Succeeded");
    expect(rows[0]).toHaveTextContent("Done");
    expect(rows[0]).toHaveTextContent("Made without asking");
    expect(rows[1]).toHaveTextContent("Failed");
    expect(rows[1]).toHaveTextContent("quota exceeded");
    expect(rows[2]).toHaveTextContent("Not sent");

    /*
     * Each change is a line with a rule beside it, as a command of a plan
     * is: on the AI card, the card is the only frame (block 43).
     */
    for (const row of rows) {
      expect(row).toHaveClass("border-l-2", "pl-3");
      expect(row.className).not.toMatch(MCP_ROW_BOX_CLASS_NAME);
    }

    // The answer is folded until asked for.
    expect(screen.queryByText("restarted api")).not.toBeInTheDocument();
    fireEvent.click(within(rows[0]!).getByText("Show the server's answer"));
    expect(screen.getByText("restarted api")).toBeInTheDocument();

    expect(
      screen.queryByTestId("remediation-approve-button"),
    ).not.toBeInTheDocument();
  });

  test("a fix whose changes cannot be read says so in its own words, not a command plan's", async () => {
    serve(
      Object.assign(mcpFix(AutoRemediationSuggestionStatus.Suggested, []), {
        mcpToolCallPlan: "not a plan",
      }) as AutoRemediationSuggestion,
    );

    await act(async () => {
      render(
        <RemediationStep
          investigationStage="reported"
          incidentId={INCIDENT_ID}
        />,
      );
    });

    expect(
      await screen.findByText("The changes of this fix could not be shown."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("The command plan could not be displayed."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("remediation-mcp-tool-calls"),
    ).not.toBeInTheDocument();
  });

  test("keeps watching a fix while its changes are being made", () => {
    const fix: (
      status: AutoRemediationSuggestionStatus,
      calls: Array<ExternalMcpToolCall>,
    ) => AutoRemediationSuggestion = mcpFix;

    expect(
      isMcpFixInProgress(
        fix(AutoRemediationSuggestionStatus.Approved, [
          call(1, ExternalMcpToolCallStatus.Proposed),
        ]),
      ),
    ).toBe(true);
    expect(
      isMcpFixInProgress(
        fix(AutoRemediationSuggestionStatus.AutoExecuted, [
          call(1, ExternalMcpToolCallStatus.Running),
        ]),
      ),
    ).toBe(true);
    expect(
      isMcpFixInProgress(
        fix(AutoRemediationSuggestionStatus.Approved, [
          call(1, ExternalMcpToolCallStatus.Succeeded),
        ]),
      ),
    ).toBe(false);
    // Waiting for a click is not in progress: nothing is on its way.
    expect(
      isMcpFixInProgress(
        fix(AutoRemediationSuggestionStatus.Suggested, [
          call(1, ExternalMcpToolCallStatus.Proposed),
        ]),
      ),
    ).toBe(false);
  });

  test("its description names MCP servers only when a fix goes through them", () => {
    expect(
      getRemediationCardDescription([
        { suggestionType: AutoRemediationSuggestionType.McpToolCalls },
      ] as never),
    ).toBe(REMEDIATION_CARD_DESCRIPTION_WITH_MCP_FIXES);
    expect(
      getRemediationCardDescription([
        { suggestionType: AutoRemediationSuggestionType.Runbook },
      ] as never),
    ).not.toBe(REMEDIATION_CARD_DESCRIPTION_WITH_MCP_FIXES);
  });
});

describe("what the card says auto-remediation did", () => {
  function onlyLine(
    reason: AutoRemediationDecisionReason,
    lane: AutoRemediationDecisionLane,
  ): RemediationDecisionLine {
    const lines: Array<RemediationDecisionLine> = getRemediationDecisionLines({
      decision: {
        stage: AutoRemediationDecisionStage.Evaluated,
        entries: [{ lane, reason, ruleName: "Fix the API" }],
      },
      signal: "incident",
      translator: getGlobalTranslator(),
    });

    expect(lines).toHaveLength(1);
    return lines[0]!;
  }

  test("working out a fix through the MCP servers, and when it could not start", () => {
    expect(
      onlyLine(
        AutoRemediationDecisionReason.AiFixingThroughMcpServers,
        AutoRemediationDecisionLane.Project,
      ),
    ).toMatchObject({
      tone: "acted",
      text: "OneUptime AI is working out a fix for this incident through your MCP servers. It proposes the changes for your approval.",
    });
    expect(
      onlyLine(
        AutoRemediationDecisionReason.AiMcpFixNotStarted,
        AutoRemediationDecisionLane.Project,
      ).tone,
    ).toBe("attention");
    expect(
      onlyLine(
        AutoRemediationDecisionReason.RuleAiFixingThroughMcpServers,
        AutoRemediationDecisionLane.Rule,
      ),
    ).toMatchObject({
      tone: "acted",
      text: 'Rule "Fix the API" matched: OneUptime AI is working out a fix for this incident through your MCP servers.',
    });
  });

  test("the AI logs name the kind of fix", () => {
    expect(describeFixKind(AutoRemediationSuggestionType.McpToolCalls)).toBe(
      "MCP server tools",
    );
  });
});

describe("a run that used the MCP servers", () => {
  test("its activity names the steps in plain words", () => {
    const steps: Array<[AIRunEventType, string]> = [
      [AIRunEventType.ToolCallStarted, LIST_MCP_TOOLS_TOOL_NAME],
      [AIRunEventType.ToolCallCompleted, LIST_MCP_TOOLS_TOOL_NAME],
      [AIRunEventType.ToolCallStarted, CALL_MCP_TOOL_TOOL_NAME],
      [AIRunEventType.ToolCallCompleted, CALL_MCP_TOOL_TOOL_NAME],
    ];
    const run: Array<AIRunEvent> = steps.map(
      ([eventType, toolName]: [AIRunEventType, string], index: number) => {
        const event: AIRunEvent = new AIRunEvent(
          new ObjectID(`da1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8c0${index}`),
        );
        event.eventType = eventType;
        event.toolName = toolName;
        return event;
      },
    );

    render(<ChatActivityFeed events={run} />);

    expect(
      screen.getByText("Listing the tools of your MCP servers"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Using a tool of an MCP server"),
    ).toBeInTheDocument();
  });

  test("its evidence names them too", () => {
    expect(describeEvidenceTool(LIST_MCP_TOOLS_TOOL_NAME)).toMatchObject({
      description: "Listed the tools of your MCP servers",
      category: "MCP servers",
    });
    expect(describeEvidenceTool(CALL_MCP_TOOL_TOOL_NAME)).toMatchObject({
      description: "Used a tool of an MCP server",
      category: "MCP servers",
    });
  });
});

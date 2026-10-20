import RemediationPlanRunner from "../../../../Server/Utils/AI/Remediation/RemediationPlanRunner";
import McpRemediationRunner from "../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * A fix through MCP servers whose run died: the stranded-suggestion sweep
 * never says "nothing happened" of one that already sent changes (each is
 * recorded before it is sent) - it is settled as made, and verification
 * judges it. One that sent nothing changed nothing, and says so.
 */

const SUGGESTION_ID: ObjectID = new ObjectID(
  "ba1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const RUN_ID: ObjectID = new ObjectID("ba1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02");

function call(status: ExternalMcpToolCallStatus): ExternalMcpToolCall {
  return {
    sequence: 1,
    serverId: "ba1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03",
    serverNameSnapshot: "AWS",
    toolName: "restart_service",
    arguments: {},
    status,
  };
}

function strandedFix(calls: Array<ExternalMcpToolCall> | null): void {
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([
    {
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      projectId: new ObjectID("ba1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04"),
      incidentId: new ObjectID("ba1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05"),
      aiRunId: RUN_ID,
      status: AutoRemediationSuggestionStatus.Planning,
      suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      mcpToolCallPlan: calls
        ? ExternalMcpToolCallPlanUtil.toJSON({ calls })
        : null,
      ruleNameSnapshot: "Fix the API",
    } as unknown as AutoRemediationSuggestion,
  ] as never);

  jest.spyOn(AIRunService, "findOneById").mockResolvedValue({
    id: RUN_ID,
    status: AIRunStatus.Error,
  } as unknown as AIRun as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the stranded-suggestion sweep, for a fix through MCP servers", () => {
  it("a fix that sent changes is settled as made, never as nothing happened", async () => {
    strandedFix([
      call(ExternalMcpToolCallStatus.Succeeded),
      call(ExternalMcpToolCallStatus.Running),
    ]);
    const interrupted: jest.SpyInstance = jest
      .spyOn(McpRemediationRunner, "settleInterruptedFix")
      .mockResolvedValue(undefined as never);
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(interrupted).toHaveBeenCalledTimes(1);
    expect(interrupted.mock.calls[0]![0].reason).toBe(
      "the planning run failed",
    );
    expect(settle).not.toHaveBeenCalled();
  });

  it.each([
    ["only proposed changes", [call(ExternalMcpToolCallStatus.Proposed)]],
    ["no plan at all", null],
  ])(
    "a fix with %s changed nothing, and says so",
    async (_name: string, calls: Array<ExternalMcpToolCall> | null) => {
      strandedFix(calls);
      const interrupted: jest.SpyInstance = jest
        .spyOn(McpRemediationRunner, "settleInterruptedFix")
        .mockResolvedValue(undefined as never);
      const settle: jest.SpyInstance = jest
        .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
        .mockResolvedValue(1 as never);

      await RemediationPlanRunner.settleStrandedPlanningSuggestions();

      expect(interrupted).not.toHaveBeenCalled();
      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.NoneApplicable,
          }),
        }),
      );
      expect(String(settle.mock.calls[0]![0].set.rationaleMarkdown)).toContain(
        "Nothing was changed",
      );
    },
  );
});

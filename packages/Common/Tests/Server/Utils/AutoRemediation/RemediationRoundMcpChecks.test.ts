import {
  getRoundChecks,
  getRoundMcpChanges,
  RoundMcpChange,
} from "../../../../Server/Utils/AutoRemediation/RemediationRound";
import McpRemediationRunner, {
  McpFixMode,
} from "../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import McpRunToolkit, {
  CALL_MCP_TOOL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
  McpChangeDecision,
  McpToolCallRequest,
} from "../../../../Server/Utils/AI/Mcp/McpRunToolkit";
import ExternalMcpServerConnection from "../../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import ExternalMcpServerCheck from "../../../../Server/Utils/AI/Mcp/ExternalMcpServerCheck";
import { clearMcpSignInCachesForTests } from "../../../../Server/Utils/AI/Mcp/McpSignIn";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import ExternalMcpServerAuthType from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
  MAX_MCP_TOOL_CALLS_PER_FIX,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import { RemediationRoundCheck } from "../../../../Types/AutoRemediation/RemediationRound";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import FakeMcpServer, {
  FakeMcpTool,
  LocalMcpHttpTransport,
} from "../../../Helpers/FakeMcpServer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT A FIX THROUGH MCP SERVERS READ, IN WHAT IT CHECKED (issue #6526).
 *
 * A fix through the project's MCP servers checks the systems behind the
 * signal with the tools its servers mark as only reading, and makes or
 * proposes its fix with the ones that may change something - all through
 * one tool, call_mcp_tool. The Remediation step's What it checked lists
 * the reads like the commands a round ran: the server, the tool, why, when
 * and how it went. The changes stay out: they are the fix's plan.
 *
 * Here the real toolkit (McpRunToolkit) talks to a real MCP server over
 * HTTP, with the fix's own change handler (McpRemediationRunner
 * .decideChange) recording each change on its plan, and each call is
 * recorded as the AI engine records a tool step. The round's read
 * (getRoundChecks) then reads them back, so the step and the toolkit can
 * never disagree on what was a read: the citation of a change that was not
 * made, and the words of a call that failed at the server, are the
 * toolkit's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("6c000000-0000-4000-8000-000000000002");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000003",
);

// Never to reach a reader: what the reads were called with.
const SECRET_ARGUMENT: string = "acct-4242-do-not-show";

const TOOLS: Array<FakeMcpTool> = [
  {
    name: "describe_services",
    description: "Describes the ECS services of a cluster.",
    readOnly: true,
    handler: (args: JSONObject): JSONObject => {
      return {
        content: [
          { type: "text", text: `services of ${String(args["cluster"])}` },
        ],
      };
    },
  },
  {
    name: "get_metric_data",
    description: "Reads CloudWatch metrics.",
    readOnly: true,
    // The server answers, with an error of its own.
    handler: (): JSONObject => {
      return {
        content: [{ type: "text", text: "AccessDenied: cloudwatch:GetData" }],
        isError: true,
      };
    },
  },
  {
    name: "filter_log_events",
    description: "Reads CloudWatch Logs.",
    readOnly: true,
    // The call itself fails: the server answers with a protocol error.
    handler: (): JSONObject => {
      throw new Error("ThrottlingException: Rate exceeded");
    },
  },
  {
    name: "update_service",
    description: "Changes an ECS service's desired count.",
    readOnly: false,
    handler: (args: JSONObject): JSONObject => {
      return {
        content: [{ type: "text", text: `updated ${String(args["service"])}` }],
      };
    },
  },
];

const fakes: Array<FakeMcpServer> = [];

beforeEach(() => {
  clearMcpSignInCachesForTests();
  jest
    .spyOn(ExternalMcpServerCheck, "recordConnection")
    .mockResolvedValue(undefined);
  // The fix is still being worked out, and its plan is written as it goes.
  jest.spyOn(AutoRemediationSuggestionService, "findOneById").mockResolvedValue(
    Object.assign(new AutoRemediationSuggestion(), {
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    }),
  );
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(async () => {
  jest.restoreAllMocks();

  for (const fake of fakes.splice(0)) {
    await fake.stop();
  }
});

async function startServer(): Promise<FakeMcpServer> {
  const fake: FakeMcpServer = await FakeMcpServer.start({ tools: TOOLS });
  fakes.push(fake);
  return fake;
}

function storedServer(fake: FakeMcpServer): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server.id = new ObjectID("6c000000-0000-4000-8000-0000000000a1");
  server.projectId = PROJECT_ID;
  server.name = "AWS";
  server.description = "Production AWS account.";
  server.url = fake.url("/mcp");
  server.authType = ExternalMcpServerAuthType.BearerToken;
  server.bearerToken = "sekret-bearer-token";
  server.isEnabled = true;
  return server;
}

/*
 * A fix's run: the real toolkit, whose changes go to the fix's own handler
 * in the given mode, and the events the AI engine records for each call.
 */
class FixRun {
  public readonly plan: ExternalMcpToolCallPlan =
    ExternalMcpToolCallPlanUtil.empty();
  public readonly events: Array<AIRunEvent> = [];
  private readonly kit: McpRunToolkit;
  private sequence: number = 1;

  public constructor(server: ExternalMcpServer, mode: McpFixMode) {
    this.kit = new McpRunToolkit({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      servers: [server],
      purpose: "remediation",
      changeHandler: {
        decide: async (
          request: McpToolCallRequest,
        ): Promise<McpChangeDecision> => {
          return await McpRemediationRunner.decideChange({
            suggestionId: SUGGESTION_ID,
            plan: this.plan,
            request,
            mode,
          });
        },
      },
      createConnection: (stored: ExternalMcpServer) => {
        return ExternalMcpServerConnection.fromServer(stored, {
          transport: new LocalMcpHttpTransport(),
        });
      },
    });
  }

  // One tool step, recorded as AIInvestigationEngine.onStep records it.
  public async call(toolName: string, args: JSONObject): Promise<void> {
    this.record({
      eventType: AIRunEventType.ToolCallStarted,
      toolName,
      toolArguments: args,
    });

    const tool: ObservabilityAssistantExtraTool = this.kit
      .buildTools()
      .find((candidate: ObservabilityAssistantExtraTool): boolean => {
        return candidate.definition.name === toolName;
      })!;
    const outcome: ToolCallOutcome = await tool.execute(args);

    if (!outcome.success || !outcome.result) {
      this.record({
        eventType: AIRunEventType.ToolCallFailed,
        toolName,
        resultSummary: {
          errorMessage: outcome.errorMessage || outcome.textForLlm,
        },
      });
      return;
    }

    this.record({
      eventType: AIRunEventType.ToolCallCompleted,
      toolName,
      toolArguments: args,
      resultSummary: {
        rowCount: outcome.result.rowCount,
        citationLabel: outcome.result.citationLabel,
      },
    });
  }

  public async close(): Promise<void> {
    await this.kit.close();
  }

  // What the Remediation step reads of the run.
  public checks(): Array<RemediationRoundCheck> {
    return getRoundChecks({
      events: this.events,
      isRunOver: true,
      mcpChanges: getRoundMcpChanges(
        ExternalMcpToolCallPlanUtil.toJSON(this.plan),
      ),
    });
  }

  private record(data: {
    eventType: AIRunEventType;
    toolName: string;
    toolArguments?: JSONObject;
    resultSummary?: JSONObject;
  }): void {
    const event: AIRunEvent = new AIRunEvent();
    event.sequence = this.sequence;
    event.eventType = data.eventType;
    event.toolName = data.toolName;
    if (data.toolArguments) {
      event.toolArguments = data.toolArguments;
    }
    if (data.resultSummary) {
      event.resultSummary = data.resultSummary;
    }
    event.createdAt = new Date(Date.UTC(2026, 10, 19, 6, 0, this.sequence));
    this.sequence++;
    this.events.push(event);
  }
}

type CheckLine = [string, string, string, string];

// A check as a line: what it called, its mark, why, and what went wrong.
function lineOf(check: RemediationRoundCheck): CheckLine {
  return [
    check.mcpTool
      ? `${check.mcpTool.server} · ${check.mcpTool.tool}`
      : check.command,
    check.status,
    check.why,
    check.error,
  ];
}

describe("a fix through MCP servers that asks before it changes anything", () => {
  test("lists each tool it read with - the server's error when the server failed it - and none of its changes", async () => {
    const run: FixRun = new FixRun(
      storedServer(await startServer()),
      "Propose",
    );

    await run.call(LIST_MCP_TOOLS_TOOL_NAME, {});
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: { cluster: SECRET_ARGUMENT },
      rationale: "See how many tasks checkout-api runs.",
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "get_metric_data",
      arguments: { metric: SECRET_ARGUMENT },
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "aws",
      tool: "filter_log_events",
      arguments: { group: SECRET_ARGUMENT },
      rationale: "Look for the timeouts in the service's logs.",
    });
    // The change it proposes: recorded for approval, never sent.
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "update_service",
      arguments: { service: "checkout-api", desiredCount: 8 },
      rationale: "Scale checkout-api out to 8 tasks.",
    });
    await run.close();

    expect(
      run.plan.calls.map((call: ExternalMcpToolCall): string => {
        return call.status;
      }),
    ).toEqual([ExternalMcpToolCallStatus.Proposed]);
    expect(run.checks().map(lineOf)).toEqual([
      [
        "AWS · describe_services",
        "ran",
        "See how many tasks checkout-api runs.",
        "",
      ],
      // The server answered with an error: failed, with no words of its own.
      ["AWS · get_metric_data", "failed", "", ""],
      // The call failed at the server: its words, without the toolkit's own.
      [
        "aws · filter_log_events",
        "failed",
        "Look for the timeouts in the service's logs.",
        expect.stringContaining("ThrottlingException: Rate exceeded") as never,
      ],
    ]);
    expect(run.checks()[2]!.error.startsWith("Error calling")).toBe(false);
  });

  test("never names what a call was made with, or what it answered", async () => {
    const run: FixRun = new FixRun(
      storedServer(await startServer()),
      "Propose",
    );

    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: { cluster: SECRET_ARGUMENT },
    });
    await run.close();

    const sent: string = JSON.stringify(run.checks());

    expect(run.checks()).toHaveLength(1);
    expect(sent).not.toContain(SECRET_ARGUMENT);
    expect(sent).not.toContain("services of");
    expect(Object.keys(run.checks()[0]!).sort()).toEqual(
      ["at", "command", "error", "mcpTool", "status", "why"].sort(),
    );
    expect(run.checks()[0]!.mcpTool).toEqual({
      server: "AWS",
      tool: "describe_services",
    });
  });

  test("a call refused before it reached the server read nothing, and is left out", async () => {
    const run: FixRun = new FixRun(
      storedServer(await startServer()),
      "Propose",
    );

    // A tool the server does not have, a server the run does not have, and arguments that are no object.
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_everything",
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "Azure",
      tool: "describe_services",
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: "not json",
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: {},
    });
    await run.close();

    expect(run.checks().map(lineOf)).toEqual([
      ["AWS · describe_services", "ran", "", ""],
    ]);
  });

  test("a change refused once the fix holds its most changes is not run, and is never a read", async () => {
    const run: FixRun = new FixRun(
      storedServer(await startServer()),
      "Propose",
    );

    for (let index: number = 0; index <= MAX_MCP_TOOL_CALLS_PER_FIX; index++) {
      await run.call(CALL_MCP_TOOL_TOOL_NAME, {
        server: "AWS",
        tool: "update_service",
        arguments: { service: `svc-${index}`, desiredCount: index },
      });
    }

    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: {},
    });
    await run.close();

    expect(run.plan.calls).toHaveLength(MAX_MCP_TOOL_CALLS_PER_FIX);
    expect(run.checks().map(lineOf)).toEqual([
      ["AWS · describe_services", "ran", "", ""],
    ]);
  });
});

describe("a fix through MCP servers that makes its changes without asking", () => {
  test("lists its reads, and never the change it made", async () => {
    const run: FixRun = new FixRun(
      storedServer(await startServer()),
      "MakeChanges",
    );

    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: {},
      rationale: "See how many tasks checkout-api runs.",
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "update_service",
      arguments: { service: "checkout-api", desiredCount: 8 },
    });
    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "describe_services",
      arguments: {},
      rationale: "Check the new tasks came up.",
    });
    await run.close();

    expect(
      run.plan.calls.map((call: ExternalMcpToolCall): string => {
        return call.status;
      }),
    ).toEqual([ExternalMcpToolCallStatus.Succeeded]);
    expect(run.checks().map(lineOf)).toEqual([
      [
        "AWS · describe_services",
        "ran",
        "See how many tasks checkout-api runs.",
        "",
      ],
      ["AWS · describe_services", "ran", "Check the new tasks came up.", ""],
    ]);
  });

  test("a change on its way - recorded before it is sent - is never listed as a read at work", async () => {
    const run: FixRun = new FixRun(
      storedServer(await startServer()),
      "MakeChanges",
    );

    await run.call(CALL_MCP_TOOL_TOOL_NAME, {
      server: "AWS",
      tool: "update_service",
      arguments: { service: "checkout-api", desiredCount: 8 },
    });
    await run.close();

    // The run died after it sent the change: its end was never recorded.
    const events: Array<AIRunEvent> = run.events.slice(0, 1);
    const mcpChanges: Array<RoundMcpChange> = getRoundMcpChanges(
      ExternalMcpToolCallPlanUtil.toJSON(run.plan),
    );

    expect(getRoundChecks({ events, isRunOver: false, mcpChanges })).toEqual(
      [],
    );
    expect(getRoundChecks({ events, isRunOver: true, mcpChanges })).toEqual([]);
  });
});

import McpRemediationRunner, {
  McpFixTarget,
} from "../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import ExternalMcpServerConnection from "../../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import { clearMcpSignInCachesForTests } from "../../../../Server/Utils/AI/Mcp/McpSignIn";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ExternalMcpServerService from "../../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ExternalMcpServerAuthType from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { EVERY_EXTERNAL_MCP_SERVER } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
  MAX_MCP_TOOL_CALLS_PER_FIX,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import FakeMcpServer, {
  LocalMcpHttpTransport,
} from "../../../Helpers/FakeMcpServer";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A FIX THROUGH THE PROJECT'S EXTERNAL MCP SERVERS, AGAINST A FAKE MCP
 * SERVER: what runs is the rule's Approval's to decide, never the model's.
 *
 *   - Ask before fixing (and every fix of a rule that names no server, and
 *     the project's own when no rule is set up): a change the model makes
 *     is recorded as Proposed and NOT sent; a person's approval then makes
 *     exactly the recorded calls, in order, and nothing else.
 *   - Fix without asking, for a rule that names its servers: each change is
 *     recorded Running before it is sent, then what the server answered.
 *   - A change that fails stops the rest; a server turned off since is
 *     never reached; a fix settled meanwhile sends nothing more.
 *
 * The model is played by the test: AIInvestigationEngine.executeRun is
 * replaced by a script that calls the run's own tools - list_mcp_tools and
 * call_mcp_tool - the way a model would, then hands in its answer.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const RUN_ID: ObjectID = new ObjectID("6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03",
);
const RULE_ID: ObjectID = new ObjectID("6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04");
const SERVER_ID: ObjectID = new ObjectID(
  "6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05",
);
const OTHER_SERVER_ID: ObjectID = new ObjectID(
  "6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b06",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b07",
);

let fake: FakeMcpServer | null = null;

// The suggestion row as the database holds it, changed by the writes below.
let row: Record<string, unknown> = {};
// Every plan written, in order, as stored.
let writtenPlans: Array<ExternalMcpToolCallPlan> = [];
// Every status transition asked for.
let transitions: Array<{ from: string; set: Record<string, unknown> }> = [];
let feedItems: Array<string> = [];
let ruleRow: Record<string, unknown> | null = null;
let servers: Array<ExternalMcpServer> = [];
let autoExecutedInLastHour: number = 0;

function storedServer(
  id: ObjectID,
  fields: Partial<ExternalMcpServer> = {},
): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server.id = id;
  server._id = id.toString();
  server.projectId = PROJECT_ID;
  server.name = "AWS";
  server.url = fake ? fake.url("/mcp") : "http://127.0.0.1:1/mcp";
  server.authType = ExternalMcpServerAuthType.BearerToken;
  server.bearerToken = "stored-token";
  server.isEnabled = true;
  Object.assign(server, fields);
  return server;
}

function suggestionRow(overrides: Record<string, unknown> = {}): void {
  row = {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    executionMode: AutoRemediationExecutionMode.Suggest,
    incidentId: INCIDENT_ID,
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

function asSuggestion(): AutoRemediationSuggestion {
  const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  Object.assign(suggestion, row);
  return suggestion;
}

function lastPlan(): ExternalMcpToolCallPlan {
  const plan: ExternalMcpToolCallPlan | null =
    ExternalMcpToolCallPlanUtil.parse(row["mcpToolCallPlan"]);

  if (!plan) {
    throw new Error("no plan stored");
  }

  return plan;
}

async function startFake(): Promise<FakeMcpServer> {
  fake = await FakeMcpServer.start({
    requiredHeaders: { authorization: "Bearer stored-token" },
    tools: [
      {
        name: "describe_service",
        readOnly: true,
        handler: () => {
          return {
            content: [{ type: "text", text: "api: 0 of 3 tasks running" }],
          };
        },
      },
      {
        name: "restart_service",
        readOnly: false,
        handler: (args: JSONObject) => {
          return {
            content: [
              { type: "text", text: `restarted ${String(args["service"])}` },
            ],
          };
        },
      },
      {
        name: "scale_service",
        readOnly: false,
        handler: () => {
          return {
            content: [{ type: "text", text: "quota exceeded" }],
            isError: true,
          };
        },
      },
    ],
  });

  return fake;
}

function changingCalls(): Array<string> {
  return (fake?.calls || [])
    .map((call: { name: string }): string => {
      return call.name;
    })
    .filter((name: string): boolean => {
      return name !== "describe_service";
    });
}

beforeEach(() => {
  clearMcpSignInCachesForTests();
  writtenPlans = [];
  transitions = [];
  feedItems = [];
  ruleRow = null;
  servers = [];
  autoExecutedInLastHour = 0;
  suggestionRow();

  const realFromServer: typeof ExternalMcpServerConnection.fromServer =
    ExternalMcpServerConnection.fromServer.bind(ExternalMcpServerConnection);

  // Every connection reaches the fake server, never the egress guard.
  jest
    .spyOn(ExternalMcpServerConnection, "fromServer")
    .mockImplementation((server: ExternalMcpServer) => {
      return realFromServer(server, { transport: new LocalMcpHttpTransport() });
    });

  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation((async (args: {
      select: Record<string, unknown>;
    }): Promise<AutoRemediationSuggestion | null> => {
      if (!row["id"]) {
        return null;
      }

      // Only what the caller asks for, as a real read.
      const picked: Record<string, unknown> = { id: row["id"] };

      for (const key of Object.keys(args.select)) {
        if (key in row) {
          picked[key] = row[key];
        }
      }

      const suggestion: AutoRemediationSuggestion =
        new AutoRemediationSuggestion();
      Object.assign(suggestion, picked);
      return suggestion;
    }) as never);

  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockImplementation((async (args: {
      data: Record<string, unknown>;
    }): Promise<void> => {
      if (args.data["mcpToolCallPlan"]) {
        const plan: ExternalMcpToolCallPlan | null =
          ExternalMcpToolCallPlanUtil.parse(
            JSON.parse(JSON.stringify(args.data["mcpToolCallPlan"])),
          );
        writtenPlans.push(plan!);
      }

      Object.assign(row, JSON.parse(JSON.stringify(args.data)));
    }) as never);

  jest
    .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
    .mockImplementation((async (args: {
      fromStatus: string;
      set: Record<string, unknown>;
    }): Promise<number> => {
      transitions.push({ from: args.fromStatus, set: args.set });

      if (row["status"] !== args.fromStatus) {
        return 0;
      }

      Object.assign(row, args.set);
      return 1;
    }) as never);

  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockImplementation((async (): Promise<PositiveNumber> => {
      return new PositiveNumber(autoExecutedInLastHour);
    }) as never);

  jest
    .spyOn(AutoRemediationRuleService, "findOneById")
    .mockImplementation((async (): Promise<AutoRemediationRule | null> => {
      if (!ruleRow) {
        return null;
      }

      const rule: AutoRemediationRule = new AutoRemediationRule();
      Object.assign(rule, ruleRow);
      return rule;
    }) as never);

  jest
    .spyOn(ExternalMcpServerService, "findServersForRun")
    .mockImplementation((async (data: {
      allowance: { isEveryServer: boolean; serverIds: Array<string> };
    }): Promise<Array<ExternalMcpServer>> => {
      return servers.filter((server: ExternalMcpServer): boolean => {
        return (
          data.allowance.isEveryServer ||
          data.allowance.serverIds.includes(server.id!.toString().toLowerCase())
        );
      });
    }) as never);

  jest
    .spyOn(RemediationExecutionRunner, "checkProjectGates")
    .mockResolvedValue(null as never);

  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident.title = "API is down";
      incident.incidentNumber = 42;
      return incident;
    }) as never);

  jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null as never);

  jest
    .spyOn(AIRunService, "attemptStatusTransition")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation((async (data: {
      feedInfoInMarkdown: string;
    }): Promise<void> => {
      feedItems.push(data.feedInfoInMarkdown);
    }) as never);

  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
});

afterEach(async () => {
  jest.restoreAllMocks();

  if (fake) {
    await fake.stop();
    fake = null;
  }
});

/*
 * The model, played by the test: the run's own tools called as a model
 * would, then its answer handed to the run.
 */
// The run's MCP tools, as the model calls them.
interface ModelTools {
  list: () => Promise<ToolCallOutcome>;
  call: (
    tool: string,
    args?: JSONObject,
    server?: string,
  ) => Promise<ToolCallOutcome>;
}

function playModel(script: (tools: ModelTools) => Promise<void>): {
  requests: Array<InvestigationRequest>;
} {
  const requests: Array<InvestigationRequest> = [];

  jest
    .spyOn(AIInvestigationEngine, "executeRun")
    .mockImplementation((async (data: {
      request: InvestigationRequest;
    }): Promise<void> => {
      requests.push(data.request);

      const tools: Array<ObservabilityAssistantExtraTool> =
        data.request.extraTools || [];
      const named: (name: string) => ObservabilityAssistantExtraTool = (
        name: string,
      ): ObservabilityAssistantExtraTool => {
        const tool: ObservabilityAssistantExtraTool | undefined = tools.find(
          (candidate: ObservabilityAssistantExtraTool): boolean => {
            return candidate.definition.name === name;
          },
        );

        if (!tool) {
          throw new Error(`the run offers no ${name}`);
        }

        return tool;
      };

      await script({
        list: async (): Promise<ToolCallOutcome> => {
          return await named("list_mcp_tools").execute({});
        },
        call: async (
          tool: string,
          args: JSONObject = {},
          server: string = "AWS",
        ): Promise<ToolCallOutcome> => {
          return await named("call_mcp_tool").execute({
            server,
            tool,
            arguments: args,
          });
        },
      });

      await data.request.postAnalysis!({
        analysisMarkdown: "**Summary** - the API service is down.",
        confidence: {} as never,
        result: {} as never,
      });
    }) as never);

  return { requests };
}

async function runFix(): Promise<void> {
  await McpRemediationRunner.executeRun({
    aiRunId: RUN_ID,
    projectId: PROJECT_ID,
    suggestionId: SUGGESTION_ID,
    attemptCount: 1,
  });
}

describe("which servers a fix may use, and whether it asks", () => {
  test("no rule set up: every server, and every change waits for approval", async () => {
    const target: McpFixTarget | string =
      await McpRemediationRunner.getTarget(asSuggestion());

    expect(target).toEqual({
      allowance: EVERY_EXTERNAL_MCP_SERVER,
      mode: "Propose",
    });
  });

  test("a rule that fixes without asking and names its servers makes the changes", async () => {
    suggestionRow({
      autoRemediationRuleId: RULE_ID,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });
    ruleRow = {
      id: RULE_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      externalMcpServers: [{ _id: SERVER_ID.toString() }],
    };

    const target: McpFixTarget | string =
      await McpRemediationRunner.getTarget(asSuggestion());

    expect(target).toEqual({
      allowance: {
        isEveryServer: false,
        serverIds: [SERVER_ID.toString().toLowerCase()],
      },
      mode: "MakeChanges",
    });
  });

  test("proposes when the rule names no server, asks first, or spent its hourly limit", async () => {
    suggestionRow({
      autoRemediationRuleId: RULE_ID,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });
    const base: Record<string, unknown> = {
      id: RULE_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      externalMcpServers: [{ _id: SERVER_ID.toString() }],
    };

    ruleRow = { ...base, externalMcpServers: [] };
    expect(
      ((await McpRemediationRunner.getTarget(asSuggestion())) as McpFixTarget)
        .mode,
    ).toBe("Propose");

    ruleRow = { ...base, executionMode: AutoRemediationExecutionMode.Suggest };
    expect(
      ((await McpRemediationRunner.getTarget(asSuggestion())) as McpFixTarget)
        .mode,
    ).toBe("Propose");

    ruleRow = base;
    autoExecutedInLastHour = 3;
    expect(
      ((await McpRemediationRunner.getTarget(asSuggestion())) as McpFixTarget)
        .mode,
    ).toBe("Propose");

    // The suggestion was made to ask first: the rule changing since does not lift it.
    autoExecutedInLastHour = 0;
    suggestionRow({
      autoRemediationRuleId: RULE_ID,
      executionMode: AutoRemediationExecutionMode.Suggest,
    });
    expect(
      ((await McpRemediationRunner.getTarget(asSuggestion())) as McpFixTarget)
        .mode,
    ).toBe("Propose");
  });

  test("a failed limit check proposes", async () => {
    suggestionRow({
      autoRemediationRuleId: RULE_ID,
      executionMode: AutoRemediationExecutionMode.FullAuto,
    });
    ruleRow = {
      id: RULE_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      externalMcpServers: [{ _id: SERVER_ID.toString() }],
    };
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockRejectedValue(new Error("database is down") as never);

    expect(
      ((await McpRemediationRunner.getTarget(asSuggestion())) as McpFixTarget)
        .mode,
    ).toBe("Propose");
  });

  test("a rule deleted, of another project, or turned off stops the fix", async () => {
    suggestionRow({ autoRemediationRuleId: RULE_ID });

    ruleRow = null;
    expect(await McpRemediationRunner.getTarget(asSuggestion())).toContain(
      "deleted",
    );

    ruleRow = {
      id: RULE_ID,
      projectId: new ObjectID("6a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b99"),
      isEnabled: true,
    };
    expect(await McpRemediationRunner.getTarget(asSuggestion())).toContain(
      "deleted",
    );

    ruleRow = { id: RULE_ID, projectId: PROJECT_ID, isEnabled: false };
    expect(await McpRemediationRunner.getTarget(asSuggestion())).toContain(
      "turned off",
    );
  });

  // An AI rule set to "Don't fix" only investigates: it changes nothing.
  test("a rule set to only investigate since stops the fix, saying so", async () => {
    suggestionRow({ autoRemediationRuleId: RULE_ID });

    ruleRow = {
      id: RULE_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      fixes: false,
    };
    expect(await McpRemediationRunner.getTarget(asSuggestion())).toBe(
      "The rule behind this fix was set to only investigate before OneUptime AI could work on it, so it changed nothing.",
    );

    // Still fixing, it goes on.
    ruleRow = {
      id: RULE_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      fixes: true,
    };
    expect(typeof (await McpRemediationRunner.getTarget(asSuggestion()))).toBe(
      "object",
    );
  });
});

describe("a fix that asks first", () => {
  test("records the change for approval and sends nothing; approving makes exactly it", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];

    const outcomes: Array<ToolCallOutcome> = [];
    const { requests } = playModel(async (tools: ModelTools) => {
      outcomes.push(await tools.list());
      outcomes.push(await tools.call("describe_service"));
      outcomes.push(
        await tools.call("restart_service", { service: "api", force: true }),
      );
    });

    await runFix();

    // The run said it asks first, and was offered the MCP tools.
    expect(requests).toHaveLength(1);
    expect(requests[0]!.contextSummary).toContain("This fix asks first");
    expect(requests[0]!.personaOverride).toContain(
      "NOTHING you propose runs until a person approves it",
    );

    // The read ran; the change did not.
    expect(outcomes[1]!.textForLlm).toContain("0 of 3 tasks running");
    expect(outcomes[2]!.textForLlm).toContain("Nothing was sent");
    expect(changingCalls()).toEqual([]);

    // Proposed, waiting for a click.
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    const proposed: Array<ExternalMcpToolCall> = lastPlan().calls;
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({
      sequence: 1,
      serverId: SERVER_ID.toString(),
      toolName: "restart_service",
      arguments: { service: "api", force: true },
      status: ExternalMcpToolCallStatus.Proposed,
    });
    /*
     * The feed - and the Slack or Teams post made from it - says it the way
     * a person would: the server by name, the count in words.
     */
    const proposal: string = feedItems.join("\n");
    expect(proposal).toContain("proposes a fix through MCP server");
    expect(proposal).toContain("AWS");
    expect(proposal).toContain("(1 change)");
    expect(proposal).toContain("nothing changes until someone approves it");
    expect(proposal).not.toContain("change(s)");
    expect(proposal).not.toContain("nothing runs before");

    // A person approves (the API claims it), and exactly that call is made.
    row["status"] = AutoRemediationSuggestionStatus.Approved;
    row["verificationStatus"] = AutoRemediationVerificationStatus.Pending;
    row["verificationDeadlineAt"] = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      15,
    );

    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });

    expect(changingCalls()).toEqual(["restart_service"]);
    expect(fake!.calls[fake!.calls.length - 1]!.arguments).toEqual({
      service: "api",
      force: true,
    });

    const made: ExternalMcpToolCall = lastPlan().calls[0]!;
    expect(made.status).toBe(ExternalMcpToolCallStatus.Succeeded);
    expect(made.resultText).toContain("restarted api");
    expect(made.wasMadeWithoutAsking).toBeFalsy();
    expect(feedItems[feedItems.length - 1]).toContain(
      "The approved fix through MCP servers was made",
    );
    expect(feedItems[feedItems.length - 1]).toContain("(1 change)");
    expect(feedItems[feedItems.length - 1]).not.toContain("change(s)");

    // Recorded Running before it was sent.
    expect(
      writtenPlans.some((plan: ExternalMcpToolCallPlan): boolean => {
        return plan.calls[0]?.status === ExternalMcpToolCallStatus.Running;
      }),
    ).toBe(true);

    // Approving again makes nothing more.
    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });
    expect(changingCalls()).toEqual(["restart_service"]);
  });

  test("a change that fails stops the rest, and the feed says so", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    suggestionRow({
      status: AutoRemediationSuggestionStatus.Approved,
      verificationStatus: AutoRemediationVerificationStatus.Pending,
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
        calls: [
          proposedCall(1, "scale_service", { service: "api", count: 3 }),
          proposedCall(2, "restart_service", { service: "api" }),
        ],
      }),
    });

    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });

    expect(changingCalls()).toEqual(["scale_service"]);
    const calls: Array<ExternalMcpToolCall> = lastPlan().calls;
    expect(calls[0]!.status).toBe(ExternalMcpToolCallStatus.Failed);
    expect(calls[0]!.errorMessage).toContain("quota exceeded");
    expect(calls[1]!.status).toBe(ExternalMcpToolCallStatus.Skipped);
    expect(calls[1]!.errorMessage).toContain("an earlier change failed");
    expect(feedItems[feedItems.length - 1]).toContain("did not complete");
    expect(feedItems[feedItems.length - 1]).toContain("⚠️");
  });

  test("a server turned off since is never reached", async () => {
    await startFake();
    // The server the plan names is no longer one the project may use.
    servers = [storedServer(OTHER_SERVER_ID)];
    suggestionRow({
      status: AutoRemediationSuggestionStatus.Approved,
      verificationStatus: AutoRemediationVerificationStatus.Pending,
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
        calls: [proposedCall(1, "restart_service", { service: "api" })],
      }),
    });

    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });

    expect(fake!.calls).toEqual([]);
    expect(lastPlan().calls[0]!.status).toBe(ExternalMcpToolCallStatus.Failed);
    expect(lastPlan().calls[0]!.errorMessage).toContain(
      "was turned off or removed",
    );
  });

  test("a fix settled before the next change sends nothing more", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    suggestionRow({
      status: AutoRemediationSuggestionStatus.Approved,
      verificationStatus: AutoRemediationVerificationStatus.Pending,
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
        calls: [
          proposedCall(1, "restart_service", { service: "api" }),
          proposedCall(2, "restart_service", { service: "worker" }),
        ],
      }),
    });

    // Verification settles the fix as soon as the first change is answered.
    const originalUpdate: jest.Mock = jest.fn();
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockImplementation((async (args: {
        data: Record<string, unknown>;
      }): Promise<void> => {
        originalUpdate();
        Object.assign(row, JSON.parse(JSON.stringify(args.data)));
        const plan: ExternalMcpToolCallPlan | null =
          ExternalMcpToolCallPlanUtil.parse(row["mcpToolCallPlan"]);

        if (plan?.calls[0]?.status === ExternalMcpToolCallStatus.Succeeded) {
          row["verificationStatus"] =
            AutoRemediationVerificationStatus.Verified;
        }
      }) as never);

    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });

    expect(fake!.calls).toEqual([
      { name: "restart_service", arguments: { service: "api" } },
    ]);
    expect(lastPlan().calls[1]!.status).toBe(ExternalMcpToolCallStatus.Skipped);
  });

  test("makes nothing for a fix that is not approved, or that another executor holds", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    suggestionRow({
      status: AutoRemediationSuggestionStatus.Suggested,
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
        calls: [proposedCall(1, "restart_service", { service: "api" })],
      }),
    });

    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });
    expect(fake!.calls).toEqual([]);

    row["status"] = AutoRemediationSuggestionStatus.Approved;
    row["verificationStatus"] = AutoRemediationVerificationStatus.Pending;
    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("held") as never);

    await McpRemediationRunner.executeApprovedCalls({
      suggestionId: SUGGESTION_ID,
    });
    expect(fake!.calls).toEqual([]);
  });

  test("records at most the most changes one fix may hold", async () => {
    const plan: ExternalMcpToolCallPlan = ExternalMcpToolCallPlanUtil.empty();

    for (let index: number = 0; index < MAX_MCP_TOOL_CALLS_PER_FIX; index++) {
      const decision: { run: boolean } =
        await McpRemediationRunner.decideChange({
          suggestionId: SUGGESTION_ID,
          plan,
          request: changeRequest(),
          mode: "Propose",
        });
      expect(decision.run).toBe(false);
    }

    const over: { run: boolean; textForLlm?: string | undefined } =
      await McpRemediationRunner.decideChange({
        suggestionId: SUGGESTION_ID,
        plan,
        request: changeRequest(),
        mode: "Propose",
      });

    expect(over.run).toBe(false);
    expect(over.textForLlm).toContain(`at most ${MAX_MCP_TOOL_CALLS_PER_FIX}`);
    expect(plan.calls).toHaveLength(MAX_MCP_TOOL_CALLS_PER_FIX);
  });
});

describe("a fix that does not ask", () => {
  function fixesWithoutAsking(): void {
    suggestionRow({
      autoRemediationRuleId: RULE_ID,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      ruleNameSnapshot: "Restart the API",
    });
    ruleRow = {
      id: RULE_ID,
      projectId: PROJECT_ID,
      isEnabled: true,
      executionMode: AutoRemediationExecutionMode.FullAuto,
      externalMcpServers: [{ _id: SERVER_ID.toString() }],
    };
  }

  test("makes the change, recorded before it is sent, and settles AutoExecuted", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    fixesWithoutAsking();

    const outcomes: Array<ToolCallOutcome> = [];
    const { requests } = playModel(async (tools: ModelTools) => {
      outcomes.push(await tools.call("describe_service"));
      outcomes.push(await tools.call("restart_service", { service: "api" }));
    });

    await runFix();

    expect(requests[0]!.contextSummary).toContain(
      "This fix runs without asking",
    );
    expect(changingCalls()).toEqual(["restart_service"]);
    expect(outcomes[1]!.textForLlm).toContain("restarted api");

    // Running was written before the server was called, then the answer.
    expect(writtenPlans[0]!.calls[0]!.status).toBe(
      ExternalMcpToolCallStatus.Running,
    );
    const made: ExternalMcpToolCall = lastPlan().calls[0]!;
    expect(made.status).toBe(ExternalMcpToolCallStatus.Succeeded);
    expect(made.wasMadeWithoutAsking).toBe(true);
    expect(made.resultText).toContain("restarted api");

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.AutoExecuted);
    expect(row["verificationStatus"]).toBe(
      AutoRemediationVerificationStatus.Pending,
    );
    expect(feedItems.join("\n")).toContain("without asking");
  });

  test("uses only the servers the rule names", async () => {
    await startFake();
    servers = [
      storedServer(SERVER_ID),
      storedServer(OTHER_SERVER_ID, { name: "Azure" }),
    ];
    fixesWithoutAsking();

    const outcomes: Array<ToolCallOutcome> = [];
    playModel(async (tools: ModelTools) => {
      outcomes.push(
        await tools.call("restart_service", { service: "api" }, "Azure"),
      );
    });

    await runFix();

    expect(changingCalls()).toEqual([]);
    expect(outcomes[0]!.textForLlm).not.toContain("restarted");
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.NoneApplicable);
  });

  test("a fix dismissed while it works sends nothing more", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    fixesWithoutAsking();

    const outcomes: Array<ToolCallOutcome> = [];
    playModel(async (tools: ModelTools) => {
      row["status"] = AutoRemediationSuggestionStatus.Dismissed;
      outcomes.push(await tools.call("restart_service", { service: "api" }));
    });

    await runFix();

    expect(changingCalls()).toEqual([]);
    expect(outcomes[0]!.textForLlm).toContain("Nothing was sent");
  });

  test("a change that cannot be recorded first is never sent", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    fixesWithoutAsking();
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockRejectedValue(new Error("write failed") as never);

    const outcomes: Array<ToolCallOutcome> = [];
    playModel(async (tools: ModelTools) => {
      outcomes.push(await tools.call("restart_service", { service: "api" }));
    });

    await runFix();

    expect(changingCalls()).toEqual([]);
    expect(outcomes[0]!.textForLlm).toContain("could not be recorded first");
  });

  test("a retried run whose earlier attempt sent changes settles what happened, never runs again", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    fixesWithoutAsking();
    row["mcpToolCallPlan"] = ExternalMcpToolCallPlanUtil.toJSON({
      calls: [
        {
          ...proposedCall(1, "restart_service", { service: "api" }),
          status: ExternalMcpToolCallStatus.Running,
          wasMadeWithoutAsking: true,
        },
      ],
    });
    const { requests } = playModel(async () => {
      // Never reached.
    });

    await runFix();

    expect(requests).toEqual([]);
    expect(changingCalls()).toEqual([]);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.AutoExecuted);
    expect(String(row["rationaleMarkdown"])).toContain("interrupted");
  });
});

describe("a fix with nothing to do", () => {
  test("no server on any more: settled NoneApplicable, no model run", async () => {
    servers = [];
    const { requests } = playModel(async () => {
      // Never reached.
    });

    await runFix();

    expect(requests).toEqual([]);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.NoneApplicable);
  });

  test("the model changes nothing: NoneApplicable with its answer", async () => {
    await startFake();
    servers = [storedServer(SERVER_ID)];
    playModel(async (tools: ModelTools) => {
      await tools.call("describe_service");
    });

    await runFix();

    expect(changingCalls()).toEqual([]);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.NoneApplicable);
    expect(row["rationaleMarkdown"]).toContain("the API service is down");
  });
});

describe("the remediation queue", () => {
  test("hands a fix through MCP servers to its own runner", async () => {
    const run: jest.SpyInstance = jest
      .spyOn(McpRemediationRunner, "executeRun")
      .mockResolvedValue(undefined as never);

    await RemediationExecutionRunner.executeRemediation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 2,
    });

    expect(run).toHaveBeenCalledWith({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 2,
    });
  });
});

function proposedCall(
  sequence: number,
  toolName: string,
  args: JSONObject,
): ExternalMcpToolCall {
  return {
    sequence,
    serverId: SERVER_ID.toString(),
    serverNameSnapshot: "AWS",
    toolName,
    arguments: args,
    status: ExternalMcpToolCallStatus.Proposed,
  };
}

function changeRequest(): {
  serverId: string;
  serverName: string;
  toolName: string;
  arguments: JSONObject;
} {
  return {
    serverId: SERVER_ID.toString(),
    serverName: "AWS",
    toolName: "restart_service",
    arguments: { service: "api" },
  };
}

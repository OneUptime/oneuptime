import McpInvestigationTools from "../../../../../Server/Utils/AI/Mcp/McpInvestigationTools";
import McpRunToolkit from "../../../../../Server/Utils/AI/Mcp/McpRunToolkit";
import ExternalMcpServerConnection from "../../../../../Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import { clearMcpSignInCachesForTests } from "../../../../../Server/Utils/AI/Mcp/McpSignIn";
import ToolOutputPager from "../../../../../Server/Utils/AI/Chat/ToolOutputPager";
import { ObservabilityAssistantExtraTool } from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../../Server/Utils/AI/Toolbox/Index";
import IncidentAlertRuleMatcher from "../../../../../Server/Utils/Rules/IncidentAlertRuleMatcher";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import AlertService from "../../../../../Server/Services/AlertService";
import ExternalMcpServerService from "../../../../../Server/Services/ExternalMcpServerService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import ExternalMcpServer from "../../../../../Models/DatabaseModels/ExternalMcpServer";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ExternalMcpServerAuthType from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerAllowance } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import ObjectID from "../../../../../Types/ObjectID";
import FakeMcpServer, {
  LocalMcpHttpTransport,
} from "../../../../Helpers/FakeMcpServer";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE EXTERNAL MCP SERVERS AN INVESTIGATION MAY USE: the project's servers
 * that are on, as the AI rules that investigate and match the incident (or
 * alert) allow - all of them with no rule, or when a matching rule names
 * none; only the named ones otherwise; none when the rules cannot be read.
 * And only their tools that read: a tool that may change something is
 * refused, never sent.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const RUN_ID: ObjectID = new ObjectID("8a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02");
const INCIDENT_ID: ObjectID = new ObjectID(
  "8a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03",
);
const ALERT_ID: ObjectID = new ObjectID("8a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04");
const AWS_ID: string = "8a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05";
const AZURE_ID: string = "8a1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b06";

let fake: FakeMcpServer | null = null;
let rules: Array<AutoRemediationRule> | Error = [];
// The rules (by name) the signal matches.
let matching: Array<string> = [];
let allowances: Array<ExternalMcpServerAllowance> = [];
let servers: Array<ExternalMcpServer> = [];
const toolkits: Array<McpRunToolkit> = [];

function rule(name: string, serverIds: Array<string>): AutoRemediationRule {
  const item: AutoRemediationRule = new AutoRemediationRule();
  item.name = name;
  item.externalMcpServers = serverIds.map((id: string): ExternalMcpServer => {
    const server: ExternalMcpServer = new ExternalMcpServer();
    server._id = id;
    return server;
  });
  return item;
}

function server(id: string, name: string): ExternalMcpServer {
  const item: ExternalMcpServer = new ExternalMcpServer();
  item.id = new ObjectID(id);
  item._id = id;
  item.projectId = PROJECT_ID;
  item.name = name;
  item.url = fake ? fake.url("/mcp") : "http://127.0.0.1:1/mcp";
  item.authType = ExternalMcpServerAuthType.None;
  item.isEnabled = true;
  return item;
}

beforeEach(() => {
  clearMcpSignInCachesForTests();
  rules = [];
  matching = [];
  allowances = [];
  servers = [];

  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(new Incident() as never);
  jest
    .spyOn(AlertService, "findOneById")
    .mockResolvedValue(new Alert() as never);

  jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockImplementation((async (): Promise<Array<AutoRemediationRule>> => {
      if (rules instanceof Error) {
        throw rules;
      }

      return rules;
    }) as never);

  const matches: (
    _signal: unknown,
    candidate: AutoRemediationRule,
  ) => Promise<boolean> = async (
    _signal: unknown,
    candidate: AutoRemediationRule,
  ): Promise<boolean> => {
    return matching.includes(candidate.name || "");
  };

  jest
    .spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch")
    .mockImplementation(matches as never);
  jest
    .spyOn(IncidentAlertRuleMatcher, "doesAlertMatch")
    .mockImplementation(matches as never);

  jest
    .spyOn(ExternalMcpServerService, "findServersForRun")
    .mockImplementation((async (data: {
      allowance: ExternalMcpServerAllowance;
    }): Promise<Array<ExternalMcpServer>> => {
      allowances.push(data.allowance);

      return servers.filter((candidate: ExternalMcpServer): boolean => {
        return (
          data.allowance.isEveryServer ||
          data.allowance.serverIds.includes(candidate._id!.toLowerCase())
        );
      });
    }) as never);

  const realFromServer: typeof ExternalMcpServerConnection.fromServer =
    ExternalMcpServerConnection.fromServer.bind(ExternalMcpServerConnection);

  jest
    .spyOn(ExternalMcpServerConnection, "fromServer")
    .mockImplementation((stored: ExternalMcpServer) => {
      return realFromServer(stored, { transport: new LocalMcpHttpTransport() });
    });
});

afterEach(async () => {
  for (const kit of toolkits.splice(0)) {
    await kit.close();
  }

  jest.restoreAllMocks();

  if (fake) {
    await fake.stop();
    fake = null;
  }
});

async function forIncident(): Promise<McpRunToolkit | null> {
  const kit: McpRunToolkit | null = await McpInvestigationTools.forIncident({
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: RUN_ID,
    outputPager: new ToolOutputPager(),
  });

  if (kit) {
    toolkits.push(kit);
  }

  return kit;
}

describe("which servers an investigation may use", () => {
  test("with no AI rule that investigates, all of the project's servers", async () => {
    servers = [server(AWS_ID, "AWS"), server(AZURE_ID, "Azure")];

    expect(await forIncident()).not.toBeNull();
    expect(allowances).toEqual([{ isEveryServer: true, serverIds: [] }]);
  });

  test("a matching rule that names servers: only those", async () => {
    servers = [server(AWS_ID, "AWS"), server(AZURE_ID, "Azure")];
    rules = [rule("Production", [AWS_ID]), rule("Staging", [AZURE_ID])];
    matching = ["Production"];

    expect(await forIncident()).not.toBeNull();
    expect(allowances).toEqual([{ isEveryServer: false, serverIds: [AWS_ID] }]);
  });

  test("a matching rule that names none: all of them", async () => {
    servers = [server(AWS_ID, "AWS")];
    rules = [rule("Production", [AWS_ID]), rule("Everything", [])];
    matching = ["Production", "Everything"];

    expect(await forIncident()).not.toBeNull();
    expect(allowances).toEqual([{ isEveryServer: true, serverIds: [] }]);
  });

  test("rules that cannot be read: none, and OneUptime's own data only", async () => {
    servers = [server(AWS_ID, "AWS")];
    rules = new Error("database is down");

    expect(await forIncident()).toBeNull();
    expect(allowances).toEqual([]);
  });

  test("no server on, or allowed: no toolkit", async () => {
    rules = [rule("Production", [AZURE_ID])];
    matching = ["Production"];
    servers = [server(AWS_ID, "AWS")];

    expect(await forIncident()).toBeNull();
  });

  test("an alert is matched against the alert rules the same way", async () => {
    servers = [server(AWS_ID, "AWS"), server(AZURE_ID, "Azure")];
    rules = [rule("Payments", [AZURE_ID])];
    matching = ["Payments"];

    const kit: McpRunToolkit | null = await McpInvestigationTools.forAlert({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      aiRunId: RUN_ID,
      outputPager: new ToolOutputPager(),
    });

    if (kit) {
      toolkits.push(kit);
    }

    expect(kit).not.toBeNull();
    expect(allowances).toEqual([
      { isEveryServer: false, serverIds: [AZURE_ID] },
    ]);
  });

  test("a signal that cannot be read: no toolkit, never a failed run", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("gone") as never);

    expect(await forIncident()).toBeNull();
  });
});

describe("what an investigation may do with them", () => {
  test("reads, and never changes: a tool that may change something is refused and not sent", async () => {
    fake = await FakeMcpServer.start({
      tools: [
        { name: "describe_instances", readOnly: true },
        { name: "reboot_instance", readOnly: false },
      ],
    });
    servers = [server(AWS_ID, "AWS")];

    const kit: McpRunToolkit | null = await forIncident();
    expect(kit).not.toBeNull();

    const callTool: ObservabilityAssistantExtraTool = kit!
      .buildTools()
      .find((tool: ObservabilityAssistantExtraTool): boolean => {
        return tool.definition.name === "call_mcp_tool";
      })!;

    const read: ToolCallOutcome = await callTool.execute({
      server: "AWS",
      tool: "describe_instances",
      arguments: {},
    });
    const change: ToolCallOutcome = await callTool.execute({
      server: "AWS",
      tool: "reboot_instance",
      arguments: { id: "i-123" },
    });

    expect(read.success).toBe(true);
    expect(change.success).toBe(false);
    expect(
      fake.calls.map((call: { name: string }): string => {
        return call.name;
      }),
    ).toEqual(["describe_instances"]);
  });
});

import { describe, expect, test } from "@jest/globals";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import {
  AssistantPromptContext,
  describeResourceForPrompt,
  getAssistantPrompts,
  getMcpApiKeySetupMarkdown,
  getMcpClientSetups,
  getMcpServerUrl,
  getMcpToolNames,
  hasMcpTools,
  McpClientSetup,
  sanitizeMcpToolName,
} from "../../../Utils/DeveloperDocs/AiAssistantExamples";

/*
 * The Developer > AI Assistants pages. Tool names are the MCP server's
 * (App/FeatureSet/MCP/Tests/DeveloperDocsAiAssistant.test.ts checks them
 * against the real tool list); prompts only ask for what the assistant can
 * actually do with the tools it has.
 */

const MCP_URL: string = "https://oneuptime.com/mcp";
const ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";

describe("tool names", () => {
  test("the MCP server's sanitizer", () => {
    expect(sanitizeMcpToolName("On-Call Policy")).toBe("on_call_policy");
    expect(sanitizeMcpToolName("Scheduled Maintenance Events")).toBe(
      "scheduled_maintenance_events",
    );
    expect(sanitizeMcpToolName("monitorStatus")).toBe("monitor_status");
    expect(sanitizeMcpToolName("--x--")).toBe("x");
  });

  test("a model with MCP tools has the six CRUD tools", () => {
    expect(getMcpToolNames(Monitor)).toEqual({
      create: "create_monitor",
      get: "get_monitor",
      list: "list_monitors",
      update: "update_monitor",
      delete: "delete_monitor",
      count: "count_monitors",
    });
    // Singular "On-Call Policy", plural "On-Call Duty Policies".
    expect(getMcpToolNames(OnCallDutyPolicy)?.get).toBe("get_on_call_policy");
    expect(getMcpToolNames(OnCallDutyPolicy)?.list).toBe(
      "list_on_call_duty_policies",
    );
  });

  test("a model the MCP server does not cover has none", () => {
    expect(hasMcpTools(Workflow)).toBe(false);
    expect(getMcpToolNames(Workflow)).toBeNull();
  });
});

describe("connecting an assistant", () => {
  test("the server URL is this installation's /mcp", () => {
    expect(getMcpServerUrl("https://oneuptime.com/")).toBe(MCP_URL);
  });

  test("each client is set up with the URL alone, so it signs in instead of carrying a key", () => {
    const setups: Array<McpClientSetup> = getMcpClientSetups(MCP_URL);

    expect(
      setups.map((setup: McpClientSetup): string => {
        return setup.label;
      }),
    ).toEqual(["Claude Code", "Claude", "VS Code", "Cursor", "Other assistants"]);

    for (const setup of setups) {
      expect({ label: setup.label, hasUrl: setup.markdown.includes(MCP_URL) }).toEqual(
        { label: setup.label, hasUrl: true },
      );
      expect(setup.markdown).not.toContain("x-api-key");
    }

    expect(setups[0]?.markdown).toContain(
      `claude mcp add --transport http oneuptime ${MCP_URL}`,
    );
  });

  test("an unattended agent reads the key from the environment, never inline", () => {
    const markdown: string = getMcpApiKeySetupMarkdown(MCP_URL);

    expect(markdown).toContain('--header "x-api-key: $ONEUPTIME_API_KEY"');
    expect(markdown).toContain("Never give an agent a master API key.");
  });
});

function context(
  overrides: Partial<AssistantPromptContext>,
): AssistantPromptContext {
  return {
    modelType: Monitor,
    singularName: "Monitor",
    pluralName: "Monitors",
    apiReferenceUrl: "https://oneuptime.com/reference/monitor",
    ...overrides,
  };
}

describe("prompts", () => {
  test("name the resource and its id, so the assistant finds the right one", () => {
    expect(
      describeResourceForPrompt(
        context({ displayName: "API Health", id: ID }),
      ),
    ).toBe(`the monitor "API Health" (ID ${ID})`);
    expect(describeResourceForPrompt(context({ id: ID }))).toBe(
      `the monitor with ID ${ID}`,
    );
  });

  test("a monitor's prompts are about its status and incidents", () => {
    const prompts: Array<string> = getAssistantPrompts(
      context({ displayName: "API Health", id: ID }),
    );

    expect(prompts[0]).toBe(
      `Is the monitor "API Health" (ID ${ID}) up right now? Show me its status changes from the last 7 days.`,
    );
    expect(prompts.length).toBeGreaterThanOrEqual(2);
  });

  test("incident and alert prompts use the acknowledge and note tools", () => {
    expect(
      getAssistantPrompts(
        context({
          modelType: Incident,
          singularName: "Incident",
          pluralName: "Incidents",
          displayName: "Checkout errors",
          id: ID,
        }),
      ).join("\n"),
    ).toContain("Acknowledge the incident");
    expect(
      getAssistantPrompts(
        context({
          modelType: Alert,
          singularName: "Alert",
          pluralName: "Alerts",
          id: ID,
        }),
      ).join("\n"),
    ).toContain("Resolve the alert");
  });

  test("a status page's prompts post announcements", () => {
    expect(
      getAssistantPrompts(
        context({
          modelType: StatusPage,
          singularName: "Status Page",
          pluralName: "Status Pages",
          displayName: "Acme",
          id: ID,
        }),
      ).join("\n"),
    ).toContain('Post an announcement on the status page "Acme"');
  });

  test("on a list page the prompts are about all of them", () => {
    expect(getAssistantPrompts(context({}))[0]).toBe(
      "Which of my monitors are not operational right now?",
    );
  });

  test("other MCP models get general prompts", () => {
    expect(
      getAssistantPrompts(
        context({
          modelType: Label,
          singularName: "Label",
          pluralName: "Labels",
          displayName: "prod",
          id: ID,
        }),
      )[0],
    ).toBe(`Show me the label "prod" (ID ${ID}) in OneUptime and summarize how it is set up.`);
  });

  test("without MCP tools, prompts send a coding assistant to the API, and ask for Terraform", () => {
    const prompts: Array<string> = getAssistantPrompts({
      modelType: Workflow,
      singularName: "Workflow",
      pluralName: "Workflows",
      displayName: "Send weekly report",
      id: ID,
      apiReferenceUrl: "https://oneuptime.com/reference/workflow",
    });

    expect(prompts).toEqual([
      `Show me the workflow "Send weekly report" (ID ${ID}) and explain what it does. Use the OneUptime REST API (reference: https://oneuptime.com/reference/workflow) with the API key in the ONEUPTIME_API_KEY environment variable.`,
      `Update the description of the workflow "Send weekly report" (ID ${ID}) so it explains what it is for. Use the OneUptime REST API (reference: https://oneuptime.com/reference/workflow) with the API key in the ONEUPTIME_API_KEY environment variable.`,
      `Write Terraform for the workflow "Send weekly report" (ID ${ID}) with the oneuptime/oneuptime provider (resource oneuptime_workflow), with an import block so Terraform adopts the existing one.`,
    ]);
  });

  test("no prompt ever carries a key", () => {
    for (const prompt of [
      ...getAssistantPrompts(context({ id: ID })),
      ...getAssistantPrompts({
        modelType: Workflow,
        singularName: "Workflow",
        pluralName: "Workflows",
        apiReferenceUrl: "https://oneuptime.com/reference/workflow",
      }),
    ]) {
      expect(prompt).not.toMatch(/your-api-key|ApiKey:/);
    }
  });
});

/*
 * The two Switch / Case templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, its
 * values substituted the way RunWorkflow does, the real Switch / Case, Log
 * and Slack steps, and Slack faked at API.fetch.
 *
 *   - "Take one of several paths" (webhook-switch): a webhook's environment
 *     field takes one Log for production, another for staging and a third
 *     for anything else - and nothing needs setting up first.
 *   - "Send each new incident to the right Slack channel by severity"
 *     (incident-severity-slack): a critical incident goes to one Slack
 *     webhook, a major one to the other, anything else is only logged, and a
 *     failed post is logged where it happened.
 */

import { JSONObject } from "../../../Types/JSON";
import {
  getWorkflowTemplate,
  getRecommendedWorkflowTemplates,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getWorkflowTemplateOutline,
} from "../../../Types/Workflow/Templates";
import ComponentID from "../../../Types/Workflow/ComponentID";
import {
  SimulatedReply,
  SimulatedRequest,
  SimulationTrace,
  runTemplate,
} from "./WorkflowTemplateSimulator";
import { describe, expect, test } from "@jest/globals";

const CRITICAL_WEBHOOK: string =
  "https://hooks.slack.com/services/T000/B000/CRITICAL";
const MAJOR_WEBHOOK: string =
  "https://hooks.slack.com/services/T000/B000/MAJOR";

const SLACK_OK: SimulatedReply = { status: 200, body: "ok" };

type WebhookRunFunction = (body: JSONObject) => Promise<SimulationTrace>;

const runWebhookSwitch: WebhookRunFunction = async (
  body: JSONObject,
): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: "webhook-switch",
    trigger: {
      "request-headers": { "content-type": "application/json" },
      "request-params": {},
      "request-body": body,
    },
    variables: {},
  });
};

type IncidentRunFunction = (
  severity: string,
  http?: (request: SimulatedRequest) => SimulatedReply,
) => Promise<SimulationTrace>;

const runSeveritySwitch: IncidentRunFunction = async (
  severity: string,
  http?: (request: SimulatedRequest) => SimulatedReply,
): Promise<SimulationTrace> => {
  return await runTemplate({
    templateId: "incident-severity-slack",
    trigger: {
      model: {
        _id: "6a1b2c3d-0000-4000-8000-000000000001",
        title: "Checkout is down",
        incidentNumber: 42,
        incidentNumberWithPrefix: "INC-42",
        incidentSeverity: { name: severity },
        currentIncidentState: { name: "Created" },
      },
    },
    variables: {
      slackCriticalWebhookUrl: CRITICAL_WEBHOOK,
      slackMajorWebhookUrl: MAJOR_WEBHOOK,
    },
    http:
      http ||
      ((): SimulatedReply => {
        return SLACK_OK;
      }),
  });
};

type PostedTextFunction = (request: SimulatedRequest | undefined) => string;

// The text of the one section a Slack step posts.
const postedText: PostedTextFunction = (
  request: SimulatedRequest | undefined,
): string => {
  const blocks: Array<JSONObject> = ((request?.body as JSONObject)?.[
    "blocks"
  ] || []) as Array<JSONObject>;

  return blocks
    .map((block: JSONObject): string => {
      return String((block["text"] as JSONObject | undefined)?.["text"] || "");
    })
    .join("\n");
};

describe("Take one of several paths (webhook-switch)", () => {
  test("is a Basics template that needs nothing set up, and says what it teaches", () => {
    const template: WorkflowTemplate | null =
      getWorkflowTemplate("webhook-switch");

    expect(template?.category).toBe(WorkflowTemplateCategory.Basics);
    expect(template?.variables).toEqual([]);
    expect(template?.teaches).toContain("Switch / Case");
  });

  test("production takes the first case", async () => {
    const trace: SimulationTrace = await runWebhookSwitch({
      environment: "production",
    });

    expect(trace.executed).toEqual(["webhook-1", "switch-1", "log-production"]);
    expect(trace.ports["switch-1"]).toBe("case-1");
    expect(trace.logs).toEqual([
      "🚨 Production webhook received. Treating it as urgent.",
    ]);
  });

  test("staging takes the second", async () => {
    const trace: SimulationTrace = await runWebhookSwitch({
      environment: "staging",
    });

    expect(trace.executed).toEqual(["webhook-1", "switch-1", "log-staging"]);
    expect(trace.ports["switch-1"]).toBe("case-2");
  });

  test("anything else takes Default, which logs the environment it came from", async () => {
    const trace: SimulationTrace = await runWebhookSwitch({
      environment: "qa",
    });

    expect(trace.executed).toEqual(["webhook-1", "switch-1", "log-other"]);
    expect(trace.ports["switch-1"]).toBe("default");
    expect(trace.logs).toEqual([
      "ℹ️ Webhook from another environment: qa. Logged without alerting.",
    ]);
  });

  test("a body without the field takes Default too", async () => {
    const trace: SimulationTrace = await runWebhookSwitch({});

    expect(trace.ports["switch-1"]).toBe("default");
  });

  test("capital letters count: Production is not production", async () => {
    const trace: SimulationTrace = await runWebhookSwitch({
      environment: "Production",
    });

    expect(trace.ports["switch-1"]).toBe("default");
  });

  test("the run's log says which case matched and why", async () => {
    const trace: SimulationTrace = await runWebhookSwitch({
      environment: "staging",
    });

    // The Switch / Case's own lines come first, before the Log step's.
    expect(trace.runLog.slice(0, 3)).toEqual([
      "Case 1 (production): no match.",
      "Case 2 (staging): matched.",
      "Case 2 matched: the value is equal to “staging”. Case 1 did not.",
    ]);
  });
});

describe("Send each new incident to the right Slack channel by severity (incident-severity-slack)", () => {
  test("is an Incidents template asking for the two channels' webhooks", () => {
    const template: WorkflowTemplate | null = getWorkflowTemplate(
      "incident-severity-slack",
    );

    expect(template?.category).toBe(WorkflowTemplateCategory.Incidents);
    expect(
      template?.variables.map((variable: { name: string }): string => {
        return variable.name;
      }),
    ).toEqual(["slackCriticalWebhookUrl", "slackMajorWebhookUrl"]);
    expect(template?.workflowDescription).toContain(
      "If your severities have other names, change the cases to match them.",
    );
  });

  test("a critical incident is posted to the critical channel, and only there", async () => {
    const trace: SimulationTrace = await runSeveritySwitch("Critical Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "slack-critical",
    ]);
    expect(trace.requests).toHaveLength(1);
    expect(trace.requests[0]?.url).toBe(CRITICAL_WEBHOOK);
    expect(postedText(trace.requests[0])).toContain(
      "Critical incident INC-42 declared",
    );
    expect(postedText(trace.requests[0])).toContain("Checkout is down");
  });

  test("a major incident is posted to the other channel", async () => {
    const trace: SimulationTrace = await runSeveritySwitch("Major Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "slack-major",
    ]);
    expect(trace.requests).toHaveLength(1);
    expect(trace.requests[0]?.url).toBe(MAJOR_WEBHOOK);
    expect(postedText(trace.requests[0])).toContain(
      "Major incident INC-42 declared",
    );
  });

  test("any other severity is only logged, naming it", async () => {
    const trace: SimulationTrace = await runSeveritySwitch("Minor Incident");

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "log-other-severity",
    ]);
    expect(trace.requests).toEqual([]);
    expect(trace.logs).toEqual([
      "ℹ️ Incident INC-42 is Minor Incident, so it was not posted to Slack.",
    ]);
  });

  test("a post Slack refuses is logged by the step that made it", async () => {
    const trace: SimulationTrace = await runSeveritySwitch(
      "Critical Incident",
      (): SimulatedReply => {
        return { status: 404, body: "no_service" };
      },
    );

    expect(trace.executed).toEqual([
      "incident-on-create-1",
      "switch-1",
      "slack-critical",
      "log-critical-failed",
    ]);
    expect(trace.ports["slack-critical"]).toBe("error");
    expect(trace.logs[0]).toContain(
      "❌ Slack could not deliver the critical incident",
    );
  });

  test("its outline leads with the trigger, then the check, the Slack posts, and the logs last", () => {
    expect(getWorkflowTemplateOutline("incident-severity-slack")).toEqual({
      triggerComponentId: "incident-on-create",
      stepComponentIds: [
        ComponentID.Switch,
        ComponentID.SlackSendMessageToChannel,
        ComponentID.Log,
      ],
      blockCount: 7,
    });
  });

  test("is not one of the recommended handful: those stay one-step notifications", () => {
    expect(
      getRecommendedWorkflowTemplates().map(
        (template: WorkflowTemplate): string => {
          return template.id;
        },
      ),
    ).not.toContain("incident-severity-slack");
  });
});

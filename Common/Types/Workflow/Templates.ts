/*
 * Starter workflows.
 *
 * An empty canvas is a bad first lesson: the thing a new builder most needs to
 * learn is how one step reads another's output, and nothing on a blank graph
 * teaches it. Each template below is a small, working workflow whose whole
 * point is to show a {{local.components.…}} reference in context.
 *
 * The original three templates were deliberately runnable with no external
 * configuration at all, which kept them honest but also kept them toys — the
 * workflows people actually want ("tell Slack when an incident opens") need a
 * webhook URL, and there was nowhere to put one. Templates now DECLARE the
 * configuration they need, as `variables`, and the create wizard collects the
 * values and writes them as WorkflowVariable rows scoped to the new workflow.
 * The graph refers to them as {{local.variables.<name>}}, so the value lives in
 * one place and can be changed later without editing the graph.
 *
 * The graphs are plain data in the same shape the builder saves and the JSON
 * import reads, so a template is created through the ordinary Workflow create
 * path (which denormalizes the trigger onto the row in
 * WorkflowService.onCreateSuccess).
 */

import { JSONObject } from "../JSON";
import IconProp from "../Icon/IconProp";
import ComponentID from "./ComponentID";
import { ComponentType, NodeType } from "./Component";
import { ConditionOperator } from "./Components/Condition";

export enum WorkflowTemplateCategory {
  Basics = "Basics",
  Incidents = "Incidents",
  Alerts = "Alerts",
  Monitors = "Monitors",
  StatusPage = "Status Page",
  ScheduledMaintenance = "Scheduled Maintenance",
  OnCall = "On-Call",
  Scheduled = "On a Schedule",
  Integrations = "Integrations",
}

/** Display order in the picker. Basics first, because that is where a new builder should start. */
export const WorkflowTemplateCategories: Array<WorkflowTemplateCategory> = [
  WorkflowTemplateCategory.Basics,
  WorkflowTemplateCategory.Incidents,
  WorkflowTemplateCategory.Alerts,
  WorkflowTemplateCategory.Monitors,
  WorkflowTemplateCategory.OnCall,
  WorkflowTemplateCategory.StatusPage,
  WorkflowTemplateCategory.ScheduledMaintenance,
  WorkflowTemplateCategory.Scheduled,
  WorkflowTemplateCategory.Integrations,
];

/*
 * A variable name becomes two things that must match exactly: the `name` column
 * on the created WorkflowVariable row, and the tail of the
 * {{local.variables.<name>}} reference inside the graph. Runtime lookup is a
 * plain case-sensitive property read on a map keyed by name, and the path is
 * split on dots — so a name with a dot, a space, or the wrong case resolves to
 * nothing, silently, and the workflow posts literal braces to Slack.
 */
export const WORKFLOW_TEMPLATE_VARIABLE_NAME_REGEX: RegExp = /^[A-Za-z0-9_-]+$/;

export interface WorkflowTemplateVariable {
  /** Referenced as {{local.variables.<name>}} and used verbatim as the WorkflowVariable name. */
  name: string;
  /** Field label in the wizard. */
  title: string;
  /** Help text under the field — say where the user gets this value. */
  description: string;
  placeholder: string;
  required: boolean;
  /**
   * Marks the stored row secret, which redacts it from run logs. This is a
   * persistence concern and does not change how the create wizard displays the
   * field. It does NOT encrypt it at rest — nothing on WorkflowVariable is.
   */
  isSecret: boolean;
}

export interface WorkflowTemplate {
  /** Stable key, used by the picker and by tests. */
  id: string;
  name: string;
  /** One line, shown on the card. */
  description: string;
  /** What the builder should look at once it opens. */
  teaches: string;
  category: WorkflowTemplateCategory;
  icon: IconProp;
  /** Suggested name for the created workflow. */
  workflowName: string;
  workflowDescription: string;
  /** Configuration the wizard collects before creating. Empty means it runs as-is. */
  variables: Array<WorkflowTemplateVariable>;
}

interface TemplateNodeSpec {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  position: { x: number; y: number };
  args?: JSONObject | undefined;
}

interface TemplateEdgeSpec {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

interface TemplateGraphSpec {
  nodes: Array<TemplateNodeSpec>;
  edges: Array<TemplateEdgeSpec>;
}

/*
 * Node and edge identifiers are generated per creation rather than baked in,
 * so two workflows made from the same template never share react-flow ids.
 * The component ids (the user-facing "log-1") are stable, because that is what
 * the {{...}} references inside the template point at.
 */
export type BuildTemplateGraphFunction = (
  spec: TemplateGraphSpec,
  generateId: () => string,
) => JSONObject;

export const buildTemplateGraph: BuildTemplateGraphFunction = (
  spec: TemplateGraphSpec,
  generateId: () => string,
): JSONObject => {
  const nodeIdByComponentId: Record<string, string> = {};

  const nodes: Array<JSONObject> = spec.nodes.map(
    (node: TemplateNodeSpec): JSONObject => {
      const nodeId: string = generateId();
      nodeIdByComponentId[node.componentId] = nodeId;

      return {
        id: nodeId,
        type: "node",
        position: node.position,
        data: {
          id: node.componentId,
          nodeType: NodeType.Node,
          componentType: node.componentType,
          metadataId: node.metadataId,
          internalId: generateId(),
          error: "",
          /*
           * Deep-copied, not shared. A built graph gets edited — by the wizard
           * substituting variable names, and by the builder afterwards — and a
           * shallow copy would let that editing reach back into the shipped
           * template definition for the rest of the process.
           */
          arguments: node.args
            ? (JSON.parse(JSON.stringify(node.args)) as JSONObject)
            : {},
          returnValues: {},
        },
      };
    },
  );

  const edges: Array<JSONObject> = spec.edges.map(
    (edge: TemplateEdgeSpec): JSONObject => {
      return {
        id: generateId(),
        source: nodeIdByComponentId[edge.fromComponentId] as string,
        target: nodeIdByComponentId[edge.toComponentId] as string,
        sourceHandle: edge.fromPort,
        targetHandle: "in",
      };
    },
  );

  return { nodes: nodes, edges: edges };
};

type TemplateDefinition = WorkflowTemplate & { graph: TemplateGraphSpec };

/*
 * Shared variable definitions. Several templates ask for the same thing, and
 * defining it once keeps the name identical everywhere — which matters,
 * because the name is what the graph references.
 */
const SLACK_WEBHOOK_URL: WorkflowTemplateVariable = {
  name: "slackWebhookUrl",
  title: "Slack Incoming Webhook URL",
  description:
    "Create one at api.slack.com/messaging/webhooks and pick the channel the message should land in.",
  placeholder: "https://hooks.slack.com/services/T000/B000/XXXX",
  required: true,
  isSecret: true,
};

const TEAMS_WEBHOOK_URL: WorkflowTemplateVariable = {
  name: "teamsWebhookUrl",
  title: "Microsoft Teams Webhook URL",
  description:
    "In Teams, open the channel, then Connectors, then Incoming Webhook, and copy the URL it gives you.",
  placeholder: "https://outlook.office.com/webhook/...",
  required: true,
  isSecret: true,
};

const DISCORD_WEBHOOK_URL: WorkflowTemplateVariable = {
  name: "discordWebhookUrl",
  title: "Discord Webhook URL",
  description:
    "In Discord, open Channel Settings, then Integrations, then Webhooks, and copy the URL.",
  placeholder: "https://discord.com/api/webhooks/...",
  required: true,
  isSecret: true,
};

/** The select every incident trigger uses. Anything referenced below must be in here. */
const INCIDENT_SELECT: JSONObject = {
  _id: true,
  title: true,
  description: true,
  incidentNumber: true,
  currentIncidentState: { name: true },
  incidentSeverity: { name: true },
};

const ALERT_SELECT: JSONObject = {
  _id: true,
  title: true,
  description: true,
  alertNumber: true,
  currentAlertState: { name: true },
  alertSeverity: { name: true },
};

const MONITOR_STATUS_TIMELINE_SELECT: JSONObject = {
  _id: true,
  monitor: { name: true },
  monitorStatus: { name: true, isOfflineState: true },
};

const TEMPLATE_DEFINITIONS: Array<TemplateDefinition> = [
  /* ----------------------------- Basics ----------------------------- */
  {
    id: "manual-log",
    name: "Log a message when run by hand",
    description:
      "The smallest working workflow: a manual trigger and a step that writes a line to the run log.",
    teaches: "How to run a workflow and where its output shows up.",
    category: WorkflowTemplateCategory.Basics,
    icon: IconProp.Play,
    workflowName: "Log a message",
    workflowDescription:
      "Runs on demand and writes a line to the run log. A good place to start.",
    variables: [],
    graph: {
      nodes: [
        {
          componentId: "manual-1",
          metadataId: ComponentID.Manual,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            value: "Hello from OneUptime. This workflow ran.",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "manual-1",
          toComponentId: "log-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "webhook-echo",
    name: "Echo what a webhook sent",
    description:
      "Takes the body posted to this workflow's webhook and writes it back out to the log.",
    /*
     * The reason this template exists: the log message is a reference, not
     * text, and seeing that in place is the fastest way to understand the
     * whole substitution model.
     */
    teaches:
      "How one step reads another's output, using {{local.components...}}.",
    category: WorkflowTemplateCategory.Basics,
    icon: IconProp.Webhook,
    workflowName: "Echo webhook body",
    workflowDescription:
      "Writes whatever was posted to this workflow's webhook into the run log.",
    variables: [],
    graph: {
      nodes: [
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            value:
              "Webhook received: {{local.components.webhook-1.returnValues.request-body}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "webhook-1",
          toComponentId: "log-1",
          fromPort: "out",
        },
      ],
    },
  },
  {
    id: "webhook-branch",
    name: "Take one path or another",
    description:
      "Reads a field out of the webhook body and logs a different line depending on what it says.",
    teaches: "How If / Else splits a workflow into a Yes path and a No path.",
    category: WorkflowTemplateCategory.Basics,
    icon: IconProp.Condition,
    workflowName: "Branch on webhook body",
    workflowDescription:
      "Posts to this workflow's webhook take one of two paths depending on the environment field.",
    variables: [],
    graph: {
      nodes: [
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "if-else-1",
          metadataId: ComponentID.IfElse,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "input-1":
              "{{local.components.webhook-1.returnValues.request-body.environment}}",
            operator: ConditionOperator.EqualTo,
            "input-2": "production",
          },
        },
        {
          componentId: "log-production",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: -100, y: 500 },
          args: {
            value: "This one came from production. Treat it as urgent.",
          },
        },
        {
          componentId: "log-other",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value: "Not production. Logging it and moving on.",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "webhook-1",
          toComponentId: "if-else-1",
          fromPort: "out",
        },
        {
          fromComponentId: "if-else-1",
          toComponentId: "log-production",
          fromPort: "yes",
        },
        {
          fromComponentId: "if-else-1",
          toComponentId: "log-other",
          fromPort: "no",
        },
      ],
    },
  },
  {
    id: "javascript-transform",
    name: "Reshape data with a few lines of JavaScript",
    description:
      "Runs a small script over the webhook body and logs whatever it returns.",
    teaches:
      "How to drop into code when the built-in components cannot express something.",
    category: WorkflowTemplateCategory.Basics,
    icon: IconProp.Code,
    workflowName: "Transform with JavaScript",
    workflowDescription:
      "Runs a small script over the webhook body. Edit the code to shape the data however you need.",
    variables: [],
    graph: {
      nodes: [
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "javascript-1",
          metadataId: ComponentID.JavaScriptCode,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            code: [
              "// Whatever you return here is available as returnValue on the next step.",
              "const body = args.body || {};",
              "",
              "return {",
              "  receivedKeys: Object.keys(body),",
              "  summary: `Received ${Object.keys(body).length} field(s).`,",
              "};",
            ].join("\n"),
            arguments: {
              body: "{{local.components.webhook-1.returnValues.request-body}}",
            },
          },
        },
        {
          componentId: "log-1",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 500 },
          args: {
            value:
              "Script returned: {{local.components.javascript-1.returnValues.returnValue}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "webhook-1",
          toComponentId: "javascript-1",
          fromPort: "out",
        },
        {
          fromComponentId: "javascript-1",
          toComponentId: "log-1",
          fromPort: "success",
        },
      ],
    },
  },

  /* ---------------------------- Incidents ---------------------------- */
  {
    id: "incident-created-slack",
    name: "Tell Slack when an incident opens",
    description:
      "Posts the incident's title, severity and description to a Slack channel the moment it is declared.",
    teaches:
      "How a database trigger fires, and how to read fields off the record it hands you.",
    category: WorkflowTemplateCategory.Incidents,
    icon: IconProp.Slack,
    workflowName: "Notify Slack on new incident",
    workflowDescription:
      "Posts to Slack whenever an incident is created in this project.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "incident-on-create-1",
          metadataId: "incident-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: INCIDENT_SELECT },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: [
              "*Incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}} declared*",
              "*{{local.components.incident-on-create-1.returnValues.model.title}}*",
              "Severity: {{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",
              "State: {{local.components.incident-on-create-1.returnValues.model.currentIncidentState.name}}",
              "",
              "{{local.components.incident-on-create-1.returnValues.model.description}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "incident-on-create-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "incident-created-teams",
    name: "Tell Microsoft Teams when an incident opens",
    description:
      "Posts the incident's title, severity and description to a Teams channel as soon as it is declared.",
    teaches: "How a database trigger feeds a chat integration.",
    category: WorkflowTemplateCategory.Incidents,
    icon: IconProp.MicrosoftTeams,
    workflowName: "Notify Teams on new incident",
    workflowDescription:
      "Posts to Microsoft Teams whenever an incident is created in this project.",
    variables: [TEAMS_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "incident-on-create-1",
          metadataId: "incident-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: INCIDENT_SELECT },
        },
        {
          componentId: "teams-1",
          metadataId: ComponentID.MicrosoftTeamsSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.teamsWebhookUrl}}",
            text: [
              "Incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}} declared",
              "{{local.components.incident-on-create-1.returnValues.model.title}}",
              "Severity: {{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",
              "",
              "{{local.components.incident-on-create-1.returnValues.model.description}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "incident-on-create-1",
          toComponentId: "teams-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "incident-created-discord",
    name: "Tell Discord when an incident opens",
    description:
      "Posts a short incident summary to a Discord channel the moment the incident is declared.",
    teaches: "How a database trigger feeds a chat integration.",
    category: WorkflowTemplateCategory.Incidents,
    icon: IconProp.Chat,
    workflowName: "Notify Discord on new incident",
    workflowDescription:
      "Posts to Discord whenever an incident is created in this project.",
    variables: [DISCORD_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "incident-on-create-1",
          metadataId: "incident-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: INCIDENT_SELECT },
        },
        {
          componentId: "discord-1",
          metadataId: ComponentID.DiscordSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.discordWebhookUrl}}",
            text: [
              "Incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}} declared",
              "{{local.components.incident-on-create-1.returnValues.model.title}}",
              "Severity: {{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "incident-on-create-1",
          toComponentId: "discord-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "incident-state-changed-slack",
    name: "Tell Slack when an incident changes state",
    description:
      "Watches the incident's state and posts to Slack when it moves — acknowledged, resolved, and anything else.",
    teaches:
      "How the update trigger's Listen On field narrows a workflow to the fields you care about.",
    category: WorkflowTemplateCategory.Incidents,
    icon: IconProp.ArrowPath,
    workflowName: "Notify Slack on incident state change",
    workflowDescription:
      "Posts to Slack whenever an incident's state changes. Edit Listen On to watch other fields.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "incident-on-update-1",
          metadataId: "incident-on-update",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            "listen-on": { currentIncidentStateId: true },
            select: INCIDENT_SELECT,
          },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: [
              "*Incident #{{local.components.incident-on-update-1.returnValues.model.incidentNumber}} is now {{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}*",
              "{{local.components.incident-on-update-1.returnValues.model.title}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "incident-on-update-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "incident-created-forward",
    name: "Forward new incidents to another system",
    description:
      "POSTs a JSON summary of every new incident to a URL of yours — a ticketing system, a data warehouse, anything that takes a webhook.",
    teaches:
      "How to build a JSON request body out of references, and how the Error port catches a failed call.",
    category: WorkflowTemplateCategory.Incidents,
    icon: IconProp.Link,
    workflowName: "Forward incidents to a URL",
    workflowDescription:
      "POSTs a JSON summary of each new incident to an endpoint you control.",
    variables: [
      {
        name: "forwardUrl",
        title: "Destination URL",
        description:
          "The endpoint that should receive the POST. It will get a JSON body with the incident's fields.",
        placeholder: "https://example.com/hooks/oneuptime-incidents",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "incident-on-create-1",
          metadataId: "incident-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: INCIDENT_SELECT },
        },
        {
          componentId: "api-post-1",
          metadataId: ComponentID.ApiPost,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.forwardUrl}}",
            "request-body": [
              "{",
              '  "id": "{{local.components.incident-on-create-1.returnValues.model._id}}",',
              '  "number": "{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}",',
              '  "title": "{{local.components.incident-on-create-1.returnValues.model.title}}",',
              '  "severity": "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",',
              '  "state": "{{local.components.incident-on-create-1.returnValues.model.currentIncidentState.name}}"',
              "}",
            ].join("\n"),
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Could not forward the incident: {{local.components.api-post-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "incident-on-create-1",
          toComponentId: "api-post-1",
          fromPort: "success",
        },
        {
          fromComponentId: "api-post-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },
  {
    id: "incident-created-ai-summary",
    name: "Summarise a new incident with AI, then post it",
    description:
      "Asks the model for a one-paragraph plain-English summary of the incident and sends that to Slack.",
    teaches: "How to chain AI output into another step.",
    category: WorkflowTemplateCategory.Incidents,
    icon: IconProp.Sparkles,
    workflowName: "AI incident summary to Slack",
    workflowDescription:
      "Generates a short plain-English summary of each new incident and posts it to Slack.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "incident-on-create-1",
          metadataId: "incident-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: INCIDENT_SELECT },
        },
        {
          componentId: "ai-1",
          metadataId: ComponentID.AIGenerateText,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "system-prompt":
              "You write short, calm incident summaries for an on-call engineer. One paragraph. No preamble, no bullet points.",
            prompt: [
              "Summarise this incident in one paragraph for someone who has just been paged.",
              "",
              "Title: {{local.components.incident-on-create-1.returnValues.model.title}}",
              "Severity: {{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}",
              "Description: {{local.components.incident-on-create-1.returnValues.model.description}}",
            ].join("\n"),
          },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: -100, y: 500 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: [
              "*Incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}*",
              "",
              "{{local.components.ai-1.returnValues.response}}",
            ].join("\n"),
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Could not generate a summary: {{local.components.ai-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "incident-on-create-1",
          toComponentId: "ai-1",
          fromPort: "success",
        },
        {
          fromComponentId: "ai-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
        {
          fromComponentId: "ai-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },

  /* ------------------------------ Alerts ------------------------------ */
  {
    id: "alert-created-slack",
    name: "Tell Slack when an alert fires",
    description:
      "Posts the alert's title and severity to a Slack channel as soon as it is raised.",
    teaches: "How the alert trigger differs from the incident one.",
    category: WorkflowTemplateCategory.Alerts,
    icon: IconProp.Bell,
    workflowName: "Notify Slack on new alert",
    workflowDescription:
      "Posts to Slack whenever an alert is created in this project.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "alert-on-create-1",
          metadataId: "alert-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: ALERT_SELECT },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: [
              "*Alert: {{local.components.alert-on-create-1.returnValues.model.title}}*",
              "Severity: {{local.components.alert-on-create-1.returnValues.model.alertSeverity.name}}",
              "",
              "{{local.components.alert-on-create-1.returnValues.model.description}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "alert-on-create-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "alert-created-telegram",
    name: "Tell Telegram when an alert fires",
    description:
      "Sends a message to a Telegram chat whenever an alert is raised.",
    teaches:
      "How a template can ask for more than one piece of configuration, including a secret.",
    category: WorkflowTemplateCategory.Alerts,
    icon: IconProp.Telegram,
    workflowName: "Notify Telegram on new alert",
    workflowDescription:
      "Sends a Telegram message whenever an alert is created in this project.",
    variables: [
      {
        name: "telegramBotToken",
        title: "Telegram Bot Token",
        description: "The token BotFather gave you when you created the bot.",
        placeholder: "123456:ABC-DEF...",
        required: true,
        isSecret: true,
      },
      {
        name: "telegramChatId",
        title: "Telegram Chat ID",
        description:
          "The chat the bot should post into. Add the bot to the chat first.",
        placeholder: "-1001234567890",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "alert-on-create-1",
          metadataId: "alert-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: ALERT_SELECT },
        },
        {
          componentId: "telegram-1",
          metadataId: ComponentID.TelegramSendMessageToChat,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "bot-token": "{{local.variables.telegramBotToken}}",
            "chat-id": "{{local.variables.telegramChatId}}",
            text: [
              "Alert: {{local.components.alert-on-create-1.returnValues.model.title}}",
              "Severity: {{local.components.alert-on-create-1.returnValues.model.alertSeverity.name}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "alert-on-create-1",
          toComponentId: "telegram-1",
          fromPort: "success",
        },
      ],
    },
  },

  /* ----------------------------- Monitors ----------------------------- */
  {
    id: "monitor-status-changed-slack",
    name: "Tell Slack when a monitor changes status",
    description:
      "Posts to Slack every time a monitor goes down, comes back, or changes status in any way.",
    teaches:
      "How status changes are their own records, and how to read the monitor's name off one.",
    category: WorkflowTemplateCategory.Monitors,
    icon: IconProp.Heartbeat,
    workflowName: "Notify Slack on monitor status change",
    workflowDescription:
      "Posts to Slack whenever a monitor's status changes in this project.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "monitor-status-timeline-on-create-1",
          metadataId: "monitor-status-timeline-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: MONITOR_STATUS_TIMELINE_SELECT },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: "*{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitor.name}}* is now *{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitorStatus.name}}*",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "monitor-status-timeline-on-create-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "monitor-offline-only-slack",
    name: "Tell Slack only when a monitor goes offline",
    description:
      "Filters monitor status changes down to the offline ones, so the channel is quiet until something is actually wrong.",
    teaches:
      "How to put an If / Else between a trigger and an action to cut the noise.",
    category: WorkflowTemplateCategory.Monitors,
    icon: IconProp.ShieldExclamation,
    workflowName: "Notify Slack when a monitor goes offline",
    workflowDescription:
      "Posts to Slack only when a monitor moves into an offline status.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "monitor-status-timeline-on-create-1",
          metadataId: "monitor-status-timeline-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: MONITOR_STATUS_TIMELINE_SELECT },
        },
        {
          componentId: "if-else-1",
          metadataId: ComponentID.IfElse,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "input-1":
              "{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitorStatus.isOfflineState}}",
            operator: ConditionOperator.EqualTo,
            "input-2": "true",
          },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: -100, y: 500 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: "*{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitor.name}}* is offline — status is now *{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitorStatus.name}}*.",
          },
        },
        {
          componentId: "log-online",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Status changed to {{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitorStatus.name}}, which is not an offline state. Staying quiet.",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "monitor-status-timeline-on-create-1",
          toComponentId: "if-else-1",
          fromPort: "success",
        },
        {
          fromComponentId: "if-else-1",
          toComponentId: "slack-1",
          fromPort: "yes",
        },
        {
          fromComponentId: "if-else-1",
          toComponentId: "log-online",
          fromPort: "no",
        },
      ],
    },
  },
  {
    id: "monitor-status-changed-forward",
    name: "Forward monitor status changes to another system",
    description:
      "POSTs each monitor status change to a URL of yours, so another system can react to it.",
    teaches: "How to send OneUptime data outward as JSON.",
    category: WorkflowTemplateCategory.Monitors,
    icon: IconProp.Signal,
    workflowName: "Forward monitor status changes",
    workflowDescription:
      "POSTs every monitor status change to an endpoint you control.",
    variables: [
      {
        name: "forwardUrl",
        title: "Destination URL",
        description:
          "The endpoint that should receive the POST. It will get the monitor name and its new status.",
        placeholder: "https://example.com/hooks/monitor-status",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "monitor-status-timeline-on-create-1",
          metadataId: "monitor-status-timeline-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: { select: MONITOR_STATUS_TIMELINE_SELECT },
        },
        {
          componentId: "api-post-1",
          metadataId: ComponentID.ApiPost,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.forwardUrl}}",
            "request-body": [
              "{",
              '  "monitor": "{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitor.name}}",',
              '  "status": "{{local.components.monitor-status-timeline-on-create-1.returnValues.model.monitorStatus.name}}"',
              "}",
            ].join("\n"),
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Could not forward the status change: {{local.components.api-post-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "monitor-status-timeline-on-create-1",
          toComponentId: "api-post-1",
          fromPort: "success",
        },
        {
          fromComponentId: "api-post-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },

  /* ------------------------------ On-Call ------------------------------ */
  {
    id: "oncall-executed-slack",
    name: "Tell Slack when an on-call policy is executed",
    description:
      "Posts to Slack every time an on-call escalation policy runs, so the team can see a page going out.",
    teaches: "How execution records can be triggers in their own right.",
    category: WorkflowTemplateCategory.OnCall,
    icon: IconProp.Phone,
    workflowName: "Notify Slack when on-call is paged",
    workflowDescription:
      "Posts to Slack whenever an on-call duty policy is executed.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "oncall-execution-on-create-1",
          metadataId: "on-call-duty-policy-execution-log-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            select: {
              _id: true,
              status: true,
              statusMessage: true,
              onCallDutyPolicy: { name: true },
            },
          },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: [
              "*On-call policy executed: {{local.components.oncall-execution-on-create-1.returnValues.model.onCallDutyPolicy.name}}*",
              "Status: {{local.components.oncall-execution-on-create-1.returnValues.model.status}}",
              "{{local.components.oncall-execution-on-create-1.returnValues.model.statusMessage}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "oncall-execution-on-create-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },

  /* ---------------------------- Status Page ---------------------------- */
  {
    id: "subscriber-added-slack",
    name: "Tell Slack when someone subscribes to your status page",
    description:
      "Posts a short note to Slack each time a new status page subscriber signs up.",
    teaches: "How status page events can drive a workflow.",
    category: WorkflowTemplateCategory.StatusPage,
    icon: IconProp.UserGroup,
    workflowName: "Notify Slack on new subscriber",
    workflowDescription:
      "Posts to Slack whenever someone subscribes to one of your status pages.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "subscriber-on-create-1",
          metadataId: "status-page-subscriber-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            select: {
              _id: true,
              subscriberEmail: true,
              subscriberPhone: true,
              statusPage: { name: true },
            },
          },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: "New subscriber on *{{local.components.subscriber-on-create-1.returnValues.model.statusPage.name}}*: {{local.components.subscriber-on-create-1.returnValues.model.subscriberEmail}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "subscriber-on-create-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },
  {
    id: "subscriber-added-forward",
    name: "Send new status page subscribers to your CRM",
    description:
      "POSTs each new status page subscriber to a URL of yours, so they land in your mailing list or CRM.",
    teaches: "How to push OneUptime data into a system you already run.",
    category: WorkflowTemplateCategory.StatusPage,
    icon: IconProp.InboxArrowDown,
    workflowName: "Forward new subscribers",
    workflowDescription:
      "POSTs every new status page subscriber to an endpoint you control.",
    variables: [
      {
        name: "crmWebhookUrl",
        title: "Destination URL",
        description:
          "The endpoint that should receive the subscriber's email address.",
        placeholder: "https://example.com/hooks/subscribers",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "subscriber-on-create-1",
          metadataId: "status-page-subscriber-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            select: {
              _id: true,
              subscriberEmail: true,
              statusPage: { name: true },
            },
          },
        },
        {
          componentId: "api-post-1",
          metadataId: ComponentID.ApiPost,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.crmWebhookUrl}}",
            "request-body": [
              "{",
              '  "email": "{{local.components.subscriber-on-create-1.returnValues.model.subscriberEmail}}",',
              '  "statusPage": "{{local.components.subscriber-on-create-1.returnValues.model.statusPage.name}}"',
              "}",
            ].join("\n"),
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Could not forward the subscriber: {{local.components.api-post-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "subscriber-on-create-1",
          toComponentId: "api-post-1",
          fromPort: "success",
        },
        {
          fromComponentId: "api-post-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },

  /* ----------------------- Scheduled Maintenance ----------------------- */
  {
    id: "maintenance-scheduled-slack",
    name: "Announce scheduled maintenance in Slack",
    description:
      "Posts the title and window to Slack as soon as a maintenance event is scheduled.",
    teaches: "How maintenance events can drive a workflow.",
    category: WorkflowTemplateCategory.ScheduledMaintenance,
    icon: IconProp.Calendar,
    workflowName: "Announce maintenance in Slack",
    workflowDescription:
      "Posts to Slack whenever a scheduled maintenance event is created.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "maintenance-on-create-1",
          metadataId: "scheduled-maintenance-on-create",
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            select: {
              _id: true,
              title: true,
              description: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: [
              "*Maintenance scheduled: {{local.components.maintenance-on-create-1.returnValues.model.title}}*",
              "From {{local.components.maintenance-on-create-1.returnValues.model.startsAt}} to {{local.components.maintenance-on-create-1.returnValues.model.endsAt}}",
              "",
              "{{local.components.maintenance-on-create-1.returnValues.model.description}}",
            ].join("\n"),
          },
        },
      ],
      edges: [
        {
          fromComponentId: "maintenance-on-create-1",
          toComponentId: "slack-1",
          fromPort: "success",
        },
      ],
    },
  },

  /* ---------------------------- On a Schedule ---------------------------- */
  {
    id: "scheduled-check",
    name: "Call an API on a schedule",
    description:
      "Runs every hour, calls a URL, and logs whether it came back OK — with separate paths for success and failure.",
    teaches:
      "How a schedule works, and how a step's Success and Error ports branch.",
    category: WorkflowTemplateCategory.Scheduled,
    icon: IconProp.Clock,
    workflowName: "Hourly API check",
    workflowDescription:
      "Calls a URL every hour and logs the outcome. Change the cron to run it more or less often.",
    variables: [
      {
        name: "apiUrl",
        title: "URL to call",
        description: "The endpoint this workflow should call every hour.",
        placeholder: "https://api.example.com/health",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "schedule-1",
          metadataId: ComponentID.Schedule,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            schedule: "0 * * * *",
          },
        },
        {
          componentId: "api-get-1",
          metadataId: ComponentID.ApiGet,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.apiUrl}}",
          },
        },
        {
          componentId: "log-ok",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: -100, y: 500 },
          args: {
            value:
              "Responded {{local.components.api-get-1.returnValues.response-status}}: {{local.components.api-get-1.returnValues.response-body}}",
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            value:
              "Call failed: {{local.components.api-get-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "schedule-1",
          toComponentId: "api-get-1",
          fromPort: "execute",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "log-ok",
          fromPort: "success",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },
  {
    id: "scheduled-check-alert-slack",
    name: "Check an API on a schedule and shout if it fails",
    description:
      "Calls a URL every five minutes and posts to Slack only when the call fails.",
    teaches:
      "How to wire the Error port to a notification so silence means healthy.",
    category: WorkflowTemplateCategory.Scheduled,
    icon: IconProp.Fire,
    workflowName: "API check with Slack alert",
    workflowDescription:
      "Calls a URL every five minutes and posts to Slack when the call fails.",
    variables: [
      {
        name: "apiUrl",
        title: "URL to check",
        description:
          "The endpoint this workflow should call every five minutes.",
        placeholder: "https://api.example.com/health",
        required: true,
        isSecret: false,
      },
      SLACK_WEBHOOK_URL,
    ],
    graph: {
      nodes: [
        {
          componentId: "schedule-1",
          metadataId: ComponentID.Schedule,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            schedule: "*/5 * * * *",
          },
        },
        {
          componentId: "api-get-1",
          metadataId: ComponentID.ApiGet,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.apiUrl}}",
          },
        },
        {
          componentId: "log-ok",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: -100, y: 500 },
          args: {
            value:
              "Healthy — responded {{local.components.api-get-1.returnValues.response-status}}.",
          },
        },
        {
          componentId: "slack-failed",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 300, y: 500 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: "*Scheduled check failed* for {{local.variables.apiUrl}}\n{{local.components.api-get-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "schedule-1",
          toComponentId: "api-get-1",
          fromPort: "execute",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "log-ok",
          fromPort: "success",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "slack-failed",
          fromPort: "error",
        },
      ],
    },
  },
  {
    id: "scheduled-heartbeat",
    name: "Ping a heartbeat URL on a schedule",
    description:
      "Calls a dead-man's-switch URL every five minutes so an external watchdog knows OneUptime is alive.",
    teaches: "The smallest useful scheduled workflow.",
    category: WorkflowTemplateCategory.Scheduled,
    icon: IconProp.ArrowPath,
    workflowName: "Heartbeat ping",
    workflowDescription:
      "Calls a heartbeat URL every five minutes. Point it at your dead-man's-switch.",
    variables: [
      {
        name: "heartbeatUrl",
        title: "Heartbeat URL",
        description:
          "The dead-man's-switch endpoint to ping. Most watchdog services give you one.",
        placeholder: "https://hc-ping.com/your-uuid-here",
        required: true,
        isSecret: true,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "schedule-1",
          metadataId: ComponentID.Schedule,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            schedule: "*/5 * * * *",
          },
        },
        {
          componentId: "api-get-1",
          metadataId: ComponentID.ApiGet,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.heartbeatUrl}}",
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 500 },
          args: {
            value:
              "Heartbeat ping failed: {{local.components.api-get-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "schedule-1",
          toComponentId: "api-get-1",
          fromPort: "execute",
        },
        {
          fromComponentId: "api-get-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },
  {
    id: "scheduled-email-digest",
    name: "Email yourself on a schedule",
    description:
      "Sends a daily email through your own SMTP server. A starting point for digests and reports.",
    teaches: "How to configure an outbound email step.",
    category: WorkflowTemplateCategory.Scheduled,
    icon: IconProp.Email,
    workflowName: "Daily email",
    workflowDescription:
      "Sends an email every morning through your SMTP server. Add steps before it to gather the content.",
    variables: [
      {
        name: "smtpHost",
        title: "SMTP Host",
        description: "The mail server to send through.",
        placeholder: "smtp.example.com",
        required: true,
        isSecret: false,
      },
      {
        name: "smtpPort",
        title: "SMTP Port",
        description: "Usually 587 for STARTTLS, or 465 for implicit TLS.",
        placeholder: "587",
        required: true,
        isSecret: false,
      },
      {
        name: "smtpUsername",
        title: "SMTP Username",
        description: "Leave blank if your server does not require a login.",
        placeholder: "notifications@example.com",
        required: false,
        isSecret: false,
      },
      {
        name: "smtpPassword",
        title: "SMTP Password",
        description: "Leave blank if your server does not require a login.",
        placeholder: "••••••••",
        required: false,
        isSecret: true,
      },
      {
        name: "emailFrom",
        title: "From Address",
        description: "The address the email is sent from.",
        placeholder: "notifications@example.com",
        required: true,
        isSecret: false,
      },
      {
        name: "emailTo",
        title: "To Address",
        description: "Who should receive it.",
        placeholder: "you@example.com",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "schedule-1",
          metadataId: ComponentID.Schedule,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
          args: {
            schedule: "0 8 * * *",
          },
        },
        {
          componentId: "send-email-1",
          metadataId: ComponentID.SendEmail,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            from: "{{local.variables.emailFrom}}",
            to: "{{local.variables.emailTo}}",
            subject: "Your daily OneUptime digest",
            "email-body":
              "<p>This email was sent by a OneUptime workflow. Add steps before this one to fill it with something useful.</p>",
            "smtp-host": "{{local.variables.smtpHost}}",
            "smtp-port": "{{local.variables.smtpPort}}",
            "smtp-username": "{{local.variables.smtpUsername}}",
            "smtp-password": "{{local.variables.smtpPassword}}",
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 500 },
          args: {
            value: "The daily email could not be sent.",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "schedule-1",
          toComponentId: "send-email-1",
          fromPort: "execute",
        },
        {
          fromComponentId: "send-email-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },

  /* --------------------------- Integrations --------------------------- */
  {
    id: "webhook-to-slack",
    name: "Post anything you send to a webhook into Slack",
    description:
      "Gives you a URL. Anything POSTed to it turns up in a Slack channel.",
    teaches: "How to turn OneUptime into glue between two systems.",
    category: WorkflowTemplateCategory.Integrations,
    icon: IconProp.SendMessage,
    workflowName: "Webhook to Slack",
    workflowDescription:
      "Anything POSTed to this workflow's webhook is forwarded into a Slack channel.",
    variables: [SLACK_WEBHOOK_URL],
    graph: {
      nodes: [
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "slack-1",
          metadataId: ComponentID.SlackSendMessageToChannel,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            "webhook-url": "{{local.variables.slackWebhookUrl}}",
            text: "Webhook received:\n```{{local.components.webhook-1.returnValues.request-body}}```",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "webhook-1",
          toComponentId: "slack-1",
          fromPort: "out",
        },
      ],
    },
  },
  {
    id: "webhook-relay",
    name: "Relay a webhook to another URL",
    description:
      "Receives a webhook and forwards the body straight on to a second endpoint.",
    teaches:
      "How to sit between two systems, with somewhere to add filtering later.",
    category: WorkflowTemplateCategory.Integrations,
    icon: IconProp.Integrations,
    workflowName: "Relay a webhook",
    workflowDescription:
      "Forwards anything POSTed to this workflow's webhook on to another endpoint.",
    variables: [
      {
        name: "targetUrl",
        title: "Destination URL",
        description: "Where the received body should be forwarded.",
        placeholder: "https://example.com/hooks/inbound",
        required: true,
        isSecret: false,
      },
    ],
    graph: {
      nodes: [
        {
          componentId: "webhook-1",
          metadataId: ComponentID.Webhook,
          componentType: ComponentType.Trigger,
          position: { x: 100, y: 100 },
        },
        {
          componentId: "api-post-1",
          metadataId: ComponentID.ApiPost,
          componentType: ComponentType.Component,
          position: { x: 100, y: 300 },
          args: {
            url: "{{local.variables.targetUrl}}",
            "request-body":
              "{{local.components.webhook-1.returnValues.request-body}}",
          },
        },
        {
          componentId: "log-failed",
          metadataId: ComponentID.Log,
          componentType: ComponentType.Component,
          position: { x: 100, y: 500 },
          args: {
            value:
              "Relay failed: {{local.components.api-post-1.returnValues.error}}",
          },
        },
      ],
      edges: [
        {
          fromComponentId: "webhook-1",
          toComponentId: "api-post-1",
          fromPort: "out",
        },
        {
          fromComponentId: "api-post-1",
          toComponentId: "log-failed",
          fromPort: "error",
        },
      ],
    },
  },
];

type ToPublicTemplateFunction = (
  definition: TemplateDefinition,
) => WorkflowTemplate;

/*
 * Strips the graph off, and nothing else. Listing every field by hand here is
 * how a new field on WorkflowTemplate silently fails to reach the picker, so
 * this destructures instead: add a field to the interface and it arrives.
 */
const toPublicTemplate: ToPublicTemplateFunction = (
  definition: TemplateDefinition,
): WorkflowTemplate => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { graph: _graph, ...template } = definition;
  return template;
};

export type GetWorkflowTemplatesFunction = () => Array<WorkflowTemplate>;

export const getWorkflowTemplates: GetWorkflowTemplatesFunction =
  (): Array<WorkflowTemplate> => {
    return TEMPLATE_DEFINITIONS.map(toPublicTemplate);
  };

export type GetWorkflowTemplatesByCategoryFunction = (
  category: WorkflowTemplateCategory,
) => Array<WorkflowTemplate>;

export const getWorkflowTemplatesByCategory: GetWorkflowTemplatesByCategoryFunction =
  (category: WorkflowTemplateCategory): Array<WorkflowTemplate> => {
    return getWorkflowTemplates().filter((template: WorkflowTemplate) => {
      return template.category === category;
    });
  };

export type GetWorkflowTemplateFunction = (
  templateId: string,
) => WorkflowTemplate | null;

export const getWorkflowTemplate: GetWorkflowTemplateFunction = (
  templateId: string,
): WorkflowTemplate | null => {
  const definition: TemplateDefinition | undefined = TEMPLATE_DEFINITIONS.find(
    (candidate: TemplateDefinition) => {
      return candidate.id === templateId;
    },
  );

  return definition ? toPublicTemplate(definition) : null;
};

export type GetTemplateGraphSpecFunction = (
  templateId: string,
) => TemplateGraphSpec | null;

export const getTemplateGraphSpec: GetTemplateGraphSpecFunction = (
  templateId: string,
): TemplateGraphSpec | null => {
  const definition: TemplateDefinition | undefined = TEMPLATE_DEFINITIONS.find(
    (candidate: TemplateDefinition) => {
      return candidate.id === templateId;
    },
  );

  return definition ? definition.graph : null;
};

export type BuildGraphForTemplateFunction = (
  templateId: string,
  generateId: () => string,
) => JSONObject | null;

export const buildGraphForTemplate: BuildGraphForTemplateFunction = (
  templateId: string,
  generateId: () => string,
): JSONObject | null => {
  const spec: TemplateGraphSpec | null = getTemplateGraphSpec(templateId);

  if (!spec) {
    return null;
  }

  return buildTemplateGraph(spec, generateId);
};

export default getWorkflowTemplates;

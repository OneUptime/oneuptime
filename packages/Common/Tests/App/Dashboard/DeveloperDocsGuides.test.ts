import { describe, expect, test } from "@jest/globals";
import {
  DEVELOPER_DOCS_GUIDE_COPY,
  DeveloperDocsGuide,
  DeveloperDocsGuideContext,
  DeveloperDocsSection,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DEVELOPER_DOCS_PARENT_PAGES,
  DeveloperDocsPageType,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import {
  DeveloperDocsResource,
  getDeveloperDocsResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Incident from "../../../Models/DatabaseModels/Incident";
import Models from "../../../Models/DatabaseModels/Index";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { DeveloperDocsLiveData } from "../../../Utils/DeveloperDocs/LiveData";
import { DEVELOPER_DOCS_PROFILES } from "../../../Utils/DeveloperDocs/ResourceProfiles";
import { SetupGuideTopic } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  FIXTURE_NOW,
  fixtureRecordId,
  getEmptyFixtureLiveData,
  getFixtureLiveData,
} from "../../Utils/DeveloperDocs/DeveloperDocsLiveFixture";

/*
 * What every Developer page says, from the guide builders the page renders.
 * The maintainer's screenshot was the Incidents list's Terraform page:
 * generic steps and "Create a incident" with placeholders. These pin what
 * replaced it: pages written for their resource, filled in from the
 * project, for every resource that has them. Records come from real models
 * through BaseModel.toJSON, the way the page turns what it fetched into the
 * guides' input.
 */

const WORKFLOW_ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
const INCIDENT_ID: string = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
const MONITOR_ID: string = "1a2b3c4d-1234-4b2c-9d8e-0123456789ab";
const ORIGIN: string = "https://oneuptime.example.com";
const API_KEYS_URL: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/settings/api-keys";

const CRITICAL: string = fixtureRecordId(
  "IncidentSeverity",
  "Critical Incident",
);
const MAJOR: string = fixtureRecordId("IncidentSeverity", "Major Incident");
const CHECKOUT_API: string = fixtureRecordId("Monitor", "Checkout API");
const PRODUCTION: string = fixtureRecordId("Label", "production");

function workflowJson(): JSONObject {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID;
  workflow.name = "Send weekly report";
  workflow.description = "Mails the ops team";
  workflow.isEnabled = true;
  return BaseModel.toJSON(workflow, Workflow);
}

function incidentJson(): JSONObject {
  return {
    _id: INCIDENT_ID,
    title: "Checkout requests are failing",
    description: "Customers see an error when they pay.",
    incidentSeverityId: { _type: "ObjectID", value: CRITICAL },
    monitors: [{ _id: CHECKOUT_API }],
    labels: [{ _id: PRODUCTION }],
    currentIncidentStateId: {
      _type: "ObjectID",
      value: fixtureRecordId("IncidentState", "Acknowledged"),
    },
    declaredAt: { _type: "DateTime", value: "2026-10-02T09:12:00.000Z" },
  };
}

function context(
  overrides: Partial<DeveloperDocsGuideContext>,
): DeveloperDocsGuideContext {
  return {
    resource: getDeveloperDocsResource(Workflow),
    scope: DeveloperDocsScope.View,
    oneuptimeUrl: ORIGIN,
    platformVersion: "14.0.11",
    apiKeysUrl: API_KEYS_URL,
    live: getFixtureLiveData(),
    ...overrides,
  };
}

function workflowRecordContext(): DeveloperDocsGuideContext {
  return context({
    record: {
      id: WORKFLOW_ID,
      displayName: "Send weekly report",
      json: workflowJson(),
    },
  });
}

function incidentRecordContext(
  overrides: Partial<DeveloperDocsGuideContext> = {},
): DeveloperDocsGuideContext {
  return context({
    resource: getDeveloperDocsResource(Incident),
    record: {
      id: INCIDENT_ID,
      displayName: "Checkout requests are failing",
      json: incidentJson(),
    },
    ...overrides,
  });
}

function incidentListContext(
  overrides: Partial<DeveloperDocsGuideContext> = {},
): DeveloperDocsGuideContext {
  return context({
    resource: getDeveloperDocsResource(Incident),
    scope: DeveloperDocsScope.List,
    importTargets: [
      { id: INCIDENT_ID, displayName: "Checkout requests are failing" },
    ],
    totalCount: 1,
    ...overrides,
  });
}

function stepTitles(guide: DeveloperDocsGuide): Array<string> {
  return guide.steps.map((step: DeveloperDocsStep): string => {
    return step.title;
  });
}

function sectionTitles(guide: DeveloperDocsGuide): Array<string> {
  return guide.sections.map((section: DeveloperDocsSection): string => {
    return section.title;
  });
}

function variantLabels(
  variants: Array<{ label: string }> | undefined,
): Array<string> {
  return (variants || []).map((variant: { label: string }): string => {
    return variant.label;
  });
}

function topicTitles(guide: DeveloperDocsGuide): Array<string> {
  return guide.topics.map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
}

function allText(guide: DeveloperDocsGuide): string {
  return JSON.stringify(guide);
}

describe("the Incidents list's Terraform page (the maintainer's screenshot)", () => {
  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
    DeveloperDocsPageType.Terraform,
    incidentListContext(),
  );

  test("says 'Declare an incident', in the product's own words", () => {
    expect(stepTitles(guide)).toEqual([
      "Connect Terraform to OneUptime",
      "Declare an incident",
      "Bring in the incidents you already have",
    ]);
    expect(allText(guide)).not.toMatch(/\ba incident/i);
  });

  test("connects once: the key and the provider pointed at this installation, in one step", () => {
    const markdown: string = guide.steps[0]?.markdown || "";

    expect(markdown).toContain(
      `[Project Settings → API Keys](${API_KEYS_URL})`,
    );
    expect(markdown).toContain("permission to manage incidents");
    expect(markdown).toContain('export ONEUPTIME_API_KEY="your-api-key"');
    expect(markdown).toContain(`oneuptime_url = "${ORIGIN}"`);
    expect(markdown).toContain('version = ">= 14.0, <= 14.0.11"');
  });

  test("declares an incident with the fields most incidents set, filled in from this project", () => {
    const step: DeveloperDocsStep | undefined = guide.steps[1];
    const markdown: string = step?.markdown || "";

    expect(step?.description).toBe(
      "The fields most incidents set, filled in from this project.",
    );
    expect(markdown).toContain(
      'resource "oneuptime_incident" "checkout_requests_are_failing" {',
    );
    expect(markdown).toContain(`"${CRITICAL}"   # Critical Incident`);
    expect(markdown).toContain(`["${CHECKOUT_API}"] # Checkout API`);
    expect(markdown).toContain("# Degraded");
    expect(markdown).toContain(`["${PRODUCTION}"] # production`);
    expect(markdown).not.toContain("<");
    expect(markdown).toContain("terraform init\nterraform apply");
  });

  test("warns that this declares a real incident", () => {
    expect(guide.steps[1]?.markdown).toContain(
      "This declares a real incident: its owners, on-call policies and status page subscribers are told",
    );
  });

  test("says what each field is for, required ones first in the block and marked", () => {
    const markdown: string = guide.steps[1]?.markdown || "";

    expect(markdown).toContain("What each field is for:");
    expect(markdown).toContain(
      "- `title` (required): What is wrong, in a few words. Status pages show it.",
    );
    expect(markdown).toContain(
      "- `incident_severity_id` (required): How bad it is: one of your incident severities.",
    );
    expect(markdown).toContain("- `labels`: Labels to find and filter it by.");
  });

  test("brings the existing incidents in with import blocks", () => {
    expect(guide.steps[2]?.markdown).toContain(
      "to = oneuptime_incident.checkout_requests_are_failing",
    );
    expect(guide.steps[2]?.markdown).toContain(
      "terraform plan -generate-config-out=incidents.tf",
    );
  });

  test("offers common setups for incidents: a severity by name, an owner team", () => {
    expect(sectionTitles(guide)).toEqual(["Common setups"]);
    expect(variantLabels(guide.sections[0]?.variants)).toEqual([
      "Severity by name",
      "Owner team",
    ]);
    expect(guide.sections[0]?.variants?.[0]?.markdown).toContain(
      'data "oneuptime_incident_severity" "critical_incident"',
    );
  });

  test("looks an incident up by ID: the provider looks up by name only resources with a name", () => {
    expect(topicTitles(guide)).toEqual(["Look one up by ID", "OpenTofu"]);
    expect(guide.topics[0]?.markdown).toContain(
      `data "oneuptime_incident" "incident" {\n  id = "${INCIDENT_ID}"\n}`,
    );
  });

  test("with nothing looked up, it says what to replace, and claims nothing from the project", () => {
    const empty: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      incidentListContext({ live: getEmptyFixtureLiveData() }),
    );

    expect(empty.steps[1]?.description).toBe(
      "The fields most incidents set. Replace the values in angle brackets with your own.",
    );
    expect(empty.steps[1]?.markdown).toContain(
      'incident_severity_id = "<incident severity id>"',
    );
  });
});

describe("an incident's own Terraform page", () => {
  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
    DeveloperDocsPageType.Terraform,
    incidentRecordContext(),
  );

  test("writes its configuration, naming the records its ids point at", () => {
    const markdown: string = guide.steps[1]?.markdown || "";

    expect(guide.steps[1]?.title).toBe(
      'Add the incident "Checkout requests are failing"',
    );
    expect(markdown).toContain(
      `incident_severity_id = "${CRITICAL}" # Critical Incident`,
    );
    expect(markdown).toContain(`# Checkout API`);
    expect(markdown).toContain(`# production`);
    expect(markdown).toContain(`id = "${INCIDENT_ID}"`);
  });

  test("then what people build on it, referring to it by its address", () => {
    expect(sectionTitles(guide)).toEqual(["Build on it"]);
    expect(guide.sections[0]?.variants?.[0]?.markdown).toContain(
      "incident_id = oneuptime_incident.checkout_requests_are_failing.id",
    );
  });
});

describe("Terraform, for one workflow", () => {
  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
    DeveloperDocsPageType.Terraform,
    workflowRecordContext(),
  );

  test("three steps: connect, the workflow, the import", () => {
    expect(stepTitles(guide)).toEqual([
      "Connect Terraform to OneUptime",
      'Add the workflow "Send weekly report"',
      "Import it",
    ]);
  });

  test("the workflow's configuration is its real settings plus the import block", () => {
    const markdown: string = guide.steps[1]?.markdown || "";

    expect(markdown).toContain(
      'resource "oneuptime_workflow" "send_weekly_report" {',
    );
    expect(markdown).toContain('name        = "Send weekly report"');
    expect(markdown).toContain("is_enabled  = true");
    expect(markdown).toContain(`id = "${WORKFLOW_ID}"`);
    expect(markdown).toContain(
      "Left out because they are secret: `webhook_secret_key`, `incoming_email_secret_key`.",
    );
  });

  test("then init, plan and apply", () => {
    expect(guide.steps[2]?.markdown).toContain(
      "terraform init\nterraform plan\nterraform apply",
    );
  });

  test("the command-line import, the data source and OpenTofu are folded away", () => {
    expect(topicTitles(guide)).toEqual([
      "Import it from the command line instead",
      "Read it without managing it",
      "OpenTofu",
    ]);
    expect(guide.topics[0]?.markdown).toContain(
      `terraform import oneuptime_workflow.send_weekly_report ${WORKFLOW_ID}`,
    );
  });

  test("links to the provider docs, importing, and this resource's reference", () => {
    expect(guide.links).toEqual([
      { title: "Terraform provider", url: `${ORIGIN}/docs/terraform/index` },
      {
        title: "Importing resources",
        url: `${ORIGIN}/docs/terraform/importing-resources`,
      },
      {
        title: "oneuptime_workflow reference",
        url: "https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs/resources/workflow",
      },
    ]);
  });

  test("a secret that reached the record still never reaches the page", () => {
    const json: JSONObject = workflowJson();
    json["webhookSecretKey"] = "SUPER-SECRET-WEBHOOK-KEY";
    json["incomingEmailSecretKey"] = "SUPER-SECRET-EMAIL-KEY";

    const leaked: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        record: { id: WORKFLOW_ID, displayName: "Send weekly report", json },
      }),
    );

    expect(allText(leaked)).not.toContain("SUPER-SECRET");
  });

  test("secrets inside a value are read from variables, with how to set them", () => {
    const json: JSONObject = workflowJson();
    json["graph"] = { nodes: [{ data: { apiKey: "sk_live_1" } }] };

    const withSecret: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        record: { id: WORKFLOW_ID, displayName: "Send weekly report", json },
      }),
    );
    const markdown: string = withSecret.steps[1]?.markdown || "";

    expect(markdown).not.toContain("sk_live_1");
    expect(markdown).toContain(
      'export TF_VAR_send_weekly_report_graph_api_key="..."',
    );
  });
});

describe("Terraform pages that need more care", () => {
  test("a monitor starts from a website monitor with the dashboard's own criteria, and links the monitor steps guide", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        resource: getDeveloperDocsResource(Monitor),
        scope: DeveloperDocsScope.List,
      }),
    );

    expect(guide.steps[1]?.title).toBe("Create a monitor");
    expect(guide.steps[1]?.markdown).toContain(
      `monitor_type = "${MonitorType.Website}"`,
    );
    expect(guide.steps[1]?.markdown).toContain("criteria = [");
    expect(variantLabels(guide.sections[0]?.variants)).toEqual([
      "API monitor",
      "Ping a host",
      "Manual monitor",
    ]);
    expect(guide.links).toContainEqual({
      title: "Monitor steps",
      url: `${ORIGIN}/docs/terraform/monitor-steps`,
    });
  });

  test("a Kubernetes cluster's provider is left out of its configuration, and the page says why", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster._id = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
    cluster.name = "production-us-east";
    cluster.clusterIdentifier = "production-us-east";
    cluster.provider = "EKS";

    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        resource: getDeveloperDocsResource(KubernetesCluster),
        record: {
          id: cluster._id,
          displayName: "production-us-east",
          json: BaseModel.toJSON(cluster, KubernetesCluster),
        },
      }),
    );

    expect(guide.steps[1]?.markdown).not.toMatch(/^\s*provider\s*=/m);
    expect(guide.steps[1]?.markdown).toContain(
      "Left out because Terraform reserves the name for its own use: `provider`.",
    );
  });

  test("an inventory item's list page says why Terraform does not create them, and still imports them", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        resource: getDeveloperDocsResource(InventoryItem),
        scope: DeveloperDocsScope.List,
        importTargets: [{ id: "id-1", displayName: "Stripe payments API" }],
        totalCount: 1,
      }),
    );

    expect(guide.notice).toBeUndefined();
    expect(guide.steps[1]?.title).toBe("Create an inventory item");
    expect(guide.steps[1]?.markdown).toContain(
      "OneUptime works out an inventory item's key from its name",
    );
    expect(guide.steps[2]?.markdown).toContain(
      "to = oneuptime_inventory_item.stripe_payments_api",
    );
  });

  test("a resource the provider cannot create says so instead", () => {
    const insight: DeveloperDocsResource = { modelType: AIInsight };
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({ resource: insight, scope: DeveloperDocsScope.List }),
    );

    expect(guide.notice).toBe(
      "The Terraform provider cannot create or change AI insights. You can still read them with the `oneuptime_ai_insight` data source.",
    );
    expect(guide.sections).toEqual([]);
  });

  test("says when only the first ones are listed, and when there is nothing to import", () => {
    const many: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        scope: DeveloperDocsScope.List,
        importTargets: [{ id: "id-1", displayName: "Report" }],
        totalCount: 250,
      }),
    );
    const none: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({ scope: DeveloperDocsScope.List, importTargets: [] }),
    );

    expect(many.steps[2]?.markdown).toContain(
      "Import blocks for the first 1 of your 250 workflows:",
    );
    expect(none.steps[2]?.markdown).toBe(
      "There are no workflows in this project yet.",
    );
  });
});

describe("the Incidents list's API page", () => {
  const sample: JSONObject = {
    _id: INCIDENT_ID,
    title: "Checkout requests are failing",
    incidentSeverityId: { _type: "ObjectID", value: CRITICAL },
    createdAt: { _type: "DateTime", value: "2026-10-02T09:12:00.000Z" },
    // Fetched, but not asked for by the example: never shown.
    isVisibleOnStatusPage: true,
  };
  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
    DeveloperDocsPageType.Api,
    incidentListContext({ sample: { records: [sample], count: 42 } }),
  );

  test("lists, finds, and declares incidents", () => {
    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      "List your incidents",
      "Find the ones you need",
      "Declare an incident",
    ]);
  });

  test("the list request asks for the fields that matter, and shows the answer with this project's first incident", () => {
    const markdown: string = guide.steps[1]?.markdown || "";

    expect(markdown).toContain(
      `curl -X POST '${ORIGIN}/api/incident/get-list?skip=0&limit=10'`,
    );
    expect(markdown).toContain('"incidentSeverityId": true');
    expect(markdown).toContain("It answers with:");
    expect(markdown).toContain('"count": 42');
    expect(markdown).toContain('"title": "Checkout requests are failing"');
    expect(markdown).not.toContain("isVisibleOnStatusPage");
    expect(markdown).toContain(
      "Shown with the first of your 42 incidents; `count` is how many there are in all.",
    );
  });

  test("filters filled in from this project, one tab each", () => {
    const step: DeveloperDocsStep | undefined = guide.steps[2];

    expect(variantLabels(step?.variants)).toEqual([
      "Not resolved",
      "By severity",
      "By monitor",
      "Last 7 days",
      "Search",
    ]);
    expect(step?.variants?.[1]?.markdown).toContain(
      "Only “Critical Incident” incidents.",
    );
    expect(step?.variants?.[1]?.markdown).toContain(
      `"incidentSeverityId": "${CRITICAL}"`,
    );
    expect(step?.variants?.[2]?.markdown).toContain('"monitors": [');
  });

  test("declares an incident with this project's records, list relations as {_id} objects", () => {
    const markdown: string = guide.steps[3]?.markdown || "";

    expect(markdown).toContain(`curl -X POST ${ORIGIN}/api/incident`);
    expect(markdown).toContain(`"incidentSeverityId": "${CRITICAL}"`);
    expect(markdown).toContain(`"_id": "${CHECKOUT_API}"`);
    expect(markdown).toContain(
      "- `incidentSeverityId` (required): How bad it is: one of your incident severities.",
    );
  });

  test("ends with every endpoint, then paging, operators and counting folded away", () => {
    expect(sectionTitles(guide)).toEqual(["Endpoints"]);
    expect(guide.sections[0]?.markdown).toBe(
      [
        "- List incidents: `POST /incident/get-list`",
        "- Count incidents: `POST /incident/count`",
        "- Read one: `POST /incident/{id}/get-item`",
        "- Create an incident: `POST /incident`",
        "- Change one: `PUT /incident/{id}`",
        "- Delete one: `DELETE /incident/{id}`",
      ].join("\n"),
    );
    expect(topicTitles(guide)).toEqual([
      "Page through all of them",
      "Filter, sort and choose fields",
      "Count your incidents",
    ]);
    expect(guide.topics[2]?.markdown).toContain('"count": 42');
  });

  test("without the first incident (none yet, or no permission) it shows no answer rather than a made-up one", () => {
    const withoutSample: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Api,
      incidentListContext(),
    );

    expect(withoutSample.steps[1]?.markdown).not.toContain("It answers with:");
  });
});

describe("an incident's own API page", () => {
  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
    DeveloperDocsPageType.Api,
    incidentRecordContext(),
  );

  test("reads it (with its real answer), changes it, deletes it", () => {
    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      "Read it",
      "Change it",
      "Delete it",
    ]);
    expect(guide.steps[1]?.markdown).toContain(
      `curl -X POST ${ORIGIN}/api/incident/${INCIDENT_ID}/get-item`,
    );
    expect(guide.steps[1]?.markdown).toContain(
      '"title": "Checkout requests are failing"',
    );
  });

  test("the change people make most: another severity than it has now", () => {
    expect(guide.steps[2]?.description).toBe(
      "Move it to “Major Incident”. Fields you leave out stay as they are.",
    );
    expect(guide.steps[2]?.markdown).toContain(
      `"incidentSeverityId": "${MAJOR}"`,
    );
  });

  test("common tasks: acknowledge, resolve, notes, with this project's states", () => {
    expect(sectionTitles(guide)).toEqual(["Common tasks", "Endpoints"]);

    const tasks: DeveloperDocsSection | undefined = guide.sections[0];

    expect(variantLabels(tasks?.variants)).toEqual([
      "Acknowledge it",
      "Resolve it",
      "Internal note",
      "Public update",
    ]);
    expect(tasks?.variants?.[0]?.markdown).toContain(
      `curl -X POST ${ORIGIN}/api/incident-state-timeline`,
    );
    expect(tasks?.variants?.[0]?.markdown).toContain(
      `"incidentStateId": "${fixtureRecordId("IncidentState", "Acknowledged")}"`,
    );
    expect(guide.sections[1]?.markdown).toContain(
      `- Read one: \`POST /incident/${INCIDENT_ID}/get-item\``,
    );
  });

  test("no command carries a key: they all read it from the environment", () => {
    const text: string = allText(guide);

    expect(text).toContain("ApiKey: $ONEUPTIME_API_KEY");
    expect(text).not.toMatch(/ApiKey: [0-9a-f]{8}-/);
  });
});

describe("AI Assistants", () => {
  test("for a monitor: connect the MCP server, then ask with its name and ID", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.name = "API Health";
    monitor.monitorType = MonitorType.Manual;

    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.AiAssistants,
      context({
        resource: getDeveloperDocsResource(Monitor),
        record: {
          id: MONITOR_ID,
          displayName: "API Health",
          json: BaseModel.toJSON(monitor, Monitor),
        },
      }),
    );

    expect(guide.notice).toBeUndefined();
    expect(stepTitles(guide)).toEqual([
      "Connect your assistant to OneUptime",
      'Ask about the monitor "API Health"',
    ]);
    expect(guide.steps[0]?.variants?.length).toBe(5);
    expect(guide.steps[1]?.prompts?.[0]).toContain(
      `the monitor "API Health" (ID ${MONITOR_ID})`,
    );
    expect(guide.topics[0]?.markdown).toContain(
      "| `create_monitor` | Creates a monitor |",
    );
  });

  test("the tools table uses the right article", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.AiAssistants,
      context({
        resource: getDeveloperDocsResource(Incident),
        scope: DeveloperDocsScope.List,
      }),
    );

    expect(guide.topics[0]?.markdown).toContain(
      "| `create_incident` | Creates an incident |",
    );
  });

  test("for a workflow, which the MCP server does not cover: says so, and works through the API", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.AiAssistants,
      workflowRecordContext(),
    );

    expect(guide.notice).toBe(
      "OneUptime's MCP server does not have tools for workflows yet. An assistant that can run commands (Claude Code, Cursor, or GitHub Copilot in agent mode) can still work with this workflow through the REST API.",
    );
    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      'Ask about the workflow "Send weekly report"',
    ]);
  });
});

/*
 * Every resource with Developer pages, on all of its pages: the guide
 * builds, reads right, and is specific to the resource.
 */
function modelFor(tableName: string): DatabaseBaseModelType {
  return (Models as Array<DatabaseBaseModelType>).find(
    (modelType: DatabaseBaseModelType): boolean => {
      return new modelType().tableName === tableName;
    },
  ) as DatabaseBaseModelType;
}

const PARENT_PAGES: Array<[string, DeveloperDocsParentPage]> =
  DEVELOPER_DOCS_PARENT_PAGES.map(
    (parent: DeveloperDocsParentPage): [string, DeveloperDocsParentPage] => {
      return [`${parent.tableName} (${parent.scope})`, parent];
    },
  );

describe.each(PARENT_PAGES)(
  "the Developer pages of %s",
  (_name: string, parent: DeveloperDocsParentPage) => {
    const modelType: DatabaseBaseModelType = modelFor(parent.tableName);
    const guideContext: DeveloperDocsGuideContext = context({
      resource: getDeveloperDocsResource(modelType),
      scope: parent.scope,
      record:
        parent.scope === DeveloperDocsScope.View
          ? {
              id: "99999999-9999-4999-8999-999999999999",
              displayName: "Example",
              json: { _id: "99999999-9999-4999-8999-999999999999" },
            }
          : undefined,
      importTargets: [],
      live: { ...getFixtureLiveData(), now: FIXTURE_NOW },
    });

    test("has a profile", () => {
      expect(DEVELOPER_DOCS_PROFILES[parent.tableName]).toBeDefined();
    });

    test.each([
      DeveloperDocsPageType.Terraform,
      DeveloperDocsPageType.Api,
      DeveloperDocsPageType.AiAssistants,
    ])(
      "%s builds, with no 'a' before a vowel sound",
      (page: DeveloperDocsPageType) => {
        const text: string = allText(getDeveloperDocsGuide(page, guideContext));

        expect(text).not.toMatch(
          /\b[Aa] (incident|alert|announcement|on-call|incoming|inventory|escalation|SLO|IoT|AI|API|HTTP|SSL)\b/,
        );
        expect(text).not.toMatch(
          /\b[Aa]n (monitor|status|team|workflow|dashboard|runbook|form|service|host|user|RUM|vCenter)\b/,
        );
      },
    );

    test.each([
      ["this project's records", getFixtureLiveData],
      ["an empty project", getEmptyFixtureLiveData],
    ])(
      "its Terraform and API pages read right from %s: no unfilled names or broken values",
      (_source: string, getLive: () => DeveloperDocsLiveData) => {
        for (const page of [
          DeveloperDocsPageType.Terraform,
          DeveloperDocsPageType.Api,
        ]) {
          const text: string = allText(
            getDeveloperDocsGuide(page, { ...guideContext, live: getLive() }),
          );

          expect(text).not.toContain("{name}");
          expect(text).not.toContain("undefined");
          expect(text).not.toContain("[object Object]");
          expect(text).not.toContain("NaN");
        }
      },
    );
  },
);

describe("the card's own words", () => {
  test("name no resource, so each is one translation", () => {
    for (const page of Object.values(DeveloperDocsPageType)) {
      for (const scope of Object.values(DeveloperDocsScope)) {
        expect(DEVELOPER_DOCS_GUIDE_COPY[page][scope].description).not.toMatch(
          /workflow|monitor|incident|"/i,
        );
      }
    }
  });

  test("the list pages say their examples are filled in from the project", () => {
    expect(
      DEVELOPER_DOCS_GUIDE_COPY[DeveloperDocsPageType.Terraform][
        DeveloperDocsScope.List
      ].description,
    ).toContain("filled in from this project");
    expect(
      DEVELOPER_DOCS_GUIDE_COPY[DeveloperDocsPageType.Api][
        DeveloperDocsScope.List
      ].description,
    ).toContain("filled in from this project");
  });

  test("every guide uses its page's and scope's", () => {
    for (const page of Object.values(DeveloperDocsPageType)) {
      const view: DeveloperDocsGuide = getDeveloperDocsGuide(
        page,
        workflowRecordContext(),
      );
      const list: DeveloperDocsGuide = getDeveloperDocsGuide(
        page,
        context({ scope: DeveloperDocsScope.List }),
      );

      expect({
        page,
        title: view.title,
        description: view.description,
      }).toEqual({
        page,
        ...DEVELOPER_DOCS_GUIDE_COPY[page][DeveloperDocsScope.View],
      });
      expect({
        page,
        title: list.title,
        description: list.description,
      }).toEqual({
        page,
        ...DEVELOPER_DOCS_GUIDE_COPY[page][DeveloperDocsScope.List],
      });
    }
  });
});

describe("a status page's own Terraform page", () => {
  test("adds a group with one of this project's monitors in it", () => {
    const page: StatusPage = new StatusPage();
    page._id = "5a6b7c8d-1234-4b2c-9d8e-0123456789ab";
    page.name = "Acme status";

    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        resource: getDeveloperDocsResource(StatusPage),
        record: {
          id: page._id,
          displayName: "Acme status",
          json: BaseModel.toJSON(page, StatusPage),
        },
      }),
    );

    expect(variantLabels(guide.sections[0]?.variants)).toEqual([
      "Groups and monitors",
      "Announcement",
    ]);
    expect(guide.sections[0]?.variants?.[0]?.markdown).toContain(
      "status_page_id = oneuptime_status_page.acme_status.id",
    );
    expect(guide.sections[0]?.variants?.[0]?.markdown).toContain(
      `monitor_id           = "${CHECKOUT_API}" # Checkout API`,
    );
  });
});

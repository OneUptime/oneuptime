import { describe, expect, test } from "@jest/globals";
import {
  DEVELOPER_DOCS_GUIDE_COPY,
  DeveloperDocsGuide,
  DeveloperDocsGuideContext,
  DeveloperDocsStep,
  getDeveloperDocsGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import {
  DeveloperDocsResource,
  getDeveloperDocsResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { SetupGuideTopic } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * What every Developer page says, from the guide builders the page renders.
 * The record comes from a real model through BaseModel.toJSON, the way the
 * page turns what it fetched into the generators' input.
 */

const WORKFLOW_ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
const MONITOR_ID: string = "1a2b3c4d-1234-4b2c-9d8e-0123456789ab";
const ORIGIN: string = "https://oneuptime.example.com";
const API_KEYS_URL: string =
  "/dashboard/8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b/settings/api-keys";

function workflowJson(): JSONObject {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID;
  workflow.name = "Send weekly report";
  workflow.description = "Mails the ops team";
  workflow.isEnabled = true;
  return BaseModel.toJSON(workflow, Workflow);
}

function monitorJson(): JSONObject {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = "API Health";
  monitor.monitorType = MonitorType.Manual;
  return BaseModel.toJSON(monitor, Monitor);
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

function stepTitles(guide: DeveloperDocsGuide): Array<string> {
  return guide.steps.map((step: DeveloperDocsStep): string => {
    return step.title;
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

describe("Terraform, for one workflow", () => {
  const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
    DeveloperDocsPageType.Terraform,
    workflowRecordContext(),
  );

  test("four steps: a key, the provider, the workflow, the import", () => {
    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      "Add the OneUptime provider",
      'Add the workflow "Send weekly report"',
      "Import it",
    ]);
  });

  test("the key step links to this project's API keys and exports the key", () => {
    const markdown: string = guide.steps[0]?.markdown || "";

    expect(markdown).toContain(`[Project Settings → API Keys](${API_KEYS_URL})`);
    expect(markdown).toContain("permission to manage workflows");
    expect(markdown).toContain('export ONEUPTIME_API_KEY="your-api-key"');
  });

  test("the provider points at this installation and pins a version it supports", () => {
    const markdown: string = guide.steps[1]?.markdown || "";

    expect(markdown).toContain(`oneuptime_url = "${ORIGIN}"`);
    expect(markdown).toContain('version = ">= 14.0, <= 14.0.11"');
  });

  test("the workflow's configuration is its real settings plus the import block", () => {
    const markdown: string = guide.steps[2]?.markdown || "";

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
    expect(guide.steps[3]?.markdown).toContain(
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
    expect(guide.topics[1]?.markdown).toContain(
      'data "oneuptime_workflow" "send_weekly_report"',
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
    const markdown: string = withSecret.steps[2]?.markdown || "";

    expect(markdown).not.toContain("sk_live_1");
    expect(markdown).toContain(
      'export TF_VAR_send_weekly_report_graph_api_key="..."',
    );
  });
});

describe("Terraform, for all workflows", () => {
  test("a starter block, then import blocks for the ones that exist", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        scope: DeveloperDocsScope.List,
        importTargets: [
          { id: "id-1", displayName: "Report" },
          { id: "id-2", displayName: "Cleanup" },
        ],
        totalCount: 2,
      }),
    );

    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      "Add the OneUptime provider",
      "Create a workflow",
      "Bring in the workflows you already have",
    ]);
    expect(guide.steps[2]?.markdown).toContain(
      'resource "oneuptime_workflow" "my_workflow"',
    );
    expect(guide.steps[3]?.markdown).toContain(
      "An import block for each of your workflows:",
    );
    expect(guide.steps[3]?.markdown).toContain("to = oneuptime_workflow.report");
    expect(guide.steps[3]?.markdown).toContain(
      "terraform plan -generate-config-out=workflows.tf",
    );
  });

  test("says when only the first ones are listed", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        scope: DeveloperDocsScope.List,
        importTargets: [{ id: "id-1", displayName: "Report" }],
        totalCount: 250,
      }),
    );

    expect(guide.steps[3]?.markdown).toContain(
      "Import blocks for the first 1 of your 250 workflows:",
    );
  });

  test("says so when there is nothing to import", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({ scope: DeveloperDocsScope.List, importTargets: [] }),
    );

    expect(guide.steps[3]?.markdown).toBe(
      "There are no workflows in this project yet.",
    );
  });

  test("a monitor starts from a manual monitor, which needs no steps", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Terraform,
      context({
        resource: getDeveloperDocsResource(Monitor),
        scope: DeveloperDocsScope.List,
      }),
    );

    expect(guide.steps[2]?.markdown).toContain('monitor_type = "Manual"');
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
  });
});

describe("API", () => {
  test("for one workflow: read, change and delete it", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Api,
      workflowRecordContext(),
    );

    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      "Read it",
      "Change it",
      "Delete it",
    ]);
    expect(guide.steps[1]?.markdown).toContain(
      `curl -X POST ${ORIGIN}/api/workflow/${WORKFLOW_ID}/get-item`,
    );
    expect(guide.steps[2]?.markdown).toContain(
      `curl -X PUT ${ORIGIN}/api/workflow/${WORKFLOW_ID}`,
    );
    expect(guide.steps[3]?.markdown).toContain(
      `curl -X DELETE ${ORIGIN}/api/workflow/${WORKFLOW_ID}`,
    );
    expect(guide.steps[3]?.description).toBe(
      "This deletes the workflow for good.",
    );
    expect(guide.links[0]).toEqual({
      title: "Workflow API reference",
      url: `${ORIGIN}/reference/workflow`,
    });
  });

  test("for all workflows: list and create them, and count them in More", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.Api,
      context({ scope: DeveloperDocsScope.List }),
    );

    expect(stepTitles(guide)).toEqual([
      "Create an API key",
      "List your workflows",
      "Create a workflow",
    ]);
    expect(guide.steps[2]?.markdown).toContain('"name": "My workflow"');
    expect(topicTitles(guide)).toEqual([
      "Filter, sort and choose fields",
      "Count your workflows",
    ]);
  });

  test("no command carries a key: they all read it from the environment", () => {
    const text: string = allText(
      getDeveloperDocsGuide(DeveloperDocsPageType.Api, workflowRecordContext()),
    );

    expect(text).toContain("ApiKey: $ONEUPTIME_API_KEY");
    expect(text).not.toMatch(/ApiKey: [0-9a-f]{8}-/);
  });
});

describe("AI Assistants", () => {
  test("for a monitor: connect the MCP server, then ask with its name and ID", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.AiAssistants,
      context({
        resource: getDeveloperDocsResource(Monitor),
        record: { id: MONITOR_ID, displayName: "API Health", json: monitorJson() },
      }),
    );

    expect(guide.notice).toBeUndefined();
    expect(stepTitles(guide)).toEqual([
      "Connect your assistant to OneUptime",
      'Ask about the monitor "API Health"',
    ]);
    expect(guide.steps[0]?.variants?.length).toBe(5);
    expect(guide.steps[0]?.variants?.[0]?.markdown).toContain(
      `claude mcp add --transport http oneuptime ${ORIGIN}/mcp`,
    );
    expect(guide.steps[1]?.prompts?.[0]).toContain(
      `the monitor "API Health" (ID ${MONITOR_ID})`,
    );
    expect(topicTitles(guide)).toEqual([
      "The tools your assistant uses",
      "Connect an agent that runs on its own",
    ]);
    expect(guide.topics[0]?.markdown).toContain("`get_monitor`");
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
    expect(guide.steps[1]?.prompts?.join("\n")).toContain(
      `${ORIGIN}/reference/workflow`,
    );
    expect(topicTitles(guide)).toEqual([
      "Connect the MCP server for the rest of your project",
    ]);
  });

  test("on the list page the prompts are about all of them", () => {
    const guide: DeveloperDocsGuide = getDeveloperDocsGuide(
      DeveloperDocsPageType.AiAssistants,
      context({
        resource: getDeveloperDocsResource(Monitor),
        scope: DeveloperDocsScope.List,
      }),
    );

    expect(guide.steps[1]?.title).toBe("Ask about your monitors");
  });
});

describe("the card's own words", () => {
  test("name no resource, so each is one translation", () => {
    for (const page of Object.values(DeveloperDocsPageType)) {
      for (const scope of Object.values(DeveloperDocsScope)) {
        expect(DEVELOPER_DOCS_GUIDE_COPY[page][scope].description).not.toMatch(
          /workflow|monitor|"/i,
        );
      }
    }
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

      expect({ page, title: view.title, description: view.description }).toEqual({
        page,
        ...DEVELOPER_DOCS_GUIDE_COPY[page][DeveloperDocsScope.View],
      });
      expect({ page, title: list.title, description: list.description }).toEqual({
        page,
        ...DEVELOPER_DOCS_GUIDE_COPY[page][DeveloperDocsScope.List],
      });
    }
  });
});

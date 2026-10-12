import { describe, expect, test } from "@jest/globals";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Incident from "../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageOidc from "../../../Models/DatabaseModels/StatusPageOidc";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  getTerraformDataSourceByNameHcl,
  getTerraformImportBlocksHcl,
  getTerraformLocalName,
  getTerraformProviderHcl,
  getTerraformProviderUrl,
  getTerraformProviderVersionConstraint,
  getTerraformResourceConfig,
  TerraformOmissionReason,
  TerraformResourceConfig,
} from "../../../Utils/DeveloperDocs/TerraformConfig";

/*
 * The configuration the Developer > Terraform pages show. It is generated so
 * that, once the resource is imported, `terraform plan` has nothing to
 * change, and so that no secret is ever on the page. The records are built
 * as models and turned into the API's JSON with BaseModel.toJSON, as the page
 * does with what it fetched.
 */

const WORKFLOW_ID: string = "6e4f0a1c-1234-4b2c-9d8e-0123456789ab";
const LABEL_ID: string = "0b1c2d3e-0000-4000-8000-00000000000a";

function toJson(
  model: BaseModel,
  modelType: DatabaseBaseModelType,
): Record<string, unknown> {
  return BaseModel.toJSON(model, modelType) as Record<string, unknown>;
}

function label(): Label {
  const item: Label = new Label();
  item._id = LABEL_ID;
  item.name = "production";
  item.color = new Color("#ff0000");
  return item;
}

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  const item: Workflow = new Workflow();
  item._id = WORKFLOW_ID;
  item.name = "Send weekly report";
  item.description = "Mails the ops team every Monday";
  item.isEnabled = true;
  item.projectId = ObjectID.generate();
  item.createdByUserId = ObjectID.generate();
  Object.assign(item, overrides);
  return item;
}

function configFor(
  model: BaseModel,
  modelType: DatabaseBaseModelType,
): TerraformResourceConfig {
  const config: TerraformResourceConfig | null = getTerraformResourceConfig({
    modelType,
    json: toJson(model, modelType),
  });

  if (!config) {
    throw new Error(`No Terraform configuration for ${modelType.name}`);
  }

  return config;
}

describe("the provider block", () => {
  test("pins the newest provider that is not newer than this installation", () => {
    expect(getTerraformProviderVersionConstraint("14.0.11")).toBe(
      ">= 14.0, <= 14.0.11",
    );
    expect(getTerraformProviderVersionConstraint("9.2.0")).toBe(
      ">= 9.0, <= 9.2.0",
    );
  });

  test("leaves the version out when the installation does not know its own", () => {
    for (const version of ["1.0.0", "", null, undefined, "main", "14.0"]) {
      expect(getTerraformProviderVersionConstraint(version)).toBeNull();
    }
  });

  test("points the provider at this installation", () => {
    expect(
      getTerraformProviderUrl({ host: "status.acme.com/", isHttps: true }),
    ).toBe("https://status.acme.com");
    expect(getTerraformProviderUrl({ host: "localhost", isHttps: false })).toBe(
      "http://localhost",
    );
    expect(getTerraformProviderUrl({ host: "", isHttps: true })).toBeNull();
  });

  test("is the documented setup, with the API key from the environment", () => {
    expect(
      getTerraformProviderHcl({
        oneuptimeUrl: "https://oneuptime.com",
        platformVersion: "14.0.11",
      }),
    ).toBe(
      [
        "terraform {",
        "  required_providers {",
        "    oneuptime = {",
        '      source  = "oneuptime/oneuptime"',
        '      version = ">= 14.0, <= 14.0.11"',
        "    }",
        "  }",
        "}",
        "",
        'provider "oneuptime" {',
        '  oneuptime_url = "https://oneuptime.com"',
        "  # The API key is read from the ONEUPTIME_API_KEY environment variable.",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("never contains an API key", () => {
    expect(
      getTerraformProviderHcl({ oneuptimeUrl: null, platformVersion: "1.0.0" }),
    ).not.toContain("api_key =");
  });
});

describe("local names", () => {
  test("come from the record's name", () => {
    expect(getTerraformLocalName("Send weekly report!", "workflow")).toBe(
      "send_weekly_report",
    );
    expect(getTerraformLocalName("API Health (prod)", "monitor")).toBe(
      "api_health_prod",
    );
    expect(getTerraformLocalName("Überwachung été", "monitor")).toBe(
      "uberwachung_ete",
    );
  });

  test("never start with a digit", () => {
    expect(getTerraformLocalName("2024 incidents", "incident")).toBe(
      "_2024_incidents",
    );
  });

  test("fall back to the resource type when the name has nothing usable", () => {
    expect(getTerraformLocalName("監視", "monitor")).toBe("monitor");
    expect(getTerraformLocalName("", "status_page")).toBe("status_page");
    expect(getTerraformLocalName(null, "status_page")).toBe("status_page");
  });

  test("long names are cut at a word boundary", () => {
    const name: string = getTerraformLocalName(
      "Production checkout API in the European region behind the CDN",
      "monitor",
    );

    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toBe("production_checkout_api_in_the_european");
  });
});

describe("a workflow as Terraform", () => {
  test("is the resource, an import block, and the matching command and data source", () => {
    const config: TerraformResourceConfig = configFor(workflow(), Workflow);

    expect(config.typeName).toBe("oneuptime_workflow");
    expect(config.address).toBe("oneuptime_workflow.send_weekly_report");
    expect(config.resourceHcl).toBe(
      [
        'resource "oneuptime_workflow" "send_weekly_report" {',
        '  name        = "Send weekly report"',
        '  description = "Mails the ops team every Monday"',
        "  is_enabled  = true",
        "",
        "  # Secrets are not shown here: webhook_secret_key, incoming_email_secret_key.",
        "  # Terraform leaves them as they are in OneUptime.",
        "}",
        "",
      ].join("\n"),
    );
    expect(config.importHcl).toBe(
      [
        "import {",
        "  to = oneuptime_workflow.send_weekly_report",
        `  id = "${WORKFLOW_ID}"`,
        "}",
        "",
      ].join("\n"),
    );
    expect(config.hcl).toBe(`${config.resourceHcl}\n${config.importHcl}`);
    expect(config.importCommand).toBe(
      `terraform import oneuptime_workflow.send_weekly_report ${WORKFLOW_ID}`,
    );
    expect(config.dataSourceHcl).toBe(
      `data "oneuptime_workflow" "send_weekly_report" {\n  id = "${WORKFLOW_ID}"\n}\n`,
    );
  });

  test("leaves out a value that is the default (the provider plans the default anyway)", () => {
    const config: TerraformResourceConfig = configFor(
      workflow({ isEnabled: false }),
      Workflow,
    );

    expect(config.resourceHcl).not.toContain("is_enabled");
  });

  test("never writes the project or who created it", () => {
    const config: TerraformResourceConfig = configFor(workflow(), Workflow);

    expect(config.hcl).not.toContain("project_id");
    expect(config.hcl).not.toContain("created_by_user_id");
  });

  test("lists the secrets it leaves out, with why", () => {
    expect(configFor(workflow(), Workflow).omittedSecrets).toEqual([
      {
        attributeName: "webhook_secret_key",
        title: "Webhook Secret Key",
        reason: TerraformOmissionReason.Secret,
      },
      {
        attributeName: "incoming_email_secret_key",
        title: "Incoming Email Secret Key",
        reason: TerraformOmissionReason.Secret,
      },
    ]);
  });

  test("labels are a set of ids", () => {
    const config: TerraformResourceConfig = configFor(
      workflow({ labels: [label()] }),
      Workflow,
    );

    expect(config.resourceHcl).toContain(`labels      = ["${LABEL_ID}"]`);
  });

  test("its graph is written with jsonencode, and a secret in it comes from a variable", () => {
    const config: TerraformResourceConfig = configFor(
      workflow({
        graph: {
          nodes: [
            {
              id: "webhook",
              data: {
                arguments: { "api-key": "sk_live_123", url: "https://x" },
              },
            },
          ],
          edges: [],
        },
      }),
      Workflow,
    );

    expect(config.hcl).not.toContain("sk_live_123");
    expect(config.resourceHcl).toContain("  graph = jsonencode({");
    expect(config.resourceHcl).toContain(
      "            api-key = var.send_weekly_report_graph_api_key",
    );
    expect(
      config.resourceHcl.startsWith(
        [
          'variable "send_weekly_report_graph_api_key" {',
          '  description = "The api-key in the Workflow Graph of workflow \\"Send weekly report\\"."',
          "  type        = string",
          "  sensitive   = true",
          "}",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(config.variables).toEqual([
      {
        name: "send_weekly_report_graph_api_key",
        description:
          'The api-key in the Workflow Graph of workflow "Send weekly report".',
      },
    ]);
  });

  test("text that looks like a template stays text", () => {
    const config: TerraformResourceConfig = configFor(
      workflow({ description: "Posts ${amount} to %{channel}" }),
      Workflow,
    );

    expect(config.resourceHcl).toContain(
      'description = "Posts $${amount} to %%{channel}"',
    );
  });

  test("is not generated without an id", () => {
    const json: Record<string, unknown> = toJson(workflow(), Workflow);
    delete json["_id"];

    expect(
      getTerraformResourceConfig({ modelType: Workflow, json }),
    ).toBeNull();
  });
});

describe("a monitor as Terraform", () => {
  function monitor(): Monitor {
    const item: Monitor = new Monitor();
    item._id = ObjectID.generate().toString();
    item.name = "API Health";
    item.monitorType = MonitorType.Manual;
    item.monitoringInterval = "*/5 * * * *";
    item.currentMonitorStatusId = ObjectID.generate();
    item.telemetryMonitorNextMonitorAt = new Date("2026-10-01T10:00:00Z");
    item.serverMonitorResponse = { cpu: 10 } as never;
    item.disableActiveMonitoring = false;
    return item;
  }

  test("carries its type and settings, and leaves the server's state out", () => {
    const config: TerraformResourceConfig = configFor(monitor(), Monitor);

    expect(config.resourceHcl).toContain('monitor_type        = "Manual"');
    expect(config.resourceHcl).toContain('monitoring_interval = "*/5 * * * *"');

    for (const left of [
      "current_monitor_status_id",
      "telemetry_monitor_next_monitor_at",
      "server_monitor_response",
      "disable_active_monitoring",
    ]) {
      expect({ left, present: config.resourceHcl.includes(left) }).toEqual({
        left,
        present: false,
      });
    }
  });

  test("a paused monitor says so (the default is not paused)", () => {
    const item: Monitor = monitor();
    item.disableActiveMonitoring = true;

    expect(configFor(item, Monitor).resourceHcl).toContain(
      "disable_active_monitoring = true",
    );
  });
});

/*
 * A Result Value filter of a Custom Code (or Synthetic) monitor can compare
 * one field of the data the script returns: its customCodeMonitorOptions
 * name the field. The page's configuration is applied over the monitor once
 * it is imported, so leaving the field out would make that apply drop it.
 * The monitor goes through the model and BaseModel.toJSON, as the page's
 * fetched monitor does.
 */
describe("a Custom Code monitor's Result Value field path as Terraform", () => {
  const SCRIPT: string = "return { data: { status: 'UP' } };";

  function customCodeMonitor(
    filters: Array<JSONObject>,
    monitorType: MonitorType = MonitorType.CustomJavaScriptCode,
  ): Monitor {
    const item: Monitor = new Monitor();
    item._id = "2b3c4d5e-1234-4b2c-9d8e-0123456789ab";
    item.name = "Health API";
    item.monitorType = monitorType;
    item.monitorSteps = MonitorSteps.fromJSON({
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            _type: "MonitorStep",
            value: {
              id: "3c4d5e6f-1234-4b2c-9d8e-0123456789ab",
              customCode: SCRIPT,
              monitorCriteria: {
                _type: "MonitorCriteria",
                value: {
                  monitorCriteriaInstanceArray: [
                    {
                      _type: "MonitorCriteriaInstance",
                      value: {
                        id: "4d5e6f70-1234-4b2c-9d8e-0123456789ab",
                        name: "Unhealthy",
                        filterCondition: "Any",
                        filters: filters,
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    });
    return item;
  }

  test("is written as custom_code_monitor_options, under its filter", () => {
    const config: TerraformResourceConfig = configFor(
      customCodeMonitor([
        {
          checkOn: "Result Value",
          filterType: "Not Equal To",
          value: "UP",
          customCodeMonitorOptions: { resultValuePath: "data.items[0].status" },
        },
      ]),
      Monitor,
    );

    expect(config.resourceHcl).toMatch(
      /^\s*monitor_type\s+= "Custom JavaScript Code"$/m,
    );
    expect(config.resourceHcl).toContain(
      [
        '              check_on    = "Result Value"',
        '              filter_type = "Not Equal To"',
        '              value       = "UP"',
        "              custom_code_monitor_options = jsonencode({",
        '                resultValuePath = "data.items[0].status"',
        "              })",
      ].join("\n"),
    );
    // A field path is no secret: nothing is read from a variable.
    expect(config.variables).toEqual([]);
  });

  test("a Synthetic monitor's field path is written the same way", () => {
    const config: TerraformResourceConfig = configFor(
      customCodeMonitor(
        [
          {
            checkOn: "Result Value",
            filterType: "Contains",
            value: "timeout",
            customCodeMonitorOptions: { resultValuePath: "errors[0].message" },
          },
        ],
        MonitorType.SyntheticMonitor,
      ),
      Monitor,
    );

    expect(config.resourceHcl).toContain(
      'resultValuePath = "errors[0].message"',
    );
  });

  test("a filter without a field path writes none, and its neighbour keeps its own", () => {
    const config: TerraformResourceConfig = configFor(
      customCodeMonitor([
        { checkOn: "Result Value", filterType: "Equal To", value: "DOWN" },
        {
          checkOn: "Result Value",
          filterType: "Greater Than",
          value: 500,
          customCodeMonitorOptions: { resultValuePath: "checks[0].latency" },
        },
      ]),
      Monitor,
    );

    expect(
      config.resourceHcl.split("custom_code_monitor_options").length - 1,
    ).toBe(1);
    expect(config.resourceHcl).toContain(
      [
        '              value       = "500"',
        "              custom_code_monitor_options = jsonencode({",
        '                resultValuePath = "checks[0].latency"',
        "              })",
      ].join("\n"),
    );
  });

  test("no field path anywhere writes no custom_code_monitor_options at all", () => {
    expect(
      configFor(
        customCodeMonitor([
          { checkOn: "Result Value", filterType: "Equal To", value: "DOWN" },
          { checkOn: "Error", filterType: "Is Not Empty" },
        ]),
        Monitor,
      ).resourceHcl,
    ).not.toContain("custom_code_monitor_options");
  });

  test("a field path that looks like a template stays text", () => {
    expect(
      configFor(
        customCodeMonitor([
          {
            checkOn: "Result Value",
            filterType: "Equal To",
            value: "UP",
            customCodeMonitorOptions: { resultValuePath: "items.${name}" },
          },
        ]),
        Monitor,
      ).resourceHcl,
    ).toContain('resultValuePath = "items.$${name}"');
  });
});

describe("a status page as Terraform", () => {
  test("writes the settings that differ from their defaults, and only those", () => {
    const page: StatusPage = new StatusPage();
    page._id = ObjectID.generate().toString();
    page.name = "Acme Status";
    page.isPublicStatusPage = false; // default true
    page.enableEmailSubscribers = true; // default true
    page.showIncidentHistoryInDays = 30; // default 14
    page.showAnnouncementHistoryInDays = 14; // default 14
    page.enableMasterPassword = true; // default false

    const hcl: string = configFor(page, StatusPage).resourceHcl;

    expect(hcl).toContain("is_public_status_page         = false");
    expect(hcl).toContain("show_incident_history_in_days = 30");
    expect(hcl).toContain("enable_master_password        = true");
    expect(hcl).not.toContain("enable_email_subscribers");
    expect(hcl).not.toContain("show_announcement_history_in_days");
  });

  test("never writes its password: hashed, it cannot be read back", () => {
    const page: StatusPage = new StatusPage();
    page._id = ObjectID.generate().toString();
    page.name = "Acme Status";

    const config: TerraformResourceConfig = configFor(page, StatusPage);

    expect(config.omittedSecrets).toEqual(
      expect.arrayContaining([
        {
          attributeName: "master_password",
          title: "Master Password",
          reason: TerraformOmissionReason.Hashed,
        },
      ]),
    );
    expect(config.resourceHcl).not.toMatch(/^\s*master_password\s*=/m);
  });

  test("multi-line CSS is a heredoc that keeps every character", () => {
    const page: StatusPage = new StatusPage();
    page._id = ObjectID.generate().toString();
    page.name = "Acme Status";
    page.customCSS = "body {\n  color: red;\n}\n";

    expect(configFor(page, StatusPage).resourceHcl).toContain(
      "  custom_css = <<EOT\nbody {\n  color: red;\n}\nEOT\n",
    );
  });
});

describe("which attributes are safe to write", () => {
  test("an update-only setting that differs from its default is written, or plan would reset it", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster._id = ObjectID.generate().toString();
    cluster.name = "prod-eu";
    cluster.clusterIdentifier = "prod-eu";
    cluster.isAiInvestigationEnabled = false; // default true, update-only
    cluster.agentVersion = "1.2.3"; // reported by the agent, update-only

    const hcl: string = configFor(cluster, KubernetesCluster).resourceHcl;

    expect(hcl).toContain("is_ai_investigation_enabled = false");
    expect(hcl).not.toContain("agent_version");
  });

  test("a create-only setting is written when required, and left to the server otherwise", () => {
    const resource: CloudResource = new CloudResource();
    resource._id = ObjectID.generate().toString();
    resource.name = "orders-queue";
    resource.resourceIdentifier = "arn:aws:sqs:eu-west-1:123:orders";
    resource.cloudRegion = "eu-west-1";

    const hcl: string = configFor(resource, CloudResource).resourceHcl;

    expect(hcl).toContain(
      'resource_identifier = "arn:aws:sqs:eu-west-1:123:orders"',
    );
    expect(hcl).not.toContain("cloud_region");
  });

  test("a create-only switch with a default is written when it differs, or plan would replace the resource", () => {
    const incident: Incident = new Incident();
    incident._id = ObjectID.generate().toString();
    incident.title = "Checkout errors";
    incident.incidentSeverityId = ObjectID.generate();
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;
    incident.currentIncidentStateId = ObjectID.generate();

    const hcl: string = configFor(incident, Incident).resourceHcl;

    expect(hcl).toContain(
      "should_status_page_subscribers_be_notified_on_incident_created = false",
    );
    expect(hcl).toContain("incident_severity_id");
    expect(hcl).not.toContain("current_incident_state_id");
  });

  test("dates are RFC3339 strings", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = ObjectID.generate().toString();
    event.title = "Database upgrade";
    event.startsAt = new Date("2026-08-01T02:00:00.000Z");
    event.endsAt = new Date("2026-08-01T04:00:00.000Z");

    const hcl: string = configFor(event, ScheduledMaintenance).resourceHcl;

    expect(hcl).toContain('starts_at = "2026-08-01T02:00:00.000Z"');
    expect(hcl).toContain('ends_at   = "2026-08-01T04:00:00.000Z"');
  });

  test("a required secret is read from a variable, so the block still applies", () => {
    const oidc: StatusPageOidc = new StatusPageOidc();
    oidc._id = ObjectID.generate().toString();
    oidc.name = "Okta";

    const config: TerraformResourceConfig = configFor(oidc, StatusPageOidc);

    expect(config.resourceHcl).toContain("client_secret");
    expect(config.resourceHcl).toMatch(
      /client_secret\s+= var\.okta_client_secret/,
    );
    expect(config.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "okta_client_secret" }),
      ]),
    );
  });

  test("a model without a Terraform resource has no configuration", () => {
    const insight: AIInsight = new AIInsight();
    insight._id = ObjectID.generate().toString();

    expect(
      getTerraformResourceConfig({
        modelType: AIInsight,
        json: toJson(insight, AIInsight),
      }),
    ).toBeNull();
  });
});

describe("the records a resource's ids point at", () => {
  const SEVERITY_ID: string = "a0000001-0000-4000-8000-000000000001";
  const STATUS_ID: string = "d0000002-0000-4000-8000-000000000002";
  const MONITOR_IDS: Array<string> = [
    "e0000001-0000-4000-8000-000000000001",
    "e0000002-0000-4000-8000-000000000002",
  ];
  const NAMES: Record<string, string> = {
    [SEVERITY_ID]: "Critical Incident",
    [STATUS_ID]: "Degraded",
    [MONITOR_IDS[0] as string]: "Checkout API",
    [MONITOR_IDS[1] as string]: "Website",
    [LABEL_ID]: "production",
  };

  function incidentConfig(
    describeId?: ((id: string) => string | undefined) | undefined,
  ): TerraformResourceConfig {
    const config: TerraformResourceConfig | null = getTerraformResourceConfig({
      modelType: Incident,
      json: {
        _id: "6e4f0a1c-1234-4b2c-9d8e-0123456789ab",
        title: "Checkout requests are failing",
        incidentSeverityId: { _type: "ObjectID", value: SEVERITY_ID },
        changeMonitorStatusToId: STATUS_ID,
        monitors: MONITOR_IDS.map((id: string) => {
          return { _id: id };
        }),
        labels: [{ _id: LABEL_ID }],
      },
      describeId,
    });

    if (!config) {
      throw new Error("No configuration for the incident");
    }

    return config;
  }

  test("are named in a comment after each id, lined up the way terraform fmt lines them up", () => {
    const config: TerraformResourceConfig = incidentConfig(
      (id: string): string | undefined => {
        return NAMES[id];
      },
    );

    expect(config.resourceHcl).toBe(
      [
        'resource "oneuptime_incident" "checkout_requests_are_failing" {',
        '  title                = "Checkout requests are failing"',
        `  incident_severity_id = "${SEVERITY_ID}" # Critical Incident`,
        "  monitors = [",
        `    "${MONITOR_IDS[0]}", # Checkout API`,
        `    "${MONITOR_IDS[1]}", # Website`,
        "  ]",
        `  labels                      = ["${LABEL_ID}"] # production`,
        `  change_monitor_status_to_id = "${STATUS_ID}"   # Degraded`,
        "}",
        "",
      ].join("\n"),
    );
  });

  test("an id whose record the page does not know is written without one", () => {
    const config: TerraformResourceConfig = incidentConfig(
      (id: string): string | undefined => {
        return id === SEVERITY_ID ? "Critical Incident" : undefined;
      },
    );

    // Without names the monitors fit on one line, so every = lines up.
    expect(config.resourceHcl).toContain(
      `incident_severity_id        = "${SEVERITY_ID}" # Critical Incident`,
    );
    expect(config.resourceHcl).toContain(
      `change_monitor_status_to_id = "${STATUS_ID}"\n`,
    );
  });

  test("comments never change the configuration: without names it says the same", () => {
    const named: string = incidentConfig((id: string) => {
      return NAMES[id];
    }).resourceHcl;
    const plain: string = incidentConfig().resourceHcl;
    // Only the layout may differ: a list whose items carry names is one per line.
    const tokens: (hcl: string) => string = (hcl: string): string => {
      return hcl.replace(/#[^\n]*/g, "").replace(/[\s,]+/g, "");
    };

    expect(plain).not.toContain("#");
    expect(named).toContain("#");
    expect(tokens(named)).toBe(tokens(plain));
  });

  test("a name cannot add a line to the configuration", () => {
    const config: TerraformResourceConfig = incidentConfig(() => {
      return 'evil\nresource "oneuptime_team" "x" {}';
    });

    expect(config.resourceHcl).not.toMatch(/^resource "oneuptime_team"/m);
  });

  test("the ids in a monitor's steps name their statuses and severities", () => {
    const OFFLINE: string = "d0000003-0000-4000-8000-000000000003";
    const config: TerraformResourceConfig | null = getTerraformResourceConfig({
      modelType: Monitor,
      json: {
        _id: "1a2b3c4d-1234-4b2c-9d8e-0123456789ab",
        name: "Website",
        monitorType: "Website",
        monitorSteps: {
          _type: "MonitorSteps",
          value: {
            monitorStepsInstanceArray: [
              {
                _type: "MonitorStep",
                value: {
                  monitorDestination: {
                    _type: "URL",
                    value: "https://example.com",
                  },
                  monitorCriteria: {
                    _type: "MonitorCriteria",
                    value: {
                      monitorCriteriaInstanceArray: [
                        {
                          _type: "MonitorCriteriaInstance",
                          value: {
                            name: "Offline",
                            filterCondition: "Any",
                            monitorStatusId: OFFLINE,
                            changeMonitorStatus: true,
                            createIncidents: true,
                            filters: [
                              { checkOn: "Is Online", filterType: "False" },
                            ],
                            incidents: [
                              {
                                title: "Website is offline",
                                incidentSeverityId: {
                                  _type: "ObjectID",
                                  value: SEVERITY_ID,
                                },
                                labelIds: [LABEL_ID],
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
      describeId: (id: string): string | undefined => {
        return { ...NAMES, [OFFLINE]: "Offline" }[id];
      },
    });

    expect(config).not.toBeNull();
    expect(config!.resourceHcl).toContain(
      `monitor_status_id     = "${OFFLINE}" # Offline`,
    );
    // Consecutive comments line up: the label list is two characters longer.
    expect(config!.resourceHcl).toContain(
      `incident_severity_id = "${SEVERITY_ID}"   # Critical Incident`,
    );
    expect(config!.resourceHcl).toContain(
      `label_ids            = ["${LABEL_ID}"] # production`,
    );
  });
});

describe("attributes Terraform cannot set", () => {
  test("a Kubernetes cluster's provider is left out, and the configuration says why", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster._id = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
    cluster.name = "production-us-east";
    cluster.clusterIdentifier = "production-us-east";
    cluster.provider = "EKS";

    const config: TerraformResourceConfig = configFor(
      cluster,
      KubernetesCluster,
    );

    // `provider = "EKS"` in a resource block is Terraform's own meta-argument.
    expect(config.resourceHcl).not.toMatch(/^\s*provider\s*=/m);
    expect(config.resourceHcl).toContain(
      "# Not set here, because Terraform reserves the name: provider.",
    );
    expect(config.omittedReserved).toEqual([
      {
        attributeName: "provider",
        title: expect.any(String),
        reason: TerraformOmissionReason.ReservedName,
      },
    ]);
  });

  test("a cluster without a provider says nothing about it", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster._id = "7a8b9c0d-1234-4b2c-9d8e-0123456789ab";
    cluster.name = "production-us-east";
    cluster.clusterIdentifier = "production-us-east";

    const config: TerraformResourceConfig = configFor(
      cluster,
      KubernetesCluster,
    );

    expect(config.omittedReserved).toEqual([]);
    expect(config.resourceHcl).not.toContain("reserves");
  });
});

describe("importing everything", () => {
  test("one import block per resource, each with a unique name", () => {
    expect(
      getTerraformImportBlocksHcl({
        modelType: Workflow,
        targets: [
          { id: "id-1", displayName: "Report" },
          { id: "id-2", displayName: "Report" },
          { id: "id-3" },
        ],
      }),
    ).toBe(
      [
        "import {",
        "  to = oneuptime_workflow.report",
        '  id = "id-1"',
        "}",
        "",
        "import {",
        "  to = oneuptime_workflow.report_2",
        '  id = "id-2"',
        "}",
        "",
        "import {",
        "  to = oneuptime_workflow.workflow",
        '  id = "id-3"',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("nothing to import is nothing", () => {
    expect(
      getTerraformImportBlocksHcl({ modelType: Workflow, targets: [] }),
    ).toBeNull();
  });
});

describe("looking a resource up by name", () => {
  test("is a data source", () => {
    expect(
      getTerraformDataSourceByNameHcl({
        modelType: Monitor,
        exampleName: "API Health",
      }),
    ).toBe(
      'data "oneuptime_monitor" "api_health" {\n  name = "API Health"\n}\n',
    );
  });

  test("is not offered for a resource named by its title: the provider's lookup filters on name", () => {
    expect(
      getTerraformDataSourceByNameHcl({
        modelType: Incident,
        exampleName: "Checkout requests are failing",
      }),
    ).toBeNull();
  });
});

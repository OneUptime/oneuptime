import fs from "fs";
import os from "os";
import path from "path";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import {
  API_KEY_ATTRIBUTE_DESCRIPTION,
  PROVIDER_DESCRIPTION,
  URL_ATTRIBUTE_DESCRIPTION,
} from "../Core/ProviderWords";
import { buildFixtureSpec } from "./Fixtures";

let outputDir: string;
let monitorDoc: string;
let providerExample: string;
let fileDoc: string;
let providerDoc: string;
let readme: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-docs-"));
  const generator: DocumentationGenerator = new DocumentationGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "11.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    buildFixtureSpec(),
  );
  await generator.generateDocumentation();
  monitorDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/monitor.md"),
    "utf-8",
  );
  fileDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/file.md"),
    "utf-8",
  );
  providerExample = fs.readFileSync(
    path.join(outputDir, "examples/provider.tf"),
    "utf-8",
  );
  providerDoc = fs.readFileSync(path.join(outputDir, "docs/index.md"), "utf-8");
  readme = fs.readFileSync(path.join(outputDir, "README.md"), "utf-8");
});

/*
 * The provider's page on the registry is the first thing a developer reads.
 * It opened with the API spec's description of itself ("OpenAPI
 * specification for OneUptime. This document describes the API
 * endpoints...") under the title "Oneuptime Provider".
 */
describe("the provider page", () => {
  test("is titled with the product's name, and says what the provider does", () => {
    expect(providerDoc).toContain("# OneUptime Provider\n");
    expect(providerDoc).not.toContain("Oneuptime");
    expect(providerDoc).toContain(`\n${PROVIDER_DESCRIPTION}\n`);
    expect(providerDoc).toContain(
      `description: |-\n  ${PROVIDER_DESCRIPTION}\n`,
    );
    expect(PROVIDER_DESCRIPTION).toContain("Terraform or OpenTofu");
  });

  test("never quotes the API document's description of itself", () => {
    const spec: ReturnType<typeof buildFixtureSpec> = buildFixtureSpec();

    expect(spec.info.description || "").not.toBe("");
    expect(providerDoc).not.toContain(spec.info.description!);
    expect(readme).not.toContain(spec.info.description!);
  });

  test("says where each setting comes from when it is left out", () => {
    expect(providerDoc).toContain(
      `- \`oneuptime_url\` (String) ${URL_ATTRIBUTE_DESCRIPTION}`,
    );
    expect(providerDoc).toContain(
      `- \`api_key\` (String, Sensitive) ${API_KEY_ATTRIBUTE_DESCRIPTION}`,
    );
    expect(URL_ATTRIBUTE_DESCRIPTION).toContain("`ONEUPTIME_URL`");
    expect(URL_ATTRIBUTE_DESCRIPTION).toContain("https://oneuptime.com");
    expect(API_KEY_ATTRIBUTE_DESCRIPTION).toContain("`ONEUPTIME_API_KEY`");
  });

  test("the README is titled the same way", () => {
    expect(readme).toContain("# Terraform Provider for OneUptime\n");
    expect(readme).toContain(PROVIDER_DESCRIPTION);
  });
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("shipped examples", () => {
  test("provider example uses real attributes (no fictional host)", () => {
    expect(providerExample).toContain("oneuptime_url");
    expect(providerExample).not.toMatch(/^\s*host\s*=/m);
  });

  test("enum attributes use an allowed value, not a placeholder", () => {
    // A monitor with steps is a Website monitor, not the first enum value.
    expect(monitorDoc).toMatch(/monitor_type\s+= "Website"/);
    expect(monitorDoc).not.toContain('"example-monitor_type"');
  });
});

describe("schema reference", () => {
  test("sections are split Required / Optional / Read-Only", () => {
    expect(monitorDoc).toContain("### Required");
    expect(monitorDoc).toContain("### Optional");
    expect(monitorDoc).toContain("### Read-Only");
  });

  test("enum values are documented", () => {
    expect(monitorDoc).toContain("Allowed values");
    expect(monitorDoc).toContain("`Manual`");
  });

  test("no fake tfplugindocs attribution", () => {
    expect(monitorDoc).not.toContain("terraform-plugin-docs");
  });
});

describe("curation", () => {
  test("resource pages carry a registry subcategory", () => {
    expect(monitorDoc).toContain('subcategory: "Monitors"');
    expect(fileDoc).toContain('subcategory: "Organization"');
  });

  /*
   * The registry's sidebar groups pages by product, as the dashboard's
   * menus do. Half the resources used to fall into "Other": a host, a
   * Kubernetes cluster and their owners, AI, security, network, cloud,
   * runbooks, and the log and trace pipelines.
   */
  test.each([
    ["host", "Infrastructure"],
    ["kubernetes_cluster_team_owner", "Infrastructure"],
    ["vcenter_feed", "Infrastructure"],
    ["database_endpoint", "Infrastructure"],
    ["inventory_item", "Infrastructure"],
    ["cloud_account", "Cloud"],
    ["network_device", "Network"],
    ["snmp_credential_profile", "Network"],
    ["ai_rule", "AI"],
    ["llm_provider", "AI"],
    ["auto_remediation_decision", "AI"],
    ["security_case", "Security"],
    ["hunt", "Security"],
    ["entity_risk", "Security"],
    // A security rule's exception, not a telemetry exception.
    ["rule_exception", "Security"],
    ["exception", "Telemetry & Dashboards"],
    ["data_store", "Data Security"],
    ["residency_rule", "Data Security"],
    ["runbook", "Runbooks & Runners"],
    ["runner_team_owner", "Runbooks & Runners"],
    ["log_pipeline", "Logs, Traces & Metrics"],
    ["trace_scrub_rule", "Logs, Traces & Metrics"],
    ["iot_fleet", "IoT"],
    ["form_domain", "Forms"],
    ["workspace_notification_rule", "Slack, Teams & Video Calls"],
    ["video_call_connection", "Slack, Teams & Video Calls"],
    ["subscriber_notification_template", "Status Pages"],
    ["incoming_call_policy", "On-Call & Escalation"],
    ["user_on_call_log_timeline", "On-Call & Escalation"],
    // What OneUptime sent, not the logs a service sends it.
    ["email_log", "Notification Logs"],
    ["user_notification_log", "Notification Logs"],
    ["workspace_notification_log", "Notification Logs"],
    // A project's own Twilio account and mail server, not what they sent.
    ["call_and_sms_config", "Notification Channels"],
    ["smtp_config", "Notification Channels"],
    ["call_log", "Notification Logs"],
    ["log", "Logs, Traces & Metrics"],
    ["scim_log", "Teams & Access"],
    ["postmortem_status", "Incidents"],
    ["scheduled_event_public_note", "Scheduled Maintenance"],
    ["custom_role", "Teams & Access"],
    ["packet_capture", "Probes"],
    // The first group that matches wins: a monitor's probe is a monitor's.
    ["monitor_probe", "Monitors"],
    ["slo_burn_rate_rule", "Telemetry & Dashboards"],
  ])("%s is under %s", (name: string, subcategory: string) => {
    expect(DocumentationGenerator.getSubcategory(name)).toBe(subcategory);
  });

  test("a resource of no product's is under Other", () => {
    expect(DocumentationGenerator.getSubcategory("something_new")).toBe(
      "Other",
    );
  });

  test("the provider index has a start-here section", () => {
    const indexDoc: string = fs.readFileSync(
      path.join(outputDir, "docs/index.md"),
      "utf-8",
    );
    expect(indexDoc).toContain("## Start Here");
    expect(indexDoc).toContain("oneuptime_monitor");
    expect(indexDoc).toContain("./resources/monitor");
  });

  test("resource pages open with the model's real description", () => {
    expect(monitorDoc).toContain("checks the health and availability");
  });

  test("typed monitor steps render as nested attributes, not jsonencode", () => {
    expect(monitorDoc).toContain("monitor_destination");
    expect(monitorDoc).toContain("`monitor_steps` (Attributes List)");
    expect(monitorDoc).not.toContain('monitor_steps = "example-');
  });
});

describe("opentofu", () => {
  test("a registry guide page is generated", () => {
    const guide: string = fs.readFileSync(
      path.join(outputDir, "docs/guides/opentofu.md"),
      "utf-8",
    );
    // The registry only renders a guide when the frontmatter names it.
    expect(guide).toContain('subcategory: "Guides"');
    expect(guide).toContain("page_title:");
    expect(guide).toContain("tofu init");
  });

  test("the guide keeps the registry hostname out of the source address", () => {
    const guide: string = fs.readFileSync(
      path.join(outputDir, "docs/guides/opentofu.md"),
      "utf-8",
    );
    /*
     * A hostname-qualified source pins config to one registry and breaks the
     * other engine — the whole point of the guide is to not do that.
     */
    expect(guide).toContain('source  = "oneuptime/oneuptime"');
    expect(guide).not.toContain(
      'source  = "registry.terraform.io/oneuptime/oneuptime"',
    );
  });

  /*
   * What each engine does, as real terraform and tofu runs showed it (docs
   * overhaul task 30b): OpenTofu reads TF_VAR_* and no TOFU_VAR_*, .tofu
   * files from 1.8 on, a lock file is rewritten when the engine changes, and
   * a registry hostname in the source makes Terraform refuse the OpenTofu
   * Registry's unsigned copy.
   */
  test("the guide says what each engine really does", () => {
    const guide: string = fs.readFileSync(
      path.join(outputDir, "docs/guides/opentofu.md"),
      "utf-8",
    );

    expect(guide).not.toContain("TOFU_VAR");
    expect(guide).toContain(
      "| Variables | `TF_VAR_name` sets a variable under OpenTofu too. |",
    );
    expect(guide).toContain("OpenTofu 1.8 and later also read `.tofu` files");
    expect(guide).toContain(
      "`init` rewrites the provider's entry when you switch engines",
    );
    expect(guide).toContain(
      "OpenTofu reads a state Terraform wrote, as it is.",
    );
    expect(guide).toContain(
      "Terraform refuses the OpenTofu Registry's copy (`authentication signature from unknown issuer`)",
    );
    expect(guide).not.toContain("does not satisfy the other");
  });

  test("the provider index links to the guide", () => {
    const indexDoc: string = fs.readFileSync(
      path.join(outputDir, "docs/index.md"),
      "utf-8",
    );
    expect(indexDoc).toContain("./guides/opentofu");
  });
});

describe("shipped modules", () => {
  /*
   * The module source address is published in the OneUptime docs, in the
   * generated README and in the OpenTofu guide. If generation stops emitting
   * modules/, every one of those links 404s on the next release.
   */
  test("the reusable module is copied into the provider tree", () => {
    const moduleDir: string = path.join(
      outputDir,
      "modules/monitoring-and-incident-response",
    );
    for (const file of [
      "main.tf",
      "variables.tf",
      "outputs.tf",
      "versions.tf",
      "README.md",
    ]) {
      expect(fs.existsSync(path.join(moduleDir, file))).toBe(true);
    }
  });

  test("the copied module declares the provider without a registry hostname", () => {
    const versions: string = fs.readFileSync(
      path.join(
        outputDir,
        "modules/monitoring-and-incident-response/versions.tf",
      ),
      "utf-8",
    );
    expect(versions).toContain('source  = "oneuptime/oneuptime"');
    /*
     * Assert on source lines only. The file's comments legitimately name both
     * registry hostnames while explaining why the address omits them.
     */
    const sourceLine: RegExp = /^\s*source\s*=/;
    const sourceLines: Array<string> = versions
      .split("\n")
      .filter((line: string) => {
        return sourceLine.test(line);
      });
    expect(sourceLines.length).toBeGreaterThan(0);
    for (const line of sourceLines) {
      expect(line).not.toMatch(/registry\.(terraform\.io|opentofu\.org)/);
    }
  });

  test("the README points at the module", () => {
    const readme: string = fs.readFileSync(
      path.join(outputDir, "README.md"),
      "utf-8",
    );
    expect(readme).toContain("modules/monitoring-and-incident-response");
  });
});

describe("import docs", () => {
  test("importable resources document the import command", () => {
    expect(monitorDoc).toContain(
      "terraform import oneuptime_monitor.example <id>",
    );
  });

  test("read-less resources say import is unsupported", () => {
    expect(fileDoc).toContain("does not support import");
    expect(fileDoc).not.toContain("terraform import oneuptime_file.example");
  });
});

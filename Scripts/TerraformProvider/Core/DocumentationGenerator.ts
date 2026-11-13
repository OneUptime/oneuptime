import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformMembershipImport,
  TerraformResource,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";
import { ResourceGenerator, SchemaFlags } from "./ResourceGenerator";
import {
  API_KEY_ATTRIBUTE_DESCRIPTION,
  PROVIDER_DESCRIPTION,
  PROVIDER_DISPLAY_NAME,
  URL_ATTRIBUTE_DESCRIPTION,
} from "./ProviderWords";
import {
  EXAMPLE_PERSON_EMAIL,
  MembershipKind,
} from "Common/Utils/DeveloperDocs/PeopleByEmail";
import path from "path";
import fs from "fs";

/*
 * The schema of the built provider, as provider_schema_dump_test.go writes it:
 * what Terraform itself sees - nested attributes, computed-only overrides,
 * allowed values - so the reference pages cannot drift from the provider.
 */
export interface SchemaDumpAttribute {
  type: string;
  description?: string | undefined;
  required?: boolean | undefined;
  optional?: boolean | undefined;
  computed?: boolean | undefined;
  sensitive?: boolean | undefined;
  deprecation?: string | undefined;
  allowed_values?: Array<string> | undefined;
  default?: string | undefined;
  nested?: Record<string, SchemaDumpAttribute> | undefined;
}

export interface SchemaDumpBlock {
  description?: string | undefined;
  deprecation?: string | undefined;
  attributes: Record<string, SchemaDumpAttribute>;
}

export interface ProviderSchemaDump {
  resources: Record<string, SchemaDumpBlock>;
  data_sources: Record<string, SchemaDumpBlock>;
}

/*
 * Hand-written HCL modules shipped alongside the generated provider. They are
 * real .tf files in the main repo — reviewed, `terraform fmt`-ed and validated
 * against the provider schema there — and copied verbatim into the published
 * provider repository so `source = "github.com/OneUptime/
 * terraform-provider-oneuptime//modules/<name>"` resolves without cloning the
 * OneUptime monorepo.
 */
const MODULES_SOURCE_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Examples",
  "opentofu",
  "modules",
);

// The on-call layer page's guide to its JSON attributes, and what links to it.
const ON_CALL_SCHEDULE_LAYER_GUIDE: {
  resource: string;
  title: string;
  anchor: string;
  attributes: Array<string>;
} = {
  resource: "on_call_schedule_layer",
  title: "Rotation and restriction times",
  anchor: "rotation-and-restriction-times",
  attributes: ["rotation", "restriction_times"],
};

export class DocumentationGenerator {
  private config: TerraformProviderConfig;
  private fileGenerator: FileGenerator;
  private schemaDump: ProviderSchemaDump | undefined;
  private resources: Array<TerraformResource>;
  private dataSources: Array<TerraformDataSource>;

  public constructor(
    config: TerraformProviderConfig,
    spec: OpenAPISpec,
    schemaDump?: ProviderSchemaDump,
  ) {
    this.config = config;
    this.fileGenerator = new FileGenerator(config.outputDir);
    this.schemaDump = schemaDump;

    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec);
    this.resources = parser.getResources();
    this.dataSources = parser.getDataSources();
  }

  private get majorVersion(): string {
    return this.config.providerVersion.split(".")[0] || "1";
  }

  /*
   * Registry sidebar grouping. registry.terraform.io groups pages by the
   * frontmatter `subcategory`; without it, 400 resources render as one flat
   * list. Order matters: first match wins. The groups follow the products
   * a resource belongs to, as the dashboard's menus have them: a host, a
   * Kubernetes cluster and their owners, rules and feeds are Infrastructure,
   * a security case, a hunt and a rule exception are Security. Before, half
   * the resources - hosts, clusters, AI, security, network, cloud, runbooks,
   * log and trace pipelines - fell into "Other", and a security rule
   * exception into Telemetry, by the "exception" in its name.
   */
  private static readonly SUBCATEGORIES: Array<{
    pattern: RegExp;
    name: string;
  }> = [
    { pattern: /^monitor/, name: "Monitors" },
    // A packet capture runs on a probe.
    { pattern: /probe|^packet_capture/, name: "Probes" },
    {
      pattern: /^status_page|^subscriber_notification_template/,
      name: "Status Pages",
    },
    { pattern: /^incident|^postmortem/, name: "Incidents" },
    { pattern: /^alert/, name: "Alerts" },
    {
      pattern:
        /^on_call|^escalation|schedule_layer|^user_override|^user_on_call|^incoming_call/,
      name: "On-Call & Escalation",
    },
    {
      pattern: /^scheduled_maintenance|^scheduled_event/,
      name: "Scheduled Maintenance",
    },
    // What OneUptime sent, and how it went: not the logs a service sends.
    {
      pattern:
        /^(call|email|sms|push_notification|webhook|whatsapp|telegram|workspace_notification|user_notification)_log$/,
      name: "Notification Logs",
    },
    {
      pattern:
        /^team|^user|^project|^api_key|^custom_role|^audit_log|^scim|^totp|^two_factor|^web_authn/,
      name: "Teams & Access",
    },
    {
      pattern: /^label|^custom_field|^file|^domain|^table_view|^recommendation/,
      name: "Organization",
    },
    { pattern: /^workflow/, name: "Workflows" },
    { pattern: /^runbook|^runner/, name: "Runbooks & Runners" },
    {
      pattern: /^ai_|^llm_|^external_mcp_server|^auto_remediation/,
      name: "AI",
    },
    {
      pattern:
        /^security_|^detection_rule|^hunt|^threat_intel|^watchlist|^entity_|^protected_entity|^rule_exception/,
      name: "Security",
    },
    {
      pattern:
        /^data_store|^data_security|^data_flow|^custom_data_type|^residency_rule|^check_setting/,
      name: "Data Security",
    },
    {
      pattern: /^network_|^snmp_|^oid_|^address_name/,
      name: "Network",
    },
    { pattern: /^cloud_/, name: "Cloud" },
    {
      pattern:
        /^host|^docker_|^podman_|^kubernetes_|^proxmox_|^openstack_|^ceph_|^storage_array|^vcenter|^database|^queue|^serverless_function|^collector_config|^inventory_item/,
      name: "Infrastructure",
    },
    { pattern: /^iot_/, name: "IoT" },
    { pattern: /^form/, name: "Forms" },
    {
      pattern:
        /^service|^telemetry|^dashboard|^exception|^usage|^rum_|^source_map|^slo_|^data_source/,
      name: "Telemetry & Dashboards",
    },
    { pattern: /^copilot|^code_repository/, name: "Reliability Copilot" },
    {
      pattern: /^log_|log$|^trace_|^span|^metric|^profile|^change_event/,
      name: "Logs, Traces & Metrics",
    },
    {
      pattern: /^workspace_|^video_call/,
      name: "Slack, Teams & Video Calls",
    },
  ];

  public static getSubcategory(name: string): string {
    for (const entry of DocumentationGenerator.SUBCATEGORIES) {
      if (entry.pattern.test(name)) {
        return entry.name;
      }
    }
    return "Other";
  }

  /*
   * The resources most users start with, surfaced at the top of the provider
   * index instead of leaving newcomers to scan a 289-entry list.
   */
  private static readonly START_HERE: Array<{
    name: string;
    blurb: string;
  }> = [
    { name: "monitor", blurb: "Uptime and health checks for your services" },
    { name: "monitor_status", blurb: "The states a monitor can be in" },
    { name: "label", blurb: "Organize resources across the project" },
    { name: "status_page", blurb: "Public status pages for your users" },
    {
      name: "status_page_domain",
      blurb: "Serve a status page on your own domain",
    },
    { name: "incident_severity", blurb: "Severity levels for incidents" },
    { name: "on_call_duty_policy", blurb: "On-call rotations and escalation" },
    { name: "team", blurb: "Teams that own monitors and get paged" },
    {
      name: "scheduled_maintenance",
      blurb: "Planned maintenance windows",
    },
  ];

  public async generateDocumentation(): Promise<void> {
    await this.generateProviderDoc();
    await this.generateResourceDocs();
    await this.generateDataSourceDocs();
    await this.generateExamples();
    await this.generateOpenTofuGuide();
    await this.generatePeopleGuide();
    this.copyModules();
    await this.generateReadme();
  }

  private async generateProviderDoc(): Promise<void> {
    const providerDoc: string = `---
page_title: "${this.config.providerName} Provider"
subcategory: ""
description: |-
  ${PROVIDER_DESCRIPTION}
---

# ${PROVIDER_DISPLAY_NAME} Provider

${PROVIDER_DESCRIPTION}

## Example Usage

\`\`\`terraform
terraform {
  required_providers {
    ${this.config.providerName} = {
      source  = "oneuptime/${this.config.providerName}"
      version = "~> ${this.majorVersion}.0"
    }
  }
}

provider "${this.config.providerName}" {
  # Both can come from the environment instead:
  # ${StringUtils.toConstantCase(this.config.providerName)}_URL and ${StringUtils.toConstantCase(this.config.providerName)}_API_KEY.
  oneuptime_url = "https://oneuptime.com" # or your self-hosted instance
  api_key       = var.${this.config.providerName}_api_key
}
\`\`\`

## Schema

### Optional

- \`api_key\` (String, Sensitive) ${API_KEY_ATTRIBUTE_DESCRIPTION}
- \`oneuptime_url\` (String) ${URL_ATTRIBUTE_DESCRIPTION}

## Start Here

The provider covers the full OneUptime API surface. Most configurations begin with these resources:

${DocumentationGenerator.START_HERE.map(
  (entry: { name: string; blurb: string }) => {
    return `- [\`${this.config.providerName}_${entry.name}\`](./resources/${entry.name}) — ${entry.blurb}`;
  },
).join("\n")}

Every resource has a matching data source of the same name, for referring to something that already exists instead of creating it. Look it up by \`id\`, or by any of its other arguments - each one you set must match, and exactly one item may match them all:

\`\`\`terraform
data "${this.config.providerName}_monitor_status" "offline" {
  name = "Offline"
}

data "${this.config.providerName}_incident_severity" "critical" {
  name = "Critical Incident"
}
\`\`\`

## IDs inside resources

Server-side ids that a resource carries inside it - the ids of a monitor's steps, criteria and incident templates - are the server's to manage. Never write them: the provider sends none, the server gives them, and it keeps them across every apply, so incidents keep pointing at the criteria that raised them.
${this.generateRenamedSection()}
## People by email address

Every resource that names a person takes their email address as well as their user ID - \`user_email\` beside \`user_id\`, \`owner_user_emails\` beside \`owner_users\` - and a team member named by an address that is new to the project invites them. See [Managing people and teams](./guides/people) for onboarding and offboarding as code.

\`\`\`terraform
resource "${this.config.providerName}_team_member" "alice" {
  team_id    = ${this.config.providerName}_team.sre.id
  user_email = "alice@example.com"
}
\`\`\`

## OpenTofu

This provider is published to the OpenTofu Registry as well, and its end-to-end suite runs against both engines on every change. Configuration is identical — see the [OpenTofu guide](./guides/opentofu).

## Reusable modules

Hand-written modules ship in the repository under \`modules/\`, for setups that would otherwise be copy-pasted per service:

- [\`monitoring-and-incident-response\`](https://github.com/OneUptime/terraform-provider-${this.config.providerName}/tree/master/modules/monitoring-and-incident-response) — HTTP monitors, an on-call rotation paged when they fail, and a status page listing them.
`;

    await this.fileGenerator.writeFileInDir("docs", "index.md", providerDoc);
  }

  /*
   * Registry "Guides" page for OpenTofu. Both registries render docs/guides/*.md
   * as a Guides section keyed off the frontmatter `page_title`, which is what
   * makes OneUptime's OpenTofu support visible on the provider's registry page
   * rather than only in the OneUptime docs site.
   */
  private async generateOpenTofuGuide(): Promise<void> {
    const majorVersion: string =
      this.config.providerVersion.split(".")[0] || "1";
    const guide: string = `---
page_title: "Using the ${StringUtils.capitalize(this.config.providerName)} provider with OpenTofu"
subcategory: "Guides"
description: |-
  The ${StringUtils.capitalize(this.config.providerName)} provider is published to the OpenTofu Registry and tested against OpenTofu on every change.
---

# Using the ${StringUtils.capitalize(this.config.providerName)} provider with OpenTofu

This provider works with [OpenTofu](https://opentofu.org) as well as Terraform, and is published to both registries. OpenTofu is a tested path, not an assumption inherited from Terraform compatibility: the provider's end-to-end suite runs the same fixtures against both engines on every pull request, and a break under \`tofu\` fails the build.

## Usage

Nothing in your configuration changes — declare the provider as usual and drive it with \`tofu\`:

\`\`\`terraform
terraform {
  required_providers {
    ${this.config.providerName} = {
      source  = "oneuptime/${this.config.providerName}"
      version = "~> ${majorVersion}.0"
    }
  }
}

provider "${this.config.providerName}" {
  # api_key is read from ${StringUtils.toConstantCase(this.config.providerName)}_API_KEY.
}
\`\`\`

\`\`\`shell
export ${StringUtils.toConstantCase(this.config.providerName)}_API_KEY="your-project-api-key"
tofu init
tofu plan
tofu apply
\`\`\`

## Keep the registry hostname out of the source address

\`source = "oneuptime/${this.config.providerName}"\` carries no hostname, so each engine resolves it against its own default registry — \`registry.opentofu.org\` under OpenTofu, \`registry.terraform.io\` under Terraform. The provider is published to both, so one address covers both engines.

A hostname in the address makes every engine use that registry: with \`source = "registry.terraform.io/oneuptime/${this.config.providerName}"\`, OpenTofu downloads from the Terraform Registry too, and Terraform refuses the OpenTofu Registry's copy (\`authentication signature from unknown issuer\`).

## Differences worth knowing

| Topic | Behaviour |
|-------|-----------|
| The \`terraform\` block | Stays \`terraform\`. It is a language keyword, not a reference to the Terraform CLI. |
| \`.tf\` vs \`.tofu\` files | \`.tf\` works under both. OpenTofu 1.8 and later also read \`.tofu\` files, and skip a \`.tf\` file that has a \`.tofu\` file of the same name. |
| \`required_version\` | OpenTofu's version series starts at 1.6.0, so a \`>= 1.5.0\` constraint written for Terraform is always satisfied. |
| Lock files | Both write \`.terraform.lock.hcl\`, each under its own registry's address: \`init\` rewrites the provider's entry when you switch engines, so commit the change. |
| State files | OpenTofu reads a state Terraform wrote, as it is. |
| Variables | \`TF_VAR_name\` sets a variable under OpenTofu too. |

## Reusable modules

This repository ships hand-written modules under [\`modules/\`](https://github.com/OneUptime/terraform-provider-${this.config.providerName}/tree/master/modules). They are engine-agnostic HCL and work under Terraform too.

\`\`\`terraform
module "storefront" {
  source = "github.com/OneUptime/terraform-provider-${this.config.providerName}//modules/monitoring-and-incident-response?ref=v${this.config.providerVersion}"

  service_name          = "storefront"
  status_page_is_public = true

  monitors = {
    homepage = { url = "https://example.com" }
    api      = { url = "https://api.example.com/health", expected_status_code = "204" }
  }
}
\`\`\`

Pin \`ref\` to a published tag: this repository is regenerated on every release, so an unpinned source tracks whatever was published last.

## More

- OpenTofu guide: [oneuptime.com/docs/terraform/opentofu](https://oneuptime.com/docs/terraform/opentofu)
- Runnable examples: [\`Examples/opentofu/\`](https://github.com/OneUptime/oneuptime/tree/main/Examples/opentofu) in the main OneUptime repository
- Issues, including documentation issues: [github.com/OneUptime/oneuptime/issues](https://github.com/OneUptime/oneuptime/issues)
`;

    await this.fileGenerator.writeFileInDir(
      "docs/guides",
      "opentofu.md",
      guide,
    );
  }

  /*
   * Copy the checked-in HCL modules into the generated provider. Missing
   * sources are a hard failure rather than a silent skip: the module source
   * address is published in the OneUptime docs and in the guide above, so a
   * release that quietly dropped modules/ would break those links.
   */
  private copyModules(): void {
    if (!fs.existsSync(MODULES_SOURCE_DIR)) {
      throw new Error(
        `Module source directory not found: ${MODULES_SOURCE_DIR}. The generated provider publishes these as modules/, and the docs link to that path.`,
      );
    }
    this.fileGenerator.copyDirectory(MODULES_SOURCE_DIR, "modules");
  }

  /*
   * What a configuration does where moving a resource to another type is
   * not possible: Terraform before 1.8 has no moved block between types.
   */
  public static readonly MOVE_TO_ANOTHER_TYPE_FALLBACK: string =
    "Where the engine cannot move a resource to another type (Terraform before 1.8), remove it from the state with `terraform state rm` and import it under its new name instead.";

  /*
   * The provider index lists the resources whose name changed, with the
   * moved block that carries their state over - and the names that could
   * not stay aliases, because another resource has them now: a
   * configuration that used one for what it managed before stops planning
   * until it is renamed, so the index says so where renames are read.
   */
  private generateRenamedSection(): string {
    const byName: (a: TerraformResource, b: TerraformResource) => number = (
      a: TerraformResource,
      b: TerraformResource,
    ): number => {
      return a.name.localeCompare(b.name);
    };
    const renamed: Array<TerraformResource> = this.resources
      .filter((resource: TerraformResource) => {
        return Boolean(resource.legacyName);
      })
      .sort(byName);
    const moved: Array<TerraformResource> = this.resources
      .filter((resource: TerraformResource) => {
        return Boolean(resource.movedFrom);
      })
      .sort(byName);

    if (renamed.length === 0 && moved.length === 0) {
      return "";
    }

    const provider: string = this.config.providerName;

    // The moved example uses the plainest of them: iot_fleet, not its rules.
    const example: TerraformResource | undefined = [...renamed].sort(
      (a: TerraformResource, b: TerraformResource) => {
        return a.name.length - b.name.length || a.name.localeCompare(b.name);
      },
    )[0];

    const aliases: string =
      renamed.length > 0 && example
        ? `
These resources were renamed to read the way the product names them: IoT and vCenter are one word, auto remediation rules are AI rules, an escalation rule's users, teams and schedules are \`escalation_rule_user\`, \`escalation_rule_team\` and \`escalation_rule_schedule\`, and every team owner is \`<thing>_team_owner\`. Each old name still works, as a deprecated alias, so no configuration breaks; plans that use one say so.

| Old name | New name |
|----------|----------|
${renamed
  .map((resource: TerraformResource) => {
    return `| \`${provider}_${resource.legacyName}\` | [\`${provider}_${resource.name}\`](./resources/${resource.name}) |`;
  })
  .join("\n")}

To switch, rename the resource in your configuration and add a \`moved\` block, and Terraform keeps the existing resource instead of replacing it:

\`\`\`terraform
moved {
  from = ${provider}_${example.legacyName}.example
  to   = ${provider}_${example.name}.example
}
\`\`\`
`
        : "";

    const takenNames: string =
      moved.length > 0
        ? `
${moved.length === 1 ? "One old name is" : "These old names are"} another resource's now, so no alias can keep ${moved.length === 1 ? "it" : "them"}. A configuration that uses ${moved.length === 1 ? "it" : "one"} for what it managed before stops planning until you rename the resource and add a \`moved\` block:

| Old name, now another resource | What it managed is now |
|----------|----------|
${moved
  .map((resource: TerraformResource) => {
    return `| [\`${provider}_${resource.movedFrom}\`](./resources/${resource.movedFrom}) | [\`${provider}_${resource.name}\`](./resources/${resource.name}) |`;
  })
  .join("\n")}

\`\`\`terraform
moved {
  from = ${provider}_${moved[0]!.movedFrom}.example
  to   = ${provider}_${moved[0]!.name}.example
}
\`\`\`

${DocumentationGenerator.MOVE_TO_ANOTHER_TYPE_FALLBACK}
`
        : "";

    return `
## Renamed resources
${aliases}${takenNames}`;
  }

  private async generateResourceDocs(): Promise<void> {
    this.fileGenerator.ensureDirectory("docs/resources");

    for (const resource of this.resources) {
      const resourceDoc: string = this.generateResourceDoc(resource);
      await this.fileGenerator.writeFileInDir(
        "docs/resources",
        `${resource.name}.md`,
        resourceDoc,
      );
    }
  }

  private async generateDataSourceDocs(): Promise<void> {
    this.fileGenerator.ensureDirectory("docs/data-sources");

    for (const dataSource of this.dataSources) {
      const dataSourceDoc: string = this.generateDataSourceDoc(dataSource);
      await this.fileGenerator.writeFileInDir(
        "docs/data-sources",
        `${dataSource.name}.md`,
        dataSourceDoc,
      );
    }
  }

  /*
   * The schema block a page documents: the built provider's, when generation
   * ran far enough to dump it, else the same thing derived from the spec the
   * way the resource generator derives it.
   */
  private getResourceBlock(resource: TerraformResource): SchemaDumpBlock {
    const dumped: SchemaDumpBlock | undefined =
      this.schemaDump?.resources[
        `${this.config.providerName}_${resource.name}`
      ];

    if (dumped) {
      return dumped;
    }

    const attributes: Record<string, SchemaDumpAttribute> = {};

    for (const [name, attr] of Object.entries(resource.schema)) {
      const flags: SchemaFlags = ResourceGenerator.getSchemaFlags(
        name,
        attr,
        resource,
      );
      attributes[StringUtils.toTerraformAttributeName(name)] = {
        ...this.describeSpecAttribute(attr),
        required: flags.required,
        optional: flags.optional,
        computed: flags.computed,
      };
    }

    return { description: resource.description, attributes };
  }

  private getDataSourceBlock(dataSource: TerraformDataSource): SchemaDumpBlock {
    const dumped: SchemaDumpBlock | undefined =
      this.schemaDump?.data_sources[
        `${this.config.providerName}_${dataSource.name}`
      ];

    if (dumped) {
      return dumped;
    }

    const attributes: Record<string, SchemaDumpAttribute> = {};

    for (const [name, attr] of Object.entries(dataSource.schema)) {
      attributes[StringUtils.toTerraformAttributeName(name)] = {
        ...this.describeSpecAttribute(attr),
        required: Boolean(attr.required),
        optional: Boolean(attr.optional),
        computed: Boolean(attr.computed),
      };
    }

    return { description: dataSource.description, attributes };
  }

  private describeSpecAttribute(attr: TerraformAttribute): SchemaDumpAttribute {
    let type: string = "String";

    if (attr.isMonitorSteps) {
      type = "Attributes List";
    } else if (attr.type === "number") {
      type = "Number";
    } else if (attr.type === "bool") {
      type = "Boolean";
    } else if (attr.type === "list") {
      type = "List of String";
    } else if (attr.type === "set") {
      type = "Set of String";
    } else if (attr.type === "map") {
      type = "Map of String";
    }

    return {
      type,
      description: attr.description,
      sensitive: attr.sensitive,
      ...(attr.enumValues?.length ? { allowed_values: attr.enumValues } : {}),
    };
  }

  /*
   * The Schema section, laid out the way tfplugindocs lays it out - the
   * format registry readers know: Required / Optional / Read-Only, then a
   * "Nested Schema" section for every nested attribute, linked from its line.
   */
  public renderSchema(attributes: Record<string, SchemaDumpAttribute>): string {
    const sections: Array<string> = [];
    const nestedSections: Array<string> = [];

    for (const [title, list] of this.groupAttributes(attributes)) {
      sections.push(
        `### ${title}\n\n${list
          .map(([name, attr]: [string, SchemaDumpAttribute]) => {
            return this.renderAttributeLine(name, attr, [name], nestedSections);
          })
          .join("\n")}`,
      );
    }

    return [...sections, ...nestedSections].join("\n\n");
  }

  private groupAttributes(
    attributes: Record<string, SchemaDumpAttribute>,
  ): Array<[string, Array<[string, SchemaDumpAttribute]>]> {
    const sorted: Array<[string, SchemaDumpAttribute]> = Object.entries(
      attributes,
    ).sort(
      (a: [string, SchemaDumpAttribute], b: [string, SchemaDumpAttribute]) => {
        return a[0].localeCompare(b[0]);
      },
    );

    const groups: Array<[string, Array<[string, SchemaDumpAttribute]>]> = [
      [
        "Required",
        sorted.filter(([, attr]: [string, SchemaDumpAttribute]) => {
          return Boolean(attr.required);
        }),
      ],
      [
        "Optional",
        sorted.filter(([, attr]: [string, SchemaDumpAttribute]) => {
          return !attr.required && Boolean(attr.optional);
        }),
      ],
      [
        "Read-Only",
        sorted.filter(([, attr]: [string, SchemaDumpAttribute]) => {
          return !attr.required && !attr.optional;
        }),
      ],
    ];

    return groups.filter(
      ([, list]: [string, Array<[string, SchemaDumpAttribute]>]) => {
        return list.length > 0;
      },
    );
  }

  private renderAttributeLine(
    name: string,
    attr: SchemaDumpAttribute,
    attributePath: Array<string>,
    nestedSections: Array<string>,
  ): string {
    const tags: Array<string> = [attr.type];

    if (attr.sensitive) {
      tags.push("Sensitive");
    }
    if (attr.deprecation) {
      tags.push("Deprecated");
    }

    const parts: Array<string> = [];
    const description: string = (attr.description || "").trim();

    if (description) {
      parts.push(description);
    }
    if (attr.deprecation) {
      parts.push(`**Deprecated:** ${attr.deprecation.trim()}`);
    }
    if (attr.allowed_values?.length) {
      parts.push(
        `Allowed values: ${attr.allowed_values
          .map((value: string) => {
            return `\`${value}\``;
          })
          .join(", ")}.`,
      );
    }

    const defaultText: string = this.formatDefault(attr.default);
    if (defaultText) {
      parts.push(defaultText);
    }

    if (attr.nested && Object.keys(attr.nested).length > 0) {
      const anchor: string = `nestedatt--${attributePath.join("--")}`;
      parts.push(`(see [below for nested schema](#${anchor}))`);
      // The section of this attribute first, then the ones nested in it.
      nestedSections.push(
        ...this.renderNestedSections(attr.nested, attributePath),
      );
    }

    return `- \`${name}\` (${tags.join(", ")})${parts.length ? ` ${parts.join(" ")}` : ""}`;
  }

  private renderNestedSections(
    attributes: Record<string, SchemaDumpAttribute>,
    attributePath: Array<string>,
  ): Array<string> {
    const anchor: string = `nestedatt--${attributePath.join("--")}`;
    const groups: Array<string> = [];
    const deeper: Array<string> = [];

    for (const [title, list] of this.groupAttributes(attributes)) {
      groups.push(
        `${title}:\n\n${list
          .map(([name, attr]: [string, SchemaDumpAttribute]) => {
            return this.renderAttributeLine(
              name,
              attr,
              [...attributePath, name],
              deeper,
            );
          })
          .join("\n")}`,
      );
    }

    return [
      `<a id="${anchor}"></a>\n### Nested Schema for \`${attributePath.join(".")}\`\n\n${groups.join("\n\n")}`,
      ...deeper,
    ];
  }

  // The framework says "value defaults to `x`"; a reader wants "Defaults to `x`."
  private formatDefault(value: string | undefined): string {
    const text: string = (value || "").trim();

    if (!text) {
      return "";
    }

    const match: RegExpMatchArray | null = text.match(
      /^value defaults to\s+(.+)$/i,
    );
    const shown: string = match ? match[1]!.trim() : text;

    return `Defaults to ${shown.replace(/\.$/, "")}.`;
  }

  private generateResourceDoc(resource: TerraformResource): string {
    const provider: string = this.config.providerName;
    const block: SchemaDumpBlock = this.getResourceBlock(resource);
    const resourceDescription: string = (
      resource.description ||
      `${StringUtils.capitalize(resource.name.replace(/_/g, " "))} resource.`
    ).trim();

    const renamedNote: string = resource.legacyName
      ? `
~> **Renamed:** this resource was called \`${provider}_${resource.legacyName}\` before. The old name still works, but is deprecated. To switch, rename the resource in your configuration and add a \`moved\` block, so Terraform keeps the existing ${resource.name.replace(/_/g, " ")}:

\`\`\`terraform
moved {
  from = ${provider}_${resource.legacyName}.example
  to   = ${provider}_${resource.name}.example
}
\`\`\`
`
      : resource.movedFrom
        ? `
~> **Renamed:** this resource was called \`${provider}_${resource.movedFrom}\` before, a name [another resource](./${resource.movedFrom}) has now. Rename the resource in your configuration and add a \`moved\` block, so Terraform keeps the existing ${resource.name.replace(/_/g, " ")}:

\`\`\`terraform
moved {
  from = ${provider}_${resource.movedFrom}.example
  to   = ${provider}_${resource.name}.example
}
\`\`\`

${DocumentationGenerator.MOVE_TO_ANOTHER_TYPE_FALLBACK}
`
        : "";

    const importSection: string = resource.membershipImport
      ? this.getMembershipImportSection(resource, resource.membershipImport)
      : resource.operations?.read
        ? `## Import

Import an existing ${resource.name.replace(/_/g, " ")} by its id, with an \`import\` block (Terraform 1.5+, OpenTofu 1.6+):

\`\`\`terraform
import {
  to = ${provider}_${resource.name}.example
  id = "<id>"
}
\`\`\`

or on the command line:

\`\`\`shell
terraform import ${provider}_${resource.name}.example <id>
\`\`\`
`
        : `## Import

This resource does not support import: the OneUptime API exposes no read endpoint for it.
`;

    return `---
page_title: "${provider}_${resource.name} Resource - ${provider}"
subcategory: "${DocumentationGenerator.getSubcategory(resource.name)}"
description: |-
  ${resourceDescription}
---

# ${provider}_${resource.name} (Resource)

${resourceDescription}
${renamedNote}
## Example Usage

\`\`\`terraform
${this.generateResourceExample(resource, block)}
\`\`\`
${this.getResourceGuide(resource)}
## Schema

${this.renderSchema(this.withGuideLinks(resource, block.attributes))}

${importSection}`;
  }

  /*
   * The prose a page carries between its example and its schema, for
   * attributes whose JSON shape the API's schema does not describe. Empty for
   * every other page, which keeps its layout byte for byte.
   */
  private getResourceGuide(resource: TerraformResource): string {
    if (resource.name === ON_CALL_SCHEDULE_LAYER_GUIDE.resource) {
      return `\n${this.getOnCallScheduleLayerGuide()}\n`;
    }

    if (resource.membershipImport?.kind === MembershipKind.Member) {
      return `\n${this.getTeamMemberGuide()}`;
    }

    return "";
  }

  /*
   * A row imported by what it joins and who or what joins it: a team member
   * by its team and the person's address, a monitor's owner by the monitor
   * and the person's address, an owner team or an escalation rule's team by
   * both IDs.
   */
  private getMembershipImportSection(
    resource: TerraformResource,
    membership: TerraformMembershipImport,
  ): string {
    const provider: string = this.config.providerName;
    const label: string = resource.name.replace(/_/g, " ");
    const byEmail: boolean = Boolean(membership.personEmailAttribute);
    const importId: string = `<${membership.parentAttribute}>/${byEmail ? EXAMPLE_PERSON_EMAIL : `<${membership.personAttribute}>`}`;
    const by: string = byEmail
      ? `its ${membership.parentNoun} and the person's email address (or user ID)`
      : `its ${membership.parentNoun} and its \`${membership.personAttribute}\``;
    const after: string = byEmail
      ? `Imported by an address, the person's \`${membership.personEmailAttribute}\` stays as you wrote it. Its own ID works too.`
      : "Its own ID works too.";

    return `## Import

Import an existing ${label} by ${by}, with an \`import\` block (Terraform 1.5+, OpenTofu 1.6+):

\`\`\`terraform
import {
  to = ${provider}_${resource.name}.example
  id = "${importId}"
}
\`\`\`

or on the command line:

\`\`\`shell
terraform import ${provider}_${resource.name}.example ${importId}
\`\`\`

${after}
`;
  }

  /*
   * The team member page's guide: what naming someone by address does -
   * invite them when they are new - how to put them on call in the same
   * configuration, what removing a member does, and how addresses compare.
   */
  private getTeamMemberGuide(): string {
    const provider: string = this.config.providerName;

    return `## Invite people by email address

Name the person by \`user_email\`. Someone who is in the project already joins the team at once; someone who is not is invited, as the dashboard's **Invite** does: OneUptime makes them an account if they have none, and emails them. \`has_accepted_invitation\` is \`false\` until they accept, and their accepting is no change to the plan.

To put someone this configuration invites on call, or make them an owner, refer to their membership: Terraform then invites them first.

\`\`\`terraform
resource "${provider}_monitor_user_owner" "alice" {
  monitor_id = ${provider}_monitor.example.id
  user_id    = ${provider}_team_member.example.user_id
}
\`\`\`

## Remove someone

Removing a member from the configuration removes them from the team. Out of their last team of the project, they are out of the project: OneUptime takes them off every on-call schedule, escalation rule and override, and off what they own, except the incidents, alerts and maintenance events that are over. Remove the blocks that name them in the same change. Their OneUptime account stays theirs. A team that must keep a member refuses to lose its last one who has accepted.

## Email addresses

OneUptime keeps addresses in lower case, and finds a person by theirs in any case. The address stays in state as you wrote it, and a person who changes theirs in OneUptime stays the same person to Terraform: nothing changes until you write the new address, and then only the address does.
`;
  }

  /*
   * Docs guide (docs/guides/people.md): onboarding and offboarding as code -
   * teams and their members by email address, people on call and owning
   * things, finding someone, and what removing them does.
   */
  private async generatePeopleGuide(): Promise<void> {
    const provider: string = this.config.providerName;

    const guide: string = `---
page_title: "Managing people and teams"
subcategory: "Guides"
description: |-
  Teams and their members by email address: invitations, on-call, owners and offboarding as code.
---

# Managing people and teams

Every resource that names a person takes their email address as well as their user ID: \`user_email\` beside \`user_id\`, \`owner_user_emails\` beside \`owner_users\`, \`assigned_to_user_email\` beside \`assigned_to_user_id\`, and the same everywhere else. Give one of the two. The provider finds the person among the project's members and the people invited to it, and sends their ID. It searches only the API key's project: nobody outside it is ever found.

## Onboarding

A team member named by an address nobody in the project has is invited by it, as the dashboard's **Invite** does: OneUptime makes them an account if they have none, and emails them. Someone in the project already joins the team at once.

\`\`\`terraform
resource "${provider}_team" "sre" {
  name = "SRE"
}

resource "${provider}_team_member" "alice" {
  team_id    = ${provider}_team.sre.id
  user_email = "alice@example.com"
}

resource "${provider}_on_call_policy_schedule" "weekly" {
  name     = "SRE weekly"
  timezone = "UTC"
}

resource "${provider}_on_call_schedule_layer" "weekly" {
  on_call_duty_policy_schedule_id = ${provider}_on_call_policy_schedule.weekly.id
  name                            = "Weekly"
  starts_at                       = "2030-01-07T09:00:00Z"
  hand_off_time                   = "2030-01-14T09:00:00Z"
}

# Alice takes turns on call from her first day: invited people can.
resource "${provider}_on_call_schedule_layer_user" "alice" {
  on_call_duty_policy_schedule_id       = ${provider}_on_call_policy_schedule.weekly.id
  on_call_duty_policy_schedule_layer_id = ${provider}_on_call_schedule_layer.weekly.id
  user_id                               = ${provider}_team_member.alice.user_id
}

resource "${provider}_monitor" "api" {
  name         = "Public API"
  monitor_type = "Manual"
}

# Bob is in the project already: name him by address anywhere.
resource "${provider}_monitor_user_owner" "api" {
  monitor_id = ${provider}_monitor.api.id
  user_email = "bob@example.com"
}
\`\`\`

Refer to a membership this configuration makes (\`user_id = ${provider}_team_member.alice.user_id\`) to name the person it invites: Terraform then invites them before it names them anywhere else. An address nobody in the project has is a warning in the plan, and an error in the apply.

The API key needs a permission that may read the project's team members (Project Member, Project Admin or Read Teams) to find people, and one that may invite them (Project Admin, or Invite New Members) to add them.

## Finding someone

\`data "${provider}_user"\` looks someone up by \`email\`, \`name\` or \`id\`, and gives their ID, name, whether they have joined, and the teams they are in.

\`\`\`terraform
data "${provider}_user" "alice" {
  email = "alice@example.com"
}
\`\`\`

## Offboarding

Remove the person's memberships from the configuration. Out of their last team, they are out of the project, and OneUptime takes them off every on-call schedule, escalation rule and override, and off what they own, except the incidents, alerts and maintenance events that are over. Remove the blocks that name them in the same change. Their OneUptime account stays theirs; only the project is left.

## Importing

A membership no screen shows the ID of is imported by its team and the person's address:

\`\`\`shell
terraform import ${provider}_team_member.alice <team id>/alice@example.com
\`\`\`

## When someone changes their address

The address stays in state as you wrote it, and the person stays the same person to Terraform: nothing changes until you write the new address, and then only the address does. OneUptime keeps addresses in lower case and compares them in any case.

## With an identity provider

If your identity provider manages your people over SCIM, let it: while SCIM Push Groups manages a project's teams, OneUptime refuses team member changes from anywhere else, Terraform included. Keep teams, on-call and owners in Terraform, named by address.
`;

    await this.fileGenerator.writeFileInDir("docs/guides", "people.md", guide);
  }

  // The schema lines of the attributes a page's guide covers point at it.
  private withGuideLinks(
    resource: TerraformResource,
    attributes: Record<string, SchemaDumpAttribute>,
  ): Record<string, SchemaDumpAttribute> {
    if (resource.name !== ON_CALL_SCHEDULE_LAYER_GUIDE.resource) {
      return attributes;
    }

    const linked: Record<string, SchemaDumpAttribute> = { ...attributes };

    for (const name of ON_CALL_SCHEDULE_LAYER_GUIDE.attributes) {
      const attr: SchemaDumpAttribute | undefined = linked[name];
      if (attr) {
        linked[name] = {
          ...attr,
          description: `${(attr.description || "").trim()} See [${ON_CALL_SCHEDULE_LAYER_GUIDE.title}](#${ON_CALL_SCHEDULE_LAYER_GUIDE.anchor}).`,
        };
      }
    }

    return linked;
  }

  /*
   * What a layer's rotation and restriction times look like. Both are JSON,
   * and the API's schema says nothing of their shape, so readers worked them
   * out by trial and error - and one key is spelled restictionType
   * (OneUptime/terraform-provider-oneuptime#11). The fragments here are not
   * validated, so each repeats a shape the page's example applies.
   */
  private getOnCallScheduleLayerGuide(): string {
    return `<a id="${ON_CALL_SCHEDULE_LAYER_GUIDE.anchor}"></a>
## ${ON_CALL_SCHEDULE_LAYER_GUIDE.title}

\`rotation\` and \`restriction_times\` take JSON: write them with \`jsonencode()\`, in the shapes below. The provider checks every \`_type\` and timestamp in them at plan time.

Both are optional. Left out, a layer hands off every week and is on call around the clock (OneUptime 14.0.73 and later; earlier versions refuse a layer without them).

### Rotation

How long each turn lasts. The first hand-off is at \`hand_off_time\`, and the duty moves on to the next person every rotation after that.

\`\`\`terraform
rotation = jsonencode({
  _type = "Recurring"
  value = {
    intervalType  = "Week" # Hour, Day, Week, Month or Year
    intervalCount = { _type = "PositiveNumber", value = 1 }
  }
})
\`\`\`

\`intervalCount\` is a whole number, 1 or more: with \`value = 2\` and \`intervalType = "Week"\`, the duty hands off every two weeks.

### Restriction times

When the layer is on call. \`restictionType\` is the key's real name, without the second "r": the server ignores a key spelled any other way.

- \`None\`: around the clock.

  \`\`\`terraform
  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = { restictionType = "None" }
  })
  \`\`\`

- \`Daily\`: the same hours every day. Only the time of day of \`startTime\` and \`endTime\` counts, and a window that ends before it starts runs past midnight.

  \`\`\`terraform
  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = {
      restictionType = "Daily"
      dayRestrictionTimes = {
        startTime = { _type = "DateTime", value = "2026-01-05T09:00:00Z" }
        endTime   = { _type = "DateTime", value = "2026-01-05T17:00:00Z" }
      }
    }
  })
  \`\`\`

- \`Weekly\`: windows in the week. A window runs from its \`startTime\` to its \`endTime\`, and both the weekday and the time of day count: date each one on the weekday you mean, and name those weekdays in \`startDay\` and \`endDay\`. A window is continuous, so Monday 09:00 to Friday 17:00 includes the nights in between. For working hours, give each day a window of its own, as the example above does. A window that ends earlier in the week than it starts runs over the weekend:

  \`\`\`terraform
  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = {
      restictionType = "Weekly"
      weeklyRestrictionTimes = [{
        startDay  = "Friday"
        endDay    = "Monday"
        startTime = { _type = "DateTime", value = "2026-01-09T17:00:00Z" } # a Friday
        endTime   = { _type = "DateTime", value = "2026-01-12T09:00:00Z" } # the Monday after
      }]
    }
  })
  \`\`\`

A time is \`{ _type = "DateTime", value = "<RFC 3339 timestamp>" }\`, with or without fractional seconds. It is a wall-clock time in the schedule's \`timezone\`: write it with the offset that time zone has on that date, as in \`2026-01-05T09:00:00-05:00\` for 09:00 in New York. A schedule without a \`timezone\` reads times in the server's time zone.`;
  }

  /*
   * A layer's rotation and restriction times, applied: weekday working hours
   * with a weekly hand-off, above a layer that covers the rest of the week.
   */
  private getOnCallScheduleLayerExample(): string {
    const provider: string = this.config.providerName;

    return `# Weekdays, 09:00 to 17:00. Times are wall-clock times in the schedule's
# timezone; these are for a schedule in UTC.
resource "${provider}_on_call_schedule_layer" "example" {
  on_call_duty_policy_schedule_id = ${provider}_on_call_policy_schedule.example.id
  name                            = "Business hours"
  description                     = "Weekdays, 09:00 to 17:00"
  order                           = 1 # Lower wins: this layer is on call in its hours.
  starts_at                       = "2026-01-05T09:00:00Z"
  hand_off_time                   = "2026-01-12T09:00:00Z"

  # The next person takes over every week.
  rotation = jsonencode({
    _type = "Recurring"
    value = {
      intervalType  = "Week"
      intervalCount = { _type = "PositiveNumber", value = 1 }
    }
  })

  # One window a day, each dated on its weekday (2026-01-05 is a Monday).
  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = {
      restictionType = "Weekly"
      weeklyRestrictionTimes = [
        for day, date in {
          Monday    = "2026-01-05"
          Tuesday   = "2026-01-06"
          Wednesday = "2026-01-07"
          Thursday  = "2026-01-08"
          Friday    = "2026-01-09"
          } : {
          startDay  = day
          endDay    = day
          startTime = { _type = "DateTime", value = "\${date}T09:00:00Z" }
          endTime   = { _type = "DateTime", value = "\${date}T17:00:00Z" }
        }
      ]
    }
  })
}

# Nights and weekends: on call around the clock, below the business-hours
# layer, so it covers every hour that layer does not.
resource "${provider}_on_call_schedule_layer" "around_the_clock" {
  on_call_duty_policy_schedule_id = ${provider}_on_call_policy_schedule.example.id
  name                            = "Nights and weekends"
  order                           = 2
  starts_at                       = "2026-01-05T09:00:00Z"
  hand_off_time                   = "2026-01-06T09:00:00Z"

  rotation = jsonencode({
    _type = "Recurring"
    value = {
      intervalType  = "Day"
      intervalCount = { _type = "PositiveNumber", value = 1 }
    }
  })

  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = { restictionType = "None" }
  })
}`;
  }

  /*
   * An example that applies: every required argument, plus the name and
   * description, with values that make sense - an allowed value for an enum,
   * a reference to the resource an id points at, never a made-up UUID.
   */
  private generateResourceExample(
    resource: TerraformResource,
    block: SchemaDumpBlock,
  ): string {
    if (resource.name === "monitor" && resource.schema["monitor_steps"]) {
      return this.getMonitorExample();
    }

    if (resource.name === ON_CALL_SCHEDULE_LAYER_GUIDE.resource) {
      return this.getOnCallScheduleLayerExample();
    }

    const provider: string = this.config.providerName;
    const fields: Array<string> = [];

    for (const [name, attr] of Object.entries(resource.schema)) {
      const attributeName: string = StringUtils.toTerraformAttributeName(name);
      if (name === "id" || !block.attributes[attributeName]?.required) {
        continue;
      }
      fields.push(
        `  ${attributeName} = ${this.getExampleValue(name, attr, resource)}`,
      );
    }

    /*
     * A person the resource needs: named by email address, the way a
     * configuration names people (user_email beside user_id).
     */
    for (const attr of Object.values(resource.schema)) {
      if (!attr.person?.isRequired) {
        continue;
      }
      fields.push(
        `  ${attr.person.emailAttribute} = ${
          attr.person.isList
            ? `[${DocumentationGenerator.hclString(EXAMPLE_PERSON_EMAIL)}]`
            : DocumentationGenerator.hclString(EXAMPLE_PERSON_EMAIL)
        }`,
      );
    }

    for (const name of ["name", "description"]) {
      const attr: TerraformAttribute | undefined = resource.schema[name];
      const dumped: SchemaDumpAttribute | undefined = block.attributes[name];
      if (attr && dumped && !dumped.required && dumped.optional) {
        fields.push(
          `  ${name} = ${this.getExampleValue(name, attr, resource)}`,
        );
      }
    }

    const width: number = Math.max(
      0,
      ...fields.map((field: string) => {
        return field.trim().split(" = ")[0]!.length;
      }),
    );

    const aligned: Array<string> = fields.map((field: string) => {
      const [key, ...rest] = field.trim().split(" = ");
      const value: string = rest.join(" = ");
      // Multi-line values are not aligned, as terraform fmt leaves them.
      return value.includes("\n")
        ? `  ${key} = ${value}`
        : `  ${key!.padEnd(width)} = ${value}`;
    });

    return `resource "${provider}_${resource.name}" "example" {
${aligned.join("\n")}
}`;
  }

  /*
   * The monitor is the resource most configurations start with, and its
   * steps are the part people get wrong: a whole, working example.
   */
  private getMonitorExample(): string {
    const provider: string = this.config.providerName;

    return `# The project's own statuses and severities, looked up by name.
data "${provider}_monitor_status" "operational" {
  name = "Operational"
}

data "${provider}_monitor_status" "offline" {
  name = "Offline"
}

data "${provider}_incident_severity" "critical" {
  name = "Critical Incident"
}

resource "${provider}_monitor" "example" {
  name                = "Example website"
  description         = "Checks https://example.com every minute"
  monitor_type        = "Website"
  monitoring_interval = "* * * * *"

  monitor_steps = [{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    # Evaluated top to bottom; the first that matches wins.
    criteria = [
      {
        name                  = "Offline"
        description           = "The website does not answer"
        filter_condition      = "Any"
        change_monitor_status = true
        monitor_status_id     = data.${provider}_monitor_status.offline.id
        create_incidents      = true

        filters = [
          { check_on = "Is Online", filter_type = "False" },
        ]

        incidents = [{
          title                 = "Example website is down"
          description           = "The website did not respond to the probe."
          incident_severity_id  = data.${provider}_incident_severity.critical.id
          auto_resolve_incident = true
        }]
      },
      {
        name                  = "Online"
        description           = "The website answers"
        filter_condition      = "All"
        change_monitor_status = true
        monitor_status_id     = data.${provider}_monitor_status.operational.id

        filters = [
          { check_on = "Is Online", filter_type = "True" },
        ]
      },
    ]
  }]
}`;
  }

  /*
   * How an example refers to the id of another type: its resource's example,
   * or - for a type with only a data source - that data source's example.
   * Every page's example is named "example", so the references resolve.
   */
  private getRelationReference(name: string): string {
    const provider: string = this.config.providerName;
    const isResource: boolean = this.resources.some(
      (candidate: TerraformResource) => {
        return candidate.name === name;
      },
    );

    return isResource
      ? `${provider}_${name}.example.id`
      : `data.${provider}_${name}.example.id`;
  }

  private getExampleValue(
    fieldName: string,
    attrInfo: TerraformAttribute,
    resource?: TerraformResource,
  ): string {
    const label: string = (resource?.name || "resource").replace(/_/g, " ");

    // An id (or ids) of another resource: refer to it.
    if (attrInfo.relation) {
      const reference: string = this.getRelationReference(
        attrInfo.relation.name,
      );
      return attrInfo.relation.isList ? `[${reference}]` : reference;
    }

    /*
     * Ids of records the provider has no resource or data source for: still
     * a list of ids, as the attribute takes them. The spec's own example is
     * the API's list of objects ([{ id = "..." }]), which Terraform refuses.
     */
    if (attrInfo.elementKind === "entity") {
      return '["<id>"]';
    }

    // Typed nested monitor steps: show the real nested syntax.
    if (attrInfo.isMonitorSteps) {
      return `[{
    monitor_destination      = "https://example.com"
    monitor_destination_type = "URL"
    request_type             = "GET"

    criteria = [{
      name             = "Online"
      filter_condition = "All"
      filters = [
        { check_on = "Is Online", filter_type = "True" },
      ]
    }]
  }]`;
    }

    // Enum-constrained fields: an allowed value.
    if (Array.isArray(attrInfo.enumValues) && attrInfo.enumValues.length > 0) {
      const preferred: string | undefined =
        resource?.schema["monitor_steps"] &&
        attrInfo.enumValues.includes("Website")
          ? "Website"
          : undefined;
      return DocumentationGenerator.hclString(
        preferred || attrInfo.enumValues[0]!,
      );
    }

    // RFC3339 timestamp fields
    if (attrInfo.isDateTime) {
      return '"2030-01-01T00:00:00Z"';
    }

    if (fieldName === "name") {
      return `"Example ${label}"`;
    }

    if (fieldName === "description") {
      return '"Managed by Terraform"';
    }

    /*
     * Complex nested objects are JSON strings in the schema. A wrapped
     * scalar (a Color, a Name...) is written as its plain value; anything
     * else with jsonencode().
     */
    if (attrInfo.type === "string" && attrInfo.isComplexObject) {
      const example: any = attrInfo.example;
      if (
        example &&
        typeof example === "object" &&
        example._type &&
        (typeof example.value === "string" || typeof example.value === "number")
      ) {
        return DocumentationGenerator.hclString(String(example.value));
      }
      if (
        example !== undefined &&
        example !== null &&
        typeof example === "object"
      ) {
        return `jsonencode(${JSON.stringify(example, null, 2)
          .split("\n")
          .join("\n  ")})`;
      }
      return "jsonencode({})";
    }

    // First, try to use the example from OpenAPI spec
    if (attrInfo.example !== undefined && attrInfo.example !== null) {
      return this.formatOpenAPIExample(attrInfo.example, attrInfo.type);
    }

    if (fieldName.endsWith("_id") && attrInfo.type === "string") {
      return '"<id>"';
    }

    switch (attrInfo.type) {
      case "string":
        return `"example-${fieldName.replace(/_/g, "-")}"`;
      case "number":
        return "1";
      /*
       * The parser's type token is "bool" (not "boolean") — using the wrong
       * token rendered every boolean example as a quoted string.
       */
      case "bool":
        return "true";
      case "list":
      case "set":
        return "[]";
      default:
        return `"example-${fieldName.replace(/_/g, "-")}"`;
    }
  }

  private generateDataSourceDoc(dataSource: TerraformDataSource): string {
    const provider: string = this.config.providerName;
    const block: SchemaDumpBlock = this.getDataSourceBlock(dataSource);
    const label: string = dataSource.name.replace(/_/g, " ");
    // A data source written by hand says what it is itself.
    const description: string = (
      (dataSource.staticFile && block.description) ||
      dataSource.description ||
      `${StringUtils.capitalize(label)} data source.`
    ).trim();

    const filters: Array<string> = Object.entries(dataSource.schema)
      .filter(([, attr]: [string, TerraformAttribute]) => {
        return Boolean(attr.isLookupFilter);
      })
      .map(([name]: [string, TerraformAttribute]) => {
        return name;
      });

    // People are found by email address; everything else by name.
    const byArgument: string | undefined = filters.includes("email")
      ? "email"
      : filters.includes("name")
        ? "name"
        : filters.find((name: string) => {
            return dataSource.schema[name]?.type === "string";
          }) || filters[0];

    /*
     * A record that names a person is found by their address, beside what
     * it belongs to: a team's member by its team and the person's address.
     */
    const personEmail: [string, TerraformAttribute] | undefined =
      Object.entries(dataSource.schema).find(
        ([, attr]: [string, TerraformAttribute]) => {
          return Boolean(attr.personEmailOf);
        },
      );
    const exampleArguments: Array<[string, string]> = [];

    if (personEmail) {
      const parent: string | undefined = filters.find((name: string) => {
        const attr: TerraformAttribute | undefined = dataSource.schema[name];
        return (
          name !== personEmail[0] &&
          name !== personEmail[1].personEmailOf &&
          attr?.type === "string" &&
          Boolean(attr.relation)
        );
      });

      if (parent) {
        exampleArguments.push([
          parent,
          this.getLookupExampleValue(parent, dataSource),
        ]);
      }
      exampleArguments.push([
        personEmail[0],
        DocumentationGenerator.hclString(EXAMPLE_PERSON_EMAIL),
      ]);
    } else if (byArgument) {
      exampleArguments.push([
        byArgument,
        this.getLookupExampleValue(byArgument, dataSource),
      ]);
    }

    // Aligned as terraform fmt aligns them.
    const width: number = Math.max(
      0,
      ...exampleArguments.map(([name]: [string, string]) => {
        return StringUtils.toTerraformAttributeName(name).length;
      }),
    );
    const exampleBody: string = exampleArguments
      .map(([name, value]: [string, string]) => {
        return `  ${StringUtils.toTerraformAttributeName(name).padEnd(width)} = ${value}`;
      })
      .join("\n");

    const lookupExample: string =
      exampleArguments.length > 0
        ? `data "${provider}_${dataSource.name}" "example" {
${exampleBody}
}

# Or by id:
data "${provider}_${dataSource.name}" "by_id" {
  id = "<id>"
}`
        : `data "${provider}_${dataSource.name}" "example" {
  id = "<id>"
}`;

    const renamedNote: string = dataSource.legacyName
      ? `
~> **Renamed:** this data source was called \`${provider}_${dataSource.legacyName}\` before. The old name still works, but is deprecated.
`
      : "";

    const lookupRule: string =
      dataSource.name === "user"
        ? `Look someone up by \`email\`, \`name\` or \`id\`: exactly one of them. Only the people of the API key's project are searched - its members, and those invited to it - so nobody outside it is ever found, and no match is an error rather than an empty result.`
        : `Look one up by \`id\`, or by any of its other arguments: every argument you set must match, and exactly one ${label} may match them all - none, or more than one, is an error rather than an empty or arbitrary result.`;

    return `---
page_title: "${provider}_${dataSource.name} Data Source - ${provider}"
subcategory: "${DocumentationGenerator.getSubcategory(dataSource.name)}"
description: |-
  ${description}
---

# ${provider}_${dataSource.name} (Data Source)

${description}

${lookupRule}
${renamedNote}
## Example Usage

\`\`\`terraform
${lookupExample}
\`\`\`

## Schema

${this.renderSchema(block.attributes)}
`;
  }

  private getLookupExampleValue(
    name: string,
    dataSource: TerraformDataSource,
  ): string {
    const attr: TerraformAttribute | undefined = dataSource.schema[name];
    const label: string = dataSource.name.replace(/_/g, " ");

    if (name === "name") {
      return `"Example ${label}"`;
    }
    if (name === "email") {
      return DocumentationGenerator.hclString(EXAMPLE_PERSON_EMAIL);
    }
    if (attr?.enumValues?.length) {
      return DocumentationGenerator.hclString(attr.enumValues[0]!);
    }
    if (attr?.relation) {
      return this.getRelationReference(attr.relation.name);
    }
    if (attr?.type === "number") {
      return "1";
    }
    if (attr?.type === "bool") {
      return "true";
    }
    return `"example-${name.replace(/_/g, "-")}"`;
  }

  private async generateExamples(): Promise<void> {
    this.fileGenerator.ensureDirectory("examples");

    const provider: string = this.config.providerName;

    const providerExample: string = `terraform {
  required_providers {
    ${provider} = {
      source  = "oneuptime/${provider}"
      version = "~> ${this.majorVersion}.0"
    }
  }
}

provider "${provider}" {
  oneuptime_url = "https://oneuptime.com" # Optional: defaults to oneuptime.com; or ${StringUtils.toConstantCase(provider)}_URL
  api_key       = var.${provider}_api_key  # or ${StringUtils.toConstantCase(provider)}_API_KEY
}

# Configure variables
variable "${provider}_api_key" {
  description = "Project API key for ${provider}"
  type        = string
  sensitive   = true
}
`;

    await this.fileGenerator.writeFileInDir(
      "examples",
      "provider.tf",
      providerExample,
    );

    const monitor: TerraformResource | undefined = this.resources.find(
      (resource: TerraformResource) => {
        return resource.name === "monitor";
      },
    );
    const exampleResource: TerraformResource | undefined =
      monitor || this.resources[0];

    if (exampleResource) {
      const resourceExample: string = `# Example usage of ${provider}_${exampleResource.name}
${this.generateResourceExample(exampleResource, this.getResourceBlock(exampleResource))}

output "${exampleResource.name}_id" {
  description = "ID of the created ${exampleResource.name.replace(/_/g, " ")}"
  value       = ${provider}_${exampleResource.name}.example.id
}
`;

      await this.fileGenerator.writeFileInDir(
        "examples",
        "resources.tf",
        resourceExample,
      );
    }

    const monitorStatus: TerraformDataSource | undefined =
      this.dataSources.find((dataSource: TerraformDataSource) => {
        return dataSource.name === "monitor_status";
      }) || this.dataSources[0];

    if (monitorStatus) {
      const dataSourceExample: string = `# Look up an existing ${monitorStatus.name.replace(/_/g, " ")} by name.
data "${provider}_${monitorStatus.name}" "example" {
  name = "${monitorStatus.name === "monitor_status" ? "Offline" : `Example ${monitorStatus.name.replace(/_/g, " ")}`}"
}

output "${monitorStatus.name}_id" {
  description = "ID of the ${monitorStatus.name.replace(/_/g, " ")}"
  value       = data.${provider}_${monitorStatus.name}.example.id
}
`;

      await this.fileGenerator.writeFileInDir(
        "examples",
        "data-sources.tf",
        dataSourceExample,
      );
    }
  }

  private async generateReadme(): Promise<void> {
    const readmeContent: string = `# Terraform Provider for ${PROVIDER_DISPLAY_NAME}

${PROVIDER_DESCRIPTION}

## Requirements

- [Terraform](https://www.terraform.io/downloads.html) >= 1.0 **or** [OpenTofu](https://opentofu.org/docs/intro/install/) >= 1.6
- [Go](https://golang.org/doc/install) >= 1.21

## Building The Provider

1. Clone the repository
\`\`\`sh
git clone https://github.com/oneuptime/terraform-provider-${this.config.providerName}
cd terraform-provider-${this.config.providerName}
\`\`\`

2. Build the provider using the Go \`install\` command:
\`\`\`sh
go build
\`\`\`

## Using the Provider

\`\`\`terraform
terraform {
  required_providers {
    ${this.config.providerName} = {
      source  = "oneuptime/${this.config.providerName}"
      version = "~> ${this.majorVersion}.0"
    }
  }
}

provider "${this.config.providerName}" {
  oneuptime_url = "https://${this.config.providerName}.com" # or your self-hosted instance URL
  api_key       = var.${this.config.providerName}_api_key
}
\`\`\`

The source address carries no registry hostname on purpose: OpenTofu resolves it against \`registry.opentofu.org\` and Terraform against \`registry.terraform.io\`, and the provider is published to both. Drive it with \`tofu\` or \`terraform\` — see [docs/guides/opentofu.md](./docs/guides/opentofu.md).

## Reusable Modules

[\`modules/\`](./modules) holds hand-written, engine-agnostic HCL modules:

- [\`monitoring-and-incident-response\`](./modules/monitoring-and-incident-response) — HTTP monitors for a service, an on-call rotation paged when they fail, and a status page listing them.

\`\`\`terraform
module "storefront" {
  source = "github.com/OneUptime/terraform-provider-${this.config.providerName}//modules/monitoring-and-incident-response?ref=v${this.config.providerVersion}"

  service_name = "storefront"
  monitors     = { homepage = { url = "https://example.com" } }
}
\`\`\`

Pin \`ref\` to a published tag — this repository is regenerated on every release.

## Developing the Provider

If you wish to work on the provider, you'll first need [Go](http://www.golang.org) installed on your machine (see [Requirements](#requirements) above).

To compile the provider, run \`go build\`. This will build the provider and put the provider binary in the current directory.

To generate or update documentation, run \`go generate\`.

In order to run the full suite of Acceptance tests, run \`make testacc\`.

*Note:* Acceptance tests create real resources, and often cost money to run.

\`\`\`sh
make testacc
\`\`\`

## Local Installation

To install the provider locally for testing:

\`\`\`sh
make install
\`\`\`

This will build and install the provider to your local Terraform plugins directory.

## Testing

To run unit tests:

\`\`\`sh
go test ./...
\`\`\`

To run acceptance tests:

\`\`\`sh
TF_ACC=1 go test ./... -v -timeout 120m
\`\`\`

## Documentation

Documentation is generated using [terraform-plugin-docs](https://github.com/hashicorp/terraform-plugin-docs). Run the following command to generate documentation:

\`\`\`sh
go generate
\`\`\`

## Contributing

1. This is a read-only repository. The source code is generated from the OneUptime OpenAPI specification. You can check the main repository at [OneUptime](https://github.com/oneuptime/oneuptime). Please fork the main repository and make changes there.
2. Create your feature branch (\`git checkout -b feature/amazing-feature\`)
3. Commit your changes (\`git commit -am 'Add some amazing feature'\`)
4. Push to the branch (\`git push origin feature/amazing-feature\`)
5. Open a Pull Request

## License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.
`;

    await this.fileGenerator.writeFile("README.md", readmeContent);
  }

  /*
   * A string as an HCL literal: JSON's escapes are HCL's, and HCL would read
   * ${ and %{ as a template, so those are doubled.
   */
  public static hclString(value: string): string {
    return JSON.stringify(value).replace(/\$\{/g, "$${").replace(/%\{/g, "%%{");
  }

  private formatOpenAPIExample(example: any, _fieldType?: string): string {
    if (example === null || example === undefined) {
      return '""';
    }

    // Handle different types of examples
    if (typeof example === "string") {
      return DocumentationGenerator.hclString(example);
    }

    if (typeof example === "number") {
      return example.toString();
    }

    if (typeof example === "boolean") {
      return example.toString();
    }

    if (Array.isArray(example)) {
      if (example.length === 0) {
        return "[]";
      }
      const items: string[] = example.map((item: any) => {
        return this.formatOpenAPIExample(item, "string");
      });
      const itemsString: string = items.join(", ");
      return `[${itemsString}]`;
    }

    if (typeof example === "object") {
      // A OneUptime wrapper ({_type, value}) is written as its value.
      if (example._type && example.value !== undefined) {
        return DocumentationGenerator.hclString(String(example.value));
      }

      // Handle generic objects as maps
      const entries: [string, any][] = Object.entries(example);
      const entryStrings: string[] = entries.map(
        ([key, value]: [string, any]) => {
          return `    ${key} = ${this.formatOpenAPIExample(value, "string")}`;
        },
      );
      const entriesString: string = entryStrings.join("\n");
      return `{\n${entriesString}\n  }`;
    }

    // Fallback to string representation
    return DocumentationGenerator.hclString(String(example));
  }
}

import {
  TerraformProviderConfig,
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";
import { ResourceGenerator, SchemaFlags } from "./ResourceGenerator";
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

export class DocumentationGenerator {
  private config: TerraformProviderConfig;
  private spec: OpenAPISpec;
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
    this.spec = spec;
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
   * frontmatter `subcategory`; without it, 289 resources render as one flat
   * list. Order matters: first match wins.
   */
  private static readonly SUBCATEGORIES: Array<{
    pattern: RegExp;
    name: string;
  }> = [
    { pattern: /^monitor/, name: "Monitors" },
    { pattern: /probe/, name: "Probes" },
    { pattern: /^status_page/, name: "Status Pages" },
    { pattern: /^incident/, name: "Incidents" },
    { pattern: /^alert/, name: "Alerts" },
    {
      pattern: /^on_call|^escalation|schedule_layer|^user_override/,
      name: "On-Call & Escalation",
    },
    { pattern: /^scheduled_maintenance/, name: "Scheduled Maintenance" },
    { pattern: /^team|^user|^project|^api_key/, name: "Teams & Access" },
    { pattern: /^label|^custom_field|^file|^domain/, name: "Organization" },
    { pattern: /^workflow/, name: "Workflows" },
    {
      pattern: /^service|^telemetry|^dashboard|exception|^usage/,
      name: "Telemetry & Dashboards",
    },
    { pattern: /^copilot|^code_repository/, name: "Reliability Copilot" },
    { pattern: /log$|^span|^metric/, name: "Logs & Metrics" },
  ];

  private getSubcategory(name: string): string {
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
    this.copyModules();
    await this.generateReadme();
  }

  private async generateProviderDoc(): Promise<void> {
    const providerDoc: string = `---
page_title: "${this.config.providerName} Provider"
subcategory: ""
description: |-
  Terraform provider for ${StringUtils.capitalize(this.config.providerName)}.
---

# ${StringUtils.capitalize(this.config.providerName)} Provider

${this.spec.info.description || `Terraform provider for ${StringUtils.capitalize(this.config.providerName)}.`}

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

- \`api_key\` (String, Sensitive) Project-scoped API key for authentication. Falls back to the \`${StringUtils.toConstantCase(this.config.providerName)}_API_KEY\` environment variable; the provider fails at configure time when neither is set.
- \`oneuptime_url\` (String) The ${this.config.providerName} URL (without /api path). Defaults to 'oneuptime.com' if not specified. The provider automatically appends '/api' to the URL. Can also be set via the \`${StringUtils.toConstantCase(this.config.providerName)}_URL\` environment variable.

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

Writing \`source = "registry.terraform.io/oneuptime/${this.config.providerName}"\` pins the configuration to the Terraform Registry and breaks it under OpenTofu in registry-restricted environments.

## Differences worth knowing

| Topic | Behaviour |
|-------|-----------|
| The \`terraform\` block | Stays \`terraform\`. It is a language keyword, not a reference to the Terraform CLI. |
| \`.tf\` vs \`.tofu\` files | \`.tf\` works under both. OpenTofu also reads \`.tofu\` files and ignores any \`.tf\` file with a \`.tofu\` sibling. |
| \`required_version\` | OpenTofu's version series starts at 1.6.0, so a \`>= 1.5.0\` constraint written for Terraform is always satisfied. |
| Lock files | Both write \`.terraform.lock.hcl\`, but it records the registry it resolved against — one engine's lock file does not satisfy the other. |
| State files | Identical format and filenames; state moves between engines without conversion. |
| Variables | OpenTofu reads \`TF_VAR_*\` as well as \`TOFU_VAR_*\`. |

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
- Runnable examples: [\`Examples/opentofu/\`](https://github.com/OneUptime/oneuptime/tree/master/Examples/opentofu) in the main OneUptime repository
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
   * The provider index lists the resources whose name changed, with the
   * moved block that carries their state over.
   */
  private generateRenamedSection(): string {
    const renamed: Array<TerraformResource> = this.resources.filter(
      (resource: TerraformResource) => {
        return Boolean(resource.legacyName);
      },
    );

    if (renamed.length === 0) {
      return "";
    }

    const provider: string = this.config.providerName;

    return `
## Renamed resources

These resources were renamed so that names like IoT and vCenter read as one word. Each old name still works, as a deprecated alias, so no configuration breaks; plans that use one say so.

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
  from = ${provider}_${renamed[0]!.legacyName}.example
  to   = ${provider}_${renamed[0]!.name}.example
}
\`\`\`
`;
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
      : "";

    const importSection: string = resource.operations?.read
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
subcategory: "${this.getSubcategory(resource.name)}"
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

## Schema

${this.renderSchema(block.attributes)}

${importSection}`;
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
    const description: string = (
      dataSource.description || `${StringUtils.capitalize(label)} data source.`
    ).trim();

    const filters: Array<string> = Object.entries(dataSource.schema)
      .filter(([, attr]: [string, TerraformAttribute]) => {
        return Boolean(attr.isLookupFilter);
      })
      .map(([name]: [string, TerraformAttribute]) => {
        return name;
      });

    const byArgument: string | undefined = filters.includes("name")
      ? "name"
      : filters.find((name: string) => {
          return dataSource.schema[name]?.type === "string";
        }) || filters[0];

    const lookupExample: string = byArgument
      ? `data "${provider}_${dataSource.name}" "example" {
  ${StringUtils.toTerraformAttributeName(byArgument)} = ${this.getLookupExampleValue(byArgument, dataSource)}
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

    return `---
page_title: "${provider}_${dataSource.name} Data Source - ${provider}"
subcategory: "${this.getSubcategory(dataSource.name)}"
description: |-
  ${description}
---

# ${provider}_${dataSource.name} (Data Source)

${description}

Look one up by \`id\`, or by any of its other arguments: every argument you set must match, and exactly one ${label} may match them all - none, or more than one, is an error rather than an empty or arbitrary result.
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
    const readmeContent: string = `# Terraform Provider for ${StringUtils.capitalize(this.config.providerName)}

${this.spec.info.description || `Terraform provider for ${StringUtils.capitalize(this.config.providerName)}.`}

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

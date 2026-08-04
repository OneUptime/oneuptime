import { TerraformProviderConfig, OpenAPISpec } from "./Types";
import { FileGenerator } from "./FileGenerator";
import { StringUtils } from "./StringUtils";
import { OpenAPIParser } from "./OpenAPIParser";

export class DocumentationGenerator {
  private config: TerraformProviderConfig;
  private spec: OpenAPISpec;
  private fileGenerator: FileGenerator;

  public constructor(config: TerraformProviderConfig, spec: OpenAPISpec) {
    this.config = config;
    this.spec = spec;
    this.fileGenerator = new FileGenerator(config.outputDir);
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
      source = "oneuptime/${this.config.providerName}"
      version = "${this.config.providerVersion}"
    }
  }
}

provider "${this.config.providerName}" {
  oneuptime_url = "oneuptime.com"  # Optional, defaults to oneuptime.com (internally becomes oneuptime.com/api)
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

Every resource has a matching data source of the same name for looking up existing items by \`id\` or \`name\`.
`;

    await this.fileGenerator.writeFileInDir("docs", "index.md", providerDoc);
  }

  private async generateResourceDocs(): Promise<void> {
    // Create parser and get resources
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const resources: any[] = parser.getResources();

    this.fileGenerator.ensureDirectory("docs/resources");

    for (const resource of resources) {
      const resourceDoc: string = this.generateResourceDoc(resource);
      await this.fileGenerator.writeFileInDir(
        "docs/resources",
        `${resource.name}.md`,
        resourceDoc,
      );
    }
  }

  private async generateDataSourceDocs(): Promise<void> {
    // Create parser and get data sources
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const dataSources: any[] = parser.getDataSources();

    this.fileGenerator.ensureDirectory("docs/data-sources");

    for (const dataSource of dataSources) {
      const dataSourceDoc: string = this.generateDataSourceDoc(dataSource);
      await this.fileGenerator.writeFileInDir(
        "docs/data-sources",
        `${dataSource.name}.md`,
        dataSourceDoc,
      );
    }
  }

  private generateResourceDoc(resource: any): string {
    const resourceName: string = StringUtils.capitalize(
      resource.name.replace(/_/g, " "),
    );

    // Generate example based on required fields
    const exampleFields: string = this.generateExampleFields(resource);

    /*
     * Schema documentation, split Required / Optional / Read-Only like
     * tfplugindocs renders it.
     */
    const requiredItems: string[] = [];
    const optionalItems: string[] = [];
    const readOnlyItems: string[] = [];
    for (const [name, attr] of Object.entries(resource.schema)) {
      const attrInfo: any = attr as any;
      const sensitive: string = attrInfo.sensitive ? ", Sensitive" : "";
      const enumNote: string =
        Array.isArray(attrInfo.enumValues) && attrInfo.enumValues.length > 0
          ? ` Allowed values: ${attrInfo.enumValues
              .map((value: string) => {
                return `\`${value}\``;
              })
              .join(", ")}.`
          : "";
      const typeLabel: string = attrInfo.isMonitorSteps
        ? "Block List"
        : StringUtils.capitalize(attrInfo.type);
      const line: string = `- \`${name}\` (${typeLabel}${sensitive}) ${attrInfo.description || `${resourceName} ${name}`}.${enumNote}`;
      if (attrInfo.required) {
        requiredItems.push(line);
      } else if (attrInfo.computed && !attrInfo.optional) {
        readOnlyItems.push(line);
      } else {
        optionalItems.push(line);
      }
    }
    const schemaSections: string[] = [];
    if (requiredItems.length > 0) {
      schemaSections.push(`### Required\n\n${requiredItems.join("\n")}`);
    }
    if (optionalItems.length > 0) {
      schemaSections.push(`### Optional\n\n${optionalItems.join("\n")}`);
    }
    if (readOnlyItems.length > 0) {
      schemaSections.push(`### Read-Only\n\n${readOnlyItems.join("\n")}`);
    }

    const resourceDescription: string =
      resource.description || `${resourceName} resource.`;

    return `---
page_title: "${this.config.providerName}_${resource.name} Resource - ${this.config.providerName}"
subcategory: "${this.getSubcategory(resource.name)}"
description: |-
  ${resourceDescription}
---

# ${this.config.providerName}_${resource.name} (Resource)

${resourceDescription}

## Example Usage

\`\`\`terraform
resource "${this.config.providerName}_${resource.name}" "example" {
${exampleFields}
}
\`\`\`

## Schema

${schemaSections.join("\n\n")}

${
  resource.operations?.read
    ? `## Import

Import is supported using the following syntax:

\`\`\`shell
terraform import ${this.config.providerName}_${resource.name}.example <id>
\`\`\`
`
    : `## Import

This resource does not support import: the OneUptime API exposes no read endpoint for it.
`
}`;
  }

  private generateExampleFields(resource: any): string {
    const fields: string[] = [];

    // Add required fields first
    for (const [name, attr] of Object.entries(resource.schema)) {
      const attrInfo: any = attr as any;
      if (attrInfo.required && name !== "id") {
        const exampleValue: string = this.getExampleValue(name, attrInfo);
        fields.push(`  ${name} = ${exampleValue}`);
      }
    }

    /*
     * Add some common optional fields for better examples. Typed monitor
     * steps are the marquee attribute — always show the nested syntax.
     */
    for (const [name, attr] of Object.entries(resource.schema)) {
      const attrInfo: any = attr as any;
      const isCommonField: boolean = ["name", "description"].includes(name);
      if (
        !attrInfo.required &&
        !(attrInfo.computed && !attrInfo.optional) &&
        (isCommonField || attrInfo.isMonitorSteps)
      ) {
        const exampleValue: string = this.getExampleValue(name, attrInfo);
        fields.push(`  ${name} = ${exampleValue}`);
      }
    }

    return fields.join("\n");
  }

  private getExampleValue(fieldName: string, attrInfo: any): string {
    // Typed nested monitor steps: show the real nested syntax.
    if (attrInfo.isMonitorSteps) {
      return `[
    {
      monitor_destination      = "https://your-service.example.com"
      monitor_destination_type = "URL"
      request_type             = "GET"
      criteria = [
        {
          name             = "Check if online"
          filter_condition = "All"
          filters = [
            {
              check_on = "Is Online"
            }
          ]
        }
      ]
    }
  ]`;
    }

    // Enum-constrained fields: the first allowed value is always valid.
    if (Array.isArray(attrInfo.enumValues) && attrInfo.enumValues.length > 0) {
      return `"${attrInfo.enumValues[0]}"`;
    }

    // RFC3339 timestamp fields
    if (attrInfo.isDateTime) {
      return '"2030-01-01T00:00:00Z"';
    }

    /*
     * Complex nested objects are JSON strings in the schema — examples must
     * use jsonencode() or they will not apply.
     */
    if (attrInfo.type === "string" && attrInfo.isComplexObject) {
      if (
        attrInfo.example !== undefined &&
        attrInfo.example !== null &&
        typeof attrInfo.example === "object"
      ) {
        return `jsonencode(${JSON.stringify(attrInfo.example, null, 2)
          .split("\n")
          .join("\n  ")})`;
      }
      return "jsonencode({})";
    }

    // First, try to use the example from OpenAPI spec
    if (attrInfo.example !== undefined && attrInfo.example !== null) {
      return this.formatOpenAPIExample(attrInfo.example, attrInfo.type);
    }

    /*
     * Fallback to the existing hardcoded logic
     * Handle specific field types and names
     */
    if (fieldName.includes("id") && attrInfo.type === "string") {
      return '"123e4567-e89b-12d3-a456-426614174000"';
    }

    if (fieldName === "name") {
      return `"example-${this.getResourceNameFromSchema(attrInfo) || "resource"}"`;
    }

    if (fieldName === "description") {
      return `"Example ${this.getResourceNameFromSchema(attrInfo) || "resource"}"`;
    }

    if (fieldName === "color" && attrInfo.type === "map") {
      return `{\n    _type = "Color"\n    value = "#ff0000"\n  }`;
    }

    if (attrInfo.type === "map" || attrInfo.type === "object") {
      return `{\n    id = "123e4567-e89b-12d3-a456-426614174000"\n  }`;
    }

    switch (attrInfo.type) {
      case "string":
        return `"example-${fieldName}"`;
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
        return `"example-${fieldName}"`;
    }
  }

  private getResourceNameFromSchema(attrInfo: any): string | null {
    // Try to extract resource name from description or context
    if (attrInfo.description) {
      const desc: string = attrInfo.description.toLowerCase();
      // Look for patterns like "Example label" or "Label name"
      const match: RegExpMatchArray | null = desc.match(
        /example (\w+)|(\w+) name|(\w+) description/,
      );
      if (match) {
        return match[1] || match[2] || match[3] || null;
      }
    }
    return null;
  }

  private generateDataSourceDoc(dataSource: any): string {
    const dataSourceName: string = StringUtils.capitalize(
      dataSource.name.replace(/_/g, " "),
    );

    // Generate schema documentation
    const schemaItems: string[] = [];
    for (const [name, attr] of Object.entries(dataSource.schema)) {
      const attrInfo: any = attr as any;
      const required: string = attrInfo.required
        ? "Required"
        : attrInfo.computed
          ? "Computed"
          : "Optional";
      const sensitive: string = attrInfo.sensitive ? ", Sensitive" : "";
      schemaItems.push(
        `- \`${name}\` (${StringUtils.capitalize(attrInfo.type)}${sensitive}) ${attrInfo.description || `${dataSourceName} ${name}`}. ${required}.`,
      );
    }

    const dataSourceDescription: string =
      dataSource.description || `${dataSourceName} data source.`;

    return `---
page_title: "${this.config.providerName}_${dataSource.name} Data Source - ${this.config.providerName}"
subcategory: "${this.getSubcategory(dataSource.name)}"
description: |-
  ${dataSourceDescription}
---

# ${this.config.providerName}_${dataSource.name} (Data Source)

${dataSourceDescription} Look up by \`id\` or by \`name\` (must match exactly one item).

## Example Usage

Look up by \`name\` (must match exactly one item) or by \`id\`:

\`\`\`terraform
data "${this.config.providerName}_${dataSource.name}" "by_name" {
  name = "example-${dataSource.name}"
}

data "${this.config.providerName}_${dataSource.name}" "by_id" {
  id = "123e4567-e89b-12d3-a456-426614174000"
}
\`\`\`

## Schema

${schemaItems.join("\n")}
`;
  }

  private async generateExamples(): Promise<void> {
    this.fileGenerator.ensureDirectory("examples");

    // Generate provider example
    const providerExample: string = `terraform {
  required_providers {
    ${this.config.providerName} = {
      source = "oneuptime/${this.config.providerName}"
      version = "${this.config.providerVersion}"
    }
  }
}

provider "${this.config.providerName}" {
  oneuptime_url = "oneuptime.com" # Optional, defaults to oneuptime.com (provider appends /api automatically)
  api_key       = var.${this.config.providerName}_api_key
}

# Configure variables
variable "${this.config.providerName}_api_key" {
  description = "API key for ${this.config.providerName}"
  type        = string
  sensitive   = true
}
`;

    await this.fileGenerator.writeFileInDir(
      "examples",
      "provider.tf",
      providerExample,
    );

    // Generate resources example
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(this.spec);
    const resources: any[] = parser.getResources();

    if (resources.length > 0) {
      const firstResource: any = resources[0];
      if (firstResource) {
        const resourceExample: string = `# Example usage of ${this.config.providerName}_${firstResource.name} resource
resource "${this.config.providerName}_${firstResource.name}" "example" {
  name        = "example-${firstResource.name}"
  description = "Example ${firstResource.name} created by Terraform"
}

# Output the resource ID
output "${firstResource.name}_id" {
  description = "ID of the created ${firstResource.name}"
  value       = ${this.config.providerName}_${firstResource.name}.example.id
}
`;

        await this.fileGenerator.writeFileInDir(
          "examples",
          "resources.tf",
          resourceExample,
        );
      }
    }

    // Generate data sources example
    const dataSources: any[] = parser.getDataSources();

    if (dataSources.length > 0) {
      const firstDataSource: any = dataSources[0];
      if (firstDataSource) {
        const dataSourceExample: string = `# Example usage of ${this.config.providerName}_${firstDataSource.name} data source
data "${this.config.providerName}_${firstDataSource.name}" "example" {
  name = "example-${firstDataSource.name}"
}

# Output the data source result
output "${firstDataSource.name}_result" {
  description = "Result of the ${firstDataSource.name} data source"
  value       = data.${this.config.providerName}_${firstDataSource.name}.example
}
`;

        await this.fileGenerator.writeFileInDir(
          "examples",
          "data-sources.tf",
          dataSourceExample,
        );
      }
    }
  }

  private async generateReadme(): Promise<void> {
    const readmeContent: string = `# Terraform Provider for ${StringUtils.capitalize(this.config.providerName)}

${this.spec.info.description || `Terraform provider for ${StringUtils.capitalize(this.config.providerName)}.`}

## Requirements

- [Terraform](https://www.terraform.io/downloads.html) >= 1.0
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
      source = "oneuptime/${this.config.providerName}"
      version = "${this.config.providerVersion}"
    }
  }
}

provider "${this.config.providerName}" {
  oneuptime_url = "https://${this.config.providerName}.com" # or your self-hosted instance URL
  api_key       = var.${this.config.providerName}_api_key
}
\`\`\`

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

  private formatOpenAPIExample(example: any, _fieldType?: string): string {
    if (example === null || example === undefined) {
      return '""';
    }

    // Handle different types of examples
    if (typeof example === "string") {
      return `"${example}"`;
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
      // Handle special OneUptime object types
      if (example._type && example.value !== undefined) {
        switch (example._type) {
          case "DateTime":
            return `"${example.value}"`;
          case "Name":
          case "Email":
          case "Phone":
            return `"${example.value}"`;
          case "Color":
            return `"${example.value}"`;
          default:
            return `"${example.value}"`;
        }
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
    return `"${String(example)}"`;
  }
}

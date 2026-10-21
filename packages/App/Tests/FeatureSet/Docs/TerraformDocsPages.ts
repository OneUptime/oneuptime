/*
 * The Terraform pages, by the paths their suites name them with, and the
 * words they keep as the product writes them. Docs overhaul task 30a
 * rewrote the overview, quick start, complete guide, monitor steps and
 * examples; task 30b the importing, troubleshooting, self-hosted, registry
 * and OpenTofu pages, which complete the nav group.
 *
 * TerraformDocsFacts holds the English pages to the provider
 * (Scripts/TerraformProvider) and to the product, and
 * TerraformDocsTranslations holds every translation to its English page.
 * They read the page lists and the kept words from here, never from each
 * other: importing a .test.ts file runs its tests.
 */

export interface TerraformDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const TERRAFORM_OVERVIEW: string = "terraform/index";
export const QUICK_START: string = "terraform/quick-start";
export const COMPLETE_GUIDE: string = "terraform/complete-guide";
export const MONITOR_STEPS: string = "terraform/monitor-steps";
export const EXAMPLES: string = "terraform/examples";
export const IMPORTING_RESOURCES: string = "terraform/importing-resources";
export const TROUBLESHOOTING: string = "terraform/troubleshooting";
export const SELF_HOSTED: string = "terraform/self-hosted";
export const REGISTRY: string = "terraform/registry";
export const OPENTOFU: string = "terraform/opentofu";

// Every page of the group, in nav order.
export const TERRAFORM_PAGES: ReadonlyArray<TerraformDocsPageEntry> = [
  { page: TERRAFORM_OVERVIEW, navTitle: "Terraform Overview" },
  { page: QUICK_START, navTitle: "Quick Start" },
  { page: COMPLETE_GUIDE, navTitle: "Complete Guide" },
  { page: MONITOR_STEPS, navTitle: "Monitor Steps" },
  { page: EXAMPLES, navTitle: "Examples" },
  { page: IMPORTING_RESOURCES, navTitle: "Importing Resources" },
  { page: TROUBLESHOOTING, navTitle: "Troubleshooting" },
  { page: SELF_HOSTED, navTitle: "Self-Hosted Setup" },
  { page: REGISTRY, navTitle: "Registry Usage" },
  { page: OPENTOFU, navTitle: "OpenTofu" },
];

/*
 * The whole Terraform nav group: the pages above, in the same order. The
 * group's first page is where /docs/terraform lands (Utils/Redirects).
 */
export const TERRAFORM_GROUP_URLS: ReadonlyArray<string> = [
  "/docs/terraform/index",
  "/docs/terraform/quick-start",
  "/docs/terraform/complete-guide",
  "/docs/terraform/monitor-steps",
  "/docs/terraform/examples",
  "/docs/terraform/importing-resources",
  "/docs/terraform/troubleshooting",
  "/docs/terraform/self-hosted",
  "/docs/terraform/registry",
  "/docs/terraform/opentofu",
];

/*
 * A table's create button, drawn as translateCreateAction draws it
 * ("Create <singular name>").
 */
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [QUICK_START]: ["Create API Key"],
};

/*
 * A form field the Dashboard titles with "(Optional)", named on a page by
 * its title without it: the page's word, and the field's title.
 */
export const OPTIONAL_FIELDS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  [MONITOR_STEPS]: { "Field Path": "Field Path (Optional)" },
};

/*
 * What another product draws, kept as it writes it in every language:
 * GitHub's menu path to a repository's Actions secrets. GitHub draws it in
 * English.
 */
export const OTHER_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [COMPLETE_GUIDE]: ["Settings → Secrets and variables → Actions"],
};

/*
 * Tab labels a translation words in its own language: they describe a way
 * of doing something. Every other tab names a product or a system (Linux,
 * OpenTofu, GitHub Actions, Debian / Ubuntu) and keeps its name.
 */
export const TRANSLATED_TABS: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [COMPLETE_GUIDE]: ["Environment variable", "Terraform variable"],
  };

/*
 * Bold words that are emphasis or a list item's lead, not a Dashboard
 * label: a translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [TERRAFORM_OVERVIEW]: [
    "Terraform 1.5 or later, or OpenTofu 1.6 or later.",
    "An API key of your project.",
    "On OneUptime Cloud, the Growth plan or above.",
    "IDs inside a resource.",
    "What the server keeps up to date.",
  ],
  [QUICK_START]: [
    "Terraform 1.5 or later, or OpenTofu 1.6 or later.",
    "A OneUptime project",
    "On OneUptime Cloud, the Growth plan or above.",
  ],
  [COMPLETE_GUIDE]: [
    "One configuration for each project.",
    "Shared records once.",
    "Never edit the state by hand.",
    "Never commit `terraform.tfstate`, or a `.tfvars` file with a secret in it.",
    "Times are compared as instants.",
    "Defaults the server adds",
    "What the server keeps up to date",
  ],
  [MONITOR_STEPS]: [
    "Leave out what you do not use.",
    "Filter values are strings.",
    "Empty placeholders.",
    "A number where a string goes.",
    "The wrong destination type.",
    "A status change with no status.",
    "IDs.",
    "JSON written by hand.",
  ],
  [IMPORTING_RESOURCES]: [
    "Terraform 1.5 or later, or OpenTofu 1.6 or later.",
    "An API key that can read what you import.",
    "The provider in your configuration",
    "An import changes nothing, but the next apply does.",
    "Secrets are not read back.",
    "One configuration for each record.",
    "Imported records are managed records.",
  ],
  [TROUBLESHOOTING]: [
    "402 Payment Required on every request",
    "402 Payment Required",
    "Before you plan:",
    "When the state has lost a resource already:",
  ],
  [SELF_HOSTED]: ["Proxies.", "Plain HTTP."],
};

/*
 * How each page draws its diagrams: every one reads top to bottom, one part
 * under the next, so it fits the docs column.
 */
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [TERRAFORM_OVERVIEW]: "flowchart TB",
  [QUICK_START]: "flowchart TB",
  [COMPLETE_GUIDE]: "flowchart TB",
  [MONITOR_STEPS]: "flowchart TB",
  [EXAMPLES]: "flowchart TB",
  [IMPORTING_RESOURCES]: "flowchart TB",
  [TROUBLESHOOTING]: "flowchart TB",
  [SELF_HOSTED]: "flowchart TB",
  [REGISTRY]: "flowchart TB",
  [OPENTOFU]: "flowchart TB",
};

/*
 * What a page's HCL refers to without declaring it, and why: the reader's
 * own records a snippet builds on.
 */
export const UNDECLARED_REFERENCES: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  /*
   * The incident example is a criteria of a monitor: it pages the reader's
   * on-call policy with one of the reader's severities.
   */
  [MONITOR_STEPS]: [
    "oneuptime_incident_severity.critical",
    "oneuptime_on_call_policy.primary",
  ],
  /*
   * The aliases' keys: the prose says to declare them as sensitive
   * variables, as the block above them does.
   */
  [COMPLETE_GUIDE]: ["var.production_api_key", "var.staging_api_key"],
};

/*
 * The version constraints a page's terraform blocks may write besides
 * {{TERRAFORM_PROVIDER_VERSION}}: the self-hosted range, as the dashboard
 * writes it ({{TERRAFORM_PROVIDER_MATCHING}}), and the same range spelled
 * out for an example version.
 */
export const OTHER_VERSION_CONSTRAINTS: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  [SELF_HOSTED]: [
    "{{TERRAFORM_PROVIDER_MATCHING}}",
    ">= {{TERRAFORM_PROVIDER_MAJOR}}.0, <= {{TERRAFORM_PROVIDER_MAJOR}}.0.40",
  ],
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, formats and protocols. A line made of them alone is not a
 * line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "Terraform Registry",
  "OpenTofu Registry",
  "Terraform",
  "OpenTofu",
  "GitHub Actions",
  "GitHub Copilot",
  "GitHub",
  "GitLab CI",
  "GitLab",
  "Claude",
  "Cursor",
  "PowerShell",
  "PostgreSQL",
  "DynamoDB",
  "Docker Compose",
  "Helm",
  "Debian",
  "Ubuntu",
  "RHEL",
  "Fedora",
  "FreeBSD",
  "OpenBSD",
  "Solaris",
  "Linux",
  "macOS",
  "Windows",
  "Website",
  "Chromium",
  "Firefox",
  "Mobile",
  "Tablet",
  "Desktop",
  "MCP",
  "REST",
  "JSON",
  "HCL",
  "API",
  "CI/CD",
  "URL",
  "RFC 3339",
  "PEM",
  "TLS",
  "SSL",
  "SNMP",
  "NTP",
  "UDP",
  "TCP",
  "DNS",
  "DNSSEC",
  "HTTPS",
  "HTTP",
  "IoT",
  "vCenter",
  "S3",
  "CNAME",
];

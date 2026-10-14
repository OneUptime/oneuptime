/*
 * The CLI pages, by the paths their suites name them with, and the words
 * they keep as the product writes them.
 *
 * Docs overhaul task 29 rewrote these pages: CliDocsFacts holds the English
 * pages to the CLI (packages/CLI) and the API behind it, and
 * CliDocsTranslations holds every translation to its English page. They read
 * the page lists and the kept words from here, never from each other:
 * importing a .test.ts file runs its tests.
 */

export interface CliDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const CLI_OVERVIEW: string = "cli/index";
export const AUTHENTICATION: string = "cli/authentication";
export const RESOURCE_OPERATIONS: string = "cli/resource-operations";
export const OUTPUT_FORMATS: string = "cli/output-formats";
export const SCRIPTING: string = "cli/scripting";
export const COMMAND_REFERENCE: string = "cli/command-reference";

// The CLI nav group, page for page.
export const CLI_PAGES: ReadonlyArray<CliDocsPageEntry> = [
  { page: CLI_OVERVIEW, navTitle: "CLI Overview" },
  { page: AUTHENTICATION, navTitle: "Authentication" },
  { page: RESOURCE_OPERATIONS, navTitle: "Resource Operations" },
  { page: OUTPUT_FORMATS, navTitle: "Output Formats" },
  { page: SCRIPTING, navTitle: "Scripting & CI/CD" },
  { page: COMMAND_REFERENCE, navTitle: "Command Reference" },
];

/*
 * A table's create button, drawn as translateCreateAction draws it
 * ("Create <singular name>").
 */
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [CLI_OVERVIEW]: ["Create API Key"],
  [AUTHENTICATION]: ["Create API Key"],
};

// The plans the pages name: the Dashboard shows a plan's name as written.
export const PLAN_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [AUTHENTICATION]: ["Growth"],
};

/*
 * What another product draws, kept as it writes it in every language:
 * GitHub's menu path to a repository's Actions secrets. GitHub draws it in
 * English.
 */
export const OTHER_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [SCRIPTING]: ["Settings → Secrets and variables → Actions"],
};

/*
 * Bold words that are emphasis or a list item's lead, not a Dashboard
 * label: a translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [CLI_OVERVIEW]: [
    "Node.js and npm",
    "An API key of your project.",
    "On OneUptime Cloud, the Growth plan or above.",
  ],
};

/*
 * How each page draws its diagrams. The command reference draws the tree of
 * commands left to right, so its levels sit side by side; every other
 * diagram reads top to bottom, one step under the next.
 */
export const DIAGRAM_KINDS: Readonly<Record<string, string>> = {
  [CLI_OVERVIEW]: "flowchart TB",
  [AUTHENTICATION]: "flowchart TB",
  [RESOURCE_OPERATIONS]: "flowchart TB",
  [OUTPUT_FORMATS]: "flowchart TB",
  [SCRIPTING]: "flowchart TB",
  [COMMAND_REFERENCE]: "flowchart LR",
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, tools, formats and protocols. A line made of them alone is not a
 * line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "GitHub Actions",
  "GitHub",
  "GitLab CI",
  "GitLab",
  "Docker",
  "Terraform",
  "PowerShell",
  "Command Prompt",
  "Bash",
  "zsh",
  "Node.js",
  "npm",
  "Linux",
  "macOS",
  "Windows",
  "MCP",
  "REST",
  "JSON",
  "CSV",
  "UUID",
  "API",
  "CLI",
  "CI/CD",
  "URL",
  "LTS",
];

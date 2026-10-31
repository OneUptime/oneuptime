import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  COMPOSE_INSTALLED_AI_RESOURCE_TYPES,
  getHostAiAgentInstallCommand,
  getResourceAiAgentServiceName,
  getResourceAiAgentSettingsEnv,
} from "../../../FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import {
  CLOUD_AI_AGENT_ASK_FIRST_TITLE,
  CLOUD_AI_AGENT_FIX_SAFE_TITLE,
  CLOUD_SHELL_NAMES,
  getCloudAiAgentFixesMode,
  getCloudAiAgentLogsCommand,
  getDefaultCloudAiAgentSetupChoices,
} from "../../../FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetup";
import {
  AGENT_AI_FIXES_MODES,
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
  AI_INVESTIGATION_ENV,
  AgentAiFixesMode,
} from "Common/Types/AI/AgentAiSettings";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { TOOL_OUTPUT_PAGE_CHARS } from "Common/Types/AI/AIAgentRunLimits";
import {
  RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
} from "Common/Types/AI/ResourceAiAccessPermissions";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudAiAgentEnvironmentVariable,
  CloudAiAgentSetupOptions,
  getAwsCloudAiAgentTemplate,
  getCloudAiAgentEnvironment,
  getCloudAiAgentRolePermissions,
  getCloudAiAgentSetupCommand,
} from "Common/Types/CloudConnection/CloudAiAgentSetupCommands";
import { PermissionHelper } from "Common/Types/Permission";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  CLOUD_AI_RESOURCE_TYPES,
  isCloudAiResourceType,
  parseAiResourceType,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_CLUSTER_NAME,
  AWS_CLOUD_AI_AGENT_STACK_NAME,
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  AZURE_CLOUD_AI_AGENT_APP_NAME,
  AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
  GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID,
  GCP_CLOUD_AI_AGENT_SERVICE_NAME,
  getCloudAiAgentOwnTargets,
} from "Common/Types/ResourceAiAgent/CloudAiAgentNames";
import {
  DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
  MAX_POSTURE_LIST_ENTRIES,
  MAX_POSTURE_STRING_LENGTH,
  MAX_RESOURCE_AGENT_OUTPUT_BYTES,
  MAX_RESOURCE_COMMANDS_PER_INVESTIGATION,
  MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM,
  MAX_RESOURCE_COMMAND_TIMEOUT_MS,
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  RESOURCE_AI_AGENT_API_KEY_ENVS,
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_INGEST_PATH,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
  RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  ResourceCommandTier,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import {
  CLOUD_CATALOG_PROVIDER_NAMES,
  CLOUD_CHANGE_OPERATION_NAMES,
  CLOUD_DEFAULT_EVENT_HOURS,
  CLOUD_DEFAULT_LOG_MINUTES,
  CLOUD_DEFAULT_ROW_LIMIT,
  CLOUD_DRY_RUN_OPERATION,
  CLOUD_DRY_RUN_OPERATION_NAME,
  CLOUD_MAX_EVENT_HOURS,
  CLOUD_MAX_LOG_MINUTES,
  CLOUD_MAX_ROW_LIMIT,
  CLOUD_OPERATIONS,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudOperationKindSpec,
  CloudOperationSpec,
  CloudResourceKindSpec,
  CloudUndoResult,
  describeCloudOperationUsage,
  getCloudOperation,
  getCloudReadCommandGuide,
  getCloudResourceKind,
  getCloudUndoCommand,
  getCloudWriteCommandGuide,
  isCloudChangeOperation,
  isCloudDryRun,
  isCloudOperationAvailable,
  parseCloudCommand,
  parseCloudResourceId,
} from "Common/Utils/AiRemediation/Resource/CloudOperationCatalog";
import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
  RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  RESOURCE_SHELL_SYNTAX_RULE,
  ResourceCommandPolicyResult,
} from "Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Infrastructure AI Agents" docs page (and the short "AI agent"
 * sections of each resource's telemetry page) against the code they
 * describe.
 *
 * Markdown is not compiled, so nothing else notices when a resource type
 * is added, an environment variable renamed, the health port moved, a
 * collector's compose service renamed, or the command policy re-tiers a
 * command the page promises. Each test reads the source of truth — the
 * shared contract (Common/Types/ResourceAiAgent), the command policy, the
 * compose files and install scripts under agents/, the agent's own source,
 * the nav and the locales — and checks the page still tells the same story.
 *
 * The strongest pins are the command lists: every command the page writes
 * out in a resource's "What an investigation may run" section must be a
 * Read for that resource, and every command in its "Fixes on …" table must
 * have the tier its row claims (Safe, Riskier, Always a person, Never),
 * evaluated by the same ResourceCommandPolicy OneUptime and the agent
 * enforce.
 *
 * Cloud accounts (an AWS account, an Azure subscription, a Google Cloud
 * project) run no program: their commands are operations of the closed
 * cloud catalog (CloudOperationCatalog), each naming one resource by an id
 * of its own cloud. So their sections are held to the catalog itself: the
 * reads as the guide the AI is given writes them, and every change with
 * its tier on each kind of resource, cloud by cloud. Their agent runs in
 * the account, set up with one command from the account's page, so it has
 * no compose file and no collector page: its telemetry page is Connect a
 * Cloud Account.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_DIR: string = path.join(REPO_ROOT, "packages/App/FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const LOCALES_DIR: string = path.join(DOCS_DIR, "Locales");
const AGENTS_DIR: string = path.join(REPO_ROOT, "agents");
// The docs show OneUptime Cloud's address; a self-hosted reader puts theirs.
const DOCS_ONEUPTIME_URL: string = "https://oneuptime.com";
const RESOURCE_AGENT_DIR: string = path.join(AGENTS_DIR, "ResourceAIAgent");
const COMMON_DIR: string = path.join(REPO_ROOT, "packages/Common");

const PAGE: string = "ai/infrastructure-ai-agents";
const PAGE_URL: string = `/docs/${PAGE}`;
const PAGE_TITLE: string = "Infrastructure AI Agents";
const AI_SRE_PAGE: string = "ai/ai-sre";

const IMAGE: string = `${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:release`;

const FENCE_LINE: RegExp = /^\s*```/;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const ENV_TOKEN: RegExp = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const COMPOSE_SERVICE_LINE: RegExp = /^ {2}([a-z0-9][a-z0-9-]*):\s*$/;
// A compose key that ends the services block (volumes:, networks:, ...).
const TOP_LEVEL_LINE: RegExp = /^\S/;
const DROPS_ALL_CAPABILITIES: RegExp = /cap_drop:\s*\n\s*- ALL/;
// A compose service on the host's network (a commented-out line is not).
const HOST_NETWORK_LINE: RegExp = /^\s*network_mode: host\s*$/m;
// The appliance promised as protected with no condition attached.
const UNCONDITIONAL_APPLIANCE: RegExp =
  /never changes the vCenter appliance itself[;.]/;
const A_MINUTE: RegExp = /\ba minute\b/;
const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
const HEADING_LINE: RegExp = /^#{1,6} \S/;
// `export const NAME: string = "value";`, the value on the same or the next line.
const STRING_CONSTANT: RegExp =
  /export const ([A-Z][A-Z0-9_]*): string =\s*"([^"\n]*)";/g;

/*
 * Which resource types each per-resource section of the page speaks for.
 * Docker and Podman hosts share one engine policy, so one section, and the
 * three clouds share the cloud catalog, so one section too.
 */
interface ResourceSection {
  // The "What an investigation may run" subsection.
  title: string;
  // The "How fixes work" subsection with the type's fix table.
  fixesHeading: string;
  types: Array<AiResourceType>;
}

const RESOURCE_SECTIONS: ReadonlyArray<ResourceSection> = [
  {
    title: "Docker and Podman hosts",
    fixesHeading: "### Fixes on Docker and Podman hosts",
    types: [AiResourceType.DockerHost, AiResourceType.PodmanHost],
  },
  {
    title: "Docker Swarm clusters",
    fixesHeading: "### Fixes on Docker Swarm clusters",
    types: [AiResourceType.DockerSwarmCluster],
  },
  {
    title: "Proxmox clusters",
    fixesHeading: "### Fixes on Proxmox clusters",
    types: [AiResourceType.ProxmoxCluster],
  },
  {
    title: "VMware vCenter",
    fixesHeading: "### Fixes on VMware vCenter",
    types: [AiResourceType.VMwareVCenter],
  },
  {
    title: "Ceph clusters",
    fixesHeading: "### Fixes on Ceph clusters",
    types: [AiResourceType.CephCluster],
  },
  {
    title: "Database servers",
    fixesHeading: "### Fixes on database servers",
    types: [AiResourceType.DatabaseServer],
  },
  {
    title: "Hosts",
    fixesHeading: "### Fixes on hosts",
    types: [AiResourceType.Host],
  },
  {
    title: "Cloud accounts",
    fixesHeading: "### Fixes on cloud accounts",
    types: [...CLOUD_AI_RESOURCE_TYPES],
  },
];

/*
 * The sections whose commands are a program's argv, tiered command by
 * command: every section but the cloud accounts', whose catalog the cloud
 * tests below hold it to.
 */
const COMMAND_SECTIONS: ReadonlyArray<ResourceSection> =
  RESOURCE_SECTIONS.filter((resource: ResourceSection): boolean => {
    return !resource.types.some((type: AiResourceType): boolean => {
      return isCloudAiResourceType(type);
    });
  });

const CLOUD_SECTION: ResourceSection = RESOURCE_SECTIONS.find(
  (resource: ResourceSection): boolean => {
    return resource.types.includes(AiResourceType.AwsAccount);
  },
) as ResourceSection;

/*
 * The telemetry page of each resource type, which carries a "## AI agent"
 * section. A cloud account's is the page it is connected on, Connect a
 * Cloud Account, whose "## Let AI fix problems" section is its AI agent's.
 */
const TELEMETRY_PAGES: Readonly<Record<AiResourceType, string>> = {
  [AiResourceType.DockerHost]: "telemetry/docker-host",
  [AiResourceType.PodmanHost]: "telemetry/podman-host",
  [AiResourceType.DockerSwarmCluster]: "telemetry/docker-swarm",
  [AiResourceType.ProxmoxCluster]: "telemetry/proxmox",
  [AiResourceType.VMwareVCenter]: "telemetry/vmware",
  [AiResourceType.CephCluster]: "telemetry/ceph",
  [AiResourceType.DatabaseServer]: "telemetry/databases",
  [AiResourceType.Host]: "telemetry/host-otel-collector",
  [AiResourceType.AwsAccount]: "telemetry/cloud-accounts",
  [AiResourceType.AzureSubscription]: "telemetry/cloud-accounts",
  [AiResourceType.GoogleCloudProject]: "telemetry/cloud-accounts",
};

const CLOUD_ACCOUNTS_PAGE: string = TELEMETRY_PAGES[AiResourceType.AwsAccount];

/*
 * Where each type's AI agent service ships. A cloud account's Cloud AI
 * agent has none: it runs in the account itself, set up with one command
 * from the account's page (CloudAiAgentSetupCommands), so its entry is
 * null, and every check of a compose file below leaves it out.
 */
const COMPOSE_FILES: Readonly<Record<AiResourceType, string | null>> = {
  [AiResourceType.DockerHost]: "agents/DockerAgent/docker-compose.yml",
  [AiResourceType.PodmanHost]: "agents/PodmanAgent/docker-compose.yml",
  [AiResourceType.DockerSwarmCluster]:
    "agents/DockerSwarmAgent/docker-compose.yml",
  [AiResourceType.ProxmoxCluster]: "agents/ProxmoxAgent/docker-compose.yml",
  [AiResourceType.VMwareVCenter]: "agents/VMwareAgent/docker-compose.yml",
  [AiResourceType.CephCluster]: "agents/CephAgent/docker-compose.yml",
  [AiResourceType.DatabaseServer]: "agents/DatabaseAgent/docker-compose.yml",
  [AiResourceType.Host]: "agents/HostAIAgent/docker-compose.yml",
  [AiResourceType.AwsAccount]: null,
  [AiResourceType.AzureSubscription]: null,
  [AiResourceType.GoogleCloudProject]: null,
};

// The types whose agent a compose file runs: all but the cloud accounts.
const COMPOSE_TYPES: ReadonlyArray<AiResourceType> =
  ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
    return COMPOSE_FILES[type] !== null;
  });

// The clouds, each by the provider its setup command and catalog name it.
const CLOUD_PROVIDERS: ReadonlyArray<{
  type: AiResourceType;
  provider: CloudProvider;
  catalog: CloudCatalogProvider;
}> = [
  {
    type: AiResourceType.AwsAccount,
    provider: CloudProvider.AWS,
    catalog: "aws",
  },
  {
    type: AiResourceType.AzureSubscription,
    provider: CloudProvider.Azure,
    catalog: "azure",
  },
  {
    type: AiResourceType.GoogleCloudProject,
    provider: CloudProvider.GCP,
    catalog: "gcp",
  },
];

/*
 * The resource ids the page's cloud sections write, one per cloud: the
 * ones the AI agent page's allowlist examples name too.
 */
const CLOUD_EXAMPLE_IDS: Readonly<Record<CloudCatalogProvider, string>> = {
  aws: "arn:aws:ecs:us-east-1:123456789012:service/prod/web",
  azure:
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Web/sites/web",
  gcp: "//run.googleapis.com/projects/my-project/locations/us-central1/services/web",
};

// A cloud account's ids, as its setup command takes them.
const CLOUD_ACCOUNT_IDS: Readonly<Record<CloudCatalogProvider, string>> = {
  aws: "123456789012",
  azure: "00000000-0000-0000-0000-000000000000",
  gcp: "my-project",
};

// The rows of a "Fixes on …" table, and what each promises.
enum FixRow {
  Safe = "**Safe**",
  Riskier = "**Riskier**",
  AlwaysAPerson = "**Always a person**",
  Never = "**Never**",
}

function pageFile(relative: string, language: string = "en"): string {
  return path.join(CONTENT_DIR, language, `${relative}.md`);
}

function readPage(relative: string, language: string = "en"): string {
  return fs.readFileSync(pageFile(relative, language), "utf8");
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

// Lines outside fenced code blocks, so a `#` comment is never a heading.
function proseLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      lines.push(line);
    }
  }

  return lines;
}

function getHeadings(markdown: string): Array<string> {
  return proseLines(markdown).filter((line: string): boolean => {
    return HEADING_LINE.test(line);
  });
}

function headingSlugs(markdown: string): Set<string> {
  return new Set<string>(
    getHeadings(markdown).map((heading: string): string => {
      return slugify(heading.replace(/^#+ /, ""));
    }),
  );
}

/*
 * The body of one heading's section, up to the next heading of the same or
 * a higher level (fenced blocks included, their `#` lines ignored).
 */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

function codeSpans(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * A markdown table row's cells, without the outer pipes. A pipe inside a
 * cell is escaped (\\|), as GFM tables require even inside code spans.
 */
function tableCells(row: string): Array<string> {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell: string): string => {
      return cell.trim().replace(/\\\|/g, "|");
    });
}

// The table row whose first cell is exactly `label`.
function tableRow(markdown: string, label: string): string {
  const row: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return line.startsWith(`| ${label} `) || line.startsWith(`| ${label}|`);
    });

  expect({ label, found: row !== undefined }).toEqual({ label, found: true });

  return row as string;
}

/*
 * The commands a stretch of markdown writes out for a resource type: every
 * code span of at least two words whose first word is one of the type's
 * programs. Single words (`docker`, `uptime`) and flags are prose.
 */
function commandsFor(markdown: string, type: AiResourceType): Array<string> {
  const programs: ReadonlyArray<string> = AI_RESOURCE_TYPE_INFO[type].programs;

  return codeSpans(markdown).filter((span: string): boolean => {
    const words: Array<string> = span.trim().split(/\s+/);
    return words.length >= 2 && programs.includes(words[0] as string);
  });
}

function evaluate(
  type: AiResourceType,
  command: string,
): ResourceCommandPolicyResult {
  return ResourceCommandPolicy.evaluateCommand({ resourceType: type, command });
}

function readSourceTree(directory: string): Array<string> {
  const texts: Array<string> = [];

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!["node_modules", "build", "Tests"].includes(entry.name)) {
          walk(full);
        }
      } else if (entry.name.endsWith(".ts")) {
        texts.push(fs.readFileSync(full, "utf8"));
      }
    }
  };

  walk(directory);
  return texts;
}

/*
 * The agent's source (its Common copies included) with every `${NAME}` of
 * a string constant replaced by the constant's value, so a message such as
 * `${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV} is not set` can be searched for
 * as the operator reads it.
 */
function renderedAgentSource(): string {
  const texts: Array<string> = readSourceTree(RESOURCE_AGENT_DIR);
  const constants: Map<string, string> = new Map<string, string>();

  for (const text of texts) {
    for (const match of text.matchAll(STRING_CONSTANT)) {
      constants.set(match[1] as string, match[2] as string);
    }
  }

  return texts
    .join("\n")
    .replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (whole: string, name: string) => {
      return constants.get(name) ?? whole;
    });
}

// A compose file's services, each as the text of its block.
function composeServices(relative: string): Map<string, string> {
  const services: Map<string, string> = new Map<string, string>();
  let current: string | null = null;
  let lines: Array<string> = [];

  const flush: () => void = (): void => {
    if (current) {
      services.set(current, lines.join("\n"));
    }
  };

  for (const line of readRepoFile(relative).split("\n")) {
    const service: RegExpMatchArray | null = line.match(COMPOSE_SERVICE_LINE);

    if (service) {
      flush();
      current = service[1] as string;
      lines = [];
      continue;
    }

    if (TOP_LEVEL_LINE.test(line)) {
      flush();
      current = null;
      lines = [];
      continue;
    }

    lines.push(line);
  }

  flush();
  return services;
}

function allNavLinks(): Array<NavLink> {
  return DocsNav.flatMap((group: NavGroup): Array<NavLink> => {
    return group.links;
  });
}

function infoOf(type: AiResourceType): AiResourceTypeInfo {
  return AI_RESOURCE_TYPE_INFO[type];
}

// The compose file a type's AI agent ships in; a cloud account has none.
function composeFileOf(type: AiResourceType): string {
  const file: string | null = COMPOSE_FILES[type];

  if (file === null) {
    throw new Error(`${type} has no compose file: its agent runs in its cloud`);
  }

  return file;
}

// A text on one line: a paragraph or a source statement, unwrapped.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The options a cloud's setup command is written from, for one account.
function cloudSetupOptions(
  provider: CloudProvider,
  catalog: CloudCatalogProvider,
  changes: Partial<CloudAiAgentSetupOptions> = {},
): CloudAiAgentSetupOptions {
  return {
    provider,
    oneuptimeUrl: "https://oneuptime.com",
    ingestionKey: "ingestion-key",
    cloudAccountId: "11111111-1111-1111-1111-111111111111",
    accountId: CLOUD_ACCOUNT_IDS[catalog],
    fixesMode: "RequireApproval",
    ...changes,
  };
}

/*
 * How a fix table names a tier: the policy's SafeWrite is "Safe", a
 * RiskyWrite a person must approve is "Always a person", any other
 * RiskyWrite "Riskier".
 */
function cloudTierWord(spec: CloudOperationKindSpec): string {
  if (spec.requiresHuman) {
    return "Always a person";
  }

  return spec.tier === ResourceCommandTier.SafeWrite ? "Safe" : "Riskier";
}

/*
 * The cell of "Fixes on cloud accounts" for one change on one cloud, from
 * the catalog: the tier, then the kinds of resource it works on, or "—"
 * where the cloud has no such change.
 */
function expectedCloudFixCell(
  operation: CloudOperationSpec,
  catalog: CloudCatalogProvider,
): string {
  const specs: Array<CloudOperationKindSpec> = operation.kinds.filter(
    (spec: CloudOperationKindSpec): boolean => {
      return spec.provider === catalog;
    },
  );

  if (specs.length === 0) {
    return "—";
  }

  const tiers: Set<string> = new Set<string>(specs.map(cloudTierWord));

  // One tier per cloud is what one cell can say.
  expect({ operation: operation.name, catalog, tiers: tiers.size }).toEqual({
    operation: operation.name,
    catalog,
    tiers: 1,
  });

  return `${[...tiers][0]}: ${specs
    .map((spec: CloudOperationKindSpec): string => {
      const kind: CloudResourceKindSpec | null = getCloudResourceKind(
        catalog,
        spec.kind,
      );

      return kind ? kind.displayName : spec.kind;
    })
    .join(", ")}`;
}

// "a, b, c or d", as the page lists names.
function listWithOr(names: ReadonlyArray<string>): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

const page: string = readPage(PAGE);

describe("Infrastructure AI Agents docs", (): void => {
  describe("the page", (): void => {
    it("ships in English and opens with the nav's title", (): void => {
      expect(fs.existsSync(pageFile(PAGE))).toBe(true);
      expect(page.split("\n")[0]).toBe(`# ${PAGE_TITLE}`);
    });

    it("keeps every code fence closed", (): void => {
      const fences: number = page.split("\n").filter((line: string) => {
        return FENCE_LINE.test(line);
      }).length;

      expect(fences % 2).toBe(0);
    });

    /*
     * The resource's AI section, as the side menu has it: Insights (what AI
     * learned, what deserves attention), Logs (everything AI did — the page
     * that used to be called Insights) and AI agent.
     */
    it("names the AI section's three pages in the side menu's order", (): void => {
      const pageBullet: RegExp = /^- \*\*(Insights|Logs|AI agent)\*\* — /;
      const bullets: Array<string> = page
        .split("\n")
        .filter((line: string): boolean => {
          return pageBullet.test(line);
        });

      expect(page).toContain(
        "Each resource's dashboard page has an **AI** section with three pages:",
      );
      expect(
        bullets.map((line: string): string => {
          return line.split(" — ")[0]!;
        }),
      ).toEqual(["- **Insights**", "- **Logs**", "- **AI agent**"]);
      expect(bullets[0]).toContain(
        "what OneUptime AI found out about the resource in the last 30 days: the problems that keep coming back and why",
      );
      // What AI did is the footnote, not the headline.
      expect(bullets[0]).toContain(
        "with what AI itself did there as a footnote",
      );
      expect(bullets[0]).toContain(
        "[What AI learned on a cluster](/docs/ai/ai-sre#what-ai-learned-on-a-cluster)",
      );
      expect(bullets[1]).toContain(
        "everything OneUptime AI did on the resource, newest first",
      );
      expect(bullets[1]).toContain("every command it sent through the agent");
      expect(bullets[1]).toContain("(This page used to be called Insights.)");
      // The chronological list is Logs', never Insights'.
      expect(bullets[0]).not.toContain("every command it sent");
    });

    it("gives every heading a distinct anchor", (): void => {
      const slugs: Array<string> = getHeadings(page).map(
        (heading: string): string => {
          return slugify(heading.replace(/^#+ /, ""));
        },
      );

      expect(new Set<string>(slugs).size).toBe(slugs.length);
    });

    it("only links to /docs/ pages that exist, and to headings those pages have", (): void => {
      const pages: Array<string> = [
        PAGE,
        AI_SRE_PAGE,
        ...Object.values(TELEMETRY_PAGES),
      ];

      for (const source of pages) {
        const markdown: string = readPage(source);

        for (const match of markdown.matchAll(
          /\]\((\/docs\/[^)#\s]+)(#[^)\s]+)?\)/g,
        )) {
          const target: string = (match[1] as string).replace("/docs/", "");

          // Screenshots are assets under Docs/Static, not pages.
          if (target.startsWith("static/")) {
            continue;
          }

          const exists: boolean = fs.existsSync(pageFile(target));

          expect({ source, target, exists }).toEqual({
            source,
            target,
            exists: true,
          });

          if (match[2] && exists) {
            const anchor: string = (match[2] as string).slice(1);

            expect({
              source,
              link: `${match[1]}${match[2]}`,
              resolves: headingSlugs(readPage(target)).has(anchor),
            }).toEqual({
              source,
              link: `${match[1]}${match[2]}`,
              resolves: true,
            });
          }
        }
      }
    });

    it("only uses in-page anchors that a heading on the page produces", (): void => {
      const slugs: Set<string> = headingSlugs(page);

      for (const match of page.matchAll(/\]\(#([^)\s]+)\)/g)) {
        expect({
          anchor: match[1],
          resolves: slugs.has(match[1] as string),
        }).toEqual({ anchor: match[1], resolves: true });
      }
    });

    it("covers install, what may run, fixes, write access, credentials, security and troubleshooting", (): void => {
      for (const heading of [
        "## How it relates to the Kubernetes AI agent",
        "## Supported resources",
        "## Installing an AI agent",
        "### Next to a collector",
        "### Host AI agent",
        "### In a cloud account",
        "### Connecting to OneUptime",
        "## What an investigation may run",
        "## How fixes work",
        "### Fix modes",
        "### Fixes on cloud accounts",
        "### The command allowlist",
        "### Who may change it",
        "## Write access on the agent",
        "### Write targets per resource",
        "### What the agent protects on its own",
        "## Credentials and least privilege",
        "## Security model",
        "### Three enforcement points",
        "### The Docker socket and the Host AI agent are root on the host",
        "## Troubleshooting",
      ]) {
        expect({
          heading,
          present: getHeadings(page).includes(heading),
        }).toEqual({ heading, present: true });
      }
    });

    it("says what is not covered: one Cloud AI agent per account, and a proposal, not a pull request, for a resource declared as code", (): void => {
      const notCovered: string = oneLine(
        section(page, "## What is not covered"),
      );
      const registration: string = oneLine(
        readRepoFile(
          "packages/Common/Server/Services/ResourceAiAgentService.ts",
        ),
      );

      // Cloud resources are covered now, through their account's agent.
      expect(notCovered).not.toContain("other cloud resources");
      expect(notCovered).toContain(
        "One Cloud AI agent serves one AWS account, Azure subscription or Google Cloud project, and there is no agent for a whole AWS Organization: a connection that reads an organization or a tenant needs an agent in each account, subscription or project AI should fix.",
      );
      expect(notCovered).toContain(
        "A fix to a resource declared as code stays a proposal: OneUptime AI opens no pull request against that code.",
      );
      expect(notCovered).toContain(
        "IoT fleets and network devices have no AI agent",
      );
      // An agent binds to the one account its cloud names.
      expect(registration).toContain(
        "const account: CloudAccount | null = await CloudAccountService.findAccount({ projectId: data.projectId, provider: provider as CloudProvider, accountId: identifier, });",
      );
    });
  });

  describe("navigation", (): void => {
    it("lists the page in the AI group, right after AI SRE", (): void => {
      const ai: NavGroup | undefined = DocsNav.find(
        (group: NavGroup): boolean => {
          return group.title === "AI";
        },
      );

      expect(ai).toBeDefined();

      const links: Array<NavLink> = (ai as NavGroup).links;
      const index: number = links.findIndex((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      });

      expect(index).toBeGreaterThan(0);
      expect(links[index]?.title).toBe(PAGE_TITLE);
      expect(links[index - 1]?.url).toBe(`/docs/${AI_SRE_PAGE}`);
    });

    /*
     * Docs/Index.ts serves a request from the FIRST nav link whose URL
     * contains the requested path: no earlier link may contain this page's
     * path, and this URL may contain no later page's path.
     */
    it("is the link the docs router resolves the page to, and steals no other page", (): void => {
      const links: Array<NavLink> = allNavLinks();
      const resolved: NavLink | undefined = links.find(
        (link: NavLink): boolean => {
          return link.url.toLocaleLowerCase().includes(PAGE);
        },
      );

      expect(resolved?.url).toBe(PAGE_URL);

      for (const link of links) {
        if (link.url === PAGE_URL || !link.url.startsWith("/docs/")) {
          continue;
        }

        const linkPath: string = link.url.replace("/docs/", "");

        expect({ url: link.url, stolen: PAGE_URL.includes(linkPath) }).toEqual({
          url: link.url,
          stolen: false,
        });
      }
    });

    it("has a nav title in every docs locale", (): void => {
      const locales: Array<string> = fs
        .readdirSync(LOCALES_DIR)
        .filter((file: string): boolean => {
          return file.endsWith(".json");
        });

      expect(locales.length).toBeGreaterThan(1);

      for (const file of locales) {
        const locale: { navLinks: Record<string, string> } = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
        );
        const title: string | undefined = locale.navLinks[PAGE_TITLE];

        expect({ file, hasTitle: Boolean(title && title.trim()) }).toEqual({
          file,
          hasTitle: true,
        });
      }
    });
  });

  describe("the shared contract", (): void => {
    it("names every resource type, its agent and its agent alias", (): void => {
      const supported: string = section(page, "## Supported resources");

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const info: AiResourceTypeInfo = infoOf(type);

        expect({
          type,
          displayName: supported.includes(info.displayName),
        }).toEqual({ type, displayName: true });
        expect({ type, agent: page.includes(info.agentDisplayName) }).toEqual({
          type,
          agent: true,
        });
        expect({
          type,
          alias: supported.includes(`\`${info.agentAlias}\``),
        }).toEqual({ type, alias: true });
      }
    });

    it("gives each resource type its own row, with its alias, identity variables and programs", (): void => {
      const supported: string = section(page, "## Supported resources");

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const info: AiResourceTypeInfo = infoOf(type);
        const cells: Array<string> = tableCells(
          tableRow(supported, info.displayName),
        );

        expect(cells[1]).toContain(`\`${info.agentAlias}\``);
        expect(cells[2]).toBe(info.agentDisplayName);

        for (const variable of info.identityEnvVars) {
          expect({
            type,
            variable,
            named: cells[3]?.includes(`\`${variable}\``),
          }).toEqual({ type, variable, named: true });
        }

        const runs: Array<string> = codeSpans(cells[4] as string);

        for (const program of info.programs) {
          expect({ type, program, named: runs.includes(program) }).toEqual({
            type,
            program,
            named: true,
          });
        }
      }
    });

    it("only offers aliases the agent accepts, each for its own row's type", (): void => {
      const supported: string = section(page, "## Supported resources");

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const aliasCell: string = tableCells(
          tableRow(supported, infoOf(type).displayName),
        )[1] as string;

        const aliases: Array<string> = codeSpans(aliasCell);

        expect(aliases.length).toBeGreaterThan(0);

        for (const alias of aliases) {
          expect({ alias, type: parseAiResourceType(alias) }).toEqual({
            alias,
            type,
          });
        }
      }
    });

    it("lists exactly the commands Test connection runs, for each resource type", (): void => {
      const supported: string = section(page, "## Supported resources");
      const table: string = supported.slice(
        supported.indexOf("| Test connection runs"),
      );

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const info: AiResourceTypeInfo = infoOf(type);
        const cell: string = tableCells(
          tableRow(table, info.displayName),
        )[1] as string;

        expect({ type, commands: codeSpans(cell) }).toEqual({
          type,
          commands: [...info.testCommands],
        });
      }
    });

    it("names the environment variables the agent reads exactly as the contract spells them", (): void => {
      for (const name of [
        RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
        RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
        RESOURCE_AI_ALLOW_WRITES_ENV,
        RESOURCE_AI_WRITE_TARGETS_ENV,
        "ONEUPTIME_AI_PROTECTED_TARGETS",
        ...RESOURCE_AI_AGENT_API_KEY_ENVS,
        // A Cloud AI agent's own, which its setup command sets.
        RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV,
        RESOURCE_AI_CLOUD_OPERATIONS_ENV,
        RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
        RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
      ]) {
        expect({ name, named: page.includes(`\`${name}\``) }).toEqual({
          name,
          named: true,
        });
      }

      // The protected-targets variable is the agent's own, not the contract's.
      expect(readRepoFile("agents/ResourceAIAgent/Config.ts")).toContain(
        'PROTECTED_TARGETS_ENV: string = "ONEUPTIME_AI_PROTECTED_TARGETS"',
      );

      // The key variables, in the order the agent tries them.
      const keys: string = RESOURCE_AI_AGENT_API_KEY_ENVS.map(
        (name: string): string => {
          return `\`${name}\``;
        },
      ).join(", ");

      expect(page).toContain(keys.replace(/, (`[^`]+`)$/, " and $1"));
    });

    it("names the image, and only with a published tag", (): void => {
      expect(page).toContain(`\`${IMAGE}\``);

      for (const source of [
        PAGE,
        AI_SRE_PAGE,
        ...Object.values(TELEMETRY_PAGES),
      ]) {
        const markdown: string = readPage(source);

        for (const match of markdown.matchAll(
          new RegExp(
            `${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:([^\\s\`"')]+)`,
            "g",
          ),
        )) {
          expect({ source, tag: match[1] }).toEqual({ source, tag: "release" });
        }
      }
    });

    it("names the ingest path every agent call goes to", (): void => {
      expect(page).toContain(
        `<ONEUPTIME_URL>${RESOURCE_AI_AGENT_INGEST_PATH}/`,
      );
    });

    it("puts the health server on the agent's default port, everywhere it is named", (): void => {
      const port: string = String(RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT);
      const troubleshooting: string = section(page, "## Troubleshooting");

      expect(troubleshooting).toContain(`port \`${port}\``);

      for (const source of [PAGE, ...Object.values(TELEMETRY_PAGES)]) {
        for (const match of readPage(source).matchAll(
          /127\.0\.0\.1:(\d+)\/status/g,
        )) {
          expect({ source, port: match[1] }).toEqual({ source, port });
        }
      }

      // The agent's own default, and every compose healthcheck, agree.
      expect(readRepoFile("agents/ResourceAIAgent/Config.ts")).toContain(
        "DEFAULT_PORT: number = RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT",
      );

      for (const type of COMPOSE_TYPES) {
        const service: string =
          composeServices(composeFileOf(type)).get(
            getResourceAiAgentServiceName(type),
          ) || "";
        // A service that passes PORT checks its health on that same setting.
        const passedPort: RegExpMatchArray | null = service.match(
          /^\s*- PORT=(\$\{[A-Z][A-Z0-9_]*:-(\d+)\})$/m,
        );

        if (passedPort) {
          expect(passedPort[2]).toBe(port);
          expect(service).toContain(
            `http://127.0.0.1:${passedPort[1]}/status/live`,
          );
        } else {
          expect(service).toContain(`http://127.0.0.1:${port}/status/live`);
        }
      }

      for (const route of ["/status/live", "/status/ready", "/status"]) {
        expect(troubleshooting).toContain(`\`${route}\``);
      }
    });

    it("states the caps and timings the contract, the server and the agent use", (): void => {
      const flat: string = page.replace(/\s+/g, " ");

      expect(flat).toContain(
        `counts as online for ${RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES} minutes`,
      );
      expect(flat).toContain(
        `up to ${MAX_RESOURCE_COMMANDS_PER_INVESTIGATION} per investigation, a guard against a runaway loop`,
      );
      expect(flat).toContain(
        `${DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS / 1000} seconds by default and ${
          MAX_RESOURCE_COMMAND_TIMEOUT_MS / 60000
        } minutes at most`,
      );
      expect(flat).toContain(
        `capped at ${MAX_RESOURCE_AGENT_OUTPUT_BYTES / 1024} KB on the agent`,
      );
      expect(flat).toContain(
        `the first ${TOOL_OUTPUT_PAGE_CHARS.toLocaleString("en-US")} characters, then the rest on request`,
      );
      expect(flat).not.toContain("reads at most");
      // What a caller that does not page gets is at least one page.
      expect(MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM).toBeGreaterThanOrEqual(
        TOOL_OUTPUT_PAGE_CHARS,
      );
      expect(flat).toContain(
        `at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS} entries of at most ${RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH} characters`,
      );
      expect(flat).toContain(
        `longer than ${MAX_POSTURE_LIST_ENTRIES} entries, or with an entry longer than ${MAX_POSTURE_STRING_LENGTH} characters`,
      );

      // The agent's loops.
      const config: string = readRepoFile("agents/ResourceAIAgent/Config.ts");
      expect(config).toContain(
        "DEFAULT_HEARTBEAT_INTERVAL_MS: number = 30_000",
      );
      expect(config).toContain("DEFAULT_POLL_INTERVAL_MS: number = 3_000");
      expect(flat).toContain("heartbeats every 30 seconds");
      expect(flat).toContain("asks for work every 3 seconds");

      // The server's brakes, read from where they are defined.
      const serverConstants: Array<[string, string, string]> = [
        [
          "Server/Services/ResourceAiAgentService.ts",
          "MAX_RESOURCE_AI_AGENTS_PER_PROJECT: number = 250",
          "holds at most 250 resource AI agents",
        ],
        [
          "Server/Services/ResourceAiAgentService.ts",
          "MAX_NEW_RESOURCE_AI_AGENTS_PER_PROJECT_PER_HOUR: number = 30",
          "at most 30 new ones register per hour",
        ],
        [
          "Server/Services/RunnerJobService.ts",
          "MAX_AI_INVESTIGATION_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR: number = 240",
          "at most 240 investigation commands",
        ],
        [
          "Server/Services/RunnerJobService.ts",
          "MAX_AI_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR: number = 30",
          "240 investigation commands, 30 fix commands and",
        ],
        [
          "Server/Services/RunnerJobService.ts",
          "MAX_AI_DRY_RUN_RESOURCE_COMMAND_JOBS_PER_PROJECT_PER_HOUR: number = 60",
          "and 60 cloud dry runs an hour",
        ],
        [
          "Server/Services/ResourceAiAccessService.ts",
          "MAX_RESOURCES_PER_SUBJECT: number = 10",
          "at most 10 per signal",
        ],
        [
          "Server/Services/AutoRemediationRuleEngineService.ts",
          "MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR: number = 3",
          "circuit-broken to three per resource per hour",
        ],
        [
          "Server/Services/AutoRemediationRuleEngineService.ts",
          "MAX_RESOURCE_REMEDIATION_ROUNDS_PER_SUBJECT: number = 2",
          "at most two rounds per incident or alert",
        ],
      ];

      for (const [file, constant, claim] of serverConstants) {
        expect(fs.readFileSync(path.join(COMMON_DIR, file), "utf8")).toContain(
          constant,
        );
        expect({ claim, stated: flat.includes(claim) }).toEqual({
          claim,
          stated: true,
        });
      }
    });

    it("warns about every collector default the agent warns about", (): void => {
      const connecting: string = section(page, "### Connecting to OneUptime");

      for (const type of ALL_AI_RESOURCE_TYPES) {
        for (const placeholder of infoOf(type).defaultIdentityPlaceholders) {
          // The swarm installer's suggestion is not a compose default.
          if (placeholder === "my-swarm") {
            continue;
          }

          expect({
            placeholder,
            named: connecting.includes(`\`${placeholder}\``),
          }).toEqual({ placeholder, named: true });
        }
      }
    });

    it("says AI investigations are on by default and fixes off, as the models default them", (): void => {
      for (const model of [
        "DockerHost",
        "PodmanHost",
        "DockerSwarmCluster",
        "ProxmoxCluster",
        "VMwareVCenter",
        "CephCluster",
        "DatabaseServer",
        "Host",
        // The row a Cloud AI agent serves.
        "CloudAccount",
      ]) {
        const source: string = fs.readFileSync(
          path.join(COMMON_DIR, `Models/DatabaseModels/${model}.ts`),
          "utf8",
        );
        // The @Column right above the property.
        const investigation: string = source.slice(
          source.indexOf("isAiInvestigationEnabled?: boolean") - 400,
          source.indexOf("isAiInvestigationEnabled?: boolean"),
        );

        expect({
          model,
          on: investigation.includes("default: true"),
        }).toEqual({ model, on: true });
        expect({
          model,
          disabled: source.includes(
            "default: ResourceAiRemediationMode.Disabled",
          ),
        }).toEqual({ model, disabled: true });
      }

      // The same defaults as a cluster, said among what is the same.
      const same: string = page.slice(
        page.indexOf("The resource AI agents follow the same design:"),
        page.indexOf("What differs:"),
      );

      expect(same).toContain(
        "**The same defaults.** AI investigations are on by default",
      );
      expect(same).toContain(
        "a resource starts with investigation on and fixes off, like a cluster",
      );
      expect(page).not.toContain("It starts switched off.");
      expect(page).not.toContain("investigation and fixes off.");

      // The first connection's defaults, as the registration service applies them.
      const service: string = fs.readFileSync(
        path.join(COMMON_DIR, "Server/Services/ResourceAiAgentService.ts"),
        "utf8",
      );
      expect(service).toContain(
        "remediationMode: ResourceAiRemediationMode.RequireApproval",
      );
      expect(service).toContain("aiAccessConfiguredAt: QueryHelper.isNull()");
      expect(section(page, "### Connecting to OneUptime")).toContain(
        "sets **Fixes** to **Ask for approval**",
      );
    });

    it("names the people who may loosen AI access by the permission catalog's titles", (): void => {
      const whoMay: string = section(page, "### Who may change it");

      for (const title of PermissionHelper.getPermissionTitles(
        RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
      )) {
        expect({
          title,
          named: whoMay.includes(title) || whoMay.includes(`**${title}**`),
        }).toEqual({ title, named: true });
      }
    });
  });

  describe("installing", (): void => {
    const nextToCollector: string = section(page, "### Next to a collector");

    it("points every collector-backed resource at a compose file whose AI agent service serves it", (): void => {
      const collectorTypes: Array<AiResourceType> = COMPOSE_TYPES.filter(
        (type: AiResourceType): boolean => {
          return type !== AiResourceType.Host;
        },
      );

      for (const type of collectorTypes) {
        const info: AiResourceTypeInfo = infoOf(type);
        const cells: Array<string> = tableCells(
          tableRow(nextToCollector, info.displayName),
        );
        const composeFile: string | undefined = codeSpans(
          cells[3] as string,
        ).find((span: string): boolean => {
          return span.endsWith("/docker-compose.yml");
        });

        expect({ type, composeFile }).toEqual({
          type,
          composeFile: COMPOSE_FILES[type],
        });

        const serviceName: string = getResourceAiAgentServiceName(type);

        expect(codeSpans(cells[2] as string)).toEqual([serviceName]);

        const service: string | undefined = composeServices(
          composeFile as string,
        ).get(serviceName);

        expect({ type, service: service !== undefined }).toEqual({
          type,
          service: true,
        });
        expect(service).toContain(`image: ${IMAGE}`);
        expect(service).toContain(
          `- ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV}=${info.agentAlias}\n`,
        );
        expect(service).toContain(
          `- ${RESOURCE_AI_ALLOW_WRITES_ENV}=\${${RESOURCE_AI_ALLOW_WRITES_ENV}:-false}`,
        );

        // Registers as what the collector reports: the same identity variables.
        for (const variable of info.identityEnvVars) {
          expect({
            type,
            variable,
            passed: service?.includes(`- ${variable}=`),
          }).toEqual({ type, variable, passed: true });
        }
      }
    });

    it("installs the Host AI agent from files that exist, with the host alias", (): void => {
      const host: string = section(page, "### Host AI agent");

      expect(host).toContain(
        "curl -fsSL https://oneuptime.com/install/host-ai-agent -o install.sh",
      );
      expect(
        fs.existsSync(path.join(AGENTS_DIR, "HostAIAgent/install.sh")),
      ).toBe(true);

      const service: string | undefined = composeServices(
        composeFileOf(AiResourceType.Host),
      ).get(getResourceAiAgentServiceName(AiResourceType.Host));

      expect(service).toContain(`image: ${IMAGE}`);
      expect(service).toContain(
        `- ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV}=${infoOf(AiResourceType.Host).agentAlias}\n`,
      );
      expect(service).toContain("pid: host");
      expect(service).toContain("privileged: true");
      expect(host).toContain(
        `\`${getResourceAiAgentServiceName(AiResourceType.Host)}\``,
      );
      expect(host).toContain("`--systemd`");
      expect(readRepoFile("agents/HostAIAgent/install.sh")).toContain(
        "--systemd)",
      );
      expect(host).toContain(
        "`nsenter --target 1 --mount --uts --ipc --net --pid -- PROGRAM ARGS`",
      );
    });

    it("passes the settings the agent's messages and READMEs send to the .env: the identity override and the log level, and the port on the host's network", (): void => {
      // The names the agent reads.
      expect(readRepoFile("agents/ResourceAIAgent/Config.ts")).toContain(
        'parsePort(env["PORT"])',
      );
      expect(readRepoFile("agents/ResourceAIAgent/Logger.ts")).toContain(
        'process.env["LOG_LEVEL"]',
      );

      const port: number = RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT;

      for (const type of COMPOSE_TYPES) {
        const file: string = composeFileOf(type);
        const service: string =
          composeServices(file).get(getResourceAiAgentServiceName(type)) || "";

        for (const line of [
          `- ${RESOURCE_AI_AGENT_RESOURCE_NAME_ENV}=\${${RESOURCE_AI_AGENT_RESOURCE_NAME_ENV}:-}`,
          "- LOG_LEVEL=${LOG_LEVEL:-info}",
        ]) {
          expect({ file, line, passed: service.includes(`${line}\n`) }).toEqual(
            { file, line, passed: true },
          );
        }

        // On the host's network the port can clash, so the .env moves it.
        if (HOST_NETWORK_LINE.test(service)) {
          expect({
            file,
            port: service.includes(`- PORT=\${PORT:-${port}}\n`),
            healthcheck: service.includes(
              `http://127.0.0.1:\${PORT:-${port}}/status/live`,
            ),
          }).toEqual({ file, port: true, healthcheck: true });
        }
      }

      // The one that shares the host's network by default.
      expect(
        composeServices(composeFileOf(AiResourceType.Host)).get(
          getResourceAiAgentServiceName(AiResourceType.Host),
        ),
      ).toMatch(HOST_NETWORK_LINE);
      expect(readRepoFile("agents/HostAIAgent/README.md")).toContain(
        "| Port `3877` already in use | Set `PORT` in `.env`",
      );
    });

    it("runs the Docker AI agent the way the Docker agent's installer does", (): void => {
      const blocks: Array<string> = nextToCollector
        .split("```")
        .filter((_block: string, index: number): boolean => {
          return index % 2 === 1;
        });
      const run: string | undefined = blocks.find((block: string): boolean => {
        return block.includes("docker run");
      });

      expect(run).toBeDefined();

      const installer: string = readRepoFile("agents/DockerAgent/install.sh");

      for (const line of [
        "--name oneuptime-docker-ai-agent",
        "--user 0:0",
        "-v /var/run/docker.sock:/var/run/docker.sock:ro",
        `-e ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV}=docker`,
      ]) {
        expect({ line, documented: run?.includes(line) }).toEqual({
          line,
          documented: true,
        });
        expect({ line, installed: installer.includes(line) }).toEqual({
          line,
          installed: true,
        });
      }

      expect(run).toContain(IMAGE);
    });

    it("offers --no-ai-agent only where the installers take it", (): void => {
      expect(nextToCollector).toContain("`--no-ai-agent`");
      expect(nextToCollector).toContain("`ONEUPTIME_INSTALL_AI_AGENT=false`");

      for (const installer of [
        "agents/DockerAgent/install.sh",
        "agents/PodmanAgent/install.sh",
        "agents/DockerSwarmAgent/install.sh",
      ]) {
        const text: string = readRepoFile(installer);

        expect(text).toContain("--no-ai-agent) INSTALL_AI_AGENT=false");
        expect(text).toContain("ONEUPTIME_INSTALL_AI_AGENT");
      }
    });

    it("stops the AI agent before a re-run removes it, so it signs off and the new one is let in at once", (): void => {
      /*
       * rm -f is a SIGKILL: the old agent cannot sign off, and its
       * replacement waits for OneUptime to find it silent (issue #5253).
       */
      for (const [installer, runtime] of [
        ["agents/DockerAgent/install.sh", "docker"],
        ["agents/PodmanAgent/install.sh", "podman"],
      ] as Array<[string, string]>) {
        const container: string = `oneuptime-${runtime}-ai-agent`;
        const lines: Array<string> = readRepoFile(installer)
          .split("\n")
          .map((line: string): string => {
            return line.trim();
          });
        const stop: number = lines.indexOf(
          `${runtime} stop ${container} >/dev/null || true`,
        );
        const remove: number = lines.indexOf(
          `${runtime} rm -f ${container} || return 1`,
        );

        expect({ installer, stops: stop >= 0, removes: remove >= 0 }).toEqual({
          installer,
          stops: true,
          removes: true,
        });
        expect({ installer, stopsFirst: stop < remove }).toEqual({
          installer,
          stopsFirst: true,
        });
      }
    });

    it("names every agent's container in the troubleshooting steps, and a Cloud AI agent's log in its cloud's shell", (): void => {
      const logs: string = section(page, "### Logs and status");

      for (const type of COMPOSE_TYPES) {
        expect({
          type,
          named:
            logs.includes(`\`${getResourceAiAgentServiceName(type)}\``) ||
            logs.includes(getResourceAiAgentServiceName(type)),
        }).toEqual({ type, named: true });
      }

      // A Cloud AI agent has no container to exec into: its log is read in its cloud.
      for (const cloud of CLOUD_PROVIDERS) {
        const command: string = getCloudAiAgentLogsCommand(cloud.provider);

        expect({
          cloud: cloud.catalog,
          named: logs.includes(`\`${command}\``),
        }).toEqual({ cloud: cloud.catalog, named: true });
      }

      // The account's AI agent page shows the same command.
      expect(
        readRepoFile(
          "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage.tsx",
        ),
      ).toContain("getCloudAiAgentLogsCommand(cloudProvider)");
      expect(oneLine(logs)).toContain(
        "and its status on the account's **AI agent** page, which shows the same command.",
      );

      // Only the database agent's service has no fixed container name.
      for (const type of COMPOSE_TYPES) {
        const service: string | undefined = composeServices(
          composeFileOf(type),
        ).get(getResourceAiAgentServiceName(type));

        expect({
          type,
          containerName: service?.includes(
            `container_name: ${getResourceAiAgentServiceName(type)}`,
          ),
        }).toEqual({
          type,
          containerName: type !== AiResourceType.DatabaseServer,
        });
      }
    });

    it("runs as the user the page says: root where a socket or the host needs it, UID 1000 with no capabilities elsewhere", (): void => {
      const rootTypes: Array<AiResourceType> = [
        AiResourceType.DockerHost,
        AiResourceType.PodmanHost,
        AiResourceType.DockerSwarmCluster,
        AiResourceType.Host,
      ];

      for (const type of COMPOSE_TYPES) {
        const service: string = composeServices(composeFileOf(type)).get(
          getResourceAiAgentServiceName(type),
        ) as string;

        if (rootTypes.includes(type)) {
          expect({ type, root: service.includes('user: "0:0"') }).toEqual({
            type,
            root: true,
          });
        } else {
          expect({
            type,
            uid1000: service.includes('user: "1000:1000"'),
            noCapabilities: DROPS_ALL_CAPABILITIES.test(service),
          }).toEqual({ type, uid1000: true, noCapabilities: true });
        }

        expect({ type, readOnly: service.includes("read_only: true") }).toEqual(
          {
            type,
            readOnly: true,
          },
        );
      }

      expect(page.replace(/\s+/g, " ")).toContain(
        "The Proxmox, VMware, Ceph and Database AI agents run as UID 1000 with no capabilities.",
      );
    });

    it("sets a cloud account's agent up with one command from the account's page, and with no compose file", (): void => {
      const cloud: string = section(page, "### In a cloud account");
      const words: string = oneLine(cloud);

      // The Dashboard writes a compose snippet for every type but these.
      expect([...COMPOSE_INSTALLED_AI_RESOURCE_TYPES].sort()).toEqual(
        [...COMPOSE_TYPES].sort(),
      );

      for (const type of CLOUD_AI_RESOURCE_TYPES) {
        expect({ type, composeFile: COMPOSE_FILES[type] }).toEqual({
          type,
          composeFile: null,
        });
        expect({
          type,
          collectorRow: nextToCollector.includes(
            `| ${infoOf(type).displayName} `,
          ),
        }).toEqual({ type, collectorRow: false });
      }

      expect(words).toContain(
        "is set up from the account's page with one command, with no compose file and no `.env`:",
      );
      expect(oneLine(section(page, "## Installing an AI agent"))).toContain(
        "A cloud account's runs in the account, from one command the account's page writes for it (see [In a cloud account](#in-a-cloud-account)).",
      );

      // The card, its button, the one question and its answers, as the Dashboard draws them.
      const dashboard: string =
        "packages/App/FeatureSet/Dashboard/src/Components/Cloud";
      const card: string = readRepoFile(`${dashboard}/CloudAiAgentCard.tsx`);
      const dialog: string = readRepoFile(
        `${dashboard}/CloudAiAgentSetupModal.tsx`,
      );

      expect(card).toContain('title="AI agent"');
      expect(card).toContain('title="Let AI fix problems"');
      expect(dialog).toContain('translationKey("How far may AI go?")');
      // Its fold of the rest is the forms' More fields, never Advanced.
      expect(dialog).toContain("title={MORE_FIELDS_SECTION_TITLE}");
      expect(dialog).not.toContain('title="Advanced"');
      expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
      expect(words).toContain(
        "select **Let AI fix problems** in the **AI agent** card of its **Overview**.",
      );
      expect(
        readRepoFile(
          "packages/App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/Overview.tsx",
        ),
      ).toContain("<CloudAiAgentCard");

      // Each answer, and the fixes mode it gives the agent.
      expect(
        getCloudAiAgentFixesMode(
          getDefaultCloudAiAgentSetupChoices({ provider: CloudProvider.AWS }),
        ),
      ).toBe("RequireApproval");
      expect(
        getCloudAiAgentFixesMode({
          ...getDefaultCloudAiAgentSetupChoices({
            provider: CloudProvider.AWS,
          }),
          fixSafeProblemsAlone: true,
        }),
      ).toBe("Automatic");
      expect(
        getCloudAiAgentFixesMode({
          ...getDefaultCloudAiAgentSetupChoices({
            provider: CloudProvider.AWS,
          }),
          fixSafeProblemsAlone: true,
          bypassApproval: true,
        }),
      ).toBe("BypassApproval");
      expect(words).toContain(
        `Answer the one question, **How far may AI go?**: **${CLOUD_AI_AGENT_ASK_FIRST_TITLE}**, the default, sets **Fixes** to **Ask for approval**, and **${CLOUD_AI_AGENT_FIX_SAFE_TITLE}** to **Automatic**.`,
      );
      expect(words).toContain("**Bypass approval**");

      // The shell each command runs in, and what it creates there.
      const rows: Record<CloudCatalogProvider, Array<string>> = {
        aws: tableCells(
          tableRow(cloud, infoOf(AiResourceType.AwsAccount).displayName),
        ),
        azure: tableCells(
          tableRow(cloud, infoOf(AiResourceType.AzureSubscription).displayName),
        ),
        gcp: tableCells(
          tableRow(
            cloud,
            infoOf(AiResourceType.GoogleCloudProject).displayName,
          ),
        ),
      };
      const creates: Record<CloudCatalogProvider, Array<string>> = {
        aws: [
          AWS_CLOUD_AI_AGENT_STACK_NAME,
          AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
        ],
        azure: [
          AZURE_CLOUD_AI_AGENT_APP_NAME,
          AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
        ],
        gcp: [
          GCP_CLOUD_AI_AGENT_SERVICE_NAME,
          GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID,
        ],
      };

      for (const entry of CLOUD_PROVIDERS) {
        const row: Array<string> = rows[entry.catalog];
        const command: string = getCloudAiAgentSetupCommand(
          cloudSetupOptions(entry.provider, entry.catalog),
        );

        expect(row[1]).toBe(CLOUD_SHELL_NAMES[entry.provider]);

        for (const name of creates[entry.catalog]) {
          expect({
            cloud: entry.catalog,
            name,
            named: codeSpans(row[2] as string).includes(name),
          }).toEqual({ cloud: entry.catalog, name, named: true });
          expect({
            cloud: entry.catalog,
            name,
            created: command.includes(name),
          }).toEqual({ cloud: entry.catalog, name, created: true });
        }
      }

      // AWS: one Fargate task, whose task role may only assume the write role.
      const template: string = getAwsCloudAiAgentTemplate(
        cloudSetupOptions(CloudProvider.AWS, "aws"),
      );

      expect(template).toContain('"RequiresCompatibilities":["FARGATE"]');
      expect(template).toContain('"PolicyName":"AssumeTheWriteRole"');
      expect(template).toContain(`role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`);

      /*
       * The key the agent connects with is a secret of each cloud's, as the
       * table says: Secrets Manager read by ECS, a Container Apps secret,
       * Secret Manager read by the service account - never a variable.
       */
      expect(rows["aws"]![2]).toContain(
        "The key it connects with is kept in Secrets Manager, which only ECS reads.",
      );
      expect(rows["azure"]![2]).toContain(
        "The key it connects with is a Container Apps secret.",
      );
      expect(rows["gcp"]![2]).toContain(
        "The key it connects with is kept in Secret Manager, which only that service account may read.",
      );
      expect(template).toContain('"Type":"AWS::SecretsManager::Secret"');
      expect(template).toContain(
        '"Secrets":[{"Name":"ONEUPTIME_TELEMETRY_INGESTION_KEY","ValueFrom":{"Ref":"IngestionKeySecret"}}]',
      );
      expect(template).toContain('"Action":"secretsmanager:GetSecretValue"');
      expect(
        getCloudAiAgentSetupCommand(
          cloudSetupOptions(CloudProvider.Azure, "azure"),
        ),
      ).toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY=secretref:ingestion-key");
      expect(
        getCloudAiAgentSetupCommand(
          cloudSetupOptions(CloudProvider.GCP, "gcp"),
        ),
      ).toContain(
        "--set-secrets ONEUPTIME_TELEMETRY_INGESTION_KEY=oneuptime-ai-agent-key:latest",
      );
      // Google Cloud: CPU always allocated.
      expect(
        getCloudAiAgentSetupCommand(
          cloudSetupOptions(CloudProvider.GCP, "gcp"),
        ),
      ).toContain("--no-cpu-throttling");

      // Only in the account it was written for.
      expect(
        getCloudAiAgentSetupCommand(
          cloudSetupOptions(CloudProvider.AWS, "aws"),
        ),
      ).toContain(`if [ "$ACCOUNT" != ${CLOUD_ACCOUNT_IDS.aws} ]; then`);

      for (const [entry, flag, word] of [
        [CLOUD_PROVIDERS[1], '--subscription "$SUBSCRIPTION"', "az "],
        [CLOUD_PROVIDERS[2], '"$PROJECT_ID"', "gcloud "],
      ] as Array<[(typeof CLOUD_PROVIDERS)[number], string, string]>) {
        const calls: Array<string> = getCloudAiAgentSetupCommand(
          cloudSetupOptions(entry.provider, entry.catalog),
        )
          .split("\n")
          .filter((line: string): boolean => {
            return line.includes(word) && !line.includes(`${word}extension`);
          });

        expect(calls.length).toBeGreaterThan(2);

        for (const call of calls) {
          expect({
            cloud: entry.catalog,
            call,
            names: call.includes(flag),
          }).toEqual({
            cloud: entry.catalog,
            call,
            names: true,
          });
        }
      }

      expect(words).toContain(
        "The command works only in the account it was written for: on AWS it creates nothing in a shell signed in to another account, and the Azure and Google Cloud commands name their subscription or project on every call.",
      );

      // The variables it sets: the answer, the write switch and the account it is for.
      for (const fixesMode of [
        "RequireApproval",
        "Automatic",
        "BypassApproval",
      ] as const) {
        const environment: Array<string> = getCloudAiAgentEnvironment(
          cloudSetupOptions(CloudProvider.AWS, "aws", { fixesMode }),
        ).map((variable: CloudAiAgentEnvironmentVariable): string => {
          return `${variable.name}=${variable.value}`;
        });

        expect(environment).toContain(`${AI_INVESTIGATION_ENV}=true`);
        expect(environment).toContain(
          `${AI_FIXES_ENV}=${AGENT_AI_FIXES_SETTING_VALUES[fixesMode]}`,
        );
        expect(environment).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);
        expect(environment).toContain(
          `${RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV}=11111111-1111-1111-1111-111111111111`,
        );
      }

      expect(words).toContain(
        `It sets \`${AI_INVESTIGATION_ENV}=true\`, \`${AI_FIXES_ENV}\` from your answer, \`${RESOURCE_AI_ALLOW_WRITES_ENV}=true\`, and \`${RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV}\` to the account it was written for.`,
      );

      // It binds to a connected account, never adds one, and says why it was refused.
      const registration: string = readRepoFile(
        "packages/Common/Server/Services/ResourceAiAgentService.ts",
      );

      expect(registration).toContain("and a Cloud AI agent never adds one.");
      expect(registration).toContain(", but its command was written for ");
      expect(registration).toContain(
        "await this.recordCloudAccountRegistrationError({",
      );
      expect(card).toContain("status?.aiAccessLastError");
      expect(words).toContain(
        "The agent registers as the account its cloud says it is in and never adds one to OneUptime:",
      );

      // A change turned off leaves the role.
      expect(
        getCloudAiAgentRolePermissions(CloudProvider.AWS, ["restart-service"]),
      ).not.toContain("ec2:StartInstances");
      expect(getCloudAiAgentRolePermissions(CloudProvider.AWS)).toContain(
        "ec2:StartInstances",
      );
      expect(words).toContain(
        "The role always holds only the changes turned on.",
      );

      // Change on the AI agent page opens the same dialog; the AI section has two pages.
      expect(
        oneLine(
          readRepoFile(
            "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage.tsx",
          ),
        ),
      ).toContain(
        'const settingsButtons: Array<ReactElement> = cloudProvider ? [ <Button key="change" title="Change"',
      );

      const sideMenu: string = oneLine(
        readRepoFile(
          "packages/App/FeatureSet/Dashboard/src/Pages/Cloud/Accounts/View/SideMenu.tsx",
        ),
      );
      const aiSection: string = sideMenu.slice(
        sideMenu.indexOf('<SideMenuSection title="AI">'),
        sideMenu.indexOf(
          "</SideMenuSection>",
          sideMenu.indexOf('<SideMenuSection title="AI">'),
        ),
      );

      expect(
        Array.from(aiSection.matchAll(/title: "([^"]+)"/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ).toEqual(["Logs", "AI agent"]);
      expect(words).toContain(
        "A cloud account's **AI** section has two pages, **Logs** and **AI agent**,",
      );

      /*
       * Its Feed, under Activity, records the agent connecting or being
       * reset and every change to what AI may do: the menu draws it so,
       * and the agent's and a person's changes are written to it.
       */
      const activitySection: string = sideMenu.slice(
        sideMenu.indexOf('<SideMenuSection title="Activity">'),
        sideMenu.indexOf(
          "</SideMenuSection>",
          sideMenu.indexOf('<SideMenuSection title="Activity">'),
        ),
      );

      expect(
        Array.from(activitySection.matchAll(/title: "([^"]+)"/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ).toEqual(["Changes", "Feed"]);
      expect(words).toContain(
        "Under **Activity**, the account's **Feed** records the agent connecting or being reset, and every change to what OneUptime AI may do there, with who made it.",
      );
      expect(
        oneLine(
          readRepoFile(
            "packages/Common/Server/Services/ResourceAiAgentService.ts",
          ),
        ),
      ).toContain(
        "await CloudAccountFeedService.createCloudAccountFeedItem({ cloudAccountId: item.resourceId,",
      );
    });
  });

  describe("what an investigation may run, against the command policy", (): void => {
    const investigation: string = section(
      page,
      "## What an investigation may run",
    );

    it("has one section per kind of resource, covering every type", (): void => {
      const covered: Set<AiResourceType> = new Set<AiResourceType>();

      for (const resource of RESOURCE_SECTIONS) {
        expect(investigation).toContain(`\n### ${resource.title}\n`);

        for (const type of resource.types) {
          covered.add(type);
        }
      }

      expect([...covered].sort()).toEqual([...ALL_AI_RESOURCE_TYPES].sort());
    });

    for (const resource of COMMAND_SECTIONS) {
      it(`only writes out Read commands for ${resource.title}`, (): void => {
        const text: string = section(investigation, `### ${resource.title}`);

        for (const type of resource.types) {
          const commands: Array<string> = commandsFor(text, type);

          expect({ type, count: commands.length >= 5 }).toEqual({
            type,
            count: true,
          });

          for (const command of commands) {
            const result: ResourceCommandPolicyResult = evaluate(type, command);

            expect({ type, command, tier: result.tier }).toEqual({
              type,
              command,
              tier: ResourceCommandTier.Read,
            });
          }
        }
      });
    }

    it("states the no-shell rule the tokenizer enforces", (): void => {
      expect(
        evaluate(AiResourceType.Host, "journalctl -u nginx | grep error")
          .reason,
      ).toContain(RESOURCE_SHELL_SYNTAX_RULE);
      expect(page).toContain(`\`${RESOURCE_SHELL_SYNTAX_RULE}\``);
      expect(
        evaluate(AiResourceType.Host, "sudo systemctl restart nginx").tier,
      ).toBe(ResourceCommandTier.Denied);
    });

    it("says an investigation reads a cloud account with no agent, through its read-only connection", (): void => {
      const cloud: string = oneLine(
        section(investigation, `### ${CLOUD_SECTION.title}`),
      );
      const intro: string = oneLine(
        investigation.slice(0, investigation.indexOf("\n### ")),
      );
      // The readiness: a cloud account's agent gaps block only its fixes.
      const access: string = readRepoFile(
        "packages/Common/Server/Services/ResourceAiAccessService.ts",
      );
      // The investigation tool runs the reads itself, on the server.
      const toolkit: string = readRepoFile(
        "packages/Common/Server/Utils/AI/ResourceAccess/InfrastructureInvestigationToolkit.ts",
      );

      expect(access).toContain(
        "const agentGapBlocksInvestigation: boolean = !isCloudAccount;",
      );
      expect(access).toContain('code: "cloud_connection_missing",');
      expect(toolkit).toContain(
        "return await this.runCloudLiveRead({ resource, command, label });",
      );
      expect(intro).toContain(
        "whose AI agent is connected (a cloud account needs none) and whose **Investigate** switch is on",
      );
      expect(cloud).toContain(
        "through the account's read-only connection (see [Connect a Cloud Account](/docs/telemetry/cloud-accounts)): these reads run on OneUptime and need no agent,",
      );
      expect(oneLine(page.split("\n")[4] as string)).toBe(
        "An AWS account, an Azure subscription or a Google Cloud project needs no agent to be investigated: OneUptime reads it live, through the read-only connection it was connected with. Only its fixes need one, the Cloud AI agent, which runs in the account itself and is set up with one command from the account's page (see [In a cloud account](#in-a-cloud-account)).",
      );
    });
  });

  describe("what an investigation may read on a cloud account, against the cloud catalog", (): void => {
    const cloud: string = section(
      section(page, "## What an investigation may run"),
      `### ${CLOUD_SECTION.title}`,
    );
    const spans: Array<string> = codeSpans(cloud);
    const reads: Array<CloudOperationSpec> = CLOUD_OPERATIONS.filter(
      (operation: CloudOperationSpec): boolean => {
        return !isCloudChangeOperation(operation);
      },
    );

    // The bullet that lists one operation.
    const bulletOf: (operation: CloudOperationSpec) => string = (
      operation: CloudOperationSpec,
    ): string => {
      return (
        cloud.split("\n").find((line: string): boolean => {
          return line.startsWith(
            `- \`${describeCloudOperationUsage(operation)}\` — `,
          );
        }) || ""
      );
    };

    it("lists every read as the guide the AI is given writes it, and no change", (): void => {
      for (const operation of CLOUD_OPERATIONS) {
        const usage: string = describeCloudOperationUsage(operation);

        if (isCloudChangeOperation(operation)) {
          expect({
            operation: operation.name,
            named: spans.some((span: string): boolean => {
              return span.startsWith(`cloud ${operation.name}`);
            }),
          }).toEqual({ operation: operation.name, named: false });
          continue;
        }

        expect({
          operation: operation.name,
          bullet: bulletOf(operation) !== "",
        }).toEqual({ operation: operation.name, bullet: true });

        // Each cloud's guide offers it exactly where that cloud has it.
        for (const entry of CLOUD_PROVIDERS) {
          expect({
            operation: operation.name,
            cloud: entry.catalog,
            offered: getCloudReadCommandGuide(entry.catalog).includes(
              `\`${usage}\``,
            ),
          }).toEqual({
            operation: operation.name,
            cloud: entry.catalog,
            offered: isCloudOperationAvailable(operation, entry.catalog),
          });
        }
      }

      // A read only some clouds have says which.
      const targetHealth: CloudOperationSpec = getCloudOperation(
        "target-health",
      ) as CloudOperationSpec;

      expect(
        CLOUD_PROVIDERS.filter((entry: (typeof CLOUD_PROVIDERS)[number]) => {
          return isCloudOperationAvailable(targetHealth, entry.catalog);
        }).map((entry: (typeof CLOUD_PROVIDERS)[number]): string => {
          return entry.catalog;
        }),
      ).toEqual(["aws"]);
      expect(bulletOf(targetHealth)).toContain(" — AWS only: ");

      for (const operation of reads) {
        if (operation.name === "target-health") {
          continue;
        }

        for (const entry of CLOUD_PROVIDERS) {
          expect({
            operation: operation.name,
            cloud: entry.catalog,
            available: isCloudOperationAvailable(operation, entry.catalog),
          }).toEqual({
            operation: operation.name,
            cloud: entry.catalog,
            available: true,
          });
        }
      }
    });

    it("runs the reads on OneUptime, and whoami alone on the agent, which Test connection runs", (): void => {
      for (const operation of reads) {
        expect({ operation: operation.name, runsOn: operation.runsOn }).toEqual(
          {
            operation: operation.name,
            runsOn: operation.name === "whoami" ? "agent" : "server",
          },
        );
      }

      for (const type of CLOUD_AI_RESOURCE_TYPES) {
        expect(infoOf(type).testCommands).toEqual(["cloud whoami"]);
      }

      const whoami: string = bulletOf(
        getCloudOperation("whoami") as CloudOperationSpec,
      );

      expect(whoami).toContain("a read that runs on the Cloud AI agent");
      expect(whoami).toContain(
        "**Test connection**, in the **⋯** menu next to the agent's status, runs it.",
      );
    });

    it("writes a change's dry run as the catalog reads it: a Read, run on the agent, never in the list of operations", (): void => {
      const bullet: string =
        cloud.split("\n").find((line: string): boolean => {
          return line.startsWith(
            `- \`cloud ${CLOUD_DRY_RUN_OPERATION_NAME} CHANGE RESOURCE [--flag value]\` — `,
          );
        }) || "";

      expect(bullet).toContain(
        "the other read that runs on the Cloud AI agent: a change, written exactly as it would run, checked without being made.",
      );
      expect(bullet).toContain("stops before the call that makes it.");
      expect(CLOUD_DRY_RUN_OPERATION.runsOn).toBe("agent");
      // Not an operation of its own, so no list of operations names it twice.
      expect(
        CLOUD_OPERATIONS.some((operation: CloudOperationSpec): boolean => {
          return operation.name === CLOUD_DRY_RUN_OPERATION_NAME;
        }),
      ).toBe(false);

      // The page's own change, dry-run: a Read, and the change it carries.
      const change: string = `cloud scale-out ${CLOUD_EXAMPLE_IDS.aws} --count 4`;
      const dryRun: string = change.replace(
        "cloud ",
        `cloud ${CLOUD_DRY_RUN_OPERATION_NAME} `,
      );
      const parsed: CloudCommandParse = parseCloudCommand(
        "aws",
        dryRun.split(" "),
      );

      expect(parsed.ok && isCloudDryRun(parsed.command)).toBe(true);
      expect(
        parsed.ok && parsed.command.dryRunOf
          ? parsed.command.dryRunOf.operation.name
          : null,
      ).toBe("scale-out");
      expect(evaluate(AiResourceType.AwsAccount, dryRun).tier).toBe(
        ResourceCommandTier.Read,
      );
      expect(evaluate(AiResourceType.AwsAccount, change).tier).toBe(
        ResourceCommandTier.SafeWrite,
      );

      // A read has nothing to dry-run.
      expect(
        parseCloudCommand("aws", [
          "cloud",
          CLOUD_DRY_RUN_OPERATION_NAME,
          "describe",
          CLOUD_EXAMPLE_IDS.aws,
        ]).ok,
      ).toBe(false);

      // The guide the AI is given offers it on every cloud.
      for (const entry of CLOUD_PROVIDERS) {
        expect(getCloudReadCommandGuide(entry.catalog)).toContain(
          `\`cloud ${CLOUD_DRY_RUN_OPERATION_NAME} <change> RESOURCE [--flag value]\``,
        );
      }
    });

    it("says Ask AI on a cloud resource's page reads that resource's account", (): void => {
      const access: string = readRepoFile(
        "packages/Common/Server/Utils/AI/Chat/ChatInfrastructureAccess.ts",
      );

      expect(access).toContain("AIResourceType.CloudResource");
      expect(access).toContain("buildCloudResourcePageNote");
      expect(oneLine(cloud)).toContain(
        "Ask AI, opened on a cloud resource's page, runs these reads on the resource's account.",
      );
    });

    it("names each example resource by the id its own cloud gives it, and reads it as a Read there", (): void => {
      for (const entry of CLOUD_PROVIDERS) {
        const id: string = CLOUD_EXAMPLE_IDS[entry.catalog];

        expect(spans).toContain(id);
        expect(parseCloudResourceId(entry.catalog, id).ok).toBe(true);
        expect(evaluate(entry.type, `cloud describe ${id}`).tier).toBe(
          ResourceCommandTier.Read,
        );

        // No other cloud reads it as one of its ids.
        for (const other of CLOUD_PROVIDERS) {
          if (other.catalog !== entry.catalog) {
            expect({
              id,
              cloud: other.catalog,
              ok: parseCloudResourceId(other.catalog, id).ok,
            }).toEqual({ id, cloud: other.catalog, ok: false });
          }
        }
      }

      expect(oneLine(cloud)).toContain(
        "There is never an `aws`, `az` or `gcloud` command, and flags are long only, each one given once.",
      );

      // A CLI's command is refused, and so is a flag given twice.
      expect(
        evaluate(AiResourceType.AwsAccount, "cloud aws ecs describe-services")
          .tier,
      ).toBe(ResourceCommandTier.Denied);
      expect(
        evaluate(
          AiResourceType.AwsAccount,
          `cloud recent-events ${CLOUD_EXAMPLE_IDS.aws} --hours 2 --hours 3`,
        ).tier,
      ).toBe(ResourceCommandTier.Denied);
    });

    it("states the flags' defaults and limits as the catalog sets them", (): void => {
      const words: string = oneLine(cloud);

      expect(words).toContain(
        `(\`--hours\` ${CLOUD_DEFAULT_EVENT_HOURS} by default, up to ${CLOUD_MAX_EVENT_HOURS})`,
      );
      expect(words).toContain(
        `(\`--minutes\` ${CLOUD_DEFAULT_LOG_MINUTES} by default, up to ${CLOUD_MAX_LOG_MINUTES})`,
      );
      expect(words).toContain(
        `\`--limit\` is ${CLOUD_DEFAULT_ROW_LIMIT} rows by default, ${CLOUD_MAX_ROW_LIMIT} at most.`,
      );

      // The server's own cap on an answer, and its brake per account.
      expect(
        readRepoFile(
          "packages/Common/Server/Utils/CloudConnection/CloudLiveRead.ts",
        ),
      ).toContain(
        "export const CLOUD_LIVE_READ_MAX_OUTPUT_CHARS: number = 64 * 1024;",
      );
      expect(
        readRepoFile(
          "packages/Common/Server/Utils/CloudConnection/LiveRead/CloudLiveReadRateLimit.ts",
        ),
      ).toContain("export const CLOUD_LIVE_READS_PER_MINUTE: number = 30;");
      expect(words).toContain(
        "A read's answer is cut at 64 KB, at a line, and an account takes at most 30 live reads a minute.",
      );
    });

    it("names the AWS kinds describe reads live, and marks any other NOT LIVE, as the catalog does", (): void => {
      const describeRead: CloudOperationSpec = getCloudOperation(
        "describe",
      ) as CloudOperationSpec;
      const aws: Array<CloudOperationKindSpec> = describeRead.kinds.filter(
        (spec: CloudOperationKindSpec): boolean => {
          return spec.provider === "aws";
        },
      );
      const live: Array<string> = aws
        .filter((spec: CloudOperationKindSpec): boolean => {
          return spec.kind !== "*";
        })
        .map((spec: CloudOperationKindSpec): string => {
          return (
            getCloudResourceKind("aws", spec.kind) as CloudResourceKindSpec
          ).displayName;
        });
      const rest: CloudOperationKindSpec | undefined = aws.find(
        (spec: CloudOperationKindSpec): boolean => {
          return spec.kind === "*";
        },
      );

      expect(rest?.apiCall).toContain("marked NOT LIVE");
      expect(bulletOf(describeRead)).toContain(
        `On AWS, a resource that is not an ${listWithOr(live)} is read from OneUptime's copy of the account's last read, marked NOT LIVE.`,
      );
    });

    it("keeps read-logs off until someone lets AI read the account's logs, a switch saved at once", (): void => {
      const readLogs: CloudOperationSpec = getCloudOperation(
        "read-logs",
      ) as CloudOperationSpec;
      const account: string = fs.readFileSync(
        path.join(COMMON_DIR, "Models/DatabaseModels/CloudAccount.ts"),
        "utf8",
      );
      const column: string = account.slice(
        account.indexOf("isAiLogReadEnabled?: boolean") - 400,
        account.indexOf("isAiLogReadEnabled?: boolean"),
      );
      const dialog: string = readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/Cloud/CloudAiAgentSetupModal.tsx",
      );

      expect(readLogs.summary).toContain(
        "off until someone lets AI read the account's logs",
      );
      expect(column).toContain("default: false");
      expect(oneLine(dialog)).toContain(
        '"Let AI read this account\'s logs during investigations",',
      );
      expect(dialog).toContain("Saved at once, with no command to run.");
      expect(
        readRepoFile(
          "packages/Common/Server/Utils/CloudConnection/CloudLiveRead.ts",
        ),
      ).toContain("isAiLogReadEnabled");
      expect(oneLine(bulletOf(readLogs))).toContain(
        "Log lines can hold customer data, so this read is off until someone turns on **Let AI read this account's logs during investigations**, under **More fields** in **Let AI fix problems**, which is saved at once, with no command to run.",
      );
    });
  });

  describe("what a fix may run, against the command policy", (): void => {
    const fixes: string = section(page, "## How fixes work");

    for (const resource of COMMAND_SECTIONS) {
      const heading: string = resource.fixesHeading;

      it(`tiers every command in "${heading.replace("### ", "")}" as its row says`, (): void => {
        const table: string = section(fixes, heading);

        for (const type of resource.types) {
          let checked: number = 0;

          for (const row of [
            FixRow.Safe,
            FixRow.Riskier,
            FixRow.AlwaysAPerson,
            FixRow.Never,
          ]) {
            const cell: string = tableCells(tableRow(table, row))[1] as string;
            const commands: Array<string> = commandsFor(cell, type);

            if (row !== FixRow.AlwaysAPerson) {
              expect({ type, row, some: commands.length > 0 }).toEqual({
                type,
                row,
                some: true,
              });
            } else if (commands.length === 0) {
              expect({ type, row, cell }).toEqual({ type, row, cell: "—" });
            }

            for (const command of commands) {
              const result: ResourceCommandPolicyResult = evaluate(
                type,
                command,
              );
              const actual: string =
                result.tier === ResourceCommandTier.Denied
                  ? FixRow.Never
                  : result.requiresHuman === true
                    ? FixRow.AlwaysAPerson
                    : result.tier === ResourceCommandTier.SafeWrite
                      ? FixRow.Safe
                      : result.tier === ResourceCommandTier.RiskyWrite
                        ? FixRow.Riskier
                        : `Read (${result.tier})`;

              expect({ type, command, row: actual }).toEqual({
                type,
                command,
                row,
              });
              checked++;
            }
          }

          expect(checked).toBeGreaterThanOrEqual(4);
        }
      });
    }

    it("never lets the allowlist or Bypass approval run what always needs a person", (): void => {
      for (const [type, command] of [
        [
          AiResourceType.DockerSwarmCluster,
          "docker node update --availability drain node-1",
        ],
        [
          AiResourceType.ProxmoxCluster,
          "pvesh create /nodes/pve1/qemu/101/migrate --target pve2",
        ],
        [AiResourceType.VMwareVCenter, "govc host.maintenance.enter esx-01"],
        [AiResourceType.CephCluster, "ceph osd set pause"],
        [AiResourceType.Host, "kill -TERM 4242"],
        [
          AiResourceType.AwsAccount,
          "cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0abc1234def567890",
        ],
        [
          AiResourceType.GoogleCloudProject,
          "cloud fail-over-database //cloudsql.googleapis.com/projects/my-project/instances/orders",
        ],
      ] as Array<[AiResourceType, string]>) {
        const verdict: {
          verdict: string;
          requiresHuman?: boolean | undefined;
        } = ResourceCommandPolicy.evaluateForAutoExecution({
          resourceType: type,
          command,
          allowlistPatterns: [command],
          bypassApproval: true,
        });

        expect({ type, command, requiresHuman: verdict.requiresHuman }).toEqual(
          {
            type,
            command,
            requiresHuman: true,
          },
        );
      }

      expect(section(fixes, "### The command allowlist")).toContain(
        "Nothing on the allowlist overrides a change that always needs a person",
      );
    });

    it("picks the resource a fix round changes in the order the types are declared", (): void => {
      expect(oneLine(fixes)).toContain(
        `gets the round, in this order: ${ALL_AI_RESOURCE_TYPES.map(
          (type: AiResourceType): string => {
            return infoOf(type).displayName;
          },
        ).join(", ")}. The round only changes that resource.`,
      );
    });
  });

  describe("what a fix may change on a cloud account, against the cloud catalog", (): void => {
    const cloudFixes: string = section(
      section(page, "## How fixes work"),
      CLOUD_SECTION.fixesHeading,
    );
    const words: string = oneLine(cloudFixes);

    it("lists every change of the catalog with its tier on each kind of resource, cloud by cloud", (): void => {
      const lines: Array<string> = cloudFixes
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("|");
        });
      const header: Array<string> = tableCells(lines[0] as string);
      const rows: Array<Array<string>> = lines.slice(2).map(tableCells);

      expect(header).toEqual([
        "Change",
        ...CLOUD_PROVIDERS.map((entry: (typeof CLOUD_PROVIDERS)[number]) => {
          return CLOUD_CATALOG_PROVIDER_NAMES[entry.catalog];
        }),
      ]);
      expect(
        rows.map((row: Array<string>): string => {
          return row[0] as string;
        }),
      ).toEqual(
        CLOUD_CHANGE_OPERATION_NAMES.map((name: string): string => {
          return `\`${name}\``;
        }),
      );

      rows.forEach((row: Array<string>, index: number): void => {
        const operation: CloudOperationSpec = getCloudOperation(
          CLOUD_CHANGE_OPERATION_NAMES[index] as string,
        ) as CloudOperationSpec;

        CLOUD_PROVIDERS.forEach(
          (entry: (typeof CLOUD_PROVIDERS)[number], column: number): void => {
            expect({
              operation: operation.name,
              cloud: entry.catalog,
              cell: row[column + 1],
            }).toEqual({
              operation: operation.name,
              cloud: entry.catalog,
              cell: expectedCloudFixCell(operation, entry.catalog),
            });
          },
        );
      });
    });

    it("writes out a change the policy tiers as the table says, on the resource the allowlist examples name", (): void => {
      const example: string = `cloud scale-out ${CLOUD_EXAMPLE_IDS.aws} --count 4`;
      const result: ResourceCommandPolicyResult = evaluate(
        AiResourceType.AwsAccount,
        example,
      );

      expect(words).toContain(`Written out, a change reads \`${example}\`.`);
      expect(result.tier).toBe(ResourceCommandTier.SafeWrite);
      expect(result.requiresHuman).not.toBe(true);
      // The table's "Safe: ECS service, ..." for scale-out on AWS.
      expect(
        expectedCloudFixCell(
          getCloudOperation("scale-out") as CloudOperationSpec,
          "aws",
        ),
      ).toMatch(/^Safe: ECS service/);
      expect(
        RESOURCE_AI_ALLOWLIST_EXAMPLES[AiResourceType.AwsAccount],
      ).toContain(CLOUD_EXAMPLE_IDS.aws);
    });

    it("names what never changes as the guide the AI is given does, and the policy refuses it", (): void => {
      const never: string =
        "deleting or terminating anything, IAM, security groups and firewall rules, secrets and keys, storage and database contents, instance types, snapshots and restores, purging a queue, a group's minimum or maximum";

      for (const entry of CLOUD_PROVIDERS) {
        expect(getCloudWriteCommandGuide(entry.catalog)).toContain(
          `- Never, even with approval: ${never}, and anything not listed here.`,
        );
      }

      expect(words).toContain(
        `**Never**, even when a person approves it: ${never}, and anything not in the table.`,
      );

      for (const [type, command] of [
        [
          AiResourceType.AwsAccount,
          "cloud terminate-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0abc1234def567890",
        ],
        [
          AiResourceType.AwsAccount,
          `cloud purge-queue ${CLOUD_EXAMPLE_IDS.aws}`,
        ],
        [AiResourceType.AzureSubscription, "cloud set-iam-policy"],
        [
          AiResourceType.GoogleCloudProject,
          `cloud delete ${CLOUD_EXAMPLE_IDS.gcp}`,
        ],
        [
          AiResourceType.GoogleCloudProject,
          "cloud gcloud run services delete web",
        ],
      ] as Array<[AiResourceType, string]>) {
        expect({ command, tier: evaluate(type, command).tier }).toEqual({
          command,
          tier: ResourceCommandTier.Denied,
        });
      }
    });

    it("bounds a scale and a roll back as the catalog's flags do", (): void => {
      const flagOf: (operation: string, name: string) => string = (
        operation: string,
        name: string,
      ): string => {
        return (
          (getCloudOperation(operation) as CloudOperationSpec).flags.find(
            (flag: { name: string }): boolean => {
              return flag.name === name;
            },
          )?.description || ""
        );
      };

      expect(flagOf("scale-out", "count")).toContain(
        "within the group's maximum (at most double the current count where the platform sets no maximum",
      );
      expect(flagOf("scale-in", "count")).toContain(
        "not below the group's minimum",
      );
      expect(flagOf("scale-in", "count")).toContain("never 0");
      expect(flagOf("roll-back-service", "to")).toContain(
        "without it, the one before the current one",
      );
      expect(flagOf("roll-back-service", "slot")).toContain(
        "the deployment slot to swap with production",
      );
      expect(words).toContain(
        "`scale-out` stays within the group's maximum, and at most doubles the count where the platform sets none; `scale-in` never goes below the minimum or to zero.",
      );
      expect(words).toContain(
        "`roll-back-service` moves to the version that ran before, or to the one `--to` names; on an App Service it swaps a deployment slot (`--slot`) back.",
      );
    });

    it("undoes a change from the value the agent reports it replaced, as the catalog writes the undo", (): void => {
      const scaleOut: CloudCommandParse = parseCloudCommand("aws", [
        "cloud",
        "scale-out",
        CLOUD_EXAMPLE_IDS.aws,
        "--count",
        "4",
      ]);
      const restart: CloudCommandParse = parseCloudCommand("aws", [
        "cloud",
        "restart-service",
        CLOUD_EXAMPLE_IDS.aws,
      ]);

      expect(scaleOut.ok && restart.ok).toBe(true);

      if (!scaleOut.ok || !restart.ok) {
        return;
      }

      const undo: CloudUndoResult = getCloudUndoCommand({
        command: scaleOut.command,
        replaced: { count: "2" },
      });

      expect(undo).toEqual({
        kind: "command",
        argv: ["cloud", "scale-in", CLOUD_EXAMPLE_IDS.aws, "--count", "2"],
      });
      // Without the value it replaced, it is not guessed.
      expect(
        getCloudUndoCommand({ command: scaleOut.command, replaced: {} }).kind,
      ).toBe("unknown");
      expect(
        getCloudUndoCommand({ command: restart.command, replaced: {} }).kind,
      ).toBe("nothing");
      expect(words).toContain(
        "Before it makes a change, the agent reads the value the change replaces, such as the count before a scale or the version before a roll back, and OneUptime writes the change's undo from that value, so a fix that did not help is put back exactly.",
      );
    });

    it("dry-runs each change of a fix before a person approves it, as the runner, the card and the agent do", (): void => {
      const runner: string = readRepoFile(
        "packages/Common/Server/Utils/AI/Remediation/RemediationExecutionRunner.ts",
      );
      const copy: string = readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/AutoRemediation/CloudDryRunCopy.ts",
      );
      const aws: string = readRepoFile(
        "agents/ResourceAIAgent/Executors/Cloud/AwsOperations.ts",
      );

      // Both ways a plan is settled for a person start its dry runs.
      expect(
        runner.split("CloudChangeDryRun.startForProposedPlan(").length - 1,
      ).toBe(2);
      expect(copy).toContain('dryRunAgain: translationKey("Dry run again"),');
      // On AWS a dry run's session of the write role writes nothing.
      expect(aws).toContain(
        "const writeResources: Array<string> = this.run.dryRun ? [] : requested;",
      );
      expect(words).toContain(
        "Before a person approves a fix that changes a cloud account, OneUptime dry-runs each change it proposes, and the fix's card on the incident or alert shows the answer under the change:",
      );
      expect(words).toContain("**Dry run again** checks once more.");
      expect(words).toContain(
        "A dry run changes nothing: the agent stops before the call that would make the change, and on AWS the session of the write role it uses may only read.",
      );
    });

    it("changes only what the account's inventory lists, and only proposes a fix to a resource declared as code, as the server holds it", (): void => {
      const targets: string = readRepoFile(
        "packages/Common/Server/Utils/AI/ResourceAccess/CloudAiTargets.ts",
      );
      const tools: string = oneLine(
        readRepoFile(
          "packages/Common/Server/Utils/AI/Remediation/RemediationCommandTools.ts",
        ),
      );

      expect(targets).toContain(
        "account's inventory, so OneUptime AI may not change it.",
      );
      expect(targets).toContain('folded === "aws:cloudformation:stack-name"');
      expect(targets).toContain('{ word: "terraform", name: "Terraform" }');
      expect(targets).toContain('{ word: "pulumi", name: "Pulumi" }');
      expect(tools).toContain(
        "OneUptime AI only proposes changes to resources declared as code: the next apply would put the old value back.",
      );
      expect(words).toContain(
        "A change names one resource by its id, as a read does, and runs only on a resource the account's inventory lists,",
      );
      expect(words).toContain(
        "A resource whose tags say code declares it (a CloudFormation stack, Terraform, Pulumi and the like) only ever gets its fix proposed for approval, in every mode, because the next apply would put the old value back; the plan names the code that owns it.",
      );
    });
  });

  describe("the command allowlist", (): void => {
    const allowlist: string = section(page, "### The command allowlist");

    it("shows a valid entry for every resource type, the one the AI agent page suggests", (): void => {
      for (const type of ALL_AI_RESOURCE_TYPES) {
        const example: string = RESOURCE_AI_ALLOWLIST_EXAMPLES[type];

        expect({ type, shown: allowlist.includes(`\`${example}\``) }).toEqual({
          type,
          shown: true,
        });
        expect({
          type,
          problem: ResourceCommandPolicy.describeAllowlistPatternProblem({
            resourceType: type,
            pattern: example,
          }),
        }).toEqual({ type, problem: null });
      }
    });

    it("refuses and accepts entries exactly as the page says", (): void => {
      const docker: AiResourceType = AiResourceType.DockerHost;

      for (const refused of ["docker *", "docker * web", "docker stop web-*"]) {
        expect(allowlist).toContain(`\`${refused}\``);
        expect({
          refused,
          problem:
            ResourceCommandPolicy.describeAllowlistPatternProblem({
              resourceType: docker,
              pattern: refused,
            }) !== null,
        }).toEqual({ refused, problem: true });
      }

      expect(allowlist).toContain("`docker update --memory * web`");
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: docker,
          pattern: "docker update --memory * web",
        }),
      ).toBeNull();
      expect(
        ResourceCommandPolicy.isBroadAllowlistPattern({
          resourceType: docker,
          pattern: "docker update --memory * web",
        }),
      ).toBe(false);

      expect(allowlist).toContain("`docker stop *`");
      expect(
        ResourceCommandPolicy.isBroadAllowlistPattern({
          resourceType: docker,
          pattern: "docker stop *",
        }),
      ).toBe(true);

      // A Proxmox path is one word: a * inside it never matches.
      expect(
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: AiResourceType.ProxmoxCluster,
          pattern: "pvesh create /nodes/*/qemu/100/status/shutdown",
        }),
      ).not.toBeNull();

      // Read and denied entries pre-approve nothing.
      for (const pattern of ["docker ps -a", "docker exec web sh"]) {
        expect(
          ResourceCommandPolicy.describeAllowlistPatternProblem({
            resourceType: docker,
            pattern,
          }),
        ).not.toBeNull();
      }

      // An entry pre-approves the command it names in Automatic mode.
      expect(
        ResourceCommandPolicy.evaluateForAutoExecution({
          resourceType: docker,
          command: "docker update --memory 2g web",
          allowlistPatterns: ["docker update --memory * web"],
          bypassApproval: false,
        }).verdict,
      ).toBe("AutoApproved");
      expect(
        ResourceCommandPolicy.evaluateForAutoExecution({
          resourceType: docker,
          command: "docker update --memory 2g api",
          allowlistPatterns: ["docker update --memory * web"],
          bypassApproval: false,
        }).verdict,
      ).toBe("RequiresApproval");
    });
  });

  /*
   * "These options should depend on the agent itself": the page documents
   * the two variables the agents read (the shared contract's names and
   * spellings), the example is the AI agent page's own .env lines, and it
   * says the page follows them read-only.
   */
  describe("what AI may do, set by the agent", (): void => {
    const setByAgent: string = section(
      page,
      "### What AI may do, set by the agent",
    );

    it("names both variables and every fixes value, as the agents read them", (): void => {
      expect(tableRow(setByAgent, `\`${AI_INVESTIGATION_ENV}\``)).toContain(
        "`true`",
      );
      const fixes: string = tableRow(setByAgent, `\`${AI_FIXES_ENV}\``);

      for (const mode of AGENT_AI_FIXES_MODES) {
        expect({
          mode,
          named: fixes.includes(
            `\`${AGENT_AI_FIXES_SETTING_VALUES[mode as AgentAiFixesMode]}\``,
          ),
        }).toEqual({ mode, named: true });
      }
      // Fixes also need the write switch.
      expect(fixes).toContain("`ONEUPTIME_AI_ALLOW_WRITES=true`");
    });

    it("the example is the AI agent page's own .env lines for Ask for approval", (): void => {
      expect(setByAgent).toContain(
        `\`\`\`bash\n${getResourceAiAgentSettingsEnv({
          investigation: true,
          fixes: "RequireApproval",
        })}\n\`\`\``,
      );
    });

    it("says the page follows them read-only, and that the allowlist stays on the page", (): void => {
      const flat: string = setByAgent.replace(/\s+/g, " ");

      expect(flat).toContain("shows them read-only");
      expect(flat).toContain("refuses a change made anywhere else");
      expect(flat).toContain("The command allowlist stays on the page.");
    });

    it("every collector passes both to its AI agent, so a .env line reaches it", (): void => {
      for (const type of COMPOSE_TYPES) {
        const compose: string = readRepoFile(composeFileOf(type));

        for (const variable of [AI_INVESTIGATION_ENV, AI_FIXES_ENV]) {
          expect({
            type,
            variable,
            passed: compose.includes(`- ${variable}=\${${variable}:-}`),
          }).toEqual({ type, variable, passed: true });
        }
      }
    });
  });

  describe("write access", (): void => {
    const writeAccess: string = section(page, "## Write access on the agent");

    it("names a target the way the policy computes it, and each example glob admits it", (): void => {
      const table: string = section(
        writeAccess,
        "### Write targets per resource",
      );

      const cases: Array<{
        row: string;
        type: AiResourceType;
        command: string;
        targets: Array<string>;
      }> = [
        {
          row: "Docker and Podman hosts",
          type: AiResourceType.DockerHost,
          command: "docker restart web-1",
          targets: ["web-1"],
        },
        {
          row: "Docker Swarm clusters",
          type: AiResourceType.DockerSwarmCluster,
          command: "docker service scale web_frontend=3",
          targets: ["web_frontend"],
        },
        {
          row: "Proxmox clusters",
          type: AiResourceType.ProxmoxCluster,
          command: "pvesh create /nodes/pve1/qemu/101/status/start",
          targets: ["101"],
        },
        {
          row: "Proxmox clusters",
          type: AiResourceType.ProxmoxCluster,
          command: "pvesh create /nodes/pve1/services/pveproxy/restart",
          targets: ["pve1/pveproxy"],
        },
        {
          row: "VMware vCenter",
          type: AiResourceType.VMwareVCenter,
          command: "govc vm.power -on /DC/vm/web/web-01",
          targets: ["/DC/vm/web/web-01"],
        },
        {
          row: "Ceph clusters",
          type: AiResourceType.CephCluster,
          command: "ceph osd out 3",
          targets: ["osd.3"],
        },
        {
          row: "Ceph clusters",
          type: AiResourceType.CephCluster,
          command: "ceph osd set noout",
          targets: ["cluster"],
        },
        {
          row: "Database servers",
          type: AiResourceType.DatabaseServer,
          command: "db terminate-session 12345",
          targets: ["session:12345"],
        },
        {
          row: "Hosts",
          type: AiResourceType.Host,
          command: "systemctl restart nginx",
          targets: ["nginx.service"],
        },
        {
          row: "Cloud accounts",
          type: AiResourceType.AwsAccount,
          command: `cloud restart-service ${CLOUD_EXAMPLE_IDS.aws}`,
          targets: [CLOUD_EXAMPLE_IDS.aws],
        },
      ];

      for (const testCase of cases) {
        const cells: Array<string> = tableCells(tableRow(table, testCase.row));
        const result: ResourceCommandPolicyResult = evaluate(
          testCase.type,
          testCase.command,
        );

        expect({ command: testCase.command, targets: result.targets }).toEqual({
          command: testCase.command,
          targets: testCase.targets,
        });

        const example: string = codeSpans(cells[2] as string)[0] as string;

        expect({
          command: testCase.command,
          example,
          refusal: ResourceCommandPolicy.getWriteScopeRefusal({
            result,
            allowWrites: true,
            writeTargets: example.split(","),
            protectedTargets: [],
            resourceType: testCase.type,
          }),
        }).toEqual({ command: testCase.command, example, refusal: null });
      }

      // The other forms the table promises.
      expect(
        evaluate(AiResourceType.CephCluster, "ceph osd out osd.3").targets,
      ).toEqual(["osd.3"]);
      expect(evaluate(AiResourceType.Host, "kill -TERM 4242").targets).toEqual([
        "pid:4242",
      ]);
      expect(
        evaluate(AiResourceType.Host, "journalctl --vacuum-size=500M").targets,
      ).toEqual(["journal"]);
      // An Azure resource ID is a target in lowercase.
      expect(
        evaluate(
          AiResourceType.AzureSubscription,
          `cloud restart-service ${CLOUD_EXAMPLE_IDS.azure}`,
        ).targets,
      ).toEqual([CLOUD_EXAMPLE_IDS.azure.toLowerCase()]);
      expect(
        evaluate(
          AiResourceType.GoogleCloudProject,
          `cloud scale-out ${CLOUD_EXAMPLE_IDS.gcp} --count 2`,
        ).targets,
      ).toEqual([CLOUD_EXAMPLE_IDS.gcp]);
      expect(tableRow(table, "Cloud accounts")).toContain(
        "the resource's id: an ARN, an Azure resource ID in lowercase, or a Google Cloud full resource name",
      );

      for (const literal of [
        "`osd.3`",
        "`cluster`",
        "`session:<id>`",
        "`nginx.service`",
        "`pid:<pid>`",
        "`journal`",
        "`pve1/pveproxy`",
        "`101`",
      ]) {
        expect(table).toContain(literal);
      }
    });

    it("describes the write switch and target lists as the agent parses them", (): void => {
      const flat: string = writeAccess.replace(/\s+/g, " ");

      expect(flat).toContain(`\`${RESOURCE_AI_ALLOW_WRITES_ENV}\``);
      expect(flat).toContain(`\`${RESOURCE_AI_WRITE_TARGETS_ENV}\``);

      // Without the switch, every write is refused whatever the targets.
      const restart: ResourceCommandPolicyResult = evaluate(
        AiResourceType.DockerHost,
        "docker restart web",
      );

      expect(
        ResourceCommandPolicy.getWriteScopeRefusal({
          result: restart,
          allowWrites: false,
          writeTargets: [],
          protectedTargets: [],
          resourceType: AiResourceType.DockerHost,
        }),
      ).toContain(`${RESOURCE_AI_ALLOW_WRITES_ENV}=true`);

      // With targets set, a write outside them is refused.
      expect(
        ResourceCommandPolicy.getWriteScopeRefusal({
          result: restart,
          allowWrites: true,
          writeTargets: ["api-*"],
          protectedTargets: [],
          resourceType: AiResourceType.DockerHost,
        }),
      ).toContain("outside the targets");

      // Target globs are case-sensitive, protected ones are not.
      expect(
        ResourceCommandPolicy.getWriteScopeRefusal({
          result: restart,
          allowWrites: true,
          writeTargets: ["WEB"],
          protectedTargets: [],
          resourceType: AiResourceType.DockerHost,
        }),
      ).not.toBeNull();
      expect(
        ResourceCommandPolicy.getWriteScopeRefusal({
          result: restart,
          allowWrites: true,
          writeTargets: [],
          protectedTargets: ["WEB"],
          resourceType: AiResourceType.DockerHost,
        }),
      ).toContain("protects");
      expect(flat).toContain("the match is case-sensitive");
      expect(flat).toContain("Compared case-insensitively");

      // Only "true" (any case) turns the switch on.
      const config: string = readRepoFile("agents/ResourceAIAgent/Config.ts");
      expect(config).toContain('.trim().toLowerCase() === "true"');
    });

    it("lists the targets the Host AI agent protects on its own", (): void => {
      const source: string = readRepoFile(
        "agents/ResourceAIAgent/Executors/HostExecutor.ts",
      );
      const block: RegExpMatchArray | null = source.match(
        /ONEUPTIME_HOST_PROTECTED_TARGETS: ReadonlyArray<string> = \[([^\]]*)\]/,
      );

      expect(block).not.toBeNull();

      const protectedTargets: Array<string> = Array.from(
        (block?.[1] as string).matchAll(/"([^"]+)"/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(protectedTargets.length).toBeGreaterThan(0);

      const protects: string = section(
        writeAccess,
        "### What the agent protects on its own",
      );

      for (const target of protectedTargets) {
        expect({ target, named: protects.includes(`\`${target}\``) }).toEqual({
          target,
          named: true,
        });
      }
    });

    it("lists what a Cloud AI agent protects on its own: everything its setup command made", (): void => {
      const protects: string = section(
        writeAccess,
        "### What the agent protects on its own",
      );
      const bullet: string =
        protects.split("\n").find((line: string): boolean => {
          return line.startsWith("- **Cloud accounts:** ");
        }) || "";

      for (const name of [
        AWS_CLOUD_AI_AGENT_STACK_NAME,
        AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
        AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
        AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
        GCP_CLOUD_AI_AGENT_SERVICE_NAME,
      ]) {
        expect({ name, named: codeSpans(bullet).includes(name) }).toEqual({
          name,
          named: true,
        });
      }

      // The agent's own targets: its stack, cluster, service and roles; its resource group; its service and service account.
      const own: Record<CloudCatalogProvider, Array<string>> = {
        aws: getCloudAiAgentOwnTargets({
          provider: "aws",
          accountId: "123456789012",
        }),
        azure: getCloudAiAgentOwnTargets({
          provider: "azure",
          accountId: CLOUD_ACCOUNT_IDS.azure,
        }),
        gcp: getCloudAiAgentOwnTargets({
          provider: "gcp",
          accountId: "my-project",
        }),
      };

      expect(own.aws).toEqual([
        `arn:aws*:ecs:*:123456789012:service/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}/*`,
        `arn:aws*:ecs:*:123456789012:cluster/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}`,
        `arn:aws*:iam::123456789012:role/${AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME}`,
        `arn:aws*:iam::123456789012:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
        `arn:aws*:cloudformation:*:123456789012:stack/${AWS_CLOUD_AI_AGENT_STACK_NAME}/*`,
      ]);
      expect(own.azure).toEqual([
        `/subscriptions/${CLOUD_ACCOUNT_IDS.azure}/resourcegroups/${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP}/*`,
      ]);
      expect(own.gcp).toEqual([
        `//run.googleapis.com/projects/my-project/locations/*/services/${GCP_CLOUD_AI_AGENT_SERVICE_NAME}`,
        `//iam.googleapis.com/projects/my-project/serviceAccounts/${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@*`,
      ]);
      expect(oneLine(bullet)).toContain(
        "on AWS the `oneuptime-ai-agent` stack, its ECS cluster and service, and the roles `OneUptimeAiAgentTask` and `OneUptimeAiAgentWrite`; on Azure the `oneuptime-ai-agent` resource group; on Google Cloud the `oneuptime-ai-agent` Cloud Run service and service account.",
      );
    });

    it("describes a Cloud AI agent's changes and required tag as its setup command writes them", (): void => {
      const operations: string = tableRow(
        writeAccess,
        `\`${RESOURCE_AI_CLOUD_OPERATIONS_ENV}\``,
      );
      const tag: string = tableRow(
        writeAccess,
        `\`${RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV}\``,
      );
      const variables: (
        options: CloudAiAgentSetupOptions,
      ) => Record<string, string> = (
        options: CloudAiAgentSetupOptions,
      ): Record<string, string> => {
        const found: Record<string, string> = {};

        for (const variable of getCloudAiAgentEnvironment(options)) {
          found[variable.name] = variable.value;
        }

        return found;
      };

      // Every change: the variable is left out, and empty means every change.
      expect(
        variables(cloudSetupOptions(CloudProvider.AWS, "aws"))[
          RESOURCE_AI_CLOUD_OPERATIONS_ENV
        ],
      ).toBeUndefined();
      expect(
        variables(
          cloudSetupOptions(CloudProvider.AWS, "aws", {
            enabledOperations: ["restart-service", "scale-out"],
          }),
        )[RESOURCE_AI_CLOUD_OPERATIONS_ENV],
      ).toBe("restart-service,scale-out");
      expect(operations).toContain("`restart-service,scale-out`");
      expect(operations).toContain(
        "Empty: every change of the catalog, each with its tier.",
      );

      // The tag, and on AWS the write role's own condition on it.
      expect(CLOUD_AI_DEFAULT_REQUIRED_TAG).toBe("oneuptime-ai=allow");
      expect(
        variables(
          cloudSetupOptions(CloudProvider.Azure, "azure", {
            requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
          }),
        )[RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV],
      ).toBe(CLOUD_AI_DEFAULT_REQUIRED_TAG);
      expect(
        getAwsCloudAiAgentTemplate(
          cloudSetupOptions(CloudProvider.AWS, "aws", {
            requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
          }),
        ),
      ).toContain('"aws:ResourceTag/oneuptime-ai":"allow"');
      expect(tag).toContain(`\`${CLOUD_AI_DEFAULT_REQUIRED_TAG}\``);
      expect(tag).toContain(
        "on AWS its write role allows the changes on those resources alone",
      );

      // The agent reads both (and refuses every change on a tag it cannot read).
      const settings: string = readRepoFile(
        "agents/ResourceAIAgent/Executors/Cloud/CloudSettings.ts",
      );

      expect(settings).toContain("RESOURCE_AI_CLOUD_OPERATIONS_ENV");
      expect(settings).toContain("RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV");
      expect(settings).toContain(
        "so the agent changes nothing until it is fixed",
      );
      expect(tag).toContain(
        "A value that is not `key=value` refuses every change.",
      );
      expect(oneLine(writeAccess)).toContain(
        "A Cloud AI agent's come from its setup command, as **Which changes AI may make (their tiers still apply)**, **Resources AI must never change** and the tag under **More fields** in **Let AI fix problems** set them: run the command again to change them.",
      );
    });

    it("says the vCenter appliance is protected by its name only, so with an IP endpoint it must be listed by hand", (): void => {
      // The agent: the VM named after the endpoint's host, nothing for an IP address.
      const govc: string = readRepoFile(
        "agents/ResourceAIAgent/Executors/GovcExecutor.ts",
      );

      expect(govc).toContain("net.isIP(host) !== 0");
      expect(govc).toContain("reaches vCenter by its IP address");

      const vmwarePage: string = TELEMETRY_PAGES[AiResourceType.VMwareVCenter];
      const prose: Array<[string, string]> = [
        [PAGE, section(writeAccess, "### What the agent protects on its own")],
        [vmwarePage, section(readPage(vmwarePage), "## AI agent")],
        [
          "agents/VMwareAgent/README.md",
          readRepoFile("agents/VMwareAgent/README.md"),
        ],
        [
          "agents/ResourceAIAgent/README.md",
          section(
            readRepoFile("agents/ResourceAIAgent/README.md"),
            "### VMware vCenter",
          ),
        ],
      ];

      for (const [source, text] of prose) {
        const flat: string = text.replace(/\s+/g, " ");

        expect({
          source,
          unconditional: UNCONDITIONAL_APPLIANCE.test(flat),
          ipAddress:
            flat.includes("`VCENTER_ENDPOINT`") &&
            flat.includes("an IP address"),
          listIt: flat.includes("`ONEUPTIME_AI_PROTECTED_TARGETS`"),
        }).toEqual({
          source,
          unconditional: false,
          ipAddress: true,
          listIt: true,
        });
      }

      // The installer's prompt decides what goes into the list.
      const install: string = readRepoFile("agents/VMwareAgent/install.sh");

      expect(install).not.toContain("is always protected");
      // So does the AI agent page's hint for the list.
      const pageHint: string = readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall.ts",
      );

      expect(pageHint).not.toContain("on top of the vCenter appliance itself");
      expect(pageHint).toContain(
        "when VCENTER_ENDPOINT is an IP address or the VM is named otherwise",
      );
      expect(install).toContain(
        "An endpoint given as an IP address protects no VM on its own.",
      );

      // And so does the comment next to the setting.
      const compose: string =
        composeServices(composeFileOf(AiResourceType.VMwareVCenter)).get(
          getResourceAiAgentServiceName(AiResourceType.VMwareVCenter),
        ) || "";

      expect(compose.replace(/\s*#\s*/g, " ")).toContain(
        "With an IP address as the endpoint, or an appliance VM named otherwise, put the appliance's VM name in ONEUPTIME_AI_PROTECTED_TARGETS.",
      );
    });
  });

  describe("credentials and security", (): void => {
    it("only names credential variables the agent really reads", (): void => {
      const credentials: string = section(
        page,
        "## Credentials and least privilege",
      );
      const agentSource: string = renderedAgentSource();
      // The "What the agent uses" column of every resource's row.
      const variables: Array<string> = credentials
        .split("\n")
        .filter((line: string): boolean => {
          return (
            line.startsWith("| ") &&
            !line.startsWith("| Resource") &&
            !line.startsWith("| ---")
          );
        })
        .flatMap((line: string): Array<string> => {
          return codeSpans(tableCells(line)[1] as string);
        })
        .filter((span: string): boolean => {
          return ENV_TOKEN.test(span);
        });

      expect(variables.length).toBeGreaterThan(10);

      for (const variable of variables) {
        expect({
          variable,
          read: agentSource.includes(`"${variable}"`),
        }).toEqual({ variable, read: true });
      }
    });

    it("gives Ceph exactly the read caps the agent asks for", (): void => {
      const caps: RegExpMatchArray | null = readRepoFile(
        "agents/ResourceAIAgent/Executors/CephExecutor.ts",
      ).match(/CEPH_READ_CAPS: string =\s*"([^"]+)"/);

      expect(caps).not.toBeNull();
      expect(section(page, "## Credentials and least privilege")).toContain(
        `\`${caps?.[1]}\``,
      );
      expect(readPage(TELEMETRY_PAGES[AiResourceType.CephCluster])).toContain(
        `client.oneuptime-ai ${caps?.[1]}`,
      );
    });

    it("says plainly that the Docker and Podman socket and the Host AI agent are root on the host", (): void => {
      const root: string = section(
        page,
        "### The Docker socket and the Host AI agent are root on the host",
      );

      expect(root).toContain(
        "**The Docker and Podman socket is root on the host.**",
      );
      expect(root).toContain("**The Host AI agent is root on the host.**");
      expect(root).toContain("`:ro`");
      expect(root).toContain(`\`${RESOURCE_AI_ALLOW_WRITES_ENV}\``);
      expect(root).toContain(`\`${RESOURCE_AI_WRITE_TARGETS_ENV}\``);
    });

    it("names the three enforcement points", (): void => {
      const points: string = section(page, "### Three enforcement points");

      expect(points).toContain("1. **OneUptime AI's tools.**");
      expect(points).toContain("2. **When OneUptime queues it.**");
      expect(points).toContain("3. **On the agent, before anything runs.**");
    });

    it("reads Enable AI where every AI command is queued and again where an agent claims one, as the server does", (): void => {
      const points: string = oneLine(
        section(page, "### Three enforcement points"),
      );
      const enqueue: string = readRepoFile(
        "packages/Common/Server/Services/RunnerJobService.ts",
      );
      const killSwitch: string = readRepoFile(
        "packages/Common/Server/Utils/AI/AiCommandKillSwitch.ts",
      );

      expect(points).toContain(
        "2. **When OneUptime queues it.** Every command is checked again: **Enable AI** must still be on (and is read once more when the agent claims the command), a Denied command is refused,",
      );

      // Every way an AI command is queued reads the switch...
      for (const enqueueFunction of [
        "public async enqueueAiCommand(",
        "public async enqueueAiKubectlCommand(",
        "public async enqueueAiResourceCommand(",
      ]) {
        const start: number = enqueue.indexOf(enqueueFunction);

        expect({ enqueueFunction, found: start >= 0 }).toEqual({
          enqueueFunction,
          found: true,
        });

        const next: number = enqueue.indexOf("\n  public ", start + 1);
        const body: string = enqueue.slice(
          start,
          next < 0 ? enqueue.length : next,
        );

        expect({
          enqueueFunction,
          reads: body.includes("AiCommandKillSwitch.isAiOff("),
        }).toEqual({ enqueueFunction, reads: true });
      }

      // ...and so does every ingress an agent claims one from.
      for (const ingress of [
        "packages/App/FeatureSet/Runbook/API/ResourceAiAgentIngress.ts",
        "packages/App/FeatureSet/Runbook/API/KubernetesAiAgentIngress.ts",
        "packages/App/FeatureSet/Runbook/API/RunnerIngress.ts",
      ]) {
        expect({
          ingress,
          reads: readRepoFile(ingress).includes(
            "AiCommandKillSwitch.getClaimRefusal(",
          ),
        }).toEqual({ ingress, reads: true });
      }

      // Test connection is the one AI command that still runs.
      expect(killSwitch).toContain("public static isAccessTestJob(");
      expect(killSwitch).toContain(
        "AiCommandKillSwitch.isAccessTestJob(data.job)",
      );
      expect(oneLine(section(page, "## How fixes work"))).toContain(
        "Turning it off stops every command OneUptime AI sends at once, an approved plan's next command and a rollback included; only **Test connection**, in the **⋯** menu next to the agent's status, still runs.",
      );
    });

    /*
     * The project's own switches: off by default, so a resource whose
     * fixes are on fixes nothing new until one is on. The status carries
     * them, the page draws them under the fixes with a link to each one
     * that is off, and the cloud account's setup dialog says so under its
     * question - what the docs say.
     */
    it("says the project's automatic fixing switches gate every resource's fixes, and where the page shows them", (): void => {
      expect(oneLine(section(page, "## How fixes work"))).toContain(
        "Two project switches decide whether anything new is fixed at all: **Fix new incidents automatically** (on **Incidents → AI → Settings**) and **Fix new alerts automatically** (on **Alerts → AI → Settings**) start off, and until one is on, nothing new of that kind is fixed. The **Fixes** row of the **AI agent** page says where both stand, with a link to each one that is off.",
      );

      const service: string = oneLine(
        readRepoFile(
          "packages/Common/Server/Services/ResourceAiAccessService.ts",
        ),
      );
      expect(service).toContain(
        "...(gates.automaticRemediation ? { automaticRemediation: { incidents: gates.automaticRemediation.incidents === true, alerts: gates.automaticRemediation.alerts === true, }, } : {}),",
      );

      const resourcePage: string = readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentPage.tsx",
      );
      // The page draws the shared note, which links each switch's page.
      const note: string = readRepoFile(
        "packages/App/FeatureSet/Dashboard/src/Components/AiAccess/AutomaticRemediationNote.tsx",
      );
      expect(resourcePage).toContain("<AutomaticRemediationNote");
      expect(resourcePage).toContain(
        'dataTestId="ai-access-automatic-remediation"',
      );
      expect(note).toContain("PageMap.INCIDENTS_SETTINGS_AI");
      expect(note).toContain("PageMap.ALERTS_SETTINGS_AI");

      // The switches the docs name are the ones the project's AI pages draw.
      const projectModel: string = readRepoFile(
        "packages/Common/Models/DatabaseModels/Project.ts",
      );
      expect(projectModel).toContain(
        "public enableAutomaticIncidentRemediation?: boolean = undefined;",
      );
      expect(projectModel).toContain(
        "public enableAutomaticAlertRemediation?: boolean = undefined;",
      );
    });
  });

  describe("troubleshooting", (): void => {
    it("quotes only messages the agent and the policy really print", (): void => {
      const errors: string = section(page, "### Common errors");
      const source: string = [
        renderedAgentSource(),
        ...readSourceTree(
          path.join(COMMON_DIR, "Utils/AiRemediation/Resource"),
        ),
      ].join("\n");

      const quoted: Array<string> = errors
        .split("\n")
        .filter((line: string): boolean => {
          return (
            line.startsWith("| ") &&
            !line.startsWith("| What you see") &&
            !line.startsWith("| ---")
          );
        })
        .flatMap((line: string): Array<string> => {
          return codeSpans(tableCells(line)[0] as string);
        })
        .filter((span: string): boolean => {
          return !span.startsWith(RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV + "=");
        });

      expect(quoted.length).toBeGreaterThan(8);

      for (const message of quoted) {
        for (const fragment of message.split("…")) {
          const text: string = fragment.trim().replace(/^:\s*/, "");

          if (text.length < 4) {
            continue;
          }

          expect({
            message,
            fragment: text,
            printed: source.includes(text),
          }).toEqual({ message, fragment: text, printed: true });
        }
      }
    });
  });

  describe("the resource telemetry pages", (): void => {
    for (const type of COMPOSE_TYPES) {
      const relative: string = TELEMETRY_PAGES[type];

      it(`${relative} has an AI agent section that names the agent and links to its part of the page`, (): void => {
        const markdown: string = readPage(relative);
        const aiAgent: string = section(markdown, "## AI agent");
        const info: AiResourceTypeInfo = infoOf(type);

        expect(aiAgent).toContain(info.agentDisplayName);
        expect(aiAgent).toContain(IMAGE);
        expect(aiAgent).toContain(`\`${RESOURCE_AI_ALLOW_WRITES_ENV}=true\``);

        if (type === AiResourceType.Host) {
          // The installer the AI agent page shows, from this OneUptime.
          expect(aiAgent).toContain(
            "```bash\n" +
              getHostAiAgentInstallCommand(DOCS_ONEUPTIME_URL) +
              "\n```",
          );
        } else {
          expect(aiAgent).toContain(
            `\`${getResourceAiAgentServiceName(type)}\``,
          );
        }

        const anchors: Array<string> = Array.from(
          aiAgent.matchAll(
            new RegExp(`\\]\\(${PAGE_URL}#([a-z0-9_-]+)\\)`, "g"),
          ),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        });

        for (const anchor of anchors) {
          expect({ anchor, resolves: headingSlugs(page).has(anchor) }).toEqual({
            anchor,
            resolves: true,
          });
        }

        // One of them is the resource's own part of the page.
        const expected: ResourceSection | undefined = RESOURCE_SECTIONS.find(
          (resource: ResourceSection): boolean => {
            return resource.types.includes(type);
          },
        );

        expect(anchors).toContain(slugify(expected?.title as string));
      });
    }

    it(`${CLOUD_ACCOUNTS_PAGE} has a Let AI fix problems section that names the Cloud AI agent and links to its part of the page`, (): void => {
      for (const type of CLOUD_AI_RESOURCE_TYPES) {
        expect({ type, page: TELEMETRY_PAGES[type] }).toEqual({
          type,
          page: CLOUD_ACCOUNTS_PAGE,
        });
        expect(infoOf(type).agentDisplayName).toBe("Cloud AI agent");
      }

      const fix: string = section(
        readPage(CLOUD_ACCOUNTS_PAGE),
        "## Let AI fix problems",
      );
      const anchors: Array<string> = Array.from(
        fix.matchAll(new RegExp(`\\]\\(${PAGE_URL}#([a-z0-9_-]+)\\)`, "g")),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(fix).toContain(infoOf(AiResourceType.AwsAccount).agentDisplayName);
      expect(fix).toContain("**Let AI fix problems**");
      expect(anchors).toEqual(["in-a-cloud-account"]);

      for (const anchor of anchors) {
        expect({ anchor, resolves: headingSlugs(page).has(anchor) }).toEqual({
          anchor,
          resolves: true,
        });
      }

      // And the AI agents page links back to it.
      expect(page).toContain(
        "](/docs/telemetry/cloud-accounts#let-ai-fix-problems)",
      );
    });

    it("keeps the Persian VMware page's AI agent section in step with the English one", (): void => {
      const relative: string = TELEMETRY_PAGES[AiResourceType.VMwareVCenter];
      const english: Array<string> = readPage(relative).split("\n");
      const persian: Array<string> = readPage(relative, "fa").split("\n");

      /*
       * The Persian page mirrors the English one line for line
       * (VMwareDocs.test.ts), so its AI agent section starts on the same
       * line and runs to the next "## " heading.
       */
      const start: number = english.indexOf("## AI agent");

      expect(start).toBeGreaterThan(0);
      expect(persian[start]).toMatch(/^## \S/);

      const sectionOf: (lines: Array<string>) => string = (
        lines: Array<string>,
      ): string => {
        const end: number = lines.findIndex(
          (line: string, index: number): boolean => {
            return index > start && line.startsWith("## ");
          },
        );
        return lines.slice(start + 1, end).join("\n");
      };

      const englishSection: string = sectionOf(english);
      const persianSection: string = sectionOf(persian);

      expect(codeSpans(persianSection)).toEqual(codeSpans(englishSection));
      expect(persianSection).toContain(`](${PAGE_URL}#vmware-vcenter)`);
    });
  });

  describe("the AI SRE page", (): void => {
    it("links to this page from its own section, after the Kubernetes cluster-access section", (): void => {
      const aiSre: string = readPage(AI_SRE_PAGE);
      const clusterAccess: string = section(
        aiSre,
        "## Cluster access — let OneUptime AI run kubectl",
      );

      // The Kubernetes section is left as it was.
      expect(clusterAccess).not.toContain(PAGE_URL);
      expect(clusterAccess).not.toContain(RESOURCE_AI_AGENT_IMAGE_REPOSITORY);

      const headings: Array<string> = getHeadings(aiSre).filter(
        (heading: string): boolean => {
          return heading.startsWith("## ");
        },
      );
      const clusterIndex: number = headings.indexOf(
        "## Cluster access — let OneUptime AI run kubectl",
      );
      const infrastructure: string | undefined = headings[clusterIndex + 1];

      expect(infrastructure).toMatch(/^## Infrastructure access/);

      const body: string = section(aiSre, infrastructure as string);

      expect(body).toContain(`](${PAGE_URL})`);
      expect(body).toContain(`\`${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}\``);
      expect(body).toContain(`\`${RESOURCE_AI_ALLOW_WRITES_ENV}=true\``);
      expect(
        body.split("\n").filter((line: string): boolean => {
          return line.trim().length > 0;
        }),
      ).toHaveLength(1);
    });
  });

  describe("the agents' READMEs, against what the agent and OneUptime do", (): void => {
    const hostReadme: string = readRepoFile("agents/HostAIAgent/README.md");
    const agentReadme: string = readRepoFile(
      "agents/ResourceAIAgent/README.md",
    );

    it("says a Host AI agent with an unknown name gets a new, empty Host, as registration creates one, and promises no refusal", (): void => {
      // Every type but a database server is found or created by its name.
      const service: string = readRepoFile(
        "packages/Common/Server/Services/ResourceAiAgentService.ts",
      );

      expect(service).toContain("HostService.findOrCreateByHostIdentifier");

      const flat: string = hostReadme.replace(/\s+/g, " ");

      expect(flat).not.toContain("it does not create one");
      expect(flat).not.toContain("(no such Host)");
      expect(flat).not.toContain("or the agent is refused");
      expect(flat).toContain(
        "A name no Host has is not refused: OneUptime creates a new, empty Host under that name",
      );
      // The page and the agent's README say the same.
      expect(page.replace(/\s+/g, " ")).toContain(
        "gives you a second, empty resource instead of an error",
      );
      expect(agentReadme).toContain(
        "OneUptime creates the Host when none has that name yet",
      );
    });

    it("says how long a replacement waits after an agent that never signed off: until the old one has been silent for the takeover window", (): void => {
      const seconds: string = `${RESOURCE_AI_AGENT_TAKEOVER_AFTER_SILENT_SECONDS} seconds`;
      const aliveWindow: string = `${RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES} minutes`;

      /*
       * An agent that stopped cleanly signed off; one that crashed, was
       * killed or was removed with rm -f is taken over once it has sent
       * nothing for the takeover window — not the alive window it still
       * counts as online for.
       */
      for (const [source, text] of [
        [PAGE, page],
        ["agents/HostAIAgent/README.md", hostReadme],
        ["agents/ResourceAIAgent/README.md", agentReadme],
      ] as Array<[string, string]>) {
        const row: string =
          text.split("\n").find((line: string): boolean => {
            return line.startsWith("| `Waiting for this");
          }) || "";

        expect({
          source,
          takeover: row.includes(`sent nothing for ${seconds}`),
          aliveWindow: row.includes(aliveWindow),
          aMinute: A_MINUTE.test(row),
        }).toEqual({
          source,
          takeover: true,
          aliveWindow: false,
          aMinute: false,
        });
      }

      const flat: string = page.replace(/\s+/g, " ");

      expect(flat).not.toContain("which takes about a minute");
      expect(flat).not.toContain(`has been quiet for ${aliveWindow}`);
      expect(flat).toContain(
        `the replacement takes over once the old one has sent nothing for ${seconds} after the first refusal`,
      );
    });

    it("sends the Host AI agent's operator to /status for what the AI agent page does not show", (): void => {
      const dashboardDir: string = path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/ResourceAiAgent",
      );
      const dashboard: string = fs
        .readdirSync(dashboardDir)
        .filter((name: string): boolean => {
          return TYPESCRIPT_FILE.test(name);
        })
        .map((name: string): string => {
          return fs.readFileSync(path.join(dashboardDir, name), "utf8");
        })
        .join("\n");

      expect(dashboard.length).toBeGreaterThan(0);

      // Claims about the AI agent page only for what the page renders.
      if (!dashboard.includes("protectedTargets")) {
        expect(hostReadme).not.toContain("**AI → AI agent** page lists them");
      }

      if (!dashboard.includes("hostnameMatchesIdentity")) {
        expect(hostReadme).not.toContain(
          "page shows the agent's `hostname` and whether it matches",
        );
      }

      // What the README reads off /status is what /status reports.
      const status: string = readRepoFile(
        "agents/ResourceAIAgent/AgentStatus.ts",
      );

      for (const field of [
        "resourceIdentifier",
        "resourceName",
        "protectedTargets",
      ]) {
        expect({
          field,
          named: hostReadme.includes(`(\`${field}\`)`),
          reported: status.includes(`      ${field}:`),
        }).toEqual({ field, named: true, reported: true });
      }
    });

    it("describes Proxmox TLS verification as the agent decides it: a CA file always verifies", (): void => {
      expect(
        readRepoFile(
          "agents/ResourceAIAgent/Executors/ProxmoxExecutor.ts",
        ).replace(/\s+/g, " "),
      ).toContain('caFile !== "" ? true');

      const proxmox: string = section(
        agentReadme,
        "### Proxmox cluster",
      ).replace(/\s+/g, " ");

      expect(proxmox).not.toContain(
        "`PVE_CA_FILE` alone does not turn verification on",
      );
      expect(proxmox).toContain(
        "`PVE_CA_FILE`, when set, always turns verification on",
      );
      // The Proxmox agent's own README agrees.
      expect(readRepoFile("agents/ProxmoxAgent/README.md")).toContain(
        "setting it turns verification on",
      );
    });
  });
});

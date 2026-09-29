import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { getResourceAiAgentServiceName } from "../../../FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
} from "Common/Types/AI/ResourceAiAccessPermissions";
import { PermissionHelper } from "Common/Types/Permission";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  parseAiResourceType,
} from "Common/Types/ResourceAiAgent/AiResourceType";
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
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceCommandTier,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import ResourceCommandPolicy, {
  RESOURCE_ALLOWLIST_MAX_PATTERNS,
  RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH,
} from "Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import {
  RESOURCE_SHELL_SYNTAX_RULE,
  ResourceCommandPolicyResult,
} from "Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
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
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_DIR: string = path.join(REPO_ROOT, "packages/App/FeatureSet/Docs");
const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
const LOCALES_DIR: string = path.join(DOCS_DIR, "Locales");
const AGENTS_DIR: string = path.join(REPO_ROOT, "agents");
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
 * Docker and Podman hosts share one engine policy, so one section.
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
];

// The telemetry page of each resource type, which carries a "## AI agent" section.
const TELEMETRY_PAGES: Readonly<Record<AiResourceType, string>> = {
  [AiResourceType.DockerHost]: "telemetry/docker-host",
  [AiResourceType.PodmanHost]: "telemetry/podman-host",
  [AiResourceType.DockerSwarmCluster]: "telemetry/docker-swarm",
  [AiResourceType.ProxmoxCluster]: "telemetry/proxmox",
  [AiResourceType.VMwareVCenter]: "telemetry/vmware",
  [AiResourceType.CephCluster]: "telemetry/ceph",
  [AiResourceType.DatabaseServer]: "telemetry/databases",
  [AiResourceType.Host]: "telemetry/host-otel-collector",
};

// Where each type's AI agent service ships.
const COMPOSE_FILES: Readonly<Record<AiResourceType, string>> = {
  [AiResourceType.DockerHost]: "agents/DockerAgent/docker-compose.yml",
  [AiResourceType.PodmanHost]: "agents/PodmanAgent/docker-compose.yml",
  [AiResourceType.DockerSwarmCluster]:
    "agents/DockerSwarmAgent/docker-compose.yml",
  [AiResourceType.ProxmoxCluster]: "agents/ProxmoxAgent/docker-compose.yml",
  [AiResourceType.VMwareVCenter]: "agents/VMwareAgent/docker-compose.yml",
  [AiResourceType.CephCluster]: "agents/CephAgent/docker-compose.yml",
  [AiResourceType.DatabaseServer]: "agents/DatabaseAgent/docker-compose.yml",
  [AiResourceType.Host]: "agents/HostAIAgent/docker-compose.yml",
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
        "### Connecting to OneUptime",
        "## What an investigation may run",
        "## How fixes work",
        "### Fix modes",
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

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const service: string =
          composeServices(COMPOSE_FILES[type]).get(
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
        `runs up to ${MAX_RESOURCE_COMMANDS_PER_INVESTIGATION} commands per investigation`,
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
        `at most ${MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM.toLocaleString("en-US")} characters`,
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
          "and 30 fix commands an hour",
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

    it("says a resource starts with investigation and fixes off, as the models default them", (): void => {
      for (const model of [
        "DockerHost",
        "PodmanHost",
        "DockerSwarmCluster",
        "ProxmoxCluster",
        "VMwareVCenter",
        "CephCluster",
        "DatabaseServer",
        "Host",
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
          off: investigation.includes("default: false"),
        }).toEqual({ model, off: true });
        expect({
          model,
          disabled: source.includes(
            "default: ResourceAiRemediationMode.Disabled",
          ),
        }).toEqual({ model, disabled: true });
      }

      expect(page).toContain(
        "A resource starts with investigation and fixes off.",
      );

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
      const collectorTypes: Array<AiResourceType> =
        ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
          return type !== AiResourceType.Host;
        });

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
        "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent/install.sh",
      );
      expect(
        fs.existsSync(path.join(AGENTS_DIR, "HostAIAgent/install.sh")),
      ).toBe(true);

      const service: string | undefined = composeServices(
        COMPOSE_FILES[AiResourceType.Host],
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

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const file: string = COMPOSE_FILES[type];
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
        composeServices(COMPOSE_FILES[AiResourceType.Host]).get(
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

    it("names every agent's container in the troubleshooting steps", (): void => {
      const logs: string = section(page, "### Logs and status");

      for (const type of ALL_AI_RESOURCE_TYPES) {
        expect({
          type,
          named:
            logs.includes(`\`${getResourceAiAgentServiceName(type)}\``) ||
            logs.includes(getResourceAiAgentServiceName(type)),
        }).toEqual({ type, named: true });
      }

      // Only the database agent's service has no fixed container name.
      for (const type of ALL_AI_RESOURCE_TYPES) {
        const service: string | undefined = composeServices(
          COMPOSE_FILES[type],
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

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const service: string = composeServices(COMPOSE_FILES[type]).get(
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

    for (const resource of RESOURCE_SECTIONS) {
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
  });

  describe("what a fix may run, against the command policy", (): void => {
    const fixes: string = section(page, "## How fixes work");

    for (const resource of RESOURCE_SECTIONS) {
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
        composeServices(COMPOSE_FILES[AiResourceType.VMwareVCenter]).get(
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
    for (const type of ALL_AI_RESOURCE_TYPES) {
      const relative: string = TELEMETRY_PAGES[type];

      it(`${relative} has an AI agent section that names the agent and links to its part of the page`, (): void => {
        const markdown: string = readPage(relative);
        const aiAgent: string = section(markdown, "## AI agent");
        const info: AiResourceTypeInfo = infoOf(type);

        expect(aiAgent).toContain(info.agentDisplayName);
        expect(aiAgent).toContain(IMAGE);
        expect(aiAgent).toContain(`\`${RESOURCE_AI_ALLOW_WRITES_ENV}=true\``);

        if (type === AiResourceType.Host) {
          expect(aiAgent).toContain("agents/HostAIAgent/install.sh");
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

    it("says how long a replacement waits after an agent that never signed off: the alive window", (): void => {
      const minutes: string = `${RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES} minutes`;

      /*
       * An agent that stopped cleanly signed off; one that crashed or was
       * killed counts as online until its last heartbeat is this old.
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
          window: row.includes(minutes),
          aMinute: A_MINUTE.test(row),
        }).toEqual({ source, window: true, aMinute: false });
      }

      const flat: string = page.replace(/\s+/g, " ");

      expect(flat).not.toContain("which takes about a minute");
      expect(flat).toContain(`has been quiet for ${minutes}`);
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

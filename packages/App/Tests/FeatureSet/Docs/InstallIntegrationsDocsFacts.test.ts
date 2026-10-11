import { readPage } from "./DocsContentSupport";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY } from "Common/Types/AnalyticsDatabase/RetentionTtl";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { getTableColumns } from "Common/Types/Database/TableColumn";
import Domain from "Common/Types/Domain";
import { HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS } from "Common/Types/Telemetry/TelemetryRetentionConfig";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 15: what the Local Development, Docker Compose, Sizing &
 * Capacity Planning, Slack, Microsoft Teams, Twilio and GitHub integration
 * pages say, held to the scripts, compose files, chart and code that do it.
 * The translations are held to these pages by
 * InstallIntegrationsDocsTranslations. What earlier suites hold stays with
 * them: the Teams app manifest, the messaging endpoint and install guidance
 * (Common's MicrosoftTeams* suites), what each connect callback answers
 * (ConnectCallbackDocs), who may connect GitHub (GitHubConnectDocs), the
 * Twilio configuration's default and its create button
 * (TwilioConfigDefaultDocs), test sends (TestSendDocs), phone verification
 * (PhoneNumberVerificationDocs) and the Valkey rename
 * (ValkeyRenameLocalization). This one holds the rest: the commands, ports,
 * images, settings and Helm values the pages name, the routes each
 * integration answers on, and the words each screen is drawn with.
 *
 * Markdown is not compiled and App tests read no React module, so the
 * screens' words are read from their source files, and the scripts, compose
 * files and chart from the repository.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const LOCAL: string = "installation/local-development";
const COMPOSE: string = "installation/docker-compose";
const SIZING: string = "installation/sizing";
const SLACK: string = "self-hosted/slack-integration";
const TEAMS: string = "self-hosted/microsoft-teams-integration";
const TWILIO: string = "self-hosted/twilio-integration";
const GITHUB: string = "self-hosted/github-integration";

const PAGES: Array<string> = [
  LOCAL,
  COMPOSE,
  SIZING,
  SLACK,
  TEAMS,
  TWILIO,
  GITHUB,
];

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";
const NOTIFICATION: string = "packages/App/FeatureSet/Notification";
const COMMON_SERVER: string = "packages/Common/Server";
const CHART: string = "HelmChart/Public/oneuptime";

const SOURCES: Record<string, string> = {
  rootPackage: "package.json",
  appPackage: "packages/App/package.json",
  configExample: "config.example.env",
  configure: "Scripts/Install/configure.sh",
  mergeEnvTemplate: "Scripts/Install/MergeEnvTemplate.js",
  installModules: "Scripts/Dev/install-node-modules.sh",
  devCompose: "Scripts/Dev/docker-compose.dev.yml",
  baseCompose: "docker-compose.base.yml",
  compose: "docker-compose.yml",
  appDevScript: "packages/App/scripts/dev.sh",
  appNodemon: "packages/App/nodemon.json",
  statusCheck: "Tests/Scripts/status-check.sh",
  endpointStatus: "Tests/Scripts/endpoint-status.sh",
  backup: "backup.sh",
  restore: "restore.sh",
  ingressConfig: "packages/Nginx/default.conf.template",
  ingressTemplates: "packages/Nginx/envsubst-on-templates.sh",
  provisionPrimaryDomain:
    "packages/App/FeatureSet/Workers/Jobs/CoreSsl/ProvisionPrimaryDomain.ts",
  environmentConfig: `${COMMON_SERVER}/EnvironmentConfig.ts`,
  userService: `${COMMON_SERVER}/Services/UserService.ts`,
  response: `${COMMON_SERVER}/Utils/Response.ts`,
  startServer: `${COMMON_SERVER}/Utils/StartServer.ts`,
  serviceRoute: "packages/Common/ServiceRoute.ts",
  postgresMigrations: `${COMMON_SERVER}/Infrastructure/Postgres/SchemaMigrations/Index.ts`,
  postgresDataSource: `${COMMON_SERVER}/Infrastructure/Postgres/DataSourceOptions.ts`,
  chartValues: `${CHART}/values.yaml`,
  chartHelpers: `${CHART}/templates/_helpers.tpl`,
  chartManifest: `${CHART}/Chart.yaml`,
  cnpgScheduledBackup: `${CHART}/templates/postgresql-cnpg-scheduledbackup.yaml`,
  logModel: "packages/Common/Models/AnalyticsModels/Log.ts",
  metricModel: "packages/Common/Models/AnalyticsModels/Metric.ts",
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  settingsRoutes: `${DASHBOARD}/Routes/SettingsRoutes.tsx`,
  telemetrySettings: `${DASHBOARD}/Pages/Settings/TelemetrySettings.tsx`,
  userSettingsSideMenu: `${DASHBOARD}/Pages/UserSettings/SideMenu.tsx`,
  workspaceSideMenuSection: `${DASHBOARD}/Components/Workspace/WorkspaceSideMenuSection.ts`,
  connectCallbackMessage: `${DASHBOARD}/Utils/Workspace/ConnectCallbackMessage.ts`,
  workspaceOAuthState: `${COMMON_SERVER}/Utils/Workspace/WorkspaceOAuthState.ts`,
  slackApi: `${COMMON_SERVER}/API/SlackAPI.ts`,
  slackAuthorization: `${COMMON_SERVER}/Middleware/SlackAuthorization.ts`,
  slackManifest: `${COMMON_SERVER}/Utils/Workspace/Slack/app-manifest.json`,
  slackIntegration: `${DASHBOARD}/Components/Slack/SlackIntegration.tsx`,
  slackDocumentation: `${DASHBOARD}/Components/Slack/SlackIntegrationDocumentation.tsx`,
  teamsApi: `${COMMON_SERVER}/API/MicrosoftTeamsAPI.ts`,
  teamsUtil: `${COMMON_SERVER}/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts`,
  teamsServiceUrl: `${COMMON_SERVER}/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsServiceUrl.ts`,
  teamsIntegration: `${DASHBOARD}/Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx`,
  teamsChatsCard: `${DASHBOARD}/Components/MicrosoftTeams/MicrosoftTeamsChatsCard.tsx`,
  twilioMigration:
    "packages/App/FeatureSet/Workers/DataMigrations/UpdateGlobalCongfigFromEnv.ts",
  notificationIndex: `${NOTIFICATION}/Index.ts`,
  smsApi: `${NOTIFICATION}/API/SMS.ts`,
  incomingCallApi: `${NOTIFICATION}/API/IncomingCall.ts`,
  callTimelineApi: `${COMMON_SERVER}/API/UserOnCallLogTimelineAPI.ts`,
  callTimelineModel:
    "packages/Common/Models/DatabaseModels/UserOnCallLogTimeline.ts",
  callSmsConfigTable: `${DASHBOARD}/Components/CallSMS/CallSMSConfigTable.tsx`,
  adminLocale: `${ADMIN_DASHBOARD}/Locales/en.json`,
  adminSettingsSideMenu: `${ADMIN_DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  adminAuthentication: `${ADMIN_DASHBOARD}/Pages/Settings/Authentication/Index.tsx`,
  adminProbes: `${ADMIN_DASHBOARD}/Pages/Settings/Probes/Index.tsx`,
  adminCallSms: `${ADMIN_DASHBOARD}/Pages/Settings/CallSMS/Index.tsx`,
  githubApi: `${COMMON_SERVER}/API/GitHubAPI.ts`,
  githubUtil: `${COMMON_SERVER}/Utils/CodeRepository/GitHub/GitHub.ts`,
  githubWebhookEvents: `${COMMON_SERVER}/Utils/CodeRepository/GitHub/GitHubWebhookEvents.ts`,
  githubConversation: `${COMMON_SERVER}/Utils/CodeRepository/GitHub/GitHubConversation.ts`,
  codeRepositoryPage: `${DASHBOARD}/Pages/CodeRepository/CodeRepository.tsx`,
  codeSideMenu: `${DASHBOARD}/Components/Code/CodeSideMenu.tsx`,
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  navBar: "packages/Common/UI/Components/Navbar/NavBar.tsx",
};

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: { load: (text: string) => unknown } = require(
  path.join(REPO_DIR, "packages", "Common", "node_modules", "js-yaml"),
);

// The pure half of the script `npm run update` merges config.env with.
const mergeEnvScript: {
  ENTERPRISE_TAG_PREFIX: string;
  mergeEnvTemplate: (
    templateContents: string,
    envContents: string,
  ) => { contents: string };
} = require(path.join(REPO_DIR, "Scripts", "Install", "MergeEnvTemplate.js"));
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;

// A row of a Markdown table.
const TABLE_ROW: RegExp = /^\|.*\|$/;

// The row under a table's header.
const TABLE_SEPARATOR: RegExp = /^\|(?:\s*:?-+:?\s*\|)+$/;

// A Markdown heading: its marks and its text.
const HEADING: RegExp = /^(#{1,6}) /;

const INLINE_CODE: RegExp = /`([^`]+)`/g;

// "npm run <script>" anywhere on a page.
const NPM_RUN: RegExp = /npm run ([a-z][a-z0-9:-]*)/g;

// A "KEY=value" line of config.example.env.
const CONFIG_LINE: RegExp = /^([A-Z][A-Z0-9_]*)=(.*)$/;

const PLACEHOLDER_SECRET: string = "please-change-this-to-random-value";

// A host port, as the first cell of the Docker Compose ports table writes it.
const PORT_NUMBER: RegExp = /^\d+$/;

// A GitHub Actions workflow file.
const YAML_FILE: RegExp = /\.ya?ml$/;

// "  IssueComment = "issue_comment"," - a member of the webhook event enum.
const ENUM_MEMBER_VALUE: RegExp = /[=] "([a-z_]+)",/g;

// A section of an object-literal side menu: its title and its links.
interface MenuSection {
  title: string;
  items: Array<string>;
}

// "{ title: "Workspace", items: [" - a section of a menu written as data.
const OBJECT_MENU_SECTION: RegExp =
  /title: "([^"]+)",\s*(?:defaultCollapsed: (?:true|false),\s*)?items: \[/g;

// "link: { title: "Slack"," - one of a section's links.
const OBJECT_MENU_ITEM: RegExp = /link: \{\s*title: "([^"]+)"/g;

// "<SideMenuSection title=...>" - a section of a menu written as JSX.
const JSX_MENU_SECTION: RegExp = /<SideMenuSection\b([^>]*)>/g;

// A JSX menu's titles: a key of the app's own locale.
const JSX_TITLE: RegExp = /title=\{t\("([^"]+)"\)\}/;

const JSX_ITEM: RegExp = /title: t\("([^"]+)"\)/g;

function readSource(key: string): string {
  const relativePath: string | undefined = SOURCES[key];

  expect({ key, known: Boolean(relativePath) }).toEqual({ key, known: true });

  return fs.readFileSync(path.join(REPO_DIR, relativePath as string), "utf8");
}

function sourceExists(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_DIR, relativePath));
}

function english(page: string): string {
  return readPage("en", page);
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

// A cell's text without the backticks or bold marks around it.
function unwrap(cell: string): string {
  if (cell.startsWith("**") && cell.endsWith("**")) {
    return cell.slice(2, -2);
  }

  if (cell.startsWith("`") && cell.endsWith("`")) {
    return cell.slice(1, -1);
  }

  return cell;
}

function inlineCodes(text: string): Array<string> {
  return [...text.matchAll(INLINE_CODE)].map(
    (match: RegExpExecArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The lines of a page outside its fenced code blocks, so a "#" comment in a
 * shell example is not read as a heading.
 */
function proseLines(markdown: string): Array<string | null> {
  let inFence: boolean = false;

  return markdown.split("\n").map((line: string): string | null => {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      return null;
    }

    return inFence ? null : line;
  });
}

// From a heading to the next heading of the same or a higher level.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const prose: Array<string | null> = proseLines(markdown);
  const start: number = prose.findIndex((line: string | null): boolean => {
    return line !== null && line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = (HEADING.exec(heading)?.[1] || "").length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const marks: RegExpExecArray | null = HEADING.exec(prose[index] || "");

    if (marks && (marks[1] as string).length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

// The cells of every table row of a text, header rows included.
function tableRows(text: string): Array<Array<string>> {
  return proseLines(text)
    .map((line: string | null): string => {
      return (line || "").trim();
    })
    .filter((line: string): boolean => {
      return TABLE_ROW.test(line) && !TABLE_SEPARATOR.test(line);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The one table row of a text whose first cell is this text.
function rowOf(text: string, firstCell: string): Array<string> {
  const rows: Array<Array<string>> = tableRows(text).filter(
    (cells: Array<string>): boolean => {
      return cells[0] === firstCell;
    },
  );

  expect({ firstCell, rows: rows.length }).toEqual({ firstCell, rows: 1 });

  return rows[0] as Array<string>;
}

// The bodies of a page's fenced blocks with this info string.
function fencedBlocks(markdown: string, info: string): Array<string> {
  return [
    ...markdown.matchAll(
      new RegExp("^```" + escapeRegex(info) + "\\n([\\s\\S]*?)\\n```", "gm"),
    ),
  ].map((match: RegExpExecArray): string => {
    return match[1] as string;
  });
}

// A block of a source file: from a marker to the next occurrence of an end marker.
function blockFrom(source: string, marker: string, end: string): string {
  const start: number = source.indexOf(marker);

  expect({ marker, found: start >= 0 }).toEqual({ marker, found: true });

  const stop: number = source.indexOf(end, start + marker.length);

  return source.slice(start, stop === -1 ? undefined : stop);
}

// Whether an Express router registers this method and path.
function registersRoute(
  source: string,
  method: "get" | "post",
  route: string,
): boolean {
  return new RegExp(`router\\.${method}\\(\\s*"${escapeRegex(route)}"`).test(
    source,
  );
}

// config.example.env, as the settings it ships and their first values.
function configExample(): Map<string, string> {
  const values: Map<string, string> = new Map<string, string>();

  for (const line of readSource("configExample").split("\n")) {
    const match: RegExpExecArray | null = CONFIG_LINE.exec(line);

    if (match && !values.has(match[1] as string)) {
      values.set(match[1] as string, match[2] as string);
    }
  }

  return values;
}

function scriptsOf(key: "rootPackage" | "appPackage"): Record<string, string> {
  return (JSON.parse(readSource(key)) as { scripts: Record<string, string> })
    .scripts;
}

function yamlOf(key: string): Record<string, unknown> {
  return jsYaml.load(readSource(key)) as Record<string, unknown>;
}

type ComposeService = Record<string, unknown>;

function composeServices(key: string): Record<string, ComposeService> {
  return yamlOf(key)["services"] as Record<string, ComposeService>;
}

// A value of a parsed YAML or JSON document, by a dotted path.
function valueAt(root: unknown, dottedPath: string): unknown {
  let node: unknown = root;

  for (const part of dottedPath.split(".")) {
    if (!node || typeof node !== "object") {
      return undefined;
    }

    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

// Unset, or set to nothing: what a chart default that sets no resources looks like.
function isEmptySetting(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "object" &&
      Object.keys(value as Record<string, unknown>).length === 0)
  );
}

/*
 * The lines the chart's helpers give one environment variable: its value, or
 * the Secret key it is read from.
 */
function chartEnvBlock(name: string): string {
  const helpers: string = readSource("chartHelpers");
  const start: number = helpers.indexOf(`- name: ${name}\n`);

  expect({ name, found: start >= 0 }).toEqual({ name, found: true });

  const rest: string = helpers.slice(start + 1);
  const ends: Array<number> = ["\n- name: ", "\n{{- /*", "\n\n"].map(
    (marker: string): number => {
      const at: number = rest.indexOf(marker);
      return at === -1 ? rest.length : at;
    },
  );

  return rest.slice(0, Math.min(...ends));
}

// The sections of a side menu written as an array of objects.
function objectMenuSections(source: string): Array<MenuSection> {
  const heads: Array<RegExpExecArray> = [
    ...source.matchAll(OBJECT_MENU_SECTION),
  ];

  return heads.map((head: RegExpExecArray, index: number): MenuSection => {
    const end: number =
      index + 1 < heads.length ? heads[index + 1]!.index : source.length;

    return {
      title: head[1] as string,
      items: [...source.slice(head.index, end).matchAll(OBJECT_MENU_ITEM)].map(
        (item: RegExpExecArray): string => {
          return item[1] as string;
        },
      ),
    };
  });
}

// The sections of a JSX side menu, with the app's locale keys read as the words they draw.
function jsxMenuSections(
  source: string,
  words: (key: string) => string,
): Array<MenuSection> {
  return [...source.matchAll(JSX_MENU_SECTION)].map(
    (head: RegExpExecArray): MenuSection => {
      const close: number = source.indexOf("</SideMenuSection>", head.index);
      const body: string = source.slice(
        head.index + head[0].length,
        close === -1 ? source.length : close,
      );
      const title: RegExpExecArray | null = JSX_TITLE.exec(head[1] as string);

      return {
        title: title ? words(title[1] as string) : "",
        items: [...body.matchAll(JSX_ITEM)].map(
          (item: RegExpExecArray): string => {
            return words(item[1] as string);
          },
        ),
      };
    },
  );
}

function menuSection(sections: Array<MenuSection>, title: string): MenuSection {
  const section: MenuSection | undefined = sections.find(
    (candidate: MenuSection): boolean => {
      return candidate.title === title;
    },
  );

  expect({ title, found: Boolean(section) }).toEqual({ title, found: true });

  return section as MenuSection;
}

// A dotted key of the Admin Dashboard's nested locale, as its t() reads it.
function adminText(key: string): string {
  const text: unknown = valueAt(JSON.parse(readSource("adminLocale")), key);

  expect({ key, found: typeof text === "string" }).toEqual({
    key,
    found: true,
  });

  return text as string;
}

// Every string a JSON value holds, however deep.
function stringsIn(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsIn);
  }

  return [];
}

// The TypeScript files of a folder of the repository, outside builds and tests.
function serverSourcesUnder(relativeDirectory: string): Array<string> {
  const files: Array<string> = [];
  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        ["node_modules", "build", "dist", "Tests"].includes(entry.name) ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        files.push(path.relative(REPO_DIR, fullPath));
      }
    }
  };

  walk(path.join(REPO_DIR, relativeDirectory));

  return files;
}

/*
 * A page's environment variable table: each Docker Compose variable is read
 * by the server, and the chart sets it from the Helm value in the same row.
 */
function expectEnvironmentTableHeld(page: string, heading: string): number {
  const environmentConfig: string = readSource("environmentConfig");
  const rows: Array<Array<string>> = tableRows(
    sectionOf(english(page), heading),
  ).slice(1);

  for (const row of rows) {
    const variable: string = unwrap(row[0] as string);
    const helmValue: string = unwrap(row[1] as string);

    expect({
      variable,
      readByServer: environmentConfig.includes(`process.env["${variable}"]`),
      setByChart: chartEnvBlock(variable).includes(`$.Values.${helmValue}`),
    }).toEqual({ variable, readByServer: true, setByChart: true });
  }

  return rows.length;
}

describe("the commands the pages run", () => {
  it("every npm script any of the seven pages runs is the repository's, or the App's", () => {
    const root: Record<string, string> = scriptsOf("rootPackage");
    const app: Record<string, string> = scriptsOf("appPackage");
    const named: Set<string> = new Set<string>();

    for (const page of PAGES) {
      for (const match of english(page).matchAll(NPM_RUN)) {
        named.add(match[1] as string);
      }
    }

    expect(named.size).toBeGreaterThan(15);

    for (const script of named) {
      expect({ script, known: script in root || script in app }).toEqual({
        script,
        known: true,
      });
    }
  });

  it("npm start and npm run start export config.env and recreate the containers, rather than restart them", () => {
    const start: string = scriptsOf("rootPackage")["start"] as string;

    expect(start).toContain("export $(grep -v '^#' config.env | xargs)");
    expect(start).toContain("docker compose up --remove-orphans -d");
    expect(start).not.toContain("restart");

    for (const page of [SLACK, TEAMS, GITHUB]) {
      expect({
        page,
        says: english(page).includes(
          "`docker compose restart` does not re-read",
        ),
      }).toEqual({ page, says: true });
    }
  });
});

describe("Local Development, against the scripts it runs", () => {
  const page: string = english(LOCAL);

  it("npm run dev switches config.env to development, prepares the checkout and starts the development compose file", () => {
    const scripts: Record<string, string> = scriptsOf("rootPackage");

    expect(scripts["dev"]).toContain("npm run config-to-dev");
    expect(scripts["dev"]).toContain("npm run prerun");
    expect(scripts["dev"]).toMatch(
      /-f Scripts\/Dev\/docker-compose\.dev\.yml up\s+--remove-orphans\s+-d/,
    );
    expect(scripts["config-to-dev"]).toContain(
      "ReplaceValueInConfig.js ENVIRONMENT development",
    );
    expect(scripts["prerun"]).toContain("bash ./Scripts/Install/configure.sh");

    expect(page).toContain(
      "starts the stack defined in `Scripts/Dev/docker-compose.dev.yml`",
    );
    expect(page).toContain("Sets `ENVIRONMENT=development` in `config.env`.");
  });

  it("the preparation asks for the sudo password before it installs anything", () => {
    const main: string = blockFrom(
      readSource("configure"),
      "main() {",
      "\n}\n",
    );
    const askedAt: number = main.indexOf('sudo echo ""');

    expect(askedAt).toBeGreaterThan(-1);
    expect(askedAt).toBeLessThan(main.indexOf("install_system_packages"));
    expect(page).toContain("| Prepare | Asks for your sudo password,");
    expect(page).toContain(
      "`npm run dev` asks for your password before it installs anything.",
    );
  });

  it("the preparation installs exactly the tools the page lists, and only those that are missing", () => {
    const configure: string = readSource("configure");
    const main: string = blockFrom(configure, "main() {", "\n}\n");

    expect(configure).toContain('REQUIRED_PACKAGES="git curl"');

    for (const step of [
      "setup_nodejs",
      "setup_docker",
      "setup_gomplate",
      "setup_tsnode",
    ]) {
      expect(main).toContain(step);
    }

    for (const check of [
      "if ! command_exists node || ! command_exists npm; then",
      "if ! command_exists docker; then",
      "if ! command_exists gomplate; then",
      "if ! command_exists ts-node; then",
    ]) {
      expect(configure).toContain(check);
    }

    expect(page).toContain(
      "installs tools that are missing (Git, curl, Node.js, Docker, gomplate, ts-node)",
    );
    expect(page).toContain("it skips every tool that is already installed");
  });

  it("the preparation pulls the current branch, merges new settings and renders every Dockerfile template", () => {
    const configure: string = readSource("configure");

    expect(configure).toMatch(/\n\s+git pull\n/);
    expect(configure).toContain("node ./Scripts/Install/MergeEnvTemplate.js");
    expect(configure).toContain('-name "Dockerfile.tpl"');
    expect(configure).toContain('| gomplate > "${dockerfile_template%.tpl}"');

    expect(page).toContain(
      "runs `git pull` on your current branch, adds new settings from `config.example.env` to `config.env`, and renders every `Dockerfile.tpl` into a `Dockerfile`",
    );
  });

  it("the App runs your checkout, restarts its API on a server change and rebuilds the dashboards", () => {
    const app: ComposeService = composeServices("devCompose")[
      "app"
    ] as ComposeService;
    const devScript: string = readSource("appDevScript");
    const nodemon: { watch: Array<string> } = JSON.parse(
      readSource("appNodemon"),
    ) as { watch: Array<string> };

    expect(app["volumes"]).toContain("./packages/App:/usr/src/app:cached");
    expect(devScript).toContain("npm run dev:api &");
    expect(devScript).toContain("npm run watch-frontend:dashboard &");
    expect(devScript).toContain("npm run watch-frontend:admin-dashboard &");
    expect(scriptsOf("appPackage")["dev:api"]).toBe("npx nodemon");
    expect(nodemon.watch).toEqual(
      expect.arrayContaining(["./", "../Common/Server"]),
    );

    expect(page).toContain(
      "The App restarts its API when a server file changes and rebuilds the dashboards as you edit them.",
    );
  });

  it("Node.js 26 is what the repository asks for and what CI runs", () => {
    const engines: { node: string } = (
      JSON.parse(readSource("rootPackage")) as { engines: { node: string } }
    ).engines;
    const workflows: string = path.join(REPO_DIR, ".github", "workflows");
    const versions: Set<string> = new Set<string>();

    for (const file of fs.readdirSync(workflows)) {
      if (!YAML_FILE.test(file)) {
        continue;
      }

      const workflow: string = fs.readFileSync(
        path.join(workflows, file),
        "utf8",
      );

      for (const match of workflow.matchAll(/node-version:\s*'?(\d+)'?/g)) {
        versions.add(match[1] as string);
      }
    }

    expect(engines.node).toBe(">=26.0.0");
    expect([...versions]).toEqual(["26"]);
    expect(page).toContain("| **Node.js 26 or later, and npm** |");
  });

  it("the datastores are published on the ports the page lists, with the users and databases config.example.env ships", () => {
    const dev: Record<string, ComposeService> = composeServices("devCompose");
    const config: Map<string, string> = configExample();
    const ports: string = sectionOf(page, "### Ports");

    expect(dev["postgres"]?.["ports"]).toContain("5400:5432");
    expect(dev["clickhouse"]?.["ports"]).toEqual(
      expect.arrayContaining(["8189:8123", "9034:9000"]),
    );
    expect(dev["valkey"]?.["ports"]).toContain("6310:6379");
    expect(config.get("CLICKHOUSE_PORT")).toBe("8123");
    expect(config.get("DATABASE_USERNAME")).toBe("postgres");
    expect(config.get("DATABASE_NAME")).toBe("oneuptimedb");
    expect(config.get("CLICKHOUSE_USER")).toBe("default");
    expect(config.get("CLICKHOUSE_DATABASE")).toBe("oneuptime");

    for (const password of [
      "DATABASE_PASSWORD",
      "CLICKHOUSE_PASSWORD",
      "VALKEY_PASSWORD",
    ]) {
      expect(config.has(password)).toBe(true);
    }

    expect(rowOf(ports, "PostgreSQL")).toEqual([
      "PostgreSQL",
      "`localhost:5400`",
      "User `postgres`, database `oneuptimedb`, password `DATABASE_PASSWORD`",
    ]);
    expect(rowOf(ports, "ClickHouse")).toEqual([
      "ClickHouse",
      "`localhost:8189` (HTTP), `localhost:9034` (native)",
      "User `default`, database `oneuptime`, password `CLICKHOUSE_PASSWORD`",
    ]);
    expect(rowOf(ports, "Valkey")).toEqual([
      "Valkey",
      "`localhost:6310`",
      "Password `VALKEY_PASSWORD`",
    ]);
  });

  it("the stack serves OneUptime on ports 80 and 443, through the base ingress", () => {
    const ingress: ComposeService = composeServices("baseCompose")[
      "ingress"
    ] as ComposeService;
    const config: Map<string, string> = configExample();

    expect(
      (
        composeServices("devCompose")["ingress"]?.["extends"] as {
          service: string;
        }
      )["service"],
    ).toBe("ingress");
    expect(ingress["ports"]).toEqual([
      "${ONEUPTIME_HTTP_PORT}:7849",
      "${STATUS_PAGE_HTTPS_PORT}:7850",
    ]);
    expect(config.get("ONEUPTIME_HTTP_PORT")).toBe("80");
    expect(config.get("STATUS_PAGE_HTTPS_PORT")).toBe("443");
    expect(page).toContain(
      "The stack serves OneUptime on `http://localhost` (port 80), and HTTPS on port 443.",
    );
  });

  it("the rebuild commands build the development compose file, and force-build-dev skips the cache", () => {
    const scripts: Record<string, string> = scriptsOf("rootPackage");
    const commands: string = sectionOf(page, "### Commands");

    expect(scripts["build"]).toContain(
      "-f Scripts/Dev/docker-compose.dev.yml build",
    );
    expect(scripts["force-build-dev"]).toBe(
      "npm run config-to-dev && npm run force-build",
    );
    expect(scripts["force-build"]).toMatch(
      /docker-compose\.dev\.yml build\s+--no-cache/,
    );
    expect(
      rowOf(commands, "Rebuild the images, after a dependency change")[1],
    ).toBe("`npm run build`, then `npm run dev`");
    expect(rowOf(commands, "Rebuild the images from scratch")[1]).toBe(
      "`npm run force-build-dev`, then `npm run dev`",
    );
  });

  it("npm run down stops the stack without its volumes", () => {
    const scripts: Record<string, string> = scriptsOf("rootPackage");

    const stop: string = scripts["stop"] as string;

    expect(scripts["down"]).toBe("npm run stop");
    expect(stop).toContain("docker compose down --remove-orphans");
    expect(stop.slice(stop.indexOf("docker compose down"))).not.toMatch(
      /--volumes|\s-v\b/,
    );
    expect(page).toContain(
      "`npm run down` keeps your data: the PostgreSQL and ClickHouse volumes survive it.",
    );
  });

  it("install-modules deletes and reinstalls every package's node_modules", () => {
    const script: string = readSource("installModules");

    expect(scriptsOf("rootPackage")["install-modules"]).toBe(
      "bash ./Scripts/Dev/install-node-modules.sh",
    );
    expect(script).toContain("packages/*/");
    expect(script).toContain("rm -rf node_modules");
    expect(script).toContain("npm install --force");
    expect(page).toContain(
      "`npm run install-modules`, which deletes and reinstalls every package's `node_modules`",
    );
  });

  it("lint and fix-lint lint the whole repository, so the page lints the changed files instead", () => {
    const scripts: Record<string, string> = scriptsOf("rootPackage");

    for (const script of ["lint", "fix-lint"]) {
      expect(scripts[script]).toContain("node ./Scripts/Lint/LintByProject.js");
    }

    expect(page).toContain(
      "Avoid `npm run lint` and `npm run fix-lint`: they lint the whole repository.",
    );
    expect(page).toContain("npx eslint --fix packages/App/path/to/File.ts");
  });

  it("a PostgreSQL migration is generated into the folder the page names, and runs once Index.ts lists it", () => {
    const scripts: Record<string, string> = scriptsOf("rootPackage");

    expect(scripts["generate-postgres-migration"]).toContain(
      "migration:generate ./packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/",
    );
    expect(scripts["check-postgres-schema-drift"]).toBe(
      "bash ./Scripts/Postgres/CheckSchemaDrift.sh",
    );
    expect(readSource("postgresMigrations")).toContain("export default [");
    expect(readSource("postgresDataSource")).toContain(
      'import Migrations from "./SchemaMigrations/Index";',
    );
    expect(page).toContain(
      "Register the new file in `packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts`: it does not run until it is listed there.",
    );
  });

  it("ClickHouse data migrations are written by hand in the folder the page names", () => {
    expect(sourceExists("packages/App/FeatureSet/Workers/DataMigrations")).toBe(
      true,
    );
    expect(
      sourceExists("packages/App/FeatureSet/Workers/DataMigrations/Index.ts"),
    ).toBe(true);
    expect(page).toContain(
      "Write the migration by hand in `packages/App/FeatureSet/Workers/DataMigrations`",
    );
  });

  it("the first account to sign up becomes the master admin, and the Admin Dashboard is at /admin", () => {
    expect(readSource("userService")).toContain(
      "data.user.isMasterAdmin = await this.isInstanceAwaitingFirstUser();",
    );
    expect(readSource("serviceRoute")).toContain(
      'export const AdminDashboardRoute: Route = new Route("/admin");',
    );
    expect(page).toContain(
      "The first account becomes the master admin, who can open the Admin Dashboard at `http://localhost/admin`.",
    );
    expect(english(COMPOSE)).toContain(
      "The first account on a new instance becomes its master admin, who can open the Admin Dashboard at `/admin`.",
    );
  });

  it("the App's container is named after the folder git clone makes", () => {
    for (const file of ["baseCompose", "compose", "devCompose"]) {
      expect({ file, name: yamlOf(file)["name"] }).toEqual({
        file,
        name: undefined,
      });
    }

    expect(composeServices("devCompose")["app"]).toBeDefined();
    expect(page).toContain(
      "git clone https://github.com/OneUptime/oneuptime.git\ncd oneuptime",
    );
    expect(page).toContain("`docker logs -f oneuptime-app-1`");
  });
});

describe("Docker Compose, against the compose files and scripts", () => {
  const page: string = english(COMPOSE);

  it("each service in the table runs the image the table names", () => {
    const release: Record<string, ComposeService> = composeServices("compose");
    const base: Record<string, ComposeService> = composeServices("baseCompose");
    const rows: Array<Array<string>> = tableRows(
      sectionOf(page, "## How it works"),
    ).slice(1);

    expect(
      rows.map((row: Array<string>): string => {
        return unwrap(row[0] as string);
      }),
    ).toEqual([
      "ingress",
      "app",
      "probe-1",
      "runner",
      "postgres",
      "clickhouse",
      "valkey",
    ]);

    for (const row of rows) {
      const service: string = unwrap(row[0] as string);
      const releaseImage: string | undefined = release[service]?.["image"] as
        | string
        | undefined;
      let image: unknown = base[service]?.["image"];

      if (releaseImage) {
        expect(releaseImage.endsWith(":${APP_TAG}")).toBe(true);
        image = releaseImage.slice(0, releaseImage.lastIndexOf(":"));
      }

      expect({ service, image }).toEqual({
        service,
        image: unwrap(row[1] as string),
      });
    }
  });

  it("the probe and the Runner use the host's network, and reach OneUptime at the URLs the page moves", () => {
    const base: Record<string, ComposeService> = composeServices("baseCompose");
    const config: Map<string, string> = configExample();

    expect(base["probe-1"]?.["network_mode"]).toBe("host");
    expect(base["runner"]?.["network_mode"]).toBe("host");
    expect(valueAt(base, "probe-1.environment.ONEUPTIME_URL")).toBe(
      "${GLOBAL_PROBE_1_ONEUPTIME_URL}",
    );
    expect(valueAt(base, "runner.environment.ONEUPTIME_URL")).toBe(
      "${ONEUPTIME_RUNNER_ONEUPTIME_URL}",
    );
    expect(config.get("GLOBAL_PROBE_1_ONEUPTIME_URL")).toBe("http://localhost");
    expect(config.get("ONEUPTIME_RUNNER_ONEUPTIME_URL")).toBe(
      "http://localhost",
    );

    expect(rowOf(sectionOf(page, "## How it works"), "`probe-1`")[2]).toContain(
      "It uses the host's network.",
    );
    expect(page).toContain(
      "It reaches OneUptime at `GLOBAL_PROBE_1_ONEUPTIME_URL`, which is `http://localhost` (port 80) by default.",
    );
    expect(page).toContain(
      "GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost:8080",
    );
    expect(page).toContain(
      "ONEUPTIME_RUNNER_ONEUPTIME_URL=http://localhost:8080",
    );
  });

  it("probe-1 runs by default, and probe-2 only when asked for", () => {
    expect(composeServices("compose")["probe-1"]).toBeDefined();
    expect(composeServices("compose")["probe-2"]).toBeUndefined();
    expect(composeServices("baseCompose")["probe-2"]).toBeDefined();
    expect(scriptsOf("rootPackage")["run-probes"]).toContain(
      "docker compose up --remove-orphans -d probe-1 probe-2",
    );
    expect(page).toContain("(`probe-1` runs by default)");
  });

  it("PostgreSQL and ClickHouse keep their data in the volumes the page names, and Valkey keeps nothing on disk", () => {
    const base: Record<string, ComposeService> = composeServices("baseCompose");
    const command: string = base["valkey"]?.["command"] as string;

    expect(base["postgres"]?.["volumes"]).toContain(
      "postgres:/var/lib/postgresql/data",
    );
    expect(base["clickhouse"]?.["volumes"]).toContain(
      "clickhouse:/var/lib/clickhouse/",
    );
    expect(base["valkey"]?.["volumes"]).toBeUndefined();
    expect(command).toContain('--save ""');
    expect(command).toContain("--appendonly no");
    expect(
      Object.keys(yamlOf("compose")["volumes"] as Record<string, unknown>),
    ).toEqual(expect.arrayContaining(["postgres", "clickhouse"]));

    expect(page).toContain("Stored in the `postgres` volume.");
    expect(page).toContain("Stored in the `clickhouse` volume.");
    expect(page).toContain("Cache and queues. It keeps nothing on disk.");
    expect(page).toContain(
      "Your data stays in the `oneuptime_postgres` and `oneuptime_clickhouse` volumes",
    );
    expect(page).toContain(
      "--branch release https://github.com/OneUptime/oneuptime.git\ncd oneuptime",
    );
  });

  it("each host port is the default of the setting in its row", () => {
    const base: Record<string, ComposeService> = composeServices("baseCompose");
    const config: Map<string, string> = configExample();
    const rows: Array<Array<string>> = tableRows(
      sectionOf(page, "## Requirements"),
    ).filter((row: Array<string>): boolean => {
      return PORT_NUMBER.test(row[0] as string);
    });

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(["80", "443", "5400", "3874", "3876"]);

    for (const row of rows) {
      const settings: Array<string> = inlineCodes(row[2] as string);

      if (settings[0] === "docker-compose.yml") {
        expect(
          composeServices("compose")[unwrap(row[1] as string)]?.["ports"],
        ).toContain(`${row[0]}:5432`);
        continue;
      }

      expect({
        port: row[0],
        setting: config.get(settings[0] as string),
      }).toEqual({ port: row[0], setting: row[0] });
    }

    expect(base["ingress"]?.["ports"]).toEqual([
      "${ONEUPTIME_HTTP_PORT}:7849",
      "${STATUS_PAGE_HTTPS_PORT}:7850",
    ]);
    expect(valueAt(base, "probe-1.environment.PORT")).toBe(
      "${GLOBAL_PROBE_1_PORT}",
    );
    expect(valueAt(base, "runner.environment.PORT")).toBe(
      "${ONEUPTIME_RUNNER_PORT}",
    );
    expect(config.get("DATABASE_BACKUP_HOST")).toBe("localhost");
    expect(config.get("DATABASE_BACKUP_PORT")).toBe("5400");
  });

  it("the secrets the page fills in are every placeholder config.example.env ships", () => {
    const shipped: Array<string> = [...configExample().entries()]
      .filter(([, value]: [string, string]): boolean => {
        return value.includes(PLACEHOLDER_SECRET);
      })
      .map(([key]: [string, string]): string => {
        return key;
      })
      .sort();
    const named: Array<string> = tableRows(
      sectionOf(page, "### Generate random secrets"),
    )
      .slice(1)
      .flatMap((row: Array<string>): Array<string> => {
        return inlineCodes(row[0] as string);
      })
      .sort();

    expect(shipped.length).toBe(9);
    expect(named).toEqual(shipped);
    expect(page).toContain(`while grep -q "${PLACEHOLDER_SECRET}" config.env`);
    expect(page).toContain('grep -c "please-change-this" config.env');
  });

  it("npm start runs the Docker CLI tab's command, then the status check", () => {
    const scripts: Record<string, string> = scriptsOf("rootPackage");

    expect(scripts["start"]).toContain(
      "export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d",
    );
    expect(scripts["start"]).toContain("&& npm run status-check");
    expect(scripts["status-check"]).toBe(
      "bash ./Tests/Scripts/status-check.sh $npm_config_services",
    );
    expect(page).toContain(
      "(export $(grep -v '^#' config.env | xargs) && docker compose up --remove-orphans -d)",
    );
  });

  it("the status check checks localhost unless it is given a host, and ends with the words the page quotes", () => {
    const check: string = readSource("statusCheck");

    expect(check).toContain('HOST_TO_CHECK="$1"');
    expect(check).toContain('HOST_TO_CHECK="localhost"');
    expect(check).toContain("OneUptime is up!");
    expect(readSource("endpointStatus")).toContain("Maximum retries reached");

    expect(page).toContain("ends with **OneUptime is up!**");
    expect(page).toContain(
      ':::details npm start ends with "Maximum retries reached"',
    );
    expect(page).toContain("bash Tests/Scripts/status-check.sh localhost:8080");
    expect(page).toContain(
      "`npm start` checks `http://localhost` on port 80, where your proxy will be",
    );
  });

  it("HTTPS settings ship as plain HTTP behind the ingress alone, and the proxy adds one hop", () => {
    const config: Map<string, string> = configExample();
    const environmentConfig: string = readSource("environmentConfig");

    expect(config.get("PROVISION_SSL")).toBe("false");
    expect(config.get("HTTP_PROTOCOL")).toBe("http");
    expect(config.get("TRUSTED_PROXY_HOPS")).toBe("1");
    expect(environmentConfig).toContain(
      'process.env["PROVISION_SSL"] === "true"',
    );
    expect(environmentConfig).toContain(
      'process.env["HTTP_PROTOCOL"] === "https"',
    );
    expect(
      blockFrom(environmentConfig, "export const TrustedProxyHops", "})();"),
    ).toContain("return 1;");

    expect(page).toContain(
      "| **Settings** | `PROVISION_SSL=true`, `HTTP_PROTOCOL=https` | `PROVISION_SSL=false`, `HTTP_PROTOCOL=https`, `TRUSTED_PROXY_HOPS=2` |",
    );
    expect(page).toContain(
      "`TRUSTED_PROXY_HOPS=2` counts your proxy and OneUptime's ingress",
    );
  });

  it("the certificate job checks every hour, renews under 30 days left, and needs a domain name", () => {
    const job: string = readSource("provisionPrimaryDomain");

    expect(job).toContain(
      'const JOB_NAME: string = "CoreSSL:EnsurePrimaryHostCertificate";',
    );
    expect(job).toContain(
      "schedule: IsDevelopment ? EVERY_FIFTEEN_MINUTE : EVERY_HOUR",
    );
    expect(job).toContain("runOnStartup: true");
    expect(job).toMatch(
      /addRemoveDays\(\s*OneUptimeDate\.getCurrentDate\(\),\s*30,\s*\)/,
    );
    expect(job).toContain("if (!ProvisionSsl) {");
    expect(job).toContain("if (!Domain.isValidDomain(hostnameOnly)) {");
    expect(job).toContain("logger.error(`${JOB_NAME}: failed to provision SSL");
    expect(Domain.isValidDomain("localhost")).toBe(false);
    expect(Domain.isValidDomain("203.0.113.10")).toBe(false);
    expect(Domain.isValidDomain("oneuptime.example.com")).toBe(true);

    expect(page).toContain(
      "OneUptime orders the certificate when it starts and then checks it every hour, renewing it when fewer than 30 days are left.",
    );
    expect(page).toContain(
      "`HOST` has to be a domain name: OneUptime cannot get a certificate for an IP address or for `localhost`.",
    );
    expect(page).toContain(
      "the app logs an error that starts with `CoreSSL:EnsurePrimaryHostCertificate`",
    );
  });

  it("the ingress serves a temporary self-signed certificate until the first one arrives", () => {
    expect(readSource("ingressTemplates")).toContain(
      "Generating temporary self-signed certificate",
    );
    expect(page).toContain(
      "the ingress serves a temporary self-signed one and your browser warns you",
    );
  });

  it("the Nginx example keeps the limits of OneUptime's own ingress, and keeps MCP streams open", () => {
    const ingress: string = readSource("ingressConfig");
    const api: string = blockFrom(ingress, "location /api {", "\n    }\n");
    const mcp: string = blockFrom(ingress, "location /mcp {", "\n    }\n");
    const example: string = fencedBlocks(
      page,
      'nginx title="/etc/nginx/conf.d/oneuptime.conf"',
    )[0] as string;

    for (const limit of [
      "client_max_body_size 50M;",
      "proxy_read_timeout 300s;",
      "proxy_send_timeout 300s;",
    ]) {
      expect({ limit, ingress: api.includes(limit) }).toEqual({
        limit,
        ingress: true,
      });
      expect({ limit, example: example.includes(limit) }).toEqual({
        limit,
        example: true,
      });
    }

    for (const stream of [
      "proxy_buffering off;",
      "proxy_read_timeout 86400s;",
      "proxy_send_timeout 86400s;",
    ]) {
      expect(mcp).toContain(stream);
      expect(blockFrom(example, "location /mcp {", "}")).toContain(stream);
    }
  });

  it("the ingress serves the whole application only on HOST and localhost", () => {
    const ingress: string = readSource("ingressConfig");

    expect(ingress).toContain("server_name localhost ingress ${HOST};");
    expect(ingress).toContain("server_name  _; # All domains.");
    expect(page).toContain(
      "only `HOST` and `localhost` reach the whole application, and any other name, such as the server's IP address, is treated as a status page domain",
    );
  });

  it("every container's log is capped at 1000 MB", () => {
    const base: Record<string, ComposeService> = composeServices("baseCompose");

    expect(Object.keys(base).length).toBeGreaterThan(8);

    for (const [service, definition] of Object.entries(base)) {
      expect({
        service,
        cap: valueAt(definition, "logging.options.max-size"),
      }).toEqual({ service, cap: "1000m" });
    }

    expect(page).toContain("each container's log is capped at 1000 MB");
  });

  it("the backup reads config.env as text, asks for sudo and writes one file per day of the month", () => {
    const backup: string = readSource("backup");
    const config: Map<string, string> = configExample();

    expect(scriptsOf("rootPackage")["backup"]).toBe("bash backup.sh");
    expect(backup).toContain("export $(grep -v '^#' config.env | xargs)");
    expect(backup).toContain("sudo docker run");
    expect(backup).toContain(
      "--file=/var/lib/postgresql/data/db-$(date +%d).backup",
    );
    expect(config.get("DATABASE_BACKUP_DIRECTORY")).toBe("/Backups");
    expect(config.get("DATABASE_BACKUP_PASSWORD")).toBe("${DATABASE_PASSWORD}");

    expect(page).toContain(
      "The script reads `config.env` as plain text, so the `${DATABASE_PASSWORD}` it ships with is never filled in.",
    );
    expect(page).toContain(
      "It asks for your sudo password and writes `Backups/db-<day of the month>.backup`, so daily backups replace the ones from a month earlier.",
    );
  });

  it("the restore asks first, drops what it restores, and restores into a database that exists", () => {
    const restore: string = readSource("restore");
    const command: string = blockFrom(restore, "/usr/bin/pg_restore", "\n");
    const config: Map<string, string> = configExample();

    expect(restore).toContain(
      'read -r -p "Do you want to restore into $DATABASE_RESTORE_NAME? [y/N] " response',
    );
    expect(command).toContain("--clean --if-exists");
    expect(command).not.toContain("--create");
    expect(config.get("DATABASE_RESTORE_FILENAME")).toBe("db-31.backup");
    expect(config.get("DATABASE_RESTORE_PASSWORD")).toBe(
      "${DATABASE_PASSWORD}",
    );

    expect(page).toContain(
      "`DATABASE_RESTORE_FILENAME` to the backup to restore, such as `db-31.backup`. Then run `bash restore.sh`. The database it restores into has to exist already",
    );
    expect(page).toContain(
      "`restore.sh` drops every object in the backup from the target database before recreating it. It asks before it starts; check the database name it shows.",
    );
  });

  it("npm run update repeats the preparation, pulls the images and starts, keeping your own values", () => {
    const update: string = scriptsOf("rootPackage")["update"] as string;
    const merged: string = mergeEnvScript.mergeEnvTemplate(
      "HOST=localhost\nNEW_SETTING=its-default\n",
      "HOST=oneuptime.example.com\n",
    ).contents;

    expect(update).toContain("npm run prerun");
    expect(update).toContain("docker compose pull");
    expect(update).toContain("npm run start");
    expect(update.indexOf("npm run prerun")).toBeLessThan(
      update.indexOf("docker compose pull"),
    );
    expect(merged).toContain("HOST=oneuptime.example.com");
    expect(merged).not.toContain("HOST=localhost");
    expect(merged).toContain("NEW_SETTING=its-default");

    expect(page).toContain(
      "`npm run update` asks for your sudo password, adds any new settings from `config.example.env` to your `config.env` (your own values stay), pulls the new images and restarts OneUptime.",
    );
  });

  it("APP_TAG picks the image, release by default, with enterprise- in front for the Enterprise Edition", () => {
    expect(configExample().get("APP_TAG")).toBe("release");
    expect(mergeEnvScript.ENTERPRISE_TAG_PREFIX).toBe("enterprise-");
    expect(composeServices("compose")["app"]?.["image"]).toBe(
      "oneuptime/app:${APP_TAG}",
    );
    expect(page).toContain(
      "`APP_TAG=release` in `config.env` always pulls the latest release of the Community Edition.",
    );
    expect(page).toContain(
      "For the Enterprise Edition, the tags are `enterprise-release` and `enterprise-14.0.22`.",
    );
  });

  it("only the page's own delete command removes the volumes", () => {
    expect(scriptsOf("rootPackage")["stop"]).not.toContain("--volumes");
    expect(page).toContain(
      "(export $(grep -v '^#' config.env | xargs) && docker compose down --volumes --remove-orphans)",
    );
  });

  it("the Admin Dashboard paths the page walks are its menus, with the switch and the status it names", () => {
    const sections: Array<MenuSection> = jsxMenuSections(
      readSource("adminSettingsSideMenu"),
      adminText,
    );

    expect(adminText("navbar.settings")).toBe("Settings");
    expect(
      sections.some((section: MenuSection): boolean => {
        return section.items.includes("Authentication");
      }),
    ).toBe(true);
    expect(menuSection(sections, "Notifications").items).toContain("Emails");
    expect(menuSection(sections, "Monitoring").items).toContain(
      "Global Probes",
    );
    expect(readSource("adminAuthentication")).toContain(
      't("pages.settings.authentication.signUpSwitchTitle")',
    );
    expect(adminText("pages.settings.authentication.signUpSwitchTitle")).toBe(
      "Let people sign up",
    );
    expect(readSource("adminProbes")).toContain('t("common.disconnected")');
    expect(adminText("common.disconnected")).toBe("Disconnected");

    for (const words of [
      "**Settings > Authentication**",
      "**Let people sign up**",
      "**Settings > Notifications > Emails**",
      "**Settings > Monitoring > Global Probes**",
    ]) {
      expect({ words, onPage: page.includes(words) }).toEqual({
        words,
        onPage: true,
      });
    }

    expect(page).toContain(
      ":::details The bundled probe shows Disconnected after you moved the ingress port",
    );
  });
});

describe("Sizing & Capacity Planning, against the Helm chart", () => {
  const page: string = english(SIZING);
  const values: Record<string, unknown> = yamlOf("chartValues");

  it("the services the chart runs by default set no resources, and PostgreSQL and ClickHouse get 25 Gi", () => {
    const runByDefault: Array<[string, string]> = [
      ["app", "app.resources"],
      ["nginx", "nginx.resources"],
      ["runner", "runner.resources"],
      ["probes.one", "probes.one.resources"],
      ["postgresql", "postgresql.primary.resources"],
      ["clickhouse", "clickhouse.resources"],
      ["valkey", "valkey.master.resources"],
    ];

    for (const [service, resources] of runByDefault) {
      expect({
        service,
        enabled: valueAt(values, `${service}.enabled`),
        noResources: isEmptySetting(valueAt(values, resources)),
      }).toEqual({ service, enabled: true, noResources: true });
    }

    expect(valueAt(values, "postgresql.primary.persistence.size")).toBe("25Gi");
    expect(valueAt(values, "clickhouse.persistence.size")).toBe("25Gi");
    expect(page).toContain(
      "The services it runs by default set **no CPU or memory requests or limits**, and PostgreSQL and ClickHouse get small **25 Gi** volumes",
    );
  });

  it("each workload of the compute table is a values key with one replica, but the telemetry writer runs two", () => {
    const rows: Array<Array<string>> = tableRows(
      sectionOf(page, "## Application compute"),
    ).slice(1);
    const replicas: Record<string, string> = {
      app: "app.replicaCount",
      worker: "worker.replicaCount",
      probes: "probes.one.replicaCount",
      nginx: "nginx.replicaCount",
      telemetryWriter: "telemetryWriter.replicaCount",
    };

    expect(
      rows.map((row: Array<string>): string => {
        return unwrap(row[1] as string);
      }),
    ).toEqual(Object.keys(replicas));

    for (const [key, replicaPath] of Object.entries(replicas)) {
      expect({ key, replicas: valueAt(values, replicaPath) }).toEqual({
        key,
        replicas: key === "telemetryWriter" ? 2 : 1,
      });
    }

    expect(valueAt(values, "worker.enabled")).toBe(false);
    expect(valueAt(values, "telemetryWriter.enabled")).toBe(false);
    expect(isEmptySetting(valueAt(values, "worker.resources"))).toBe(true);
    expect(isEmptySetting(valueAt(values, "telemetryWriter.resources"))).toBe(
      true,
    );
    expect(page).toContain(
      "with one replica, except the telemetry writer, which runs two",
    );
  });

  it("each pod opens up to 50 connections, and the bundled PostgreSQL allows 500", () => {
    expect(valueAt(values, "postgresql.primary.configuration")).toMatch(
      /^max_connections = 500$/m,
    );
    expect(
      valueAt(values, "postgresOperator.cnpg.parameters.max_connections"),
    ).toBe("500");
    expect(readSource("environmentConfig")).toContain(
      'process.env["DATABASE_MAX_OPEN_CONNECTIONS"] || "50"',
    );
    expect(valueAt(values, "pgbouncer.enabled")).toBe(false);
    expect(page).toContain(
      "Each pod opens up to 50 connections by default, and the bundled PostgreSQL allows 500.",
    );
    expect(page).toContain(
      "The chart includes an optional **PgBouncer** connection pooler (`pgbouncer.enabled`)",
    );
  });

  it("Valkey keeps nothing on disk by default, and never evicts", () => {
    expect(valueAt(values, "valkey.master.persistence.enabled")).toBe(false);
    expect(valueAt(values, "valkey.commonConfiguration")).toMatch(
      /^maxmemory-policy noeviction$/m,
    );
    expect(page).toContain("persistence is **off by default**");
    expect(page).toContain("Its eviction policy is `noeviction`");
  });

  it("the chart bundles KEDA, and each service that scales on its queue has its own switch", () => {
    const dependencies: Array<{ name: string; condition?: string }> = (
      yamlOf("chartManifest") as {
        dependencies: Array<{ name: string; condition?: string }>;
      }
    ).dependencies;
    const keda: { name: string; condition?: string } | undefined =
      dependencies.find((dependency: { name: string }): boolean => {
        return dependency.name === "keda";
      });

    expect(keda?.condition).toContain("keda.enabled");
    expect(valueAt(values, "keda.enabled")).toBe(false);

    for (const service of ["app", "worker", "probes.one", "runner"]) {
      expect({
        service,
        keda: valueAt(values, `${service}.keda.enabled`),
      }).toEqual({ service, keda: false });
    }

    expect(valueAt(values, "autoscaling.enabled")).toBe(false);
    expect(sourceExists("HelmChart/Docs/Keda.md")).toBe(true);
    expect(page).toContain(
      "Turn on `keda.enabled` together with each service's own `keda.enabled` (`app.keda.enabled`, for example).",
    );
    expect(page).toContain(
      "https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/Keda.md",
    );
  });

  it("both operators are bundled, start as single instances, and take the keys the page names", () => {
    const dependencies: Array<{ name: string; condition?: string }> = (
      yamlOf("chartManifest") as {
        dependencies: Array<{ name: string; condition?: string }>;
      }
    ).dependencies;
    const conditionOf: (name: string) => string | undefined = (
      name: string,
    ): string | undefined => {
      return dependencies.find((dependency: { name: string }): boolean => {
        return dependency.name === name;
      })?.condition;
    };

    expect(conditionOf("cloudnative-pg")).toBe("postgresOperator.cnpg.enabled");
    expect(conditionOf("altinity-clickhouse-operator")).toBe(
      "clickhouseOperator.altinity.enabled",
    );
    expect(valueAt(values, "postgresOperator.cnpg.enabled")).toBe(false);
    expect(valueAt(values, "postgresOperator.cnpg.instances")).toBe(1);
    expect(valueAt(values, "clickhouseOperator.altinity.enabled")).toBe(false);
    expect(
      valueAt(values, "clickhouseOperator.altinity.cluster.replicasCount"),
    ).toBe(1);
    expect(
      valueAt(values, "clickhouseOperator.altinity.cluster.shardsCount"),
    ).toBe(1);
    expect(valueAt(values, "clickhouseOperator.altinity.keeper.replicas")).toBe(
      3,
    );
    expect(valueAt(values, "externalValkey.host")).toBeNull();

    for (const key of [
      "postgresOperator.cnpg.enabled",
      "postgresOperator.cnpg.instances",
      "clickhouseOperator.altinity.enabled",
      "clickhouseOperator.altinity.cluster.replicasCount",
      "shardsCount",
      "externalValkey",
    ]) {
      expect({ key, onPage: page.includes(`\`${key}\``) }).toEqual({
        key,
        onPage: true,
      });
    }

    expect(page).toContain(
      "The chart's built-in datastores run as **single instances** by default.",
    );
    expect(page).toContain(
      "Its bundled ClickHouse Keeper runs **3 nodes** for quorum.",
    );
  });

  it("the chart's own CloudNativePG backup takes volume snapshots", () => {
    expect(valueAt(values, "postgresOperator.cnpg.backup.enabled")).toBe(false);
    expect(readSource("cnpgScheduledBackup")).toContain(
      "method: volumeSnapshot",
    );
    expect(page).toContain(
      "The chart's own CloudNativePG backup (`postgresOperator.cnpg.backup`) takes volume snapshots and needs no object store.",
    );
  });

  it("the migration guides the warning links to are the chart's", () => {
    for (const guide of [
      "MigratePostgresStandaloneToOperator.md",
      "MigrateClickhouseStandaloneToOperator.md",
    ]) {
      expect({
        guide,
        exists: sourceExists(`HelmChart/Docs/${guide}`),
      }).toEqual({ guide, exists: true });
      expect(page).toContain(
        `https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/${guide}`,
      );
    }
  });

  it("the project's default retention is 15 days, on Settings > Telemetry & APM > Data Retention", () => {
    const menu: Array<MenuSection> = objectMenuSections(
      readSource("settingsSideMenu"),
    );
    const routes: string = readSource("settingsRoutes");
    const settings: string = readSource("telemetrySettings");

    expect(HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS).toBe(15);
    expect(menuSection(menu, "Telemetry & APM").items).toContain(
      "Data Retention",
    );
    expect(routes).toContain(
      'import SettingsTelemetrySettings from "../Pages/Settings/TelemetrySettings";',
    );
    expect(routes).toMatch(
      /PageMap\.SETTINGS_TELEMETRY_SETTINGS,\s*\)\}\s*element=\{\s*<SettingsTelemetrySettings/,
    );
    expect(settings).toContain('title: "Default Retention (Days)",');
    expect(settings).toContain('placeholder: "15",');

    expect(page).toContain(
      "Every edition has the project's default, under **Project Settings > Telemetry & APM > Data Retention** (**Default Retention (Days)**); when nothing is set, it is 15 days.",
    );
  });

  it("logs and metrics expire at the first midnight after their retention ends", () => {
    expect(RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY).toMatch(
      /^toStartOfDay\(retentionDate/,
    );
    expect(RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY).toMatch(
      /\+ INTERVAL 1 DAY DELETE$/,
    );

    for (const model of ["logModel", "metricModel"]) {
      expect({
        model,
        roundedUp: readSource(model).includes(
          "ttlExpression: RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY",
        ),
      }).toEqual({ model, roundedUp: true });
    }

    expect(page).toContain(
      "Logs and metrics are deleted a day at a time, at the first midnight (ClickHouse server time) after their retention ends",
    );
    expect(page).toContain("size logs and metrics for **retention days + 1**");
  });

  it("the Docker Compose sizing the page quotes is the Docker Compose page's recommendation", () => {
    const requirements: string = sectionOf(english(COMPOSE), "## Requirements");

    expect(rowOf(requirements, "**Memory**")[1]).toBe("16 GB");
    expect(rowOf(requirements, "**CPU**")[1]).toBe("8 cores");
    expect(rowOf(requirements, "**Disk**")[1]).toBe("400 GB");
    expect(page).toContain(
      "(16 GB of memory, 8 cores and 400 GB of disk recommended)",
    );
  });
});

describe("Slack Integration, against the manifest and the server", () => {
  const page: string = english(SLACK);
  const manifest: Record<string, unknown> = JSON.parse(
    readSource("slackManifest"),
  ) as Record<string, unknown>;

  // The path of a manifest URL, after the server URL it is built on.
  const pathOf: (url: string) => string = (url: string): string => {
    expect(url.startsWith("{{SERVER_URL}}")).toBe(true);
    return url.slice("{{SERVER_URL}}".length);
  };

  it("the manifest calls exactly the four POST routes the page publishes, and redirects to /api/slack/auth", () => {
    const redirects: Array<string> = valueAt(
      manifest,
      "oauth_config.redirect_urls",
    ) as Array<string>;
    const callbacks: Array<string> = [
      ...new Set<string>(
        stringsIn(manifest)
          .filter((value: string): boolean => {
            return (
              value.startsWith("{{SERVER_URL}}") && !redirects.includes(value)
            );
          })
          .map(pathOf),
      ),
    ].sort();
    const published: Array<string> = tableRows(
      sectionOf(page, "### Traffic direction and endpoints"),
    )
      .map((row: Array<string>): string => {
        return unwrap(row[0] as string);
      })
      .filter((cell: string): boolean => {
        return cell.startsWith("POST /api/slack/");
      })
      .map((cell: string): string => {
        return cell.slice("POST ".length);
      })
      .sort();

    expect(callbacks).toEqual([
      "/api/slack/command",
      "/api/slack/events",
      "/api/slack/interactive",
      "/api/slack/options-load",
    ]);
    expect(published).toEqual(callbacks);
    expect(redirects.map(pathOf)).toEqual(["/api/slack/auth"]);
    expect(page).toContain(
      "The manifest registers `/api/slack/auth` as the redirect URL prefix",
    );
  });

  it("the server answers each callback through the signature check, and the browser on the auth paths", () => {
    const api: string = readSource("slackApi");

    for (const route of [
      "/slack/events",
      "/slack/interactive",
      "/slack/options-load",
      "/slack/command",
    ]) {
      expect({
        route,
        signed: new RegExp(
          `router\\.post\\(\\s*"${escapeRegex(route)}",\\s*SlackAuthorization\\.isAuthorizedSlackRequest`,
        ).test(api),
      }).toEqual({ route, signed: true });
    }

    expect(registersRoute(api, "get", "/slack/app-manifest")).toBe(true);
    expect(registersRoute(api, "get", "/slack/auth/:projectId/:userId")).toBe(
      true,
    );
    expect(
      registersRoute(api, "get", "/slack/auth/:projectId/:userId/user"),
    ).toBe(true);
    expect(page).toContain(
      "OAuth redirects to `/api/slack/auth/:projectId/:userId` and `/api/slack/auth/:projectId/:userId/user`",
    );
    expect(page).toContain(
      "It is also served at `https://oneuptime.example.com/api/slack/app-manifest`.",
    );
  });

  it("the commands and shortcuts are the manifest's, on the routes the page gives them", () => {
    const commands: Array<{ command: string; url: string }> = valueAt(
      manifest,
      "features.slash_commands",
    ) as Array<{ command: string; url: string }>;
    const shortcuts: Array<{ name: string; callback_id: string }> = valueAt(
      manifest,
      "features.shortcuts",
    ) as Array<{ name: string; callback_id: string }>;
    const features: string = sectionOf(page, "## What the app can do");

    expect(
      commands.map((command: { command: string }): string => {
        return command.command;
      }),
    ).toEqual(["/incident", "/maintenance", "/oneuptime"]);

    for (const command of commands) {
      const row: Array<string> | undefined = tableRows(features).find(
        (cells: Array<string>): boolean => {
          return (cells[0] as string).startsWith(`\`${command.command}\``);
        },
      );

      expect({ command: command.command, route: row?.[2] }).toEqual({
        command: command.command,
        route: `\`POST ${pathOf(command.url)}\``,
      });
    }

    for (const shortcut of shortcuts) {
      expect({
        shortcut: shortcut.name,
        row: tableRows(features).some((cells: Array<string>): boolean => {
          return (cells[0] as string).includes(
            `\`${shortcut.callback_id}\` and the **${shortcut.name}** shortcut`,
          );
        }),
      }).toEqual({ shortcut: shortcut.name, row: true });
    }
  });

  it("images need files:write, which the manifest has, and Socket Mode is off", () => {
    expect(valueAt(manifest, "oauth_config.scopes.bot")).toContain(
      "files:write",
    );
    expect(valueAt(manifest, "settings.socket_mode_enabled")).toBe(false);
    expect(valueAt(manifest, "settings.interactivity.is_enabled")).toBe(true);
    expect(page).toContain(
      "which needs the `files:write` bot scope. The generated manifest includes it.",
    );
    expect(page).toContain(
      "OneUptime's manifest uses HTTP callbacks and disables Socket Mode",
    );
  });

  it("the manifest's URLs are built from HOST and HTTP_PROTOCOL", () => {
    const handler: string = blockFrom(
      readSource("slackApi"),
      '"/slack/app-manifest"',
      "router.get(",
    );

    expect(handler).toContain("new URL(HttpProtocol, Host)");
    expect(handler).toContain(
      ".replace(/{{SERVER_URL}}/g, ServerURL.toString())",
    );
    expect(page).toContain(
      "OneUptime builds the app manifest and every callback URL from `HOST` and `HTTP_PROTOCOL`.",
    );
  });

  it("a request is refused without the signing secret, or when it is more than five minutes old", () => {
    const authorization: string = readSource("slackAuthorization");

    expect(authorization).toContain(
      "const MAX_REQUEST_AGE_IN_SECONDS: number = 5 * 60;",
    );
    expect(authorization).toMatch(
      /if \(!SlackAppSigningSecret\) \{[\s\S]*?return Response\.sendErrorResponse/,
    );
    expect(authorization).toContain('req.headers["x-slack-signature"]');
    expect(authorization).toContain('req.headers["x-slack-request-timestamp"]');

    expect(page).toContain(
      "OneUptime rejects a request whose signature does not match or whose timestamp is more than five minutes old.",
    );
    expect(page).toContain(
      "OneUptime only answers Slack's challenge once the signing secret is set",
    );
    expect(page).toContain(
      "`Content-Type`, `X-Slack-Signature` and `X-Slack-Request-Timestamp`",
    );
  });

  it("the variables the table names are the server's, and the chart sets each from its Helm value", () => {
    expect(expectEnvironmentTableHeld(SLACK, "## Environment variables")).toBe(
      5,
    );
  });

  it("an existing Secret is read with the keys the page names", () => {
    const keys: Record<string, string> = {
      SLACK_APP_CLIENT_ID: "clientIdKey",
      SLACK_APP_CLIENT_SECRET: "clientSecretKey",
      SLACK_APP_SIGNING_SECRET: "signingSecretKey",
    };

    for (const [variable, key] of Object.entries(keys)) {
      const block: string = chartEnvBlock(variable);

      expect(block).toContain("$.Values.slackApp.existingSecret.name");
      expect(block).toContain(`$.Values.slackApp.existingSecret.${key}`);
    }

    expect(page).toContain(
      "set `slackApp.existingSecret` instead: its `name`, and the keys `clientIdKey`, `clientSecretKey` and `signingSecretKey`.",
    );
  });

  it("the Slack page shows the setup guide until there is a client ID, then Connect with Slack", () => {
    const integration: string = readSource("slackIntegration");

    expect(integration).toMatch(
      /if \(!SlackAppClientId\) \{[\s\S]{0,300}<SlackIntegrationDocumentation/,
    );
    expect(readSource("slackDocumentation")).toContain(
      "title={`Integrating Slack with your OneUptime Project`}",
    );
    expect(integration).toContain("cardTitle = `Connect with Slack`;");
    expect(integration).toContain(
      "getConnectWithSlackButton(`Connect my account with Slack`)",
    );
    expect(readSource("connectCallbackMessage")).toContain(
      'translationKey("Slack was not connected")',
    );

    expect(page).toContain(
      "the page shows **Integrating Slack with your OneUptime Project** with the manifest generated for your hostname",
    );
    expect(page).toContain(
      "Without it, the Slack page shows the setup guide instead of **Connect with Slack**.",
    );
    expect(page).toContain("selects **Connect my account with Slack**");
    expect(page).toContain("says **Slack was not connected**");
  });
});

describe("the workspace pages and their connect links", () => {
  it("Project Settings and User Settings each have a Workspace section with Slack and Microsoft Teams", () => {
    const settings: Array<MenuSection> = objectMenuSections(
      readSource("settingsSideMenu"),
    );
    const workspace: string = readSource("workspaceSideMenuSection");
    const userSettings: string = readSource("userSettingsSideMenu");

    expect(menuSection(settings, "Workspace").items).toEqual(
      expect.arrayContaining(["Slack", "Microsoft Teams"]),
    );
    expect(workspace).toContain(
      'export const WORKSPACE_SECTION_TITLE: string = "Workspace";',
    );
    expect(workspace).toContain('[WorkspaceMenuEntry.Slack]: "Slack",');
    expect(workspace).toContain(
      '[WorkspaceMenuEntry.MicrosoftTeams]: "Microsoft Teams",',
    );
    expect(userSettings).toContain(
      "slack: PageMap.USER_SETTINGS_SLACK_INTEGRATION,",
    );
    expect(userSettings).toContain(
      "microsoftTeams: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION,",
    );

    for (const [page, workspaceName] of [
      [SLACK, "Slack"],
      [TEAMS, "Microsoft Teams"],
    ] as Array<[string, string]>) {
      for (const where of ["Project Settings", "User Settings"]) {
        const words: string = `**${where} > Workspace > ${workspaceName}**`;

        expect({ page, words, onPage: english(page).includes(words) }).toEqual({
          page,
          words,
          onPage: true,
        });
      }
    }
  });

  it("the Notifications section holds the settings and logs the Teams and Twilio pages open", () => {
    const notifications: MenuSection = menuSection(
      objectMenuSections(readSource("settingsSideMenu")),
      "Notifications",
    );

    expect(notifications.items).toEqual(
      expect.arrayContaining(["Notification Settings", "Notification Logs"]),
    );
    expect(english(TEAMS)).toContain(
      "**Project Settings > Notifications > Notification Logs**",
    );
    expect(english(TWILIO)).toContain(
      "**Project Settings > Notifications > Notification Settings**",
    );
  });

  it("a connect link works once, for 15 minutes, in the browser that started it, and only these roles may start one", () => {
    const state: string = readSource("workspaceOAuthState");
    const roles: string = blockFrom(
      state,
      "MANAGE_CONNECTION_PERMISSIONS",
      "];",
    );

    expect(state).toContain(
      "public static readonly EXPIRES_IN_SECONDS: number = 15 * 60;",
    );
    expect(state).toContain("it is single-use");
    expect(state).toContain("it is bound to the browser that started the flow");
    expect(roles.match(/Permission\.\w+/g)).toEqual([
      "Permission.ProjectOwner",
      "Permission.ProjectAdmin",
      "Permission.ProjectMember",
    ]);

    for (const page of [SLACK, TEAMS]) {
      const text: string = english(page);

      expect({
        page,
        roles: text.includes(
          "the **Project Owner**, **Project Admin** or **Project Member** role in it",
        ),
        link: text.includes(
          "The link works once, for 15 minutes, in the browser that started it.",
        ),
      }).toEqual({ page, roles: true, link: true });
    }
  });
});

describe("Microsoft Teams Integration, against the server and the Teams card", () => {
  const page: string = english(TEAMS);
  const api: string = readSource("teamsApi");

  it("the sign-in redirects and the bot endpoint are the server's routes", () => {
    for (const route of [
      "/microsoft-teams/auth",
      "/microsoft-teams/admin-consent/callback",
      "/microsoft-teams/app-manifest-zip",
      "/microsoft-bot/test",
      "/microsoft-bot/messages",
    ]) {
      expect({ route, get: registersRoute(api, "get", route) }).toEqual({
        route,
        get: true,
      });
    }

    expect(registersRoute(api, "post", "/microsoft-bot/messages")).toBe(true);

    for (const url of [
      "https://your-oneuptime-domain.com/api/microsoft-teams/auth",
      "https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback",
      "https://your-oneuptime-domain.com/api/microsoft-bot/messages",
    ]) {
      expect({ url, onPage: page.includes(`\`${url}\``) }).toEqual({
        url,
        onPage: true,
      });
    }
  });

  it("a GET of the messaging endpoint is answered 405, with Allow: POST", () => {
    expect(api).toMatch(
      /router\.get\(\s*"\/microsoft-bot\/messages",[\s\S]*?res\.setHeader\("Allow", "POST"\);[\s\S]*?res\.status\(405\)/,
    );
    expect(page).toContain(
      "a GET is answered `405 Method Not Allowed`, with `Allow: POST` and a description of the endpoint",
    );
  });

  it("OneUptime's own 404 for that path is the 58-byte body the page quotes", () => {
    const body: string = JSON.stringify({
      message: "Page not found - /api/microsoft-bot/messages",
    });

    expect(readSource("startServer")).toContain(
      "new NotFoundException(`Page not found - ${req.url}`)",
    );
    expect(readSource("response")).toContain(
      "oneUptimeResponse.status(status).send({ message });",
    );
    expect(Buffer.byteLength(body)).toBe(58);
    expect(page).toContain(`\`${body}\``);
    expect(page).toContain(
      '`"GET /api/microsoft-bot/messages HTTP/1.1" 404 58`',
    );
  });

  it("the configuration check reads the environment and nothing else", () => {
    const check: string = blockFrom(
      api,
      '"/microsoft-bot/test"',
      "router.get(",
    );

    expect(check).toContain("botId: MicrosoftTeamsAppClientId");
    expect(check).toContain("verified: [");
    expect(check).toContain("notVerified: [");
    expect(check).not.toContain("await ");
    expect(page).toContain(
      "curl -sS https://your-oneuptime-domain.com/api/microsoft-bot/test | jq",
    );
    expect(page).toContain("It reads environment variables and nothing else.");
  });

  it("the variables the table names are the server's, and the chart sets each from its Helm value", () => {
    expect(expectEnvironmentTableHeld(TEAMS, "## Environment variables")).toBe(
      5,
    );
  });

  it("an existing Secret is read with the keys the page names", () => {
    const keys: Record<string, string> = {
      MICROSOFT_TEAMS_APP_CLIENT_ID: "clientIdKey",
      MICROSOFT_TEAMS_APP_CLIENT_SECRET: "clientSecretKey",
      MICROSOFT_TEAMS_APP_TENANT_ID: "tenantIdKey",
    };

    for (const [variable, key] of Object.entries(keys)) {
      const block: string = chartEnvBlock(variable);

      expect(block).toContain("$.Values.microsoftTeamsApp.existingSecret.name");
      expect(block).toContain(
        `$.Values.microsoftTeamsApp.existingSecret.${key}`,
      );
    }

    expect(page).toContain(
      "set `microsoftTeamsApp.existingSecret` instead: its `name`, and the keys `clientIdKey`, `clientSecretKey` and `tenantIdKey`.",
    );
  });

  it("the Teams page shows the setup guide until there is a client ID, then the admin consent card", () => {
    const card: string = readSource("teamsIntegration");

    expect(card).toMatch(
      /if \(!MicrosoftTeamsAppClientId\) \{[\s\S]{0,300}<MicrosoftTeamsIntegrationDocumentation \/>/,
    );
    expect(card).toMatch(
      /\?\s*"Admin Consent Completed"\s*:\s*"Grant Admin Consent"/,
    );
    expect(card).toContain('title: "Grant Admin Consent",');
    expect(card).toContain(
      'translationKey("Connect my account with Microsoft Teams")',
    );

    expect(page).toContain(
      "shows the **Grant Admin Consent** card instead of the setup guide",
    );
    expect(page).toContain("the card reads **Admin Consent Completed**");
    expect(page).toContain(
      "Without the client ID, the Microsoft Teams page shows the setup guide instead of **Grant Admin Consent**.",
    );
    expect(page).toContain(
      "select **Connect my account with Microsoft Teams**",
    );
  });

  it("the manifest card downloads the zip the server builds, on a self-hosted install", () => {
    const card: string = readSource("teamsIntegration");

    expect(card).toMatch(
      /!BILLING_ENABLED && \(\s*<div className="mt-6">\s*<Card\s*title="Action Required: Install This Deployment's App on Microsoft Teams"/,
    );
    expect(card).toContain('title: "Download App Manifest Zip",');
    expect(card).toContain("api/microsoft-teams/app-manifest-zip");
    expect(page).toContain(
      "shows the **Action Required: Install This Deployment's App on Microsoft Teams** card. Select **Download App Manifest Zip**",
    );
  });

  it("the zip is refused for a client ID that is not a GUID", () => {
    const zip: string = blockFrom(
      api,
      '"/microsoft-teams/app-manifest-zip"',
      "router.get(",
    );

    expect(zip).toContain(
      "Microsoft Teams App Client ID must be a valid GUID.",
    );
    expect(page).toContain(
      "**Download App Manifest Zip** refuses to build a package when `MICROSOFT_TEAMS_APP_CLIENT_ID` is not a GUID",
    );
  });

  it("the chats card is Microsoft Teams Chats, refreshed with Refresh Chats", () => {
    const chats: string = readSource("teamsChatsCard");

    expect(chats).toContain('title="Microsoft Teams Chats"');
    expect(chats).toContain('title: "Refresh Chats",');
    expect(readSource("connectCallbackMessage")).toContain(
      '"Microsoft Teams was not connected"',
    );
    expect(page).toContain(
      "Clicking **Refresh Chats** re-reads OneUptime's stored chats, and re-reads the name of each stored group chat from Microsoft.",
    );
    expect(page).toContain("says **Microsoft Teams was not connected**");
  });

  it("each troubleshooting heading that quotes the server quotes it as the server words it", () => {
    const quotes: Array<{ heading: string; source: string }> = [
      {
        heading:
          "The OneUptime app is not installed in the Microsoft Teams team ...",
        source: "teamsUtil",
      },
      {
        heading:
          "Microsoft Teams refused the message ... because the OneUptime bot is not a member of that conversation",
        source: "teamsUtil",
      },
      {
        heading: "Sorry, I couldn't find your project configuration",
        source: "teamsUtil",
      },
      {
        heading:
          "This Microsoft 365 organization is connected to more than one OneUptime project",
        source: "teamsUtil",
      },
      {
        heading: "Microsoft Teams App Client ID must be a valid GUID",
        source: "teamsApi",
      },
    ];

    for (const quote of quotes) {
      const source: string = readSource(quote.source);
      let from: number = 0;

      expect(page).toContain(`### "${quote.heading}"`);

      for (const part of quote.heading
        .split("...")
        .map((piece: string): string => {
          return piece.trim();
        })
        .filter(Boolean)) {
        const at: number = source.indexOf(part, from);

        expect({ part, found: at >= 0 }).toEqual({ part, found: true });
        from = at + part.length;
      }
    }
  });

  it("the tenant check logs the line the page searches for, and the query reads the token table", () => {
    const query: string = fencedBlocks(page, "sql")[0] as string;
    const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    const columns: Array<string> = Object.keys(getTableColumns(token));

    expect(readSource("teamsUtil")).toContain(
      '"Project auth not found for tenant ID: "',
    );
    expect(page).toContain(
      'grep "Project auth not found for tenant ID" <your app logs>',
    );
    expect(query).toContain(`FROM "${token.tableName}"`);

    for (const column of ["projectId", "workspaceProjectId", "workspaceType"]) {
      expect(columns).toContain(column);
      expect(query).toContain(`"${column}"`);
    }

    expect(query).toContain(`'${WorkspaceType.MicrosoftTeams}'`);
  });

  it("the commercial cloud's fallback connector is the URL the page names", () => {
    expect(readSource("teamsServiceUrl")).toContain(
      '"https://smba.trafficmanager.net/teams/"',
    );
    expect(page).toContain(
      "The commercial-cloud fallback connector is `https://smba.trafficmanager.net/teams/`",
    );
  });
});

describe("Twilio Integration, against the notification server and the forms", () => {
  const page: string = english(TWILIO);

  it("only the legacy import reads the old variables, and the chart has no Twilio values", () => {
    const readers: Array<string> = [
      ...serverSourcesUnder("packages/App/FeatureSet"),
      ...serverSourcesUnder(COMMON_SERVER),
    ].filter((file: string): boolean => {
      return fs
        .readFileSync(path.join(REPO_DIR, file), "utf8")
        .includes('process.env["TWILIO_');
    });
    const migration: string = readSource("twilioMigration");

    expect(readers).toEqual([SOURCES["twilioMigration"]]);

    for (const variable of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    ]) {
      expect(migration).toContain(`process.env["${variable}"]`);
      expect(page).toContain(`\`${variable}\``);
    }

    expect(readSource("chartValues")).not.toMatch(/twilio/i);
    expect(page).toContain("the Helm chart has no Twilio credential values");
  });

  it("each callback path is the notification server's route, behind the ingress's /notification prefix", () => {
    const index: string = readSource("notificationIndex");
    const incoming: string = readSource("incomingCallApi");
    const paths: Array<string> = tableRows(
      sectionOf(page, "## 3. Configure network access"),
    )
      .filter((row: Array<string>): boolean => {
        return row[0] === "POST";
      })
      .map((row: Array<string>): string => {
        return unwrap(row[1] as string);
      });

    expect(paths).toEqual([
      "/notification/sms/status-callback/:smsLogId/:token",
      "/api/user-notification-log-timeline/call/gather-input/:itemId?token=...",
      "/notification/incoming-call/voice",
      "/notification/incoming-call/dial-status/:callLogId/:callLogItemId",
    ]);
    expect(index).toContain('const APP_NAME: string = "api/notification";');
    expect(index).toContain('app.use([`/${APP_NAME}/sms`, "/sms"], SmsAPI);');
    expect(index).toContain(
      'app.use([`/${APP_NAME}/incoming-call`, "/incoming-call"], IncomingCallAPI);',
    );
    expect(
      registersRoute(
        readSource("smsApi"),
        "post",
        "/status-callback/:smsLogId/:token",
      ),
    ).toBe(true);
    expect(registersRoute(incoming, "post", "/voice")).toBe(true);
    expect(
      registersRoute(
        incoming,
        "post",
        "/dial-status/:callLogId/:callLogItemId",
      ),
    ).toBe(true);
    expect(readSource("ingressConfig")).toContain(
      "rewrite ^/notification(.*)$ /api/notification$1 break;",
    );
    expect(page).toContain(
      "Forward them through OneUptime's Nginx gateway, which maps the external `/notification` prefix to the application.",
    );
  });

  it("the keypad route keeps /api, under the call timeline's API path, and checks its signed token", () => {
    const timeline: string = readSource("callTimelineApi");

    expect(readSource("callTimelineModel")).toContain(
      '@CrudApiEndpoint(new Route("/user-notification-log-timeline"))',
    );
    expect(timeline).toContain("/call/gather-input/:itemId`");
    expect(timeline).toContain(
      "NotificationMiddleware.isValidCallNotificationRequest",
    );
    expect(page).toContain("Keep `/api` on the keypad route.");
    expect(page).toContain("keypad acknowledgement uses a signed query token");
  });

  it("the incoming-call handlers check Twilio's signature", () => {
    expect(
      (
        readSource("incomingCallApi").match(
          /req\.headers\["x-twilio-signature"\]/g,
        ) || []
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(page).toContain("Incoming-call handlers validate Twilio signatures");
    expect(page).toContain("`X-Twilio-Signature` header through proxies");
  });

  it("the project form asks for the fields the steps name", () => {
    const table: string = readSource("callSmsConfigTable");

    for (const field of [
      "Twilio Account SID",
      "Twilio Auth Token",
      "Twilio Primary Phone Number",
      "Twilio Secondary Phone Numbers",
    ]) {
      expect({
        field,
        inForm: table.includes(`title: "${field}",`),
        onPage: page.includes(`**${field}**`),
      }).toEqual({ field, inForm: true, onPage: true });
    }
  });

  it("the installation-wide configuration is the Admin Dashboard's Call and SMS page", () => {
    const sections: Array<MenuSection> = jsxMenuSections(
      readSource("adminSettingsSideMenu"),
      adminText,
    );
    const callSms: string = readSource("adminCallSms");

    expect(menuSection(sections, "Notifications").items).toContain(
      "Call and SMS",
    );

    for (const field of [
      "twilioAccountSID",
      "twilioAuthToken",
      "twilioPrimaryPhoneNumber",
      "twilioSecondaryPhoneNumbers",
    ]) {
      expect(callSms).toContain(`${field}: true`);
    }

    expect(page).toContain("**Admin Dashboard > Settings > Call and SMS**");
  });
});

describe("GitHub Integration, against the server and Code Repositories", () => {
  const page: string = english(GITHUB);
  const api: string = readSource("githubApi");

  it("the callback and the webhook are the server's routes", () => {
    expect(registersRoute(api, "get", "/github/auth/callback")).toBe(true);
    expect(registersRoute(api, "post", "/github/webhook")).toBe(true);
    expect(page).toContain(
      "`https://your-oneuptime-domain.com/api/github/auth/callback`",
    );
    expect(page).toContain(
      "`https://your-oneuptime-domain.com/api/github/webhook`",
    );
  });

  it("webhooks are checked against X-Hub-Signature-256, and refused while the secret is unset", () => {
    expect(api).toContain('"x-hub-signature-256"');
    expect(api).toContain('new BadDataException("Invalid webhook signature")');
    expect(readSource("githubUtil")).toMatch(
      /if \(!GitHubAppWebhookSecret\) \{[\s\S]*?return false;/,
    );
    expect(page).toContain(
      "`X-Hub-Signature-256`, `X-GitHub-Event`, and `X-GitHub-Delivery`",
    );
    expect(page).toContain(
      ':::details GitHub\'s Recent Deliveries show "Invalid webhook signature"',
    );
    expect(page).toContain(
      "Webhooks are refused while `GITHUB_APP_WEBHOOK_SECRET` is unset.",
    );
  });

  it("the events the page subscribes are the ones the webhook handler knows", () => {
    const known: Array<string> = [
      ...blockFrom(
        readSource("githubWebhookEvents"),
        "export enum GitHubWebhookEvent {",
        "}",
      ).matchAll(ENUM_MEMBER_VALUE),
    ]
      .map((match: RegExpExecArray): string => {
        return match[1] as string;
      })
      .sort();
    const interactive: Array<string> = tableRows(
      sectionOf(page, "### Subscribe to webhook events"),
    )
      .slice(1)
      .map((row: Array<string>): string => {
        return unwrap(row[0] as string);
      });

    expect(known).toEqual([
      "installation",
      "installation_repositories",
      "issue_comment",
      "issues",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
    ]);
    expect(interactive).toEqual([
      "Issue comment",
      "Issues",
      "Pull request",
      "Pull request review",
      "Pull request review comment",
    ]);

    for (const event of interactive) {
      expect(known).toContain(event.toLowerCase().replaceAll(" ", "_"));
    }

    expect(page).toContain(
      "**Repository synchronisation** — `installation` and `installation_repositories`.",
    );
    expect(known).not.toContain("push");
    expect(known).not.toContain("workflow_run");
    expect(page).toContain(
      "Other events (**Push**, **Workflow run**) are acknowledged and ignored",
    );
  });

  it("the six variables are the server's, and the chart passes each through", () => {
    expect(
      expectEnvironmentTableHeld(GITHUB, "### Environment variables reference"),
    ).toBe(6);
    expect(page).toContain("All six are required.");
  });

  it("the private key is taken as a PEM, or as a PEM base64-encoded", () => {
    const decode: string = blockFrom(
      readSource("environmentConfig"),
      "const decodePrivateKey",
      "export const GitHubAppPrivateKey",
    );

    expect(decode).toContain('key.trim().startsWith("-----BEGIN")');
    expect(decode).toContain('Buffer.from(key, "base64")');
    expect(page).toContain(
      "| `GITHUB_APP_PRIVATE_KEY` | `gitHubApp.privateKey` | The private key: the PEM, or the PEM base64-encoded. |",
    );
    expect(page).toContain("base64 < private-key.pem | tr -d '\\n'");
  });

  it("the install link needs GITHUB_APP_NAME, and the mention handle falls back to it lower-cased and hyphenated", () => {
    const install: string = blockFrom(
      api,
      '"/github/install-url"',
      "router.post(",
    );
    const conversation: string = readSource("githubConversation");
    const slugify: string = blockFrom(
      conversation,
      "public static slugifyAppName",
      "\n  }\n",
    );

    expect(install).toContain("if (!GitHubAppName) {");
    expect(install).toContain("https://github.com/apps/${encodeURIComponent(");
    expect(conversation).toContain(
      "return GitHubConversation.slugifyAppName(GitHubAppName);",
    );
    expect(slugify).toContain(".toLowerCase()");
    expect(slugify).toContain('.replace(/[^a-z0-9]+/g, "-")');
    expect(page).toContain(
      "The install link and the app's `@mention` handle (lower-cased, spaces as hyphens) are built from it.",
    );
  });

  it("Code Repositories shows Connect with GitHub App once the app is set up, and says so when it is not", () => {
    const repositories: string = readSource("codeRepositoryPage");

    expect(repositories).toContain(
      'translator.translateText("Connect with GitHub App")',
    );
    expect(repositories).toContain(
      '"GitHub App is not configured on this server"',
    );
    expect(readSource("connectCallbackMessage")).toContain(
      'translationKey("GitHub was not connected")',
    );
    expect(page).toContain(
      "**Code Repositories** shows **Connect with GitHub App** instead of **GitHub App is not configured on this server**.",
    );
    expect(page).toContain(
      "**Code Repositories** says **GitHub was not connected**",
    );
  });

  it("Code Repositories is under Products > Tasks", () => {
    expect(readSource("navBar")).toContain('props.moreMenuTitle || "Products"');
    expect(readSource("navigationItems")).toContain(
      'title: t("navbar.items.aiAgentsTitle", "Tasks"),',
    );
    expect(readSource("codeSideMenu")).toContain('title: "Code Repositories",');
    expect(page).toContain(
      "Navigate to **Products** > **Tasks** > **Code Repositories**",
    );
  });

  it("on OneUptime Cloud, adding a code repository needs the Growth plan", () => {
    expect(new CodeRepository().getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(page).toContain(
      "On OneUptime Cloud, code repositories need the Growth plan or above.",
    );
  });
});

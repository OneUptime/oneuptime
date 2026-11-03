/*
 * THE CODING AGENT PLUGIN IS ONE THE DIRECTORIES TAKE, AND ITS SKILLS SAY WHAT
 * THE PRODUCT DOES.
 *
 * Scripts/MCP/BuildCodingAgentPlugin.js builds the folder OneUptime publishes
 * for Cursor's Marketplace and the Claude directory from CodingAgentPlugin/ and
 * the ChatGPT package's listing. Both directories refuse a plugin only once it
 * is submitted, and a skill that names a tool the server does not have fails
 * only in front of someone. These run the build and hold what it writes:
 *
 * - plugin.json and mcp.json to the Agent Plugins 1.0.0 schemas (copied in
 *   AgentPlugins/), which Cursor's checklist asks of a root manifest;
 * - .cursor-plugin/plugin.json and .claude-plugin/plugin.json to the fields
 *   each client documents, and the folder to the Claude directory's automated
 *   checks (claude.com/docs/plugins/pre-submission-checklist);
 * - every skill to the Agent Skills format, every tool and JSON example in one
 *   to the server, and what one says about OneUptime to the code it describes.
 */

import { afterAll, describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import Ajv2020, { ValidateFunction } from "ajv/dist/2020";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { getFilterProblem } from "../Tools/FilterCheck";
import { handleHelperTool, isHelperTool } from "../Tools/HelperTools";
import {
  generatePublicStatusPageTools,
  isPublicStatusPageTool,
} from "../Tools/PublicStatusPageTools";
import { generateAllTools } from "../Tools/ToolGenerator";
import { isWorkflowTool } from "../Tools/WorkflowTools";
import { McpToolInfo } from "../Types/McpTypes";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject, JSONValue, ObjectType } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { getOpenTelemetryGuidesIndexUrl } from "Common/Types/Telemetry/OpenTelemetryGuides";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CLI_FIELDS_SUBCOMMAND,
  CliFieldFlag,
  CliOperation,
  getCliFieldFlags,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  CliResource,
  getCliDatabaseModelType,
  getCliResource,
  getCliResources,
} from "Common/Utils/DeveloperDocs/CliResources";

interface Skill {
  directory: string;
  frontmatter: JSONObject;
  text: string;
}

interface ToolExample {
  tool: string;
  args: JSONObject;
}

const MCP_DIRECTORY: string = path.resolve(__dirname, "..");
const PACKAGES_DIRECTORY: string = path.resolve(MCP_DIRECTORY, "../../..");
const REPO_ROOT: string = path.resolve(PACKAGES_DIRECTORY, "..");
const CHATGPT_DIRECTORY: string = path.join(MCP_DIRECTORY, "ChatGPTPlugin");
const SCHEMA_DIRECTORY: string = path.join(__dirname, "AgentPlugins");
const CLI_DIRECTORY: string = path.join(PACKAGES_DIRECTORY, "CLI");
const OPEN_TELEMETRY_GUIDES: string = path.join(
  PACKAGES_DIRECTORY,
  "Home/Utils/Integrations/OpenTelemetry/GuideShared.ts",
);

/*
 * js-yaml from Common/node_modules, as the Docs tests load it and for the same
 * reason: Common declares js-yaml 4, App declares no YAML parser. Its `load`
 * uses the safe schema, and a skill's front matter is YAML.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const YAML: JsYamlModule = require(
  path.join(PACKAGES_DIRECTORY, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const TEMPORARY_DIRECTORY: string = fs.mkdtempSync(
  path.join(os.tmpdir(), "coding-agent-plugin-"),
);
const PLUGIN_DIRECTORY: string = path.join(TEMPORARY_DIRECTORY, "oneuptime");

execFileSync(
  process.execPath,
  [
    path.join(REPO_ROOT, "Scripts/MCP/BuildCodingAgentPlugin.js"),
    PLUGIN_DIRECTORY,
  ],
  { stdio: "pipe" },
);

afterAll(() => {
  fs.rmSync(TEMPORARY_DIRECTORY, { recursive: true, force: true });
});

const PLAN_REQUIREMENT: string =
  "On OneUptime Cloud, connecting an MCP client and using API keys need the Growth plan or higher.";
const NO_CREDENTIAL_NEEDED: string =
  "The public status page tools need no credential.";

/*
 * What a tool is called: a verb the server's tools start with, then the rest
 * of a snake_case name. Nothing else in a skill is lower-case snake_case.
 */
const TOOL_NAME_PATTERN: RegExp =
  /\b(?:acknowledge|add|count|create|delete|get|list|oneuptime|resolve|update)_[a-z][a-z_]*\b/g;

// A JSON example of a call: its info string names the tool after the language.
const TOOL_EXAMPLE_PATTERN: RegExp = /```json ([a-z_]+)\n([\s\S]*?)\n```/g;

const FRONTMATTER_PATTERN: RegExp = /^---\n([\s\S]*?)\n---\n/;

const CHATGPT_MENTION_PATTERN: RegExp = /ChatGPT|OpenAI|com\.openai/;

// Names Windows or macOS refuse, which stop the Claude directory's validation.
const REFUSED_FILE_NAME_PATTERN: RegExp = /[:*?"<>|]|[. ]$/;

const PUBLISHED_FILE_PATTERN: RegExp =
  /\.(?:json|md|png)$|\/?(?:LICENSE|NOTICE)$/;

// The package launchers the Claude directory holds or blocks.
const LAUNCHER_PATTERN: RegExp =
  /\b(?:npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run)\b/;

const PACKAGE_SOURCE_PATTERN: RegExp =
  /(?:^|\/)(?:\.npmrc|bunfig\.toml|uv\.toml|package\.json)$/;

// An API key, a MCP OAuth secret, or a real UUID where a placeholder belongs.
const CREDENTIAL_PATTERN: RegExp =
  /\bsk-[A-Za-z0-9]{8,}|\boumcp_[a-z]{2}_|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/;

const STATUS_PAGE_RESOURCE_TOOL_PATTERN: RegExp =
  /status_page_(?:resource|group|monitor)/;

const INGESTION_KEY_TOOL_PATTERN: RegExp = /ingestion_key/;

function readText(...segments: Array<string>): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

function readJson(...segments: Array<string>): JSONObject {
  return JSON.parse(readText(...segments)) as JSONObject;
}

function pluginFile(relativePath: string): string {
  return path.join(PLUGIN_DIRECTORY, relativePath);
}

// Every file under a directory, as a path from it, dotfiles included.
function filesUnder(
  directory: string,
  from: string = directory,
): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      return entry.isDirectory()
        ? filesUnder(full, from)
        : [path.relative(from, full).split(path.sep).join("/")];
    });
}

function schemaValidator(file: string): ValidateFunction {
  return new Ajv2020({ strict: false, allErrors: true }).compile(
    readJson(SCHEMA_DIRECTORY, file),
  );
}

function schemaErrors(validate: ValidateFunction, value: unknown): unknown {
  validate(value);

  return validate.errors || [];
}

function readSkill(directory: string): Skill {
  const text: string = readText(
    PLUGIN_DIRECTORY,
    "skills",
    directory,
    "SKILL.md",
  );
  const match: RegExpExecArray | null = FRONTMATTER_PATTERN.exec(text);

  if (!match) {
    throw new Error(`${directory}/SKILL.md opens with no front matter`);
  }

  return {
    directory,
    frontmatter: YAML.load(match[1]!) as JSONObject,
    text,
  };
}

function toolExamplesIn(text: string): Array<ToolExample> {
  return [...text.matchAll(TOOL_EXAMPLE_PATTERN)].map(
    (match: RegExpMatchArray): ToolExample => {
      return {
        tool: match[1]!,
        args: JSON.parse(match[2]!) as JSONObject,
      };
    },
  );
}

const PLUGIN_MANIFEST: JSONObject = readJson(PLUGIN_DIRECTORY, "plugin.json");
const CURSOR_MANIFEST: JSONObject = readJson(
  PLUGIN_DIRECTORY,
  ".cursor-plugin/plugin.json",
);
const CLAUDE_MANIFEST: JSONObject = readJson(
  PLUGIN_DIRECTORY,
  ".claude-plugin/plugin.json",
);
const AGENT_PLUGINS_MCP: JSONObject = readJson(PLUGIN_DIRECTORY, "mcp.json");
const CLAUDE_MCP: JSONObject = readJson(PLUGIN_DIRECTORY, ".mcp.json");
const README: string = readText(PLUGIN_DIRECTORY, "README.md");

const CHATGPT_MANIFEST: JSONObject = readJson(CHATGPT_DIRECTORY, "plugin.json");
const CHATGPT_LISTING: JSONObject = (
  (CHATGPT_MANIFEST["extensions"] as JSONObject)["com.openai"] as JSONObject
)["interface"] as JSONObject;

const REGISTRY_URL: string = (
  readJson(MCP_DIRECTORY, "server.json")["remotes"] as Array<JSONObject>
)[0]!["url"] as string;

const SKILLS: Array<Skill> = fs
  .readdirSync(pluginFile("skills"))
  .sort()
  .map(readSkill);

function skillNamed(name: string): Skill {
  const skill: Skill | undefined = SKILLS.find((candidate: Skill): boolean => {
    return candidate.directory === name;
  });

  if (!skill) {
    throw new Error(`There is no ${name} skill`);
  }

  return skill;
}

const TOOLS: Map<string, McpToolInfo> = new Map(
  generateAllTools().map((tool: McpToolInfo): [string, McpToolInfo] => {
    return [tool.name, tool];
  }),
);

// What oneuptime_describe_resource says a resource's fields can do.
type DescribedFields = Record<
  string,
  { filter?: true; sort?: true } | undefined
>;

// The tools of resources, which oneuptime_describe_resource describes.
const RESOURCE_TOOLS: Array<McpToolInfo> = [...TOOLS.values()].filter(
  (tool: McpToolInfo): boolean => {
    return (
      !isHelperTool(tool.name) &&
      !isPublicStatusPageTool(tool.name) &&
      !isWorkflowTool(tool.name)
    );
  },
);

// The fields of a tool's resource, as an agent reads them before a call.
function describedFieldsOf(toolName: string): DescribedFields {
  const description: { success?: boolean; fields?: DescribedFields } =
    JSON.parse(
      handleHelperTool(
        "oneuptime_describe_resource",
        { resource: toolName },
        RESOURCE_TOOLS,
      ),
    ) as { success?: boolean; fields?: DescribedFields };

  expect([toolName, description.success]).toEqual([toolName, true]);

  return description.fields || {};
}

describe("the coding agent plugin", () => {
  describe("as an Agent Plugin, which is what Cursor's Marketplace loads", () => {
    test("plugin.json meets the published manifest schema", () => {
      expect(
        schemaErrors(schemaValidator("plugin.schema.json"), PLUGIN_MANIFEST),
      ).toEqual([]);
    });

    test("mcp.json meets the published MCP schema", () => {
      expect(
        schemaErrors(schemaValidator("mcp.schema.json"), AGENT_PLUGINS_MCP),
      ).toEqual([]);
    });

    test("the schema check is not vacuous: the ChatGPT package's server entry fails it", () => {
      expect(
        schemaErrors(
          schemaValidator("mcp.schema.json"),
          readJson(CHATGPT_DIRECTORY, "mcp.json"),
        ),
      ).not.toEqual([]);
    });

    test("mcp.json is a plain server entry: no sign-in extension, and no headers", () => {
      expect(AGENT_PLUGINS_MCP["mcpServers"]).toEqual({
        oneuptime: { type: "streamable-http", url: REGISTRY_URL },
      });
    });

    test("both files target the same Agent Plugins version, or a client disables MCP", () => {
      const versionOf: (file: JSONObject) => string = (
        file: JSONObject,
      ): string => {
        return (file["$schema"] as string).split("/").slice(0, -1).join("/");
      };

      expect(versionOf(AGENT_PLUGINS_MCP)).toBe(versionOf(PLUGIN_MANIFEST));
    });
  });

  describe("as a Cursor Plugin", () => {
    const documentedFields: Array<string> = [
      "name",
      "displayName",
      "description",
      "version",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
      "logo",
      "mcpServers",
    ];

    test("has only the fields Cursor documents, with a name it accepts", () => {
      expect(
        Object.keys(CURSOR_MANIFEST).filter((key: string): boolean => {
          return !documentedFields.includes(key);
        }),
      ).toEqual([]);
      expect(CURSOR_MANIFEST["name"]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(
        Object.keys(CURSOR_MANIFEST["author"] as JSONObject).sort(),
      ).toEqual(["email", "name"]);
    });

    test("names a logo it holds, by a relative path", () => {
      const logo: string = CURSOR_MANIFEST["logo"] as string;

      expect(logo).toBe("assets/logo.png");
      expect(fs.existsSync(pluginFile(logo))).toBe(true);
    });

    test("points at the plain server entry, in a file the plugin holds", () => {
      const file: string = CURSOR_MANIFEST["mcpServers"] as string;

      expect(file).toBe("./.mcp.json");
      expect(fs.existsSync(pluginFile(file))).toBe(true);
    });
  });

  describe("as a Claude plugin", () => {
    test("has a name the directory takes", () => {
      const name: string = CLAUDE_MANIFEST["name"] as string;

      expect(name).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
      expect([
        "claude",
        "anthropic",
        "official",
        "plugin",
        "mcp",
        "test",
      ]).not.toContain(name);
      expect(name).not.toMatch(
        /^(?:claude-|anthropic-|anthropics-|cc-plugin-)/,
      );
    });

    test("sets the fields the directory warns about, and its listing fields", () => {
      for (const field of ["description", "author", "version"]) {
        expect([field, Boolean(CLAUDE_MANIFEST[field])]).toEqual([field, true]);
      }

      for (const field of [
        "documentationUrl",
        "supportUrl",
        "privacyPolicyUrl",
        "termsOfServiceUrl",
      ]) {
        const url: URL = new URL(CLAUDE_MANIFEST[field] as string);

        expect([field, url.protocol]).toEqual([field, "https:"]);
      }

      expect(CLAUDE_MANIFEST["icon"]).toBe("./assets/logo.png");
      expect(fs.existsSync(pluginFile("assets/logo.png"))).toBe(true);
    });

    test("keeps nothing but the manifest in .claude-plugin", () => {
      expect(fs.readdirSync(pluginFile(".claude-plugin"))).toEqual([
        "plugin.json",
      ]);
    });

    test(".mcp.json gives the same server the type and address the directory requires", () => {
      expect(CLAUDE_MCP).toEqual({
        mcpServers: { oneuptime: { type: "http", url: REGISTRY_URL } },
      });
      expect(new URL(REGISTRY_URL).protocol).toBe("https:");
    });
  });

  describe("across its manifests", () => {
    test("is the same plugin, at the release's version, from its own repository", () => {
      for (const field of [
        "name",
        "version",
        "description",
        "license",
        "repository",
      ]) {
        expect(CURSOR_MANIFEST[field]).toBe(PLUGIN_MANIFEST[field]);
        expect(CLAUDE_MANIFEST[field]).toBe(PLUGIN_MANIFEST[field]);
      }

      expect(PLUGIN_MANIFEST["version"]).toBe(
        readText(REPO_ROOT, "VERSION").trim(),
      );

      // Scripts/MCP/PublishCodingAgentPlugin.sh pushes to this repository.
      expect(PLUGIN_MANIFEST["repository"]).toBe(
        readJson(MCP_DIRECTORY, "CodingAgentPlugin/plugin.json")["repository"],
      );
      expect(PLUGIN_MANIFEST["repository"]).toMatch(
        /^https:\/\/github\.com\/OneUptime\/[A-Za-z0-9_.-]+$/,
      );
      expect(PLUGIN_MANIFEST["repository"]).not.toBe(
        CHATGPT_MANIFEST["repository"],
      );
    });
  });

  describe("what it reuses", () => {
    test("takes its links and its author from the ChatGPT listing", () => {
      expect(CLAUDE_MANIFEST).toMatchObject({
        name: CHATGPT_MANIFEST["name"],
        author: CHATGPT_MANIFEST["author"],
        homepage: CHATGPT_MANIFEST["homepage"],
        license: CHATGPT_MANIFEST["license"],
        keywords: CHATGPT_MANIFEST["keywords"],
        displayName: CHATGPT_LISTING["displayName"],
        supportUrl: CHATGPT_LISTING["supportURL"],
        privacyPolicyUrl: CHATGPT_LISTING["privacyPolicyURL"],
        termsOfServiceUrl: CHATGPT_LISTING["termsOfServiceURL"],
      });
    });

    test("carries its icon byte for byte, and no copy of it in the package", () => {
      expect(
        fs
          .readFileSync(pluginFile("assets/logo.png"))
          .equals(
            fs.readFileSync(path.join(CHATGPT_DIRECTORY, "assets/logo.png")),
          ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(MCP_DIRECTORY, "CodingAgentPlugin/assets")),
      ).toBe(false);
    });

    test("keeps the listing's list of what you can do in its README", () => {
      const longDescription: string = CHATGPT_LISTING[
        "longDescription"
      ] as string;
      const bullets: Array<string> = longDescription
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("- ");
        });

      expect(bullets.length).toBeGreaterThan(3);

      for (const bullet of bullets) {
        expect(README).toContain(bullet);
      }

      for (const prompt of CHATGPT_LISTING["defaultPrompt"] as Array<string>) {
        expect(README).toContain(`- ${prompt}`);
      }
    });

    test("says ChatGPT nowhere, and leaves no placeholder of LISTING.md behind", () => {
      for (const file of filesUnder(PLUGIN_DIRECTORY)) {
        if (file.endsWith(".png")) {
          continue;
        }

        expect([
          file,
          CHATGPT_MENTION_PATTERN.test(readText(PLUGIN_DIRECTORY, file)),
        ]).toEqual([file, false]);
      }

      expect(README).not.toMatch(/\{\{\w+\}\}/);
    });
  });

  describe("what the Claude directory checks in the folder", () => {
    const files: Array<string> = filesUnder(PLUGIN_DIRECTORY);

    test("has a README of at least 40 words outside its code blocks", () => {
      const prose: string = README.replace(/```[\s\S]*?```/g, " ");

      expect(prose.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(
        40,
      );
    });

    test("has a license: the repository's, as a file and in the manifest", () => {
      expect(CLAUDE_MANIFEST["license"]).toBe("Apache-2.0");
      expect(readText(PLUGIN_DIRECTORY, "LICENSE")).toBe(
        readText(REPO_ROOT, "LICENSE"),
      );
      expect(readText(PLUGIN_DIRECTORY, "NOTICE")).toBe(
        readText(REPO_ROOT, "NOTICE"),
      );
    });

    test("holds no system files, links, or file names Windows or macOS would refuse", () => {
      for (const file of files) {
        const name: string = path.basename(file);

        expect([
          file,
          [".DS_Store", "Thumbs.db", "desktop.ini"].includes(name),
          fs.lstatSync(pluginFile(file)).isSymbolicLink(),
          REFUSED_FILE_NAME_PATTERN.test(file),
        ]).toEqual([file, false, false, false]);
      }

      const lowerCased: Set<string> = new Set(
        files.map((file: string): string => {
          return file.toLowerCase();
        }),
      );

      expect(lowerCased.size).toBe(files.length);
    });

    test("stays under the limits that hold a version for a reviewer", () => {
      expect(files.length).toBeLessThanOrEqual(512);

      for (const file of files) {
        const size: number = fs.statSync(pluginFile(file)).size;

        expect([file, file.endsWith(".png") || size < 256 * 1024]).toEqual([
          file,
          true,
        ]);
      }
    });

    test("holds only text and PNG images", () => {
      for (const file of files) {
        expect([file, PUBLISHED_FILE_PATTERN.test(file)]).toEqual([file, true]);
      }
    });

    test("shows its image in Markdown only, as the directory asks", () => {
      expect(README).toContain("![OneUptime](assets/logo.png)");
      expect(README.replace("![OneUptime](assets/logo.png)", "")).not.toContain(
        "assets/logo.png",
      );
    });

    test("carries no launcher and no package source, which the directory holds or blocks", () => {
      for (const file of files.filter((name: string): boolean => {
        return !name.endsWith(".png");
      })) {
        expect([
          file,
          LAUNCHER_PATTERN.test(readText(PLUGIN_DIRECTORY, file)),
        ]).toEqual([file, false]);
      }

      expect(
        files.filter((file: string): boolean => {
          return PACKAGE_SOURCE_PATTERN.test(file);
        }),
      ).toEqual([]);
    });

    test("carries no credential, in a header or anywhere else", () => {
      expect(JSON.stringify([AGENT_PLUGINS_MCP, CLAUDE_MCP])).not.toContain(
        "headers",
      );

      for (const file of files.filter((name: string): boolean => {
        return !name.endsWith(".png");
      })) {
        expect([
          file,
          CREDENTIAL_PATTERN.test(readText(PLUGIN_DIRECTORY, file)),
        ]).toEqual([file, false]);
      }
    });

    test("says in its README what the plugin runs, sends and fetches", () => {
      for (const named of [
        REGISTRY_URL,
        "@oneuptime/cli",
        "https://oneuptime.com/otlp/v1/validate",
        CLAUDE_MANIFEST["privacyPolicyUrl"] as string,
      ]) {
        expect(README).toContain(named);
      }
    });
  });

  describe("its skills", () => {
    test("are three to five, each in the place both clients look", () => {
      expect(SKILLS.length).toBeGreaterThanOrEqual(3);
      expect(SKILLS.length).toBeLessThanOrEqual(5);

      for (const skill of SKILLS) {
        expect(README).toContain(`\`${skill.directory}\``);
      }
    });

    test("meet the Agent Skills format", () => {
      for (const skill of SKILLS) {
        const name: string = skill.frontmatter["name"] as string;
        const description: unknown = skill.frontmatter["description"];

        expect([
          skill.directory,
          Object.keys(skill.frontmatter).sort(),
        ]).toEqual([skill.directory, ["description", "name"]]);
        expect(name).toBe(skill.directory);
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(typeof description).toBe("string");
        expect((description as string).length).toBeGreaterThan(0);
        expect((description as string).length).toBeLessThanOrEqual(1024);
      }
    });

    test("say when to reach for them", () => {
      for (const skill of SKILLS) {
        expect([
          skill.directory,
          (skill.frontmatter["description"] as string).includes("Use when"),
        ]).toEqual([skill.directory, true]);
      }
    });

    test("name only tools this server lists", () => {
      const named: Array<string> = SKILLS.flatMap(
        (skill: Skill): Array<string> => {
          return skill.text.match(TOOL_NAME_PATTERN) || [];
        },
      );

      expect(named.length).toBeGreaterThan(20);
      expect(
        named.filter((name: string): boolean => {
          return !TOOLS.has(name);
        }),
      ).toEqual([]);
    });

    test("show calls that fit the tools' arguments", () => {
      const examples: Array<ToolExample> = SKILLS.flatMap(
        (skill: Skill): Array<ToolExample> => {
          return toolExamplesIn(skill.text);
        },
      );

      expect(examples.length).toBeGreaterThanOrEqual(5);

      for (const example of examples) {
        const tool: McpToolInfo | undefined = TOOLS.get(example.tool);

        expect([example.tool, Boolean(tool)]).toEqual([example.tool, true]);

        const fields: JSONObject = tool!.inputSchema
          .properties as unknown as JSONObject;

        expect([
          example.tool,
          Object.keys(example.args).filter((key: string): boolean => {
            return !(key in fields);
          }),
        ]).toEqual([example.tool, []]);

        for (const required of tool!.inputSchema.required || []) {
          expect([example.tool, required in example.args]).toEqual([
            example.tool,
            true,
          ]);
        }

        if (
          example.args["query"] === undefined &&
          example.args["sort"] === undefined
        ) {
          continue;
        }

        /*
         * A list tool's query and sort name no fields since #5529: an agent
         * looks a resource's fields up with oneuptime_describe_resource. So
         * the example's fields are the ones it says the resource can be
         * filtered and sorted on, and its query is one the API reads as a
         * filter (FilterCheck).
         */
        const described: DescribedFields = describedFieldsOf(example.tool);

        for (const [nested, can] of [
          ["query", "filter"],
          ["sort", "sort"],
        ] as Array<["query" | "sort", "filter" | "sort"]>) {
          expect([
            example.tool,
            nested,
            Object.keys((example.args[nested] as JSONObject) || {}).filter(
              (key: string): boolean => {
                return described[key]?.[can] !== true;
              },
            ),
          ]).toEqual([example.tool, nested, []]);
        }

        expect([
          example.tool,
          getFilterProblem(tool!, example.args["query"]),
        ]).toEqual([example.tool, null]);
      }
    });

    test("filter with operators OneUptime has", () => {
      const operators: Array<string> = toolExamplesIn(
        skillNamed("investigate-incident").text,
      ).flatMap((example: ToolExample): Array<string> => {
        return Object.values((example.args["query"] as JSONObject) || {}).map(
          (filter: JSONValue): string => {
            return (filter as JSONObject)["_type"] as string;
          },
        );
      });

      expect(operators.length).toBeGreaterThanOrEqual(3);

      for (const operator of operators) {
        expect(Object.values(ObjectType)).toContain(operator);
      }
    });

    test("state the plan OneUptime Cloud asks for, as the models set it", () => {
      expect(new ApiKey().createBillingPlan).toBe(PlanType.Growth);
      expect(new McpOAuthGrant().createBillingPlan).toBe(PlanType.Growth);

      for (const text of [
        README,
        skillNamed("investigate-incident").text,
        skillNamed("set-up-monitoring").text,
        skillNamed("use-oneuptime-cli").text,
      ]) {
        expect(text).toContain(PLAN_REQUIREMENT);
        expect(text).toContain(NO_CREDENTIAL_NEEDED);
      }
    });
  });

  describe("the investigate-incident skill", () => {
    const skill: Skill = skillNamed("investigate-incident");

    test("walks the loop of the server's README, in its order", () => {
      const loop: Array<string> = [
        "oneuptime_whoami",
        "list_incidents",
        "acknowledge_incident",
        "list_logs",
        "add_incident_note",
        "resolve_incident",
      ];
      const places: Array<number> = loop.map((tool: string): number => {
        return skill.text.indexOf(`\`${tool}\``) === -1
          ? skill.text.indexOf(`json ${tool}`)
          : skill.text.indexOf(tool);
      });

      expect(places).not.toContain(-1);
      expect(places).toEqual(
        [...places].sort((a: number, b: number): number => {
          return a - b;
        }),
      );
    });

    test("gives the log severities OneUptime stores", () => {
      const sentence: string = skill.text
        .split("\n")
        .find((line: string): boolean => {
          return line.includes("`severityText` is one of");
        }) as string;

      expect((sentence.match(/`[A-Z][a-z]+`/g) || []).sort()).toEqual(
        Object.values(LogSeverity)
          .map((severity: string): string => {
            return `\`${severity}\``;
          })
          .sort(),
      );
    });

    test("reads public status pages with tools that need no credential", () => {
      const publicTools: Array<string> = generatePublicStatusPageTools().map(
        (tool: McpToolInfo): string => {
          return tool.name;
        },
      );

      expect(publicTools.length).toBeGreaterThan(0);

      for (const tool of publicTools) {
        expect(skill.text).toContain(`\`${tool}\``);
      }
    });
  });

  describe("the set-up-monitoring skill", () => {
    const skill: Skill = skillNamed("set-up-monitoring");

    /*
     * The example as the tool would get it: the IDs a skill leaves to the
     * reader become real ones, the same one for the same placeholder. A
     * placeholder is a few words that end in "id", in angle brackets
     * ("<offline status id>"); a pattern for anything in angle brackets
     * would take HTML tags out too, which TestTagStripGuard refuses.
     */
    function monitorExample(): {
      args: JSONObject;
      ids: Map<string, string>;
    } {
      const ids: Map<string, string> = new Map();
      const block: string = [...skill.text.matchAll(TOOL_EXAMPLE_PATTERN)].find(
        (match: RegExpMatchArray): boolean => {
          return match[1] === "create_monitor";
        },
      )![2]!;

      return {
        args: JSON.parse(
          block.replace(/<[a-z ]+ id>/g, (placeholder: string): string => {
            if (!ids.has(placeholder)) {
              ids.set(placeholder, ObjectID.generate().toString());
            }

            return ids.get(placeholder)!;
          }),
        ) as JSONObject,
        ids,
      };
    }

    function criteriaOf(steps: MonitorSteps): Array<JSONObject> {
      const step: JSONObject = (
        (steps.toJSON()["value"] as JSONObject)[
          "monitorStepsInstanceArray"
        ] as Array<JSONObject>
      )[0]!;
      const criteria: Array<JSONObject> = (
        ((step["value"] as JSONObject)["monitorCriteria"] as JSONObject)[
          "value"
        ] as JSONObject
      )["monitorCriteriaInstanceArray"] as Array<JSONObject>;

      return criteria.map((instance: JSONObject): JSONObject => {
        const value: JSONObject = instance["value"] as JSONObject;

        return {
          filterCondition: value["filterCondition"]!,
          filters: value["filters"]!,
          changeMonitorStatus: value["changeMonitorStatus"]!,
          createIncidents: value["createIncidents"]!,
          createAlerts: value["createAlerts"]!,
          monitorStatusId: value["monitorStatusId"]!,
        };
      });
    }

    function defaultSteps(
      monitorType: MonitorType,
      ids: Map<string, string>,
    ): MonitorSteps {
      const idOf: (placeholder: string) => ObjectID = (
        placeholder: string,
      ): ObjectID => {
        return new ObjectID(ids.get(placeholder) as string);
      };

      return MonitorSteps.getDefaultMonitorSteps({
        monitorType,
        monitorName: "Checkout website",
        defaultMonitorStatusId: idOf("<operational status id>"),
        onlineMonitorStatusId: idOf("<operational status id>"),
        offlineMonitorStatusId: idOf("<offline status id>"),
        defaultIncidentSeverityId: idOf("<incident severity id>"),
        defaultAlertSeverityId: idOf("<incident severity id>"),
      });
    }

    function checksOf(monitorType: MonitorType): Set<string> {
      const { ids } = monitorExample();

      return new Set(
        criteriaOf(defaultSteps(monitorType, ids)).flatMap(
          (criteria: JSONObject): Array<string> => {
            return (criteria["filters"] as Array<JSONObject>).map(
              (filter: JSONObject): string => {
                return filter["checkOn"] as string;
              },
            );
          },
        ),
      );
    }

    test("shows a monitor the server would accept", () => {
      const { args } = monitorExample();
      const steps: MonitorSteps = MonitorSteps.fromJSON(
        args["monitorSteps"] as JSONObject,
      );

      expect(
        MonitorSteps.getValidationError(
          steps,
          args["monitorType"] as MonitorType,
        ),
      ).toBeNull();
    });

    test("shows the criteria a new website monitor starts with, as it says", () => {
      const { args, ids } = monitorExample();

      expect(
        criteriaOf(MonitorSteps.fromJSON(args["monitorSteps"] as JSONObject)),
      ).toEqual(criteriaOf(defaultSteps(MonitorType.Website, ids)));
    });

    test("names monitor types, checks and comparisons OneUptime has", () => {
      // The table's rows, below its heading, `monitorType`.
      const monitorTypes: Array<string> = (
        skill.text.match(/^\| `([A-Za-z ]+)` +\|/gm) || []
      )
        .map((row: string): string => {
          return row.replace(/[|`]/g, "").trim();
        })
        .filter((cell: string): boolean => {
          return cell !== "monitorType";
        });

      expect(monitorTypes.length).toBeGreaterThanOrEqual(4);

      for (const monitorType of monitorTypes) {
        expect(Object.values(MonitorType)).toContain(monitorType);
      }

      const { args } = monitorExample();
      const filters: Array<JSONObject> = JSON.stringify(args)
        .match(/\{"checkOn":[^}]*\}/g)!
        .map((filter: string): JSONObject => {
          return JSON.parse(filter) as JSONObject;
        });

      expect(filters.length).toBeGreaterThanOrEqual(6);

      for (const filter of filters) {
        expect(Object.values(CheckOn)).toContain(filter["checkOn"]);
        expect(Object.values(FilterType)).toContain(filter["filterType"]);
      }
    });

    test("says truly which checks the other types start with", () => {
      expect(checksOf(MonitorType.API)).toEqual(checksOf(MonitorType.Website));
      expect(checksOf(MonitorType.Ping)).toEqual(new Set([CheckOn.IsOnline]));
      expect(checksOf(MonitorType.Port)).toEqual(new Set([CheckOn.IsOnline]));
      expect(
        checksOf(MonitorType.SSLCertificate).has(CheckOn.IsValidCertificate),
      ).toBe(true);
      expect(checksOf(MonitorType.SSLCertificate).has(CheckOn.IsOnline)).toBe(
        false,
      );
    });

    /*
     * If this fails, the server has learned to do what the skill sends the
     * reader to the dashboard for: change step 7 of the skill.
     */
    test("is right that no tool puts a monitor on a status page", () => {
      expect(
        [...TOOLS.keys()].filter((name: string): boolean => {
          return STATUS_PAGE_RESOURCE_TOOL_PATTERN.test(name);
        }),
      ).toEqual([]);
      expect(readText(CLI_DIRECTORY, "README.md")).not.toContain(
        "status-page-resource",
      );
    });
  });

  describe("the add-opentelemetry skill", () => {
    const skill: Skill = skillNamed("add-opentelemetry");
    const guide: string = fs.readFileSync(OPEN_TELEMETRY_GUIDES, "utf8");

    function guideConstant(name: string): string {
      const match: RegExpExecArray | null = new RegExp(
        `export const ${name}: string =\\s*["']([^\\n]+)["'];`,
      ).exec(guide);

      if (!match) {
        throw new Error(`GuideShared.ts no longer exports ${name}`);
      }

      return match[1]!;
    }

    test("gives the endpoint, header and key the OpenTelemetry guides give", () => {
      expect(skill.text).toContain(
        `OTEL_EXPORTER_OTLP_ENDPOINT="${guideConstant("CLOUD_OTLP_ENDPOINT")}"`,
      );
      expect(skill.text).toContain(
        `OTEL_EXPORTER_OTLP_HEADERS="${guideConstant("INGESTION_KEY_HEADER")}=${guideConstant("INGESTION_KEY_PLACEHOLDER")}"`,
      );
      expect(skill.text).toContain(guideConstant("OTLP_HTTP_PROTOCOL_LINE"));
      expect(skill.text).toContain(
        `curl -i -H "${guideConstant("INGESTION_KEY_HEADER")}: ${guideConstant("INGESTION_KEY_PLACEHOLDER")}"`,
      );
      expect(skill.text).toContain(
        `${guideConstant("CLOUD_OTLP_ENDPOINT")}/v1/validate`,
      );
    });

    test("names the screens the guides name", () => {
      for (const screen of [
        "services",
        "traces",
        "logs",
        "metrics",
        "ingestionKeys",
      ]) {
        const match: RegExpExecArray | null = new RegExp(
          `${screen}: "(\\*\\*[^"]+\\*\\*)"`,
        ).exec(guide);

        expect(match).not.toBeNull();
        expect(skill.text).toContain(match![1]!);
      }
    });

    test("links the index of the guides", () => {
      expect(skill.text).toContain(getOpenTelemetryGuidesIndexUrl());
    });

    /*
     * If this fails, an MCP client can create an ingestion key: the skill no
     * longer has to ask the person for one.
     */
    test("is right that no tool creates an ingestion key", () => {
      expect(
        [...TOOLS.keys()].filter((name: string): boolean => {
          return INGESTION_KEY_TOOL_PATTERN.test(name);
        }),
      ).toEqual([]);
    });
  });

  describe("the use-oneuptime-cli skill", () => {
    const skill: Skill = skillNamed("use-oneuptime-cli");
    const source: string = ["Program.ts", "Core/OutputFormatter.ts"]
      .concat(
        fs
          .readdirSync(path.join(CLI_DIRECTORY, "Commands"))
          .map((file: string): string => {
            return `Commands/${file}`;
          }),
      )
      .map((file: string): string => {
        return readText(CLI_DIRECTORY, file);
      })
      .join("\n");

    // The flags Commander gives every command, and the program its version.
    const COMMANDER_FLAGS: ReadonlyArray<string> = ["--help", "--version"];

    /*
     * The flags create and update take for a resource's fields, and the
     * email flags beside the ID flags of people: read from the models as
     * the CLI reads them, not written in its sources.
     */
    const fieldFlags: Set<string> = new Set(
      getCliResources().flatMap((resource: CliResource): Array<string> => {
        const modelType: DatabaseBaseModelType | null =
          getCliDatabaseModelType(resource);

        return modelType
          ? getCliFieldFlags(modelType).flatMap(
              (flag: CliFieldFlag): Array<string> => {
                return flag.person
                  ? [flag.flag, flag.person.flag]
                  : [flag.flag];
              },
            )
          : [];
      }),
    );

    test("gives only options the CLI has", () => {
      const options: Array<string> = skill.text.match(
        /(?<![\w-])--[a-z][a-z-]*/g,
      )!;

      expect(options.length).toBeGreaterThan(5);
      expect(fieldFlags.has("--monitor-type")).toBe(true);
      expect(fieldFlags.has("--owner-user-emails")).toBe(true);

      for (const option of new Set(options)) {
        expect([
          option,
          source.includes(`"${option}`) ||
            fieldFlags.has(option) ||
            COMMANDER_FLAGS.includes(option),
        ]).toEqual([option, true]);
      }
    });

    test("runs only commands the CLI has, and subcommands its resources take", () => {
      const topLevel: Array<string> = [
        ...source.matchAll(/\.command\("([a-z-]+)/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1]!;
      });
      const commands: Array<[string, string]> = [
        ...skill.text.matchAll(
          /\boneuptime ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g,
        ),
      ].map((match: RegExpMatchArray): [string, string] => {
        return [match[1]!, match[2] || ""];
      });

      expect(commands.length).toBeGreaterThan(10);

      for (const [command, subcommand] of commands) {
        const resource: CliResource | null = getCliResource(command);

        expect([
          command,
          Boolean(resource) || topLevel.includes(command),
        ]).toEqual([command, true]);

        if (!resource) {
          continue;
        }

        // A resource's subcommands: its operations, fields, then its actions.
        expect([
          command,
          subcommand,
          [
            ...resource.operations,
            CLI_FIELDS_SUBCOMMAND,
            ...resource.actions,
          ].includes(subcommand),
        ]).toEqual([command, subcommand, true]);
      }

      expect(commands).toEqual(
        expect.arrayContaining([
          ["incident", "acknowledge"],
          ["incident", "resolve"],
          ["incident", "add-note"],
          ["monitor", "create"],
        ]),
      );
    });

    test("no longer says a monitor cannot go on a status page, or an ingestion key be made, from the CLI", () => {
      for (const name of ["status-page-resource", "telemetry-ingestion-key"]) {
        expect([name, getCliResource(name)?.operations]).toEqual([
          name,
          expect.arrayContaining([CliOperation.Create]),
        ]);
      }

      expect(skill.text).not.toContain("There is no command for");
      expect(skill.text).not.toContain("Telemetry |");
    });

    test("names the variables the CLI reads", () => {
      const configManager: string = readText(
        CLI_DIRECTORY,
        "Core/ConfigManager.ts",
      );
      const variables: Array<string> =
        skill.text.match(/\bONEUPTIME_[A-Z_]+/g)!;

      expect(new Set(variables)).toEqual(
        new Set([
          "ONEUPTIME_API_KEY",
          "ONEUPTIME_URL",
          "ONEUPTIME_TELEMETRY_INGESTION_KEY",
        ]),
      );

      for (const variable of new Set(variables)) {
        expect(configManager).toContain(`process.env["${variable}"]`);
      }
    });

    test("gives the CLI's exit codes and the Node.js it needs", () => {
      const errorHandler: string = readText(
        CLI_DIRECTORY,
        "Core/ErrorHandler.ts",
      );

      expect(errorHandler).toContain("GeneralError = 1");
      expect(errorHandler).toContain("AuthError = 2");
      expect(errorHandler).toContain("NotFound = 3");
      expect(skill.text).toMatch(/^\| `2` +\| No usable API key/m);
      expect(skill.text).toMatch(/^\| `3` +\| Not found/m);

      expect(readJson(CLI_DIRECTORY, "package.json")["engines"]).toEqual({
        node: ">=22",
      });
      expect(skill.text).toContain("Node.js 22 or later");
    });
  });
});

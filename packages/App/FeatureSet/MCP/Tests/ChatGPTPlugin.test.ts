/*
 * THE CHATGPT PLUGIN PACKAGE IS ONE THE PORTAL TAKES.
 *
 * ChatGPTPlugin/ is what OneUptime uploads to the ChatGPT plugin directory to
 * list its hosted MCP server; Scripts/MCP/BuildChatGPTPlugin.sh zips it. The
 * portal reads the listing, the review test cases and the server's sign-in
 * from it, and refuses a package that breaks its rules only once it is
 * uploaded. These hold the package to those rules first:
 *
 * - plugin.json to the Agent Plugins 1.0.0 manifest schema (copied in
 *   AgentPlugins/), and its listing to the limits in OpenAI's submission
 *   guide;
 * - the review test cases: five positive and three negative, every tool a
 *   positive case expects being one this server lists;
 * - mcp.json: one streamable HTTP server, at the address server.json lists in
 *   the MCP Registry, signed in to with OAuth for scopes the server issues.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import fs from "fs";
import path from "path";
import { generateAllTools } from "../Tools/ToolGenerator";
import { McpToolInfo } from "../Types/McpTypes";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  McpOAuthScopeUtil,
  ParsedMcpOAuthScope,
} from "Common/Types/Mcp/McpOAuthScope";

interface ReviewCase {
  description: string;
  prompt: string;
  tools_triggered?: string;
  expected_behavior?: string;
}

interface Listing {
  displayName: string;
  shortDescription: string;
  longDescription: string;
  developerName: string;
  category: string;
  capabilities?: Array<string>;
  websiteURL: string;
  supportURL: string;
  privacyPolicyURL: string;
  termsOfServiceURL: string;
  defaultPrompt?: Array<string>;
  composerIcon: string;
  logo: string;
}

interface OpenAiManifest {
  interface: Listing;
  review: {
    test_cases: { positive: Array<ReviewCase>; negative: Array<ReviewCase> };
  };
  publication: { release_notes: string };
}

interface OpenAiServerAuth {
  type: string;
  client?: JSONObject;
  baseScopes?: Array<string>;
}

const MCP_DIRECTORY: string = path.resolve(__dirname, "..");
const PLUGIN_DIRECTORY: string = path.join(MCP_DIRECTORY, "ChatGPTPlugin");
const SCHEMA_DIRECTORY: string = path.join(__dirname, "AgentPlugins");

const PNG_SIGNATURE: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function readJson(file: string): JSONObject {
  return JSON.parse(fs.readFileSync(file, "utf8")) as JSONObject;
}

// A member of a JSON object that has to be an object itself.
function objectAt(parent: JSONObject, key: string): JSONObject {
  const value: JSONValue | undefined = parent[key];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} is not an object`);
  }

  return value as JSONObject;
}

// Every key anywhere inside a JSON value.
function keysIn(value: unknown): Array<string> {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(keysIn);
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, member]: [string, unknown]): Array<string> => {
      return [key, ...keysIn(member)];
    },
  );
}

const MANIFEST: JSONObject = readJson(
  path.join(PLUGIN_DIRECTORY, "plugin.json"),
);
const MCP_CONFIG: JSONObject = readJson(
  path.join(PLUGIN_DIRECTORY, "mcp.json"),
);
const MANIFEST_SCHEMA: JSONObject = readJson(
  path.join(SCHEMA_DIRECTORY, "plugin.schema.json"),
);
const MCP_SCHEMA: JSONObject = readJson(
  path.join(SCHEMA_DIRECTORY, "mcp.schema.json"),
);
const REGISTRY_ENTRY: JSONObject = readJson(
  path.join(MCP_DIRECTORY, "server.json"),
);

const OPENAI: OpenAiManifest = objectAt(
  objectAt(MANIFEST, "extensions"),
  "com.openai",
) as unknown as OpenAiManifest;

describe("the ChatGPT plugin package", () => {
  describe("plugin.json", () => {
    const fields: JSONObject = objectAt(MANIFEST_SCHEMA, "properties");

    test("has every field the Agent Plugins manifest requires, and no field it does not know", () => {
      expect(
        Object.keys(MANIFEST).filter((key: string): boolean => {
          return !(key in fields);
        }),
      ).toEqual([]);

      for (const required of MANIFEST_SCHEMA["required"] as Array<string>) {
        expect([required, required in MANIFEST]).toEqual([required, true]);
      }

      expect(MANIFEST["$schema"]).toBe(objectAt(fields, "$schema")["const"]);
    });

    test("is named as the schema requires, and versioned", () => {
      const nameRule: JSONObject = objectAt(fields, "name");
      const name: string = MANIFEST["name"] as string;

      expect(name).toMatch(new RegExp(nameRule["pattern"] as string));
      expect(name.length).toBeLessThanOrEqual(nameRule["maxLength"] as number);
      expect(MANIFEST["version"]).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("gives each field the type the schema gives it", () => {
      for (const [field, rule] of Object.entries(fields)) {
        if (!(field in MANIFEST) || field === "$schema") {
          continue;
        }

        const value: JSONValue | undefined = MANIFEST[field];
        const type: JSONValue | undefined = (rule as JSONObject)["type"];
        const actual: string = Array.isArray(value) ? "array" : typeof value;

        expect([field, actual]).toEqual([field, type]);
      }

      const authorFields: Array<string> = Object.keys(
        objectAt(objectAt(fields, "author"), "properties"),
      );

      expect(
        Object.keys(objectAt(MANIFEST, "author")).filter(
          (key: string): boolean => {
            return !authorFields.includes(key);
          },
        ),
      ).toEqual([]);
    });
  });

  describe("its listing", () => {
    const listing: Listing = OPENAI.interface;

    test("fills every field the directory requires, within its limits", () => {
      const limits: Array<[keyof Listing, number]> = [
        ["displayName", 30],
        ["shortDescription", 30],
        ["longDescription", 4000],
        ["developerName", 80],
        // A category title from the dashboard: required, with no stated limit.
        ["category", Infinity],
      ];

      for (const [field, limit] of limits) {
        const value: unknown = listing[field];

        expect([
          field,
          typeof value === "string" &&
            value.trim().length > 0 &&
            value.length <= limit,
        ]).toEqual([field, true]);
      }

      const capabilities: Array<string> = listing.capabilities || [];

      expect(capabilities.length).toBeLessThanOrEqual(20);
      for (const capability of capabilities) {
        expect([capability, capability.length <= 120]).toEqual([
          capability,
          true,
        ]);
      }
    });

    test("offers at most three starter prompts, each short, different and naming no app", () => {
      const prompts: Array<string> = listing.defaultPrompt || [];

      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts.length).toBeLessThanOrEqual(3);
      expect(new Set(prompts).size).toBe(prompts.length);

      for (const prompt of prompts) {
        expect([prompt, prompt.length <= 128 && !prompt.includes("@")]).toEqual(
          [prompt, true],
        );
      }
    });

    test("links its website, support, privacy policy and terms over HTTPS", () => {
      for (const field of [
        "websiteURL",
        "supportURL",
        "privacyPolicyURL",
        "termsOfServiceURL",
      ] as Array<keyof Listing>) {
        const value: string = listing[field] as string;
        const url: URL = new URL(value);

        expect([field, url.protocol, url.username, url.password]).toEqual([
          field,
          "https:",
          "",
          "",
        ]);
        expect(value.length).toBeLessThanOrEqual(1024);
      }
    });

    test("names square PNG icons that the package has", () => {
      for (const field of ["logo", "composerIcon"] as Array<keyof Listing>) {
        const relative: string = listing[field] as string;

        expect(relative.startsWith("./assets/")).toBe(true);

        const icon: Buffer = fs.readFileSync(
          path.join(PLUGIN_DIRECTORY, relative),
        );
        // A PNG's IHDR chunk, first after the signature, holds its size.
        const width: number = icon.readUInt32BE(16);
        const height: number = icon.readUInt32BE(20);

        expect([field, icon.subarray(0, 8).equals(PNG_SIGNATURE)]).toEqual([
          field,
          true,
        ]);
        expect([field, width === height, width >= 48, width <= 4096]).toEqual([
          field,
          true,
          true,
          true,
        ]);
        expect(icon.length).toBeLessThanOrEqual(5 * 1024 * 1024);
      }
    });
  });

  describe("its review test cases", () => {
    const cases: OpenAiManifest["review"]["test_cases"] =
      OPENAI.review.test_cases;

    test("are five positive cases and three negative ones, each with a description and a prompt", () => {
      expect(cases.positive).toHaveLength(5);
      expect(cases.negative).toHaveLength(3);

      for (const reviewCase of [...cases.positive, ...cases.negative]) {
        expect([
          reviewCase.prompt,
          typeof reviewCase.description === "string" &&
            reviewCase.description.trim().length > 0 &&
            reviewCase.description.length <= 4000 &&
            typeof reviewCase.prompt === "string" &&
            reviewCase.prompt.trim().length > 0,
        ]).toEqual([reviewCase.prompt, true]);
      }
    });

    test("say, for every positive case, which tools it calls and what should happen", () => {
      for (const reviewCase of cases.positive) {
        expect([
          reviewCase.prompt,
          Boolean(reviewCase.tools_triggered?.trim()),
          Boolean(reviewCase.expected_behavior?.trim()),
        ]).toEqual([reviewCase.prompt, true, true]);
      }
    });

    test("expect only tools this server lists", () => {
      const toolNames: Set<string> = new Set(
        generateAllTools().map((tool: McpToolInfo): string => {
          return tool.name;
        }),
      );

      const expected: Array<string> = cases.positive.flatMap(
        (reviewCase: ReviewCase): Array<string> => {
          return (reviewCase.tools_triggered || "")
            .split(",")
            .map((name: string): string => {
              return name.trim();
            });
        },
      );

      expect(expected.length).toBeGreaterThanOrEqual(5);
      expect(
        expected.filter((name: string): boolean => {
          return !toolNames.has(name);
        }),
      ).toEqual([]);
    });

    test("leave reviewer credentials and instructions out of the package", () => {
      const keys: Array<string> = [...keysIn(MANIFEST), ...keysIn(MCP_CONFIG)];

      for (const forbidden of [
        "test_credentials",
        "reviewer_instructions",
        "clientSecret",
      ]) {
        expect([forbidden, keys.includes(forbidden)]).toEqual([
          forbidden,
          false,
        ]);
      }

      expect(OPENAI.publication.release_notes.trim().length).toBeGreaterThan(0);
    });
  });

  describe("mcp.json", () => {
    const servers: JSONObject = objectAt(MCP_CONFIG, "mcpServers");
    const serverEntries: Array<[string, JSONValue]> = Object.entries(servers);
    const server: JSONObject = objectAt(servers, serverEntries[0]![0]);

    test("has the fields the Agent Plugins MCP configuration requires, and one server", () => {
      const fields: JSONObject = objectAt(MCP_SCHEMA, "properties");

      expect(Object.keys(MCP_CONFIG).sort()).toEqual(
        (MCP_SCHEMA["required"] as Array<string>).sort(),
      );
      expect(Object.keys(MCP_CONFIG).sort()).toEqual(
        Object.keys(fields).sort(),
      );
      expect(MCP_CONFIG["$schema"]).toBe(objectAt(fields, "$schema")["const"]);
      expect(serverEntries).toHaveLength(1);
    });

    test("is the hosted server the MCP Registry lists, over streamable HTTP", () => {
      const registryRemote: JSONObject = (
        REGISTRY_ENTRY["remotes"] as Array<JSONObject>
      )[0]!;

      expect(server["type"]).toBe("streamable-http");
      expect(server["url"]).toBe(registryRemote["url"]);
      expect(new URL(server["url"] as string).protocol).toBe("https:");
    });

    test("has the schema's streamable HTTP fields and OpenAI's extension, and no headers", () => {
      const transportFields: Array<string> = Object.keys(
        objectAt(
          objectAt(objectAt(MCP_SCHEMA, "$defs"), "streamableHttpServer"),
          "properties",
        ),
      );

      /*
       * Agent Plugins 1.0.0 defines no sign-in fields, and OpenAI reads the
       * server's from extensions["com.openai"].auth, so that is the one field
       * here the schema does not list.
       */
      expect(
        Object.keys(server).filter((key: string): boolean => {
          return key !== "extensions" && !transportFields.includes(key);
        }),
      ).toEqual([]);
      expect(Object.keys(objectAt(server, "extensions"))).toEqual([
        "com.openai",
      ]);

      // The portal rejects a server with headers: no key travels in one.
      expect(server["headers"]).toBeUndefined();
    });

    test("signs in with OAuth for read and write, and carries no client credentials", () => {
      const auth: OpenAiServerAuth = objectAt(
        objectAt(objectAt(server, "extensions"), "com.openai"),
        "auth",
      ) as unknown as OpenAiServerAuth;

      expect(auth.type).toBe("oauth");
      // OneUptime publishes no client of its own: ChatGPT identifies itself.
      expect(auth.client).toEqual({ mode: "cimd" });

      const scopes: ParsedMcpOAuthScope = McpOAuthScopeUtil.parse(
        (auth.baseScopes || []).join(" "),
      );

      expect(scopes.unknownScopes).toEqual([]);
      expect(McpOAuthScopeUtil.canWrite(scopes.scopes)).toBe(true);
    });
  });
});

/*
 * THE MCP REGISTRY ENTRY DESCRIBES THIS SERVER AS IT IS.
 *
 * server.json is what the official MCP Registry
 * (registry.modelcontextprotocol.io) lists for OneUptime Cloud's MCP server,
 * and what the directories and clients that read the registry show and
 * connect to. The publish-mcp-registry job in .github/workflows/release.yml
 * publishes it at each release's version (Scripts/MCP/PublishToMcpRegistry.sh).
 *
 * These hold it to the server it describes - the hosted endpoint, which a
 * client signs in to with OAuth or sends an API key to in the header the
 * entry names - and to the limits the registry checks only when a release
 * publishes it.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import fs from "fs";
import path from "path";
import { ROUTE_PREFIXES } from "../Config/ServerConfig";
import { BearerChallenge } from "../OAuth/BearerChallenge";
import RequestGate, { CredentialResolution } from "../OAuth/RequestGate";
import { generateAllTools } from "../Tools/ToolGenerator";
import { McpCredential, McpCredentialType } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import { ExpressRequest } from "Common/Server/Utils/Express";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";

interface RegistryHeader {
  name: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryRemote {
  type: string;
  url: string;
  headers?: Array<RegistryHeader>;
}

interface RegistryServer {
  name: string;
  title: string;
  description: string;
  version: string;
  repository: { url: string; source: string; subfolder: string };
  remotes: Array<RegistryRemote>;
}

const MCP_DIRECTORY: string = path.resolve(__dirname, "..");
const REPOSITORY_ROOT: string = path.resolve(MCP_DIRECTORY, "../../../..");

const SERVER: RegistryServer = JSON.parse(
  fs.readFileSync(path.join(MCP_DIRECTORY, "server.json"), "utf8"),
) as RegistryServer;

// The registry's pattern for a server name: a reverse-DNS namespace, a slash, a name.
const SERVER_NAME_PATTERN: RegExp = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

const API_KEY: string = "3b241101-e2bb-4255-8caf-4136c566a962";

function request(headers: Record<string, unknown>): ExpressRequest {
  return { headers } as unknown as ExpressRequest;
}

async function credentialOf(
  headers: Record<string, unknown>,
): Promise<McpCredential> {
  const resolution: CredentialResolution = await RequestGate.resolveCredential(
    request(headers),
  );

  if (!("credential" in resolution)) {
    throw new Error("Expected a credential, got a challenge.");
  }

  return resolution.credential;
}

describe("server.json, the MCP Registry entry", () => {
  const remote: RegistryRemote = SERVER.remotes[0]!;

  test("fits the limits the registry checks when a release publishes it", () => {
    expect(SERVER.name).toMatch(SERVER_NAME_PATTERN);
    expect(SERVER.title.trim().length).toBeGreaterThan(0);
    expect(SERVER.title.length).toBeLessThanOrEqual(100);
    expect(SERVER.description.trim().length).toBeGreaterThan(0);
    expect(SERVER.description.length).toBeLessThanOrEqual(100);
  });

  test("leaves the version to the release, which publishes the entry at its own", () => {
    expect(SERVER.version).toBe("0.0.0");
  });

  test("is the hosted server, at this server's route, over streamable HTTP", () => {
    expect(SERVER.remotes).toHaveLength(1);
    expect(remote.type).toBe("streamable-http");

    const url: URL = new URL(remote.url);

    expect(url.origin).toBe("https://oneuptime.com");
    expect(ROUTE_PREFIXES).toContain(url.pathname);
  });

  test("points at its own source", () => {
    expect(SERVER.repository.source).toBe("github");
    expect(SERVER.repository.url).toBe(
      "https://github.com/OneUptime/oneuptime",
    );
    expect(SERVER.repository.subfolder).toBe(
      path.relative(REPOSITORY_ROOT, MCP_DIRECTORY).split(path.sep).join("/"),
    );
  });

  describe("signing in, or an API key in the header it names", () => {
    const tools: Array<McpToolInfo> = generateAllTools();
    let enabledSpy: jest.SpyInstance;

    beforeEach(() => {
      enabledSpy = jest.spyOn(
        McpOAuthConfig,
        "isEnabled",
      ) as unknown as jest.SpyInstance;
      enabledSpy.mockReturnValue(true);
    });

    afterEach(() => {
      enabledSpy.mockRestore();
    });

    test("names one header, a secret that is never required", () => {
      expect(remote.headers).toHaveLength(1);
      expect(remote.headers![0]!.isRequired).toBe(false);
      expect(remote.headers![0]!.isSecret).toBe(true);
    });

    test("the server reads an API key from that header", async () => {
      // Node hands a server its request headers in lower case.
      const header: string = remote.headers![0]!.name.toLowerCase();

      expect(await credentialOf({ [header]: API_KEY })).toEqual({
        type: McpCredentialType.ApiKey,
        apiKey: API_KEY,
      });
    });

    test("a client that leaves the header empty is asked to sign in", async () => {
      const header: string = remote.headers![0]!.name.toLowerCase();
      const credential: McpCredential = await credentialOf({ [header]: "" });

      expect(credential).toEqual({ type: McpCredentialType.None });

      const challenge: BearerChallenge | null = RequestGate.getChallenge({
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_incidents", arguments: {} },
        },
        tools,
        credential,
      });

      expect(challenge?.statusCode).toBe(401);
    });
  });
});

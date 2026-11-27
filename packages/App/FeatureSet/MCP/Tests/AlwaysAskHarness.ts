/*
 * THE ONEUPTIME API AS THE MCP SERVER'S CALLS MEET IT, FOR THE ALWAYS-ASK
 * TESTS (#11177).
 *
 * The MCP server reaches the API only through Common/Utils/API's post, put
 * and delete (OneUptimeApiService). This stands in for the API there, at
 * the very edge of the process: every request the server sends is kept,
 * reads answer with the records a test gives them, and writes answer as the
 * route does when it takes one. So a test asks the one thing that matters -
 * did the write reach the API - of the requests themselves, and a tool is
 * called the way a client calls it: through the MCP SDK's Client, over an
 * in-memory transport, into the server's own handlers.
 */

import { jest } from "@jest/globals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerToolHandlers } from "../Handlers/ToolHandler";
import { McpServer, createMCPServerInstance } from "../Server/MCPServer";
import {
  readRecordWriteOfRequest,
  RecordWrite,
} from "../Tools/AlwaysAskWrites";
import McpCredentialUtil, { McpCredential } from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthScope from "Common/Types/Mcp/McpOAuthScope";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";

export const PROJECT_ID: string = "11177000-0000-4000-8000-000000000001";
export const API_KEY: string = "11177000-0000-4000-8000-0000000000ff";
// Where the test's Dashboard is (config.env's HOST and HTTP_PROTOCOL).
export const DASHBOARD: string = "/dashboard";

export type RequestMethod = "POST" | "PUT" | "DELETE";

export interface SentRequest {
  method: RequestMethod;
  // The path asked for, without the host: /api/data-security-issue/<id>/
  path: string;
  body: JSONObject | undefined;
  headers: Headers;
}

// What the fake answers a request with.
export type Answer = HTTPResponse<JSONObject> | HTTPErrorResponse;

const READ_SUFFIXES: ReadonlyArray<string> = [
  "/get-item",
  "/get-list",
  "/count",
];

export class FakeOneUptimeApi {
  // Every request the MCP server sent, in order.
  public sent: Array<SentRequest> = [];

  // What /<record>/<id>/get-item answers, by "/<record>/<id>".
  public records: Map<string, JSONObject> = new Map();

  // What /<record>/get-list answers, by "/<record>".
  public lists: Map<string, Array<JSONObject>> = new Map();

  // Paths whose reads are refused, as the API refuses a role that may not read them.
  public refusedReads: Array<string> = [];

  // What a write, or any other request, answers: an empty success unless a test says.
  public answerOther: (request: SentRequest) => Answer = (): Answer => {
    return new HTTPResponse(200, {}, {});
  };

  public install(): void {
    for (const method of ["post", "put", "delete"] as const) {
      jest.spyOn(API, method).mockImplementation((async (options: {
        url: URL;
        headers?: Headers;
        data?: JSONObject;
      }): Promise<Answer> => {
        return this.answer(method.toUpperCase() as RequestMethod, options);
      }) as never);
    }

    // Nothing the MCP server writes is sent as a GET.
    jest.spyOn(API, "get").mockImplementation((async (): Promise<Answer> => {
      throw new Error("The MCP server sent a GET, which nothing here expects.");
    }) as never);
  }

  // Forgets every request and every record, as a fresh API would.
  public reset(): void {
    this.sent = [];
    this.records = new Map();
    this.lists = new Map();
    this.refusedReads = [];
    this.answerOther = (): Answer => {
      return new HTTPResponse(200, {}, {});
    };
  }

  // A record a read answers with, as the route serializes it.
  public holds(apiPath: string, id: string, record: JSONObject): void {
    this.records.set(`${apiPath}/${id}`, { _id: id, ...record });
  }

  // The requests that write a record, as BaseAPI routes them.
  public writesSent(): Array<RecordWrite> {
    return this.sent
      .map((request: SentRequest): RecordWrite | null => {
        return readRecordWriteOfRequest({
          method: request.method,
          path: request.path,
          body: request.body,
        });
      })
      .filter((write: RecordWrite | null): write is RecordWrite => {
        return write !== null;
      });
  }

  // The requests that only read: a record, a list, a count.
  public readsSent(): Array<SentRequest> {
    return this.sent.filter((request: SentRequest): boolean => {
      return READ_SUFFIXES.some((suffix: string): boolean => {
        return request.path.endsWith(suffix);
      });
    });
  }

  private answer(
    method: RequestMethod,
    options: { url: URL; headers?: Headers; data?: JSONObject },
  ): Answer {
    const path: string = new globalThis.URL(options.url.toString()).pathname;
    const request: SentRequest = {
      method,
      path,
      body: options.data,
      headers: options.headers || {},
    };

    this.sent.push(request);

    const suffix: string | undefined = READ_SUFFIXES.find(
      (each: string): boolean => {
        return path.endsWith(each);
      },
    );

    if (!suffix) {
      return this.answerOther(request);
    }

    if (
      this.refusedReads.some((prefix: string): boolean => {
        return path.startsWith(prefix);
      })
    ) {
      return new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read this." },
        {},
      );
    }

    const key: string = path.replace(/^\/api/, "").slice(0, -suffix.length);

    if (suffix === "/get-item") {
      const record: JSONObject | undefined = this.records.get(key);

      return record
        ? new HTTPResponse(200, record, {})
        : new HTTPErrorResponse(404, { message: "Not found." }, {});
    }

    if (suffix === "/get-list") {
      const rows: Array<JSONObject> = this.lists.get(key) || [];

      return new HTTPResponse(
        200,
        { data: rows, count: rows.length, skip: 0, limit: 10 } as JSONObject,
        {},
      );
    }

    return new HTTPResponse(200, { count: 0 }, {});
  }
}

// A member signed in with OAuth, with read and write access, in PROJECT_ID.
export function signedInMember(
  scopes: Array<McpOAuthScope> = [McpOAuthScope.Read, McpOAuthScope.Write],
): McpCredential {
  const grant: McpOAuthGrant = new McpOAuthGrant();

  grant._id = ObjectID.generate().toString();
  grant.projectId = new ObjectID(PROJECT_ID);
  grant.userId = ObjectID.generate();
  grant.clientId = ObjectID.generate().toString();
  grant.name = "Claude Code";
  grant.scope = scopes.join(" ");

  return McpCredentialUtil.fromPrincipal({
    grant,
    user: {
      id: grant.userId,
      email: new Email("jane@example.com"),
      name: "Jane Doe",
      isMasterAdmin: false,
    },
    scopes,
  });
}

export function projectApiKey(): McpCredential {
  return McpCredentialUtil.fromApiKey(API_KEY);
}

export interface ToolAnswer {
  isError?: boolean;
  structuredContent?: JSONObject;
  content: Array<{ type: string; text: string }>;
}

// An MCP server with these tools, connected to the SDK's client in memory.
export class ConnectedClient {
  private server: McpServer | undefined;
  private client: Client | undefined;

  public async connect(
    tools: Array<McpToolInfo>,
    credential: McpCredential,
  ): Promise<void> {
    const [clientTransport, serverTransport]: [
      InMemoryTransport,
      InMemoryTransport,
    ] = InMemoryTransport.createLinkedPair();

    this.server = createMCPServerInstance();
    registerToolHandlers(this.server, tools, credential);
    await this.server.connect(serverTransport);

    this.client = new Client({ name: "always-ask-test", version: "1.0.0" });
    await this.client.connect(clientTransport);
  }

  public async call(name: string, args: JSONObject): Promise<ToolAnswer> {
    if (!this.client) {
      throw new Error("Connect first.");
    }

    return (await this.client.callTool({
      name,
      arguments: args,
    })) as unknown as ToolAnswer;
  }

  public async close(): Promise<void> {
    await this.client?.close();
    await this.server?.close();
    this.client = undefined;
    this.server = undefined;
  }
}

// The error and the suggestion of a tool's answer that failed.
export function readFailure(answer: ToolAnswer): {
  error: string;
  suggestion: string;
} {
  const payload: JSONObject = (answer.structuredContent ||
    JSON.parse(answer.content[0]?.text || "{}")) as JSONObject;

  return {
    error: String(payload["error"] || ""),
    suggestion: String(payload["suggestion"] || ""),
  };
}

/**
 * The OneUptime API, as the MCP server sees it, for tests that follow a tool
 * call all the way out of the MCP feature set.
 *
 * Common's API client is intercepted at its three static methods, so no
 * request leaves the process and every request the MCP server WOULD have made
 * is kept with its headers - which is where the interesting question is: an
 * API key forwarded as it came, or a delegation token minted for a client
 * that signed in.
 *
 * It answers the way the API does. A request is authenticated when it carries
 * a delegation token that verifies or an API key on the accepted list;
 * anything else is a 401. A get-list answers with the real envelope
 * (`{ data, count, skip, limit }`), so the client's own unwrapping runs.
 */

import { jest } from "@jest/globals";
import McpDelegationToken from "Common/Server/Utils/Mcp/McpDelegationToken";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

export interface FakeApiCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  data: unknown;
}

interface ApiRequestOptions {
  url: { toString: () => string };
  headers?: Record<string, string> | undefined;
  data?: unknown;
}

type ApiMethod = "post" | "put" | "delete";

const API_METHODS: Array<ApiMethod> = ["post", "put", "delete"];

export const DELEGATION_HEADER: string = McpDelegationToken.HEADER_NAME;
export const API_KEY_HEADER: string = "APIKey";

export const DEFAULT_RECORD_ID: string = "550e8400-e29b-41d4-a716-446655440000";

export default class FakeOneUptimeApi {
  // Every request the MCP server made, in order, since the last reset.
  public calls: Array<FakeApiCall> = [];

  // The API keys this API knows. Any other key is refused with 401.
  public acceptedApiKeys: Array<string> = [];

  /*
   * The rows a get-list answers with, by request path. A test replaces it to
   * answer with its own project, or with nothing.
   */
  public rowsFor: (path: string) => Array<JSONObject> =
    (): Array<JSONObject> => {
      return [{ _id: DEFAULT_RECORD_ID, name: "Acknowledged" }];
    };

  private spies: Array<{ mockRestore: () => void }> = [];

  public install(): void {
    for (const method of API_METHODS) {
      this.spies.push(this.intercept(method));
    }
  }

  public uninstall(): void {
    for (const spy of this.spies) {
      spy.mockRestore();
    }

    this.spies = [];
  }

  public reset(): void {
    this.calls = [];
    this.acceptedApiKeys = [];
    this.rowsFor = (): Array<JSONObject> => {
      return [{ _id: DEFAULT_RECORD_ID, name: "Acknowledged" }];
    };
  }

  private intercept(method: ApiMethod): { mockRestore: () => void } {
    const spy: {
      mockImplementation: (
        implementation: (options: ApiRequestOptions) => unknown,
      ) => unknown;
      mockRestore: () => void;
    } = jest.spyOn(API, method) as any;

    spy.mockImplementation(
      async (
        options: ApiRequestOptions,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        return this.answer(method, options);
      },
    );

    return spy;
  }

  private answer(
    method: ApiMethod,
    options: ApiRequestOptions,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    const url: string = options.url.toString();
    const headers: Record<string, string> = { ...(options.headers || {}) };
    const path: string = new URL(url).pathname;

    this.calls.push({
      method: method.toUpperCase(),
      url,
      path,
      headers,
      data: options.data,
    });

    const delegation: string | undefined = headers[DELEGATION_HEADER];
    const apiKey: string | undefined = headers[API_KEY_HEADER];

    const isAuthenticated: boolean = delegation
      ? McpDelegationToken.verify(delegation) !== null
      : Boolean(apiKey && this.acceptedApiKeys.includes(apiKey));

    if (!isAuthenticated) {
      return new HTTPErrorResponse(
        401,
        { message: "Invalid API key or session." },
        {},
      );
    }

    if (path.endsWith("/get-list")) {
      const rows: Array<JSONObject> = this.rowsFor(path);

      return new HTTPResponse<JSONObject>(
        200,
        { data: rows, count: rows.length, skip: 0, limit: 10 },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(200, { _id: DEFAULT_RECORD_ID }, {});
  }
}

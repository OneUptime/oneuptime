/**
 * Where the MCP server sends the API calls its tools make.
 *
 * The MCP server is part of the App, and its tools call the App's own API.
 * They do it over the App's internal address, SERVER_APP_HOSTNAME:APP_PORT,
 * as every other server-to-server call in the App does. They used to go out
 * through the public address (HTTP_PROTOCOL + HOST) and back in through
 * Nginx: with HOST=localhost - a local install, and the e2e stack - that is
 * the App container itself, where nothing listens on port 80, so every tool
 * that read or wrote anything answered "connect ECONNREFUSED 127.0.0.1:80".
 * The e2e suite's MCP OAuth sign-in caught it: oneuptime_whoami came back as
 * an error result, with no "authentication" in it.
 *
 * EnvironmentConfig reads the environment once, when it is loaded, so every
 * case loads the modules afresh under the environment it sets. API.post is
 * spied on, so no HTTP traffic occurs.
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
jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: { isMcpServerEnabled: jest.fn() },
  };
});

import { JSONObject } from "Common/Types/JSON";

const ENVIRONMENT_KEYS: Array<string> = [
  "HOST",
  "HTTP_PROTOCOL",
  "SERVER_APP_HOSTNAME",
  "APP_PORT",
];

// A public address the App container cannot reach, as on the e2e stack.
const ENVIRONMENT: Record<string, string> = {
  HOST: "localhost",
  HTTP_PROTOCOL: "https",
  SERVER_APP_HOSTNAME: "app",
  APP_PORT: "3002",
};

const STATUS_PAGE_ID: string = "550e8400-e29b-41d4-a716-446655440000";

interface Loaded {
  getApiUrl: () => string;
  OneUptimeApiService: {
    initialize: (config: { url: string }) => void;
    makeAuthenticatedApiCall: (data: {
      method: "POST" | "PUT" | "DELETE";
      path: string;
      body?: JSONObject | undefined;
      credential: string;
    }) => Promise<unknown>;
  };
  handlePublicStatusPageTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
  postSpy: jest.SpyInstance;
}

type LoadFunction = () => Loaded;

/*
 * Loads ServerConfig, the API service and the public status page tools - and
 * the EnvironmentConfig and API they import - under ENVIRONMENT, then puts
 * the environment back. The loaded modules keep what they read.
 */
const load: LoadFunction = (): Loaded => {
  const saved: Record<string, string | undefined> = {};

  for (const key of ENVIRONMENT_KEYS) {
    saved[key] = process.env[key];
    process.env[key] = ENVIRONMENT[key];
  }

  let loaded: Loaded | null = null;

  try {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const API: { post: (...args: Array<unknown>) => Promise<unknown> } =
        require("Common/Utils/API").default;
      const HTTPResponse: new (
        statusCode: number,
        data: JSONObject,
        headers: JSONObject,
      ) => unknown = require("Common/Types/API/HTTPResponse").default;
      const StatusPageService: { isMcpServerEnabled: jest.Mock } =
        require("Common/Server/Services/StatusPageService").default;
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      StatusPageService.isMcpServerEnabled.mockResolvedValue(true as never);

      const postSpy: jest.SpyInstance = jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPResponse(200, { data: [] }, {}) as never,
        ) as unknown as jest.SpyInstance;

      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      loaded = {
        getApiUrl: require("../Config/ServerConfig").getApiUrl,
        OneUptimeApiService: require("../Services/OneUptimeApiService").default,
        handlePublicStatusPageTool: require("../Tools/PublicStatusPageTools")
          .handlePublicStatusPageTool,
        postSpy,
      };
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    });
  } finally {
    for (const key of ENVIRONMENT_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }

  return loaded!;
};

type RequestedUrlFunction = (postSpy: jest.SpyInstance) => string;

const requestedUrl: RequestedUrlFunction = (
  postSpy: jest.SpyInstance,
): string => {
  expect(postSpy).toHaveBeenCalledTimes(1);

  const options: { url: { toString: () => string } } = postSpy.mock
    .calls[0]![0] as { url: { toString: () => string } };

  return options.url.toString();
};

describe("the MCP server's API address", () => {
  let loaded: Loaded;

  beforeEach(() => {
    loaded = load();
    loaded.OneUptimeApiService.initialize({ url: loaded.getApiUrl() });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is the App's internal address, over plain HTTP, whatever HOST and HTTP_PROTOCOL say", () => {
    expect(loaded.getApiUrl()).toBe("http://app:3002");
  });

  test("a tool's API call goes to the App, not out through the public address and back", async () => {
    await loaded.OneUptimeApiService.makeAuthenticatedApiCall({
      method: "POST",
      path: "/api/project/get-list",
      body: { query: {} },
      credential: "an-api-key",
    });

    expect(requestedUrl(loaded.postSpy)).toBe(
      "http://app:3002/api/project/get-list",
    );
  });

  test("so do the public status page tools", async () => {
    const result: JSONObject = JSON.parse(
      await loaded.handlePublicStatusPageTool(
        "get_public_status_page_overview",
        { statusPageIdOrDomain: STATUS_PAGE_ID },
      ),
    ) as JSONObject;

    expect(result["success"]).toBe(true);
    expect(requestedUrl(loaded.postSpy)).toBe(
      `http://app:3002/api/status-page/overview/${STATUS_PAGE_ID}`,
    );
  });
});

import GitHubAPI from "../../../Server/API/GitHubAPI";
import GitHubWebhookQueue from "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue";
import { OneUptimeRequest } from "../../../Server/Utils/Express";
import express from "express";
import logger from "../../../Server/Utils/Logger";
import crypto from "crypto";
import http, { Server } from "http";
import { AddressInfo } from "net";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    GitHubAppWebhookSecret: "github-http-test-secret",
  };
});
jest.mock(
  "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue",
  () => {
    const actual: typeof GitHubWebhookQueue = jest.requireActual(
      "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue",
    ).default;
    return {
      __esModule: true,
      default: {
        isSupportedEvent: actual.isSupportedEvent.bind(actual),
        validate: actual.validate.bind(actual),
        enqueue: jest.fn(),
      },
    };
  },
);

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateBy: jest.fn() },
  };
});
jest.mock("../../../Server/Services/CodeRepositoryService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      importReposFromInstallation: jest.fn(),
      updateBy: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Services/AccessTokenService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return { __esModule: true, default: { getUserMiddleware: jest.fn() } };
});

const payload: Record<string, unknown> = {
  action: "created",
  installation: { id: 123 },
  repository: { id: 456, full_name: "acme/service" },
  sender: { login: "octocat", type: "User" },
  issue: { number: 7, title: "Service issue" },
  comment: {
    id: 89,
    body: "@oneuptime incident Café ☕",
    html_url: "https://github.com/acme/service/issues/7#issuecomment-89",
  },
};

interface WebhookHTTPResult {
  status: number;
  body: string;
}
type ResolveFunction<T> = (value: T | PromiseLike<T>) => void;

function signature(body: string): string {
  return `sha256=${crypto.createHmac("sha256", "github-http-test-secret").update(body).digest("hex")}`;
}

async function post(
  server: Server,
  body: string,
  headers: Record<string, string> = {},
): Promise<WebhookHTTPResult> {
  return new Promise<WebhookHTTPResult>(
    (
      resolve: ResolveFunction<WebhookHTTPResult>,
      reject: (reason?: unknown) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          hostname: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          path: "/api/github/webhook",
          method: "POST",
          agent: false,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            ...headers,
          },
        },
        (response: http.IncomingMessage) => {
          let text: string = "";
          response.on("data", (chunk: Buffer) => {
            text += chunk.toString();
          });
          response.on("end", () => {
            resolve({ status: response.statusCode!, body: text });
          });
        },
      );
      request.setTimeout(5000, () => {
        request.destroy(new Error("HTTP test request timed out"));
      });
      request.on("error", reject);
      request.end(body);
    },
  );
}

function headers(body: string): Record<string, string> {
  return {
    "x-hub-signature-256": signature(body),
    "x-github-event": "issue_comment",
    "x-github-delivery": "a6f63672-19bf-4f44-82a7-cf374d2ad90c",
  };
}

describe("GitHub signed HTTP webhook boundary", () => {
  let server: Server;
  let retainRawBody: boolean;
  beforeAll(async () => {
    const app: express.Express = express();
    app.use(
      express.json({
        verify: (
          req: http.IncomingMessage,
          _res: http.ServerResponse,
          buffer: Buffer,
        ) => {
          if (retainRawBody) {
            (req as OneUptimeRequest).rawBody = buffer.toString();
          }
        },
      }),
    );
    app.use("/api", new GitHubAPI().getRouter());
    app.use(
      (
        _error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ): void => {
        res.status(400).json({ message: "Malformed JSON request" });
      },
    );
    server = await new Promise<Server>((resolve: ResolveFunction<Server>) => {
      const listener: Server = app.listen(0, () => {
        resolve(listener);
      });
    });
  });
  beforeEach(() => {
    retainRawBody = true;
    jest.spyOn(logger, "error").mockImplementation(() => {});
    jest.clearAllMocks();
    (GitHubWebhookQueue.enqueue as jest.Mock).mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await new Promise<void>((resolve: ResolveFunction<void>) => {
      server.unref();
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
  });

  test.each([
    JSON.stringify(payload),
    JSON.stringify(payload, null, 2),
    JSON.stringify(payload).replace("Café", "Caf\\u00e9"),
  ])(
    "accepts exact signed bytes with whitespace and Unicode",
    async (body: string) => {
      expect((await post(server, body, headers(body))).status).toBe(200);
      expect(GitHubWebhookQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ event: "issue_comment", payload }),
      );
    },
  );

  test("does not acknowledge before the queue accepts the delivery", async () => {
    let finish!: () => void;
    (GitHubWebhookQueue.enqueue as jest.Mock).mockImplementation(() => {
      return new Promise<void>((resolve: ResolveFunction<void>) => {
        finish = resolve;
      });
    });
    const body: string = JSON.stringify(payload);
    let acknowledged: boolean = false;
    const response: Promise<WebhookHTTPResult> = post(
      server,
      body,
      headers(body),
    ).then((value: WebhookHTTPResult) => {
      acknowledged = true;
      return value;
    });
    for (let i: number = 0; i < 100 && !finish; i++) {
      await new Promise<void>((resolve: ResolveFunction<void>) => {
        setTimeout(resolve, 5);
      });
    }
    expect(finish).toBeDefined();
    expect(acknowledged).toBe(false);
    finish();
    expect((await response).status).toBe(200);
  });

  test.each(["missing", "wrong", "tampered", "reserialized", "missing-raw"])(
    "%s signature/body never enqueues",
    async (kind: string) => {
      let body: string = JSON.stringify(payload, null, 2);
      const requestHeaders: Record<string, string> = headers(body);
      if (kind === "missing") {
        delete requestHeaders["x-hub-signature-256"];
      }
      if (kind === "wrong") {
        requestHeaders["x-hub-signature-256"] = "sha256=" + "0".repeat(64);
      }
      if (kind === "tampered") {
        body = body.replace("Café", "Changed");
      }
      if (kind === "reserialized") {
        requestHeaders["x-hub-signature-256"] = signature(
          JSON.stringify(payload),
        );
      }
      if (kind === "missing-raw") {
        retainRawBody = false;
      }
      expect((await post(server, body, requestHeaders)).status).toBe(400);
      expect(GitHubWebhookQueue.enqueue).not.toHaveBeenCalled();
    },
  );

  test.each(["x-github-event", "x-github-delivery"])(
    "rejects missing %s",
    async (header: string) => {
      const body: string = JSON.stringify(payload);
      const requestHeaders: Record<string, string> = headers(body);
      delete requestHeaders[header];
      expect((await post(server, body, requestHeaders)).status).toBe(400);
      expect(GitHubWebhookQueue.enqueue).not.toHaveBeenCalled();
    },
  );

  test.each(
    [
      [],
      null,
      {},
      { ...payload, installation: {} },
      { ...payload, repository: {} },
      { ...payload, comment: null },
    ].map((value: unknown) => {
      return [value];
    }),
  )("rejects malformed supported payload", async (value: unknown) => {
    const body: string = JSON.stringify(value);
    expect((await post(server, body, headers(body))).status).toBe(400);
    expect(GitHubWebhookQueue.enqueue).not.toHaveBeenCalled();
  });

  test("returns server failure when durable enqueue fails", async () => {
    (GitHubWebhookQueue.enqueue as jest.Mock).mockRejectedValue(
      new Error("redis credentials must not leak"),
    );
    const body: string = JSON.stringify(payload);
    const result: { status: number; body: string } = await post(
      server,
      body,
      headers(body),
    );
    expect(result.status).toBe(500);
    expect(result.body).not.toContain("redis credentials");
  });

  test.each(["ping", "star"])(
    "acknowledges signed %s without scheduling",
    async (event: string) => {
      const body: string = JSON.stringify({ zen: "Keep it logically awesome" });
      expect(
        (
          await post(server, body, {
            ...headers(body),
            "x-github-event": event,
          })
        ).status,
      ).toBe(200);
      expect(GitHubWebhookQueue.enqueue).not.toHaveBeenCalled();
    },
  );

  test("installation lifecycle also goes through the durable queue", async () => {
    const body: string = JSON.stringify({
      action: "deleted",
      installation: { id: 123 },
    });
    expect(
      (
        await post(server, body, {
          ...headers(body),
          "x-github-event": "installation",
        })
      ).status,
    ).toBe(200);
    expect(GitHubWebhookQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});

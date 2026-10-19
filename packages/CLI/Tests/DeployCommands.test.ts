import { Command } from "commander";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  CHANGE_EVENTS_INGEST_PATH,
  buildDeployEvent,
  describeRecorded,
  parseAttribute,
  sendChangeEvents,
} from "../Commands/DeployCommands";
import * as ConfigManager from "../Core/ConfigManager";
import { buildProgram } from "../Program";
import * as fs from "fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";

/*
 * oneuptime deploy records a deploy, or another change, from a pipeline: it
 * posts one change event to the change-events ingest API with a telemetry
 * ingestion key, so the deploy is drawn on the service's charts and read by
 * OneUptime AI's investigations.
 */

const CONFIG_FILE: string = path.join(
  os.homedir(),
  ".oneuptime",
  "config.json",
);
const URL_ENV: string = "ONEUPTIME_URL";
const KEY_ENV: string = "ONEUPTIME_TELEMETRY_INGESTION_KEY";

describe("buildDeployEvent", () => {
  it("a deploy of a version, titled by it", () => {
    expect(
      buildDeployEvent({
        service: "checkout",
        serviceVersion: "2.3.1",
        commit: "1a2b3c4",
        environment: "production",
      }),
    ).toEqual({
      title: "Deploy 2.3.1",
      eventType: "deployment",
      serviceName: "checkout",
      version: "2.3.1",
      commit: "1a2b3c4",
      environment: "production",
    });
  });

  it("every field it takes, trimmed", () => {
    expect(
      buildDeployEvent({
        service: " checkout ",
        serviceVersion: " 2.3.1 ",
        previousVersion: "2.3.0",
        commit: "1a2b3c4",
        repository: "https://github.com/acme/checkout",
        branch: "main",
        pullRequest: "482",
        environment: "production",
        title: " Release train 42 ",
        description: "Totals in cents",
        time: "2026-10-19T09:48:00Z",
        attribute: ["team=payments", "pipeline.url=https://ci/run?id=1"],
      }),
    ).toEqual({
      title: "Release train 42",
      eventType: "deployment",
      serviceName: "checkout",
      description: "Totals in cents",
      version: "2.3.1",
      previousVersion: "2.3.0",
      commit: "1a2b3c4",
      repository: "https://github.com/acme/checkout",
      branch: "main",
      pullRequest: "482",
      environment: "production",
      time: "2026-10-19T09:48:00.000Z",
      attributes: { team: "payments", "pipeline.url": "https://ci/run?id=1" },
    });
  });

  it("a deploy that names no version is titled Deploy", () => {
    expect(buildDeployEvent({})).toEqual({
      title: "Deploy",
      eventType: "deployment",
    });
  });

  it("blank values are left out", () => {
    expect(
      buildDeployEvent({ service: "  ", commit: "", environment: " " }),
    ).toEqual({ title: "Deploy", eventType: "deployment" });
  });

  it("another kind of change needs a title", () => {
    expect(() => {
      return buildDeployEvent({ type: "config-change" });
    }).toThrow("A config-change change needs a --title.");
    expect(
      buildDeployEvent({ type: "config-change", title: "Raised pool size" }),
    ).toEqual({ title: "Raised pool size", eventType: "config-change" });
  });

  it("refuses a time that is not one", () => {
    expect(() => {
      return buildDeployEvent({ time: "yesterday-ish" });
    }).toThrow(
      '--time takes a date and time, such as 2026-10-19T10:00:00Z, and "yesterday-ish" is not one.',
    );
  });
});

describe("parseAttribute", () => {
  it("splits at the first =", () => {
    expect(parseAttribute("team=payments")).toEqual(["team", "payments"]);
    expect(parseAttribute("query=a=b")).toEqual(["query", "a=b"]);
    expect(parseAttribute("empty=")).toEqual(["empty", ""]);
  });

  it("refuses a pair with no key", () => {
    expect(() => {
      return parseAttribute("team");
    }).toThrow('--attribute takes key=value, and "team" is not one.');
    expect(() => {
      return parseAttribute("=payments");
    }).toThrow("--attribute takes key=value");
  });
});

describe("describeRecorded", () => {
  it("says what was recorded", () => {
    expect(
      describeRecorded({
        eventType: "deployment",
        serviceName: "checkout",
        version: "2.3.1",
      }),
    ).toBe("Recorded the deploy of checkout 2.3.1.");
    expect(describeRecorded({ eventType: "deployment" })).toBe(
      "Recorded the deploy.",
    );
    expect(
      describeRecorded({
        eventType: "config-change",
        title: "Raised pool size",
        serviceName: "checkout",
      }),
    ).toBe('Recorded the config-change change "Raised pool size" of checkout.');
  });
});

describe("sendChangeEvents", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("posts the events to the ingest API with the ingestion key", async () => {
    const post: jest.SpyInstance = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ingested: 1, skipped: 0 }, {}),
      );

    await expect(
      sendChangeEvents({
        instanceUrl: "https://oneuptime.example.com",
        ingestionKey: "key-1",
        events: [{ title: "Deploy" }],
      }),
    ).resolves.toEqual({ ingested: 1, skipped: 0 });

    const request: JSONObject = post.mock.calls[0][0] as JSONObject;
    expect(String(request["url"])).toBe(
      `https://oneuptime.example.com${CHANGE_EVENTS_INGEST_PATH}`,
    );
    expect(request["headers"]).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-oneuptime-token": "key-1",
    });
    expect(request["data"]).toEqual({ events: [{ title: "Deploy" }] });
    // The key is in the headers: a redirect is followed only on this server.
    expect(request["options"]).toEqual({ sameServerRedirectsOnly: true });
  });

  it("an error answer is thrown as an API error", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(401, { message: "Invalid ingestion key" }, {}),
      );

    await expect(
      sendChangeEvents({
        instanceUrl: "https://oneuptime.example.com",
        ingestionKey: "bad",
        events: [{ title: "Deploy" }],
      }),
    ).rejects.toThrow("API error (401)");
  });
});

/*
 * Over real HTTP, two servers on this machine: the instance the events are
 * sent to and another one. The ingestion key travels in a header, and an
 * HTTP client hands a redirected request's headers to wherever the redirect
 * points, so the request follows a redirect only on the instance's own
 * server.
 */
describe("sendChangeEvents over HTTP", () => {
  interface Received {
    url: string;
    headers: IncomingMessage["headers"];
    body: string;
  }

  interface TestServer {
    http: Server;
    origin: string;
    received: Array<Received>;
    // Where a request to a path is redirected, and with which status.
    redirects: Map<string, { status: number; location: string }>;
  }

  const startServer: () => Promise<TestServer> =
    async (): Promise<TestServer> => {
      const received: Array<Received> = [];
      const redirects: Map<string, { status: number; location: string }> =
        new Map();

      const http: Server = createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          let body: string = "";

          req.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });

          req.on("end", () => {
            received.push({
              url: req.url || "",
              headers: req.headers,
              body: body,
            });

            const redirect: { status: number; location: string } | undefined =
              redirects.get(req.url || "");

            if (redirect) {
              res.writeHead(redirect.status, { location: redirect.location });
              res.end();
              return;
            }

            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ingested: 1, skipped: 0 }));
          });
        },
      );

      await new Promise<void>((resolve: () => void) => {
        http.listen(0, "127.0.0.1", resolve);
      });

      return {
        http: http,
        origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
        received: received,
        redirects: redirects,
      };
    };

  const stopServer: (server: TestServer) => Promise<void> = async (
    server: TestServer,
  ): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      server.http.close(() => {
        resolve();
      });
    });
  };

  let instance: TestServer;
  let otherServer: TestServer;

  beforeAll(async () => {
    instance = await startServer();
    otherServer = await startServer();
  });

  afterAll(async () => {
    await stopServer(instance);
    await stopServer(otherServer);
  });

  afterEach(() => {
    instance.received.length = 0;
    instance.redirects.clear();
    otherServer.received.length = 0;
    otherServer.redirects.clear();
  });

  it.each([301, 302, 303, 307, 308])(
    "a %s to another server is not followed: the key never reaches it",
    async (status: number) => {
      instance.redirects.set(CHANGE_EVENTS_INGEST_PATH, {
        status: status,
        location: `${otherServer.origin}/collect`,
      });

      await expect(
        sendChangeEvents({
          instanceUrl: instance.origin,
          ingestionKey: "key-not-to-leak",
          events: [{ title: "Deploy" }],
        }),
      ).rejects.toThrow(otherServer.origin);

      expect(instance.received).toHaveLength(1);
      expect(instance.received[0]!.headers["x-oneuptime-token"]).toBe(
        "key-not-to-leak",
      );
      expect(otherServer.received).toEqual([]);
    },
  );

  it("a redirect on the instance's own server is followed, key and events with it", async () => {
    instance.redirects.set(CHANGE_EVENTS_INGEST_PATH, {
      status: 307,
      location: `${instance.origin}/moved${CHANGE_EVENTS_INGEST_PATH}`,
    });

    await expect(
      sendChangeEvents({
        instanceUrl: instance.origin,
        ingestionKey: "key-1",
        events: [{ title: "Deploy" }],
      }),
    ).resolves.toEqual({ ingested: 1, skipped: 0 });

    expect(
      instance.received.map((request: Received): string => {
        return request.url;
      }),
    ).toEqual([
      CHANGE_EVENTS_INGEST_PATH,
      `/moved${CHANGE_EVENTS_INGEST_PATH}`,
    ]);
    expect(instance.received[1]!.headers["x-oneuptime-token"]).toBe("key-1");
    expect(JSON.parse(instance.received[1]!.body)).toEqual({
      events: [{ title: "Deploy" }],
    });
    expect(otherServer.received).toEqual([]);
  });
});

describe("oneuptime deploy", () => {
  let savedConfig: string | null = null;
  let post: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeAll(() => {
    savedConfig = fs.existsSync(CONFIG_FILE)
      ? fs.readFileSync(CONFIG_FILE, "utf-8")
      : null;
  });

  afterAll(() => {
    if (savedConfig !== null) {
      fs.writeFileSync(CONFIG_FILE, savedConfig, { mode: 0o600 });
    } else if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  beforeEach(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
    delete process.env[URL_ENV];
    delete process.env[KEY_ENV];
    process.env["NO_COLOR"] = "1";
    post = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ingested: 1, skipped: 0 }, {}),
      );
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env[URL_ENV];
    delete process.env[KEY_ENV];
    delete process.env["NO_COLOR"];
  });

  async function deploy(args: Array<string>): Promise<void> {
    const program: Command = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "oneuptime", "deploy", ...args]);
  }

  function sent(): JSONObject {
    return post.mock.calls[0][0] as JSONObject;
  }

  it("records a deploy with the flags it is given", async () => {
    await deploy([
      "--service",
      "checkout",
      "--service-version",
      "2.3.1",
      "--commit",
      "1a2b3c4",
      "--attribute",
      "team=payments",
      "build=7",
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "key-1",
    ]);

    expect(String(sent()["url"])).toBe(
      "https://oneuptime.example.com/telemetry/change-events/v1/ingest",
    );
    expect((sent()["headers"] as JSONObject)["x-oneuptime-token"]).toBe(
      "key-1",
    );
    expect(sent()["data"]).toEqual({
      events: [
        {
          title: "Deploy 2.3.1",
          eventType: "deployment",
          serviceName: "checkout",
          version: "2.3.1",
          commit: "1a2b3c4",
          attributes: { team: "payments", build: "7" },
        },
      ],
    });
    expect(logSpy).toHaveBeenCalledWith(
      "Recorded the deploy of checkout 2.3.1.",
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("takes the key and the address from the environment", async () => {
    process.env[KEY_ENV] = "env-key";
    process.env[URL_ENV] = "https://env.example.com";

    await deploy(["--service", "checkout"]);

    expect(String(sent()["url"])).toBe(
      "https://env.example.com/telemetry/change-events/v1/ingest",
    );
    expect((sent()["headers"] as JSONObject)["x-oneuptime-token"]).toBe(
      "env-key",
    );
  });

  it("takes the address from the current context when nothing else gives one", async () => {
    ConfigManager.addContext({
      name: "production",
      apiUrl: "https://context.example.com",
      apiKey: "an-api-key",
    });
    ConfigManager.setCurrentContext("production");

    await deploy(["--ingestion-key", "key-1"]);

    expect(String(sent()["url"])).toBe(
      "https://context.example.com/telemetry/change-events/v1/ingest",
    );
  });

  it("without an ingestion key, says how to get one and sends nothing", async () => {
    await deploy(["--url", "https://oneuptime.example.com"]);

    expect(post).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "No telemetry ingestion key found. Pass --ingestion-key or set ONEUPTIME_TELEMETRY_INGESTION_KEY",
      ),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("without an address, says how to give one", async () => {
    await deploy(["--ingestion-key", "key-1"]);

    expect(post).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("No OneUptime URL found."),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("a key OneUptime refuses exits as an authentication error", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(401, { message: "Invalid ingestion key" }, {}),
    );

    await deploy([
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "bad",
    ]);

    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("a change OneUptime did not record is an error", async () => {
    post.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ingested: 0, skipped: 1 }, {}),
    );

    await deploy([
      "--url",
      "https://oneuptime.example.com",
      "--ingestion-key",
      "key-1",
    ]);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("OneUptime did not record the change."),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

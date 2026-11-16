import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { EventEmitter } from "events";
import http from "http";
import { AddressInfo } from "net";

/*
 * THE ONE PLACE AN INGEST PATH STAMPS ITS KEY AS USED (issues #7887, #8021).
 *
 * The HTTP ingest middleware, the OTLP gRPC server and the MQTT broker each
 * stamp through TelemetryIngestionKeyLastUsed once they have accepted
 * telemetry (TelemetryIngestKeyLastUsed.test.ts, GrpcServerKeyLastUsed.test.ts,
 * MqttServerKeyLastUsed.test.ts and OtlpKeyLastUsedAcrossProtocols.test.ts
 * drive them). Here, the helper itself:
 *
 *   - stamp writes through the key service's throttled markUsed with the
 *     admitting key's id, hands its caller nothing to wait on, and a failed
 *     write is logged and goes no further;
 *   - stampWhenAccepted, the HTTP middleware's way in, stamps only once the
 *     route has answered with a success, and never for a refusal, a failure,
 *     an answer never sent or a response it cannot watch.
 */

jest.mock("../../../../Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      markUsed: jest.fn(),
    },
  };
});

import TelemetryIngestionKeyService from "../../../../Server/Services/TelemetryIngestionKeyService";
import logger from "../../../../Server/Utils/Logger";
import TelemetryIngestionKeyLastUsed, {
  AnsweredHttpResponse,
  isAcceptedHttpStatus,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import ObjectID from "../../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../../Types/Telemetry/TelemetryIngestionKeyType";

type MockFn = jest.Mock;

const KEY_ID: string = "7887a000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "7887a000-0000-4000-8000-000000000002";

function buildPolicy(): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID(KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
  };
}

function markUsed(): MockFn {
  return TelemetryIngestionKeyService.markUsed as unknown as MockFn;
}

// Lets a rejected write and its .catch run out.
function settle(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/*
 * A response as Node's is to the helper: a status, and "finish" once the
 * answer is handed to the connection. answer() is what a route's res.end()
 * comes to.
 */
class FakeResponse extends EventEmitter implements AnsweredHttpResponse {
  public statusCode: number = 200;

  public answer(statusCode: number): void {
    this.statusCode = statusCode;
    this.emit("finish");
  }
}

describe("TelemetryIngestionKeyLastUsed.stamp", () => {
  let warn: jest.SpiedFunction<typeof logger.warn>;

  beforeEach(() => {
    jest.clearAllMocks();
    markUsed().mockResolvedValue(undefined as never);
    warn = jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the admitting key's id through the key service's throttled markUsed, before it returns", () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();

    TelemetryIngestionKeyLastUsed.stamp(policy);

    // The key's own id, and nothing else.
    expect(markUsed()).toHaveBeenCalledTimes(1);
    expect(markUsed().mock.calls[0]).toEqual([policy.ingestionKeyId]);
    expect(markUsed().mock.calls[0]![0]).toBe(policy.ingestionKeyId);
  });

  test("gives its caller nothing to wait on, so a slow write never holds an accepted request", () => {
    markUsed().mockReturnValue(new Promise<void>((): void => {}) as never);

    const returned: unknown = (
      TelemetryIngestionKeyLastUsed.stamp as (
        policy: TelemetryIngestionKeyPolicy,
      ) => unknown
    )(buildPolicy());

    expect(returned).toBeUndefined();
    expect(markUsed()).toHaveBeenCalledTimes(1);
  });

  test("a write that fails is caught and logged with the key's id, never thrown to the caller", async () => {
    const failure: Error = new Error("database is having a bad day");
    markUsed().mockRejectedValue(failure as never);

    expect(() => {
      TelemetryIngestionKeyLastUsed.stamp(buildPolicy());
    }).not.toThrow();
    await settle();

    // Only the .catch the helper attaches writes these two lines.
    expect(warn).toHaveBeenCalledWith(
      `TelemetryIngest: failed to record last used for ingestion key ${KEY_ID}`,
    );
    expect(warn).toHaveBeenCalledWith(failure);
  });
});

describe("isAcceptedHttpStatus: a success is what an ingest route answers once it has taken the data", () => {
  test.each([200, 201, 202, 204, 299])("%p is accepted", (status: number) => {
    expect(isAcceptedHttpStatus(status)).toBe(true);
  });

  test.each([
    0, 100, 199, 300, 304, 400, 401, 402, 413, 415, 422, 429, 500, 503,
  ])("%p is not", (status: number) => {
    expect(isAcceptedHttpStatus(status)).toBe(false);
  });
});

describe("TelemetryIngestionKeyLastUsed.stampWhenAccepted", () => {
  let stamp: jest.SpiedFunction<typeof TelemetryIngestionKeyLastUsed.stamp>;

  beforeEach(() => {
    jest.clearAllMocks();
    markUsed().mockResolvedValue(undefined as never);
    // Calls through, so the key service's markUsed is still reached.
    stamp = jest.spyOn(TelemetryIngestionKeyLastUsed, "stamp");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stamps nothing while the route has not answered", () => {
    const res: FakeResponse = new FakeResponse();

    TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);

    expect(stamp).not.toHaveBeenCalled();
    expect(markUsed()).not.toHaveBeenCalled();
  });

  test.each([200, 202, 204])(
    "stamps the key that sent the request once, when the route answers %p",
    (status: number) => {
      const policy: TelemetryIngestionKeyPolicy = buildPolicy();
      const res: FakeResponse = new FakeResponse();

      TelemetryIngestionKeyLastUsed.stampWhenAccepted(policy, res);
      res.answer(status);

      expect(stamp).toHaveBeenCalledTimes(1);
      expect(stamp).toHaveBeenCalledWith(policy);
      expect(markUsed()).toHaveBeenCalledTimes(1);
      expect(String(markUsed().mock.calls[0]![0])).toBe(KEY_ID);
    },
  );

  test.each([
    [400, "a body the route cannot read"],
    [401, "a refused credential"],
    [413, "a body over the limit"],
    [415, "a content coding the route cannot undo"],
    [422, "a key that may not write here"],
    [429, "a sender over its rate"],
    [500, "a route that failed"],
    [503, "a queue that could not take the data"],
  ])("stamps nothing when the route answers %p, %s", (status: number) => {
    const res: FakeResponse = new FakeResponse();

    TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);
    res.answer(status);

    expect(stamp).not.toHaveBeenCalled();
    expect(markUsed()).not.toHaveBeenCalled();
  });

  test("reads the status the route answered with, not the one the response held when it was watched", () => {
    const res: FakeResponse = new FakeResponse();
    // Node's default, before any route has set one.
    res.statusCode = 200;

    TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);
    res.answer(503);

    expect(markUsed()).not.toHaveBeenCalled();
  });

  test("stamps once for one answer, however the response is reused afterwards", () => {
    const res: FakeResponse = new FakeResponse();

    TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);
    res.answer(200);
    res.emit("finish");

    expect(markUsed()).toHaveBeenCalledTimes(1);
    expect(res.listenerCount("finish")).toBe(0);
  });

  test("a response it cannot watch stamps nothing and throws nothing", () => {
    for (const bare of [{}, { statusCode: 200 }, { once: "not a function" }]) {
      expect(() => {
        TelemetryIngestionKeyLastUsed.stampWhenAccepted(
          buildPolicy(),
          bare as unknown as AnsweredHttpResponse,
        );
      }).not.toThrow();
    }

    expect(markUsed()).not.toHaveBeenCalled();
  });

  test("a stamp that throws is logged, and never thrown into the response's own handling", () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
    const failure: Error = new Error("the key service is not there");
    markUsed().mockImplementation((): never => {
      throw failure;
    });
    const res: FakeResponse = new FakeResponse();

    TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);

    expect(() => {
      res.answer(200);
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      `TelemetryIngest: failed to record last used for ingestion key ${KEY_ID}`,
    );
    expect(logger.warn).toHaveBeenCalledWith(failure);
  });

  test("a stamp that fails to write is the helper's to log, never the response's to throw", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
    markUsed().mockRejectedValue(new Error("database is down") as never);
    const res: FakeResponse = new FakeResponse();

    TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);

    expect(() => {
      res.answer(200);
    }).not.toThrow();
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      `TelemetryIngest: failed to record last used for ingestion key ${KEY_ID}`,
    );
  });
});

/*
 * Over a real socket, with Node's own ServerResponse: the "finish" the helper
 * listens for is the one a real answer emits, a refusal's status is the one
 * it reads, and a client that leaves before the answer is sent leaves nothing
 * stamped.
 */
describe("TelemetryIngestionKeyLastUsed.stampWhenAccepted on a real HTTP response", () => {
  interface Scenario {
    // What the route does with the request once the guard admitted it.
    route: (res: http.ServerResponse) => void;
  }

  let server: http.Server;
  let port: number;
  let scenario: Scenario;
  let watched: Promise<void>;
  let onWatched: () => void;

  beforeAll(async () => {
    server = http.createServer(
      (_req: http.IncomingMessage, res: http.ServerResponse): void => {
        TelemetryIngestionKeyLastUsed.stampWhenAccepted(buildPolicy(), res);
        res.once("close", (): void => {
          onWatched();
        });
        scenario.route(res);
      },
    );
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    markUsed().mockResolvedValue(undefined as never);
    watched = new Promise<void>((resolve: () => void): void => {
      onWatched = resolve;
    });
  });

  function post(): Promise<number> {
    return new Promise<number>(
      (resolve: (status: number) => void, reject: (err: Error) => void) => {
        const request: http.ClientRequest = http.request(
          { host: "127.0.0.1", port, method: "POST", path: "/otlp/v1/logs" },
          (response: http.IncomingMessage): void => {
            response.resume();
            response.on("end", (): void => {
              resolve(response.statusCode ?? 0);
            });
          },
        );
        request.on("error", reject);
        request.end("{}");
      },
    );
  }

  test("a 200 the route sends stamps the key", async () => {
    scenario = {
      route: (res: http.ServerResponse): void => {
        res.statusCode = 200;
        res.end("{}");
      },
    };

    expect(await post()).toBe(200);
    await watched;

    expect(markUsed()).toHaveBeenCalledTimes(1);
    expect(String(markUsed().mock.calls[0]![0])).toBe(KEY_ID);
  });

  test("a 503 the route sends stamps nothing", async () => {
    scenario = {
      route: (res: http.ServerResponse): void => {
        res.statusCode = 503;
        res.end('{"message":"Telemetry queue unavailable. Please retry."}');
      },
    };

    expect(await post()).toBe(503);
    await watched;

    expect(markUsed()).not.toHaveBeenCalled();
  });

  test("a client that leaves before the route answers leaves nothing stamped, even if the route later answers 200", async () => {
    let answerLate!: () => void;
    const answeredLate: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        answerLate = resolve;
      },
    );

    scenario = {
      route: (res: http.ServerResponse): void => {
        // The route is still waiting on its queue when the client leaves.
        res.once("close", (): void => {
          res.statusCode = 200;
          res.end("{}");
          answerLate();
        });
      },
    };

    await new Promise<void>((resolve: () => void): void => {
      const request: http.ClientRequest = http.request({
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/otlp/v1/logs",
      });
      request.on("error", (): void => {
        resolve();
      });
      request.on("close", (): void => {
        resolve();
      });
      request.write("{");
      setTimeout((): void => {
        request.destroy();
      }, 20);
    });
    await watched;
    await answeredLate;
    await settle();

    expect(markUsed()).not.toHaveBeenCalled();
  });
});

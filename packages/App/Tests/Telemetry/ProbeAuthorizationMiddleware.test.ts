import ProbeService from "Common/Server/Services/ProbeService";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
import ProbeKeyHeaders, {
  PROBE_ID_HEADER,
  PROBE_KEY_HEADER,
} from "Common/Types/Probe/ProbeKeyHeaders";
import Dictionary from "Common/Types/Dictionary";
import { ProbeExpressRequest } from "../../FeatureSet/Telemetry/Types/Request";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Regression tests for the probe-auth middleware.
 *
 * This middleware runs on EVERY authenticated probe request — including the
 * /alive heartbeat — so its failure modes decide whether a briefly-starved
 * database turns into probes being flagged Disconnected:
 *
 *   1. It is an ASYNC middleware on Express 4, which ignores the promise a
 *      middleware returns. Before the try/catch wrapped the whole body, any
 *      rejection (pool-acquire timeout, statement timeout) was swallowed and
 *      the request was NEVER answered — the probe client saw the connection
 *      go silent until its own 45s+ timeout fired. Errors must reach
 *      next(err) so Express answers the request.
 *
 *   2. The lastAlive stamp is fire-and-forget. Awaiting it would chain every
 *      probe request's latency — including the heartbeat itself — to
 *      Postgres write latency, which is precisely the coupling that let a
 *      slow database mark healthy probes Disconnected.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    // The middleware imports this named export for log attribution.
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      verifyProbeKey: jest.fn(),
      updateLastAlive: jest.fn(),
    },
  };
});

import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";

type ProbeServiceMock = {
  verifyProbeKey: jest.Mock;
  updateLastAlive: jest.Mock;
};

const probeService: ProbeServiceMock =
  ProbeService as unknown as ProbeServiceMock;

const responseUtil: { sendErrorResponse: jest.Mock } = Response as unknown as {
  sendErrorResponse: jest.Mock;
};

const loggerMock: { error: jest.Mock; warn: jest.Mock } = logger as unknown as {
  error: jest.Mock;
  warn: jest.Mock;
};

const mockResponse: ExpressResponse = {} as ExpressResponse;

type MiddlewareInvocation = {
  req: ProbeExpressRequest;
  next: NextFunction;
  middlewarePromise: Promise<void>;
};

/*
 * Invokes the middleware WITHOUT awaiting it, so tests can observe timing:
 * whether the returned promise settles independently of the promises the
 * middleware kicked off internally.
 */
function callMiddleware(body: JSONObject): MiddlewareInvocation {
  const req: ProbeExpressRequest = { body } as unknown as ProbeExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const middlewarePromise: Promise<void> =
    ProbeAuthorization.isAuthorizedServiceMiddleware(req, mockResponse, next);
  return { req, next, middlewarePromise };
}

describe("ProbeAuthorization.isAuthorizedServiceMiddleware", () => {
  const probeId: ObjectID = ObjectID.generate();
  const probeKey: string = "test-probe-key";

  beforeEach(() => {
    jest.clearAllMocks();
    probeService.verifyProbeKey.mockResolvedValue(true as never);
    probeService.updateLastAlive.mockResolvedValue(undefined as never);
  });

  test("rejects a request with no probeId before touching the service", async () => {
    const { next, middlewarePromise } = callMiddleware({
      probeKey: probeKey,
    });
    await middlewarePromise;

    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
    expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
    expect(probeService.updateLastAlive).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects a request with no probeKey before touching the service", async () => {
    const { next, middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
    });
    await middlewarePromise;

    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
    expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
    expect(probeService.updateLastAlive).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("an invalid probeId/probeKey pair is refused and never stamps liveness", async () => {
    probeService.verifyProbeKey.mockResolvedValue(false as never);

    const { next, middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: "wrong-key",
    });
    await middlewarePromise;

    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
    // A failed authentication must not count as proof of liveness.
    expect(probeService.updateLastAlive).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("a valid pair authenticates, attaches req.probe, and stamps liveness", async () => {
    const { req, next, middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: probeKey,
    });
    await middlewarePromise;

    expect(next).toHaveBeenCalledTimes(1);
    // next() with NO argument — an argument would route to the error handler.
    expect(next).toHaveBeenCalledWith();
    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();

    // Verification goes through the cache-backed check, not a per-request findOneBy.
    expect(probeService.verifyProbeKey).toHaveBeenCalledTimes(1);
    const verifyArgs: { probeId: ObjectID; probeKey: string } = probeService
      .verifyProbeKey.mock.calls[0]![0] as {
      probeId: ObjectID;
      probeKey: string;
    };
    expect(verifyArgs.probeId.toString()).toBe(probeId.toString());
    expect(verifyArgs.probeKey).toBe(probeKey);

    /*
     * Handlers downstream only ever read req.probe.id, and the middleware
     * hands them exactly that — a Probe instance carrying the id — instead
     * of a row fetched from the database.
     */
    expect(req.probe).toBeInstanceOf(Probe);
    expect(req.probe?.id?.toString()).toBe(probeId.toString());

    expect(probeService.updateLastAlive).toHaveBeenCalledTimes(1);
    const stampedId: ObjectID = probeService.updateLastAlive.mock
      .calls[0]![0] as ObjectID;
    expect(stampedId).toBeInstanceOf(ObjectID);
    expect(stampedId.toString()).toBe(probeId.toString());
  });

  /*
   * Postgres reads a uuid in any case, so a probe may send its id
   * upper-cased and still authenticate. Everything after the middleware -
   * the key check's cache and its revocation, the liveness stamp, every
   * handler reading req.probe - sees the one spelling Postgres stores.
   */
  test("an id sent in another case is the probe's one id: checked, stamped and attached lower-cased", async () => {
    const sentId: string = probeId.toString().toUpperCase();

    expect(sentId).not.toBe(probeId.toString());

    const { req, next, middlewarePromise } = callMiddleware({
      probeId: sentId,
      probeKey: probeKey,
    });
    await middlewarePromise;

    expect(next).toHaveBeenCalledWith();

    const verifyArgs: { probeId: ObjectID; probeKey: string } = probeService
      .verifyProbeKey.mock.calls[0]![0] as {
      probeId: ObjectID;
      probeKey: string;
    };
    expect(verifyArgs.probeId.toString()).toBe(probeId.toString());

    const stampedId: ObjectID = probeService.updateLastAlive.mock
      .calls[0]![0] as ObjectID;
    expect(stampedId.toString()).toBe(probeId.toString());

    expect(req.probe?.id?.toString()).toBe(probeId.toString());
  });

  test("an id sent as JSON writes an ObjectID is read the same way", async () => {
    const { req, next, middlewarePromise } = callMiddleware({
      probeId: {
        _type: "ObjectID",
        value: probeId.toString().toUpperCase(),
      },
      probeKey: probeKey,
    });
    await middlewarePromise;

    expect(next).toHaveBeenCalledWith();
    expect(req.probe?.id?.toString()).toBe(probeId.toString());
  });

  /*
   * THE non-blocking pin: the lastAlive stamp must be fire-and-forget. If
   * someone re-introduces an `await` on updateLastAlive, this test hangs on
   * a never-resolving promise and the 500ms timer wins the race — awaiting
   * the stamp re-couples every probe request (including the /alive
   * heartbeat) to Postgres write latency, which is exactly how a slow
   * database marked healthy probes Disconnected.
   */
  test("resolves and calls next() even when the lastAlive write never settles", async () => {
    probeService.updateLastAlive.mockReturnValue(
      new Promise<void>(() => {}) as never,
    );

    const { next, middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: probeKey,
    });

    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const timeout: Promise<string> = new Promise<string>(
      (resolve: (value: string) => void) => {
        timer = setTimeout(() => {
          resolve("timed out");
        }, 500);
      },
    );

    try {
      const winner: string = await Promise.race([
        middlewarePromise.then(() => {
          return "middleware resolved";
        }),
        timeout,
      ]);
      expect(winner).toBe("middleware resolved");
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  /*
   * A failed lastAlive write must not fail the request (the write is
   * throttled and self-healing), and the rejection must be HANDLED: the
   * .catch on the fire-and-forget promise is what keeps an async stamp
   * failure from surfacing as an unhandledRejection. logger.error receiving
   * the error proves the .catch handler observed it.
   */
  test("a lastAlive write failure is logged, not surfaced to the request", async () => {
    const failure: Error = new Error("postgres write failed");
    probeService.updateLastAlive.mockImplementation(() => {
      return new Promise<void>(
        (_resolve: () => void, reject: (err: Error) => void) => {
          setImmediate(() => {
            reject(failure);
          });
        },
      );
    });

    const { next, middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: probeKey,
    });
    await middlewarePromise;

    // The request already proceeded — before the write failure even landed.
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();

    // Let the rejection land and its .catch handler run.
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    expect(loggerMock.error).toHaveBeenCalled();
    const loggedTheError: boolean = loggerMock.error.mock.calls.some(
      (call: Array<unknown>) => {
        return call[0] === failure;
      },
    );
    expect(loggedTheError).toBe(true);

    // The failure never turned into next(err) after the fact.
    expect(next).toHaveBeenCalledTimes(1);
  });

  /*
   * THE silent-hang regression pin. This is an async middleware on Express
   * 4, which ignores the promise a middleware returns: without the
   * try/catch → next(err), a verifyProbeKey rejection (pool-acquire
   * timeout, statement timeout, Redis failure) was swallowed by the
   * process-level unhandledRejection logger and the HTTP request was NEVER
   * answered. The probe client saw a connection that accepted the request
   * and then went silent until its own timeout — the customer-visible 45s+
   * ECONNABORTED hang that got healthy probes flagged Disconnected.
   */
  /*
   * The release the probe says it runs (issue #9759) is kept with its
   * liveness stamp, read from the body of whatever request authenticated:
   * a probe from 17.0.1 on says it on every request, an older one says
   * what it can do and no release, and a probe checking its key as it
   * starts says neither.
   */
  test.each([
    [
      "a probe that says its release",
      {
        probeVersion: "17.0.1",
        probeCapabilities: ["networkDevicePing", "totpCodes"],
      },
      { isReported: true, version: "17.0.1" },
    ],
    [
      "a probe older than 17.0.1, which says what it can do and no release",
      { probeCapabilities: ["networkDevicePing", "retryWhenBusy"] },
      { isReported: true, version: null },
    ],
    [
      "a probe built without a release version",
      { probeVersion: "unknown", probeCapabilities: ["totpCodes"] },
      { isReported: true, version: "unknown" },
    ],
    [
      "a probe checking its key as it starts",
      {},
      {
        isReported: false,
        version: null,
      },
    ],
  ])(
    "stamps %s with what its request says of its release",
    async (_label: string, extra: JSONObject, expected: unknown) => {
      const { next, middlewarePromise } = callMiddleware({
        probeId: probeId.toString(),
        probeKey: probeKey,
        ...extra,
      });
      await middlewarePromise;

      expect(next).toHaveBeenCalledWith();
      expect(probeService.updateLastAlive).toHaveBeenCalledTimes(1);
      expect(probeService.updateLastAlive.mock.calls[0]![1]).toEqual(expected);
    },
  );

  test("a request refused for its key stamps no release", async () => {
    probeService.verifyProbeKey.mockResolvedValue(false as never);

    const { middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: "a wrong key",
      probeVersion: "17.0.1",
      probeCapabilities: ["totpCodes"],
    });
    await middlewarePromise;

    expect(probeService.updateLastAlive).not.toHaveBeenCalled();
  });

  test("a verifyProbeKey rejection reaches next(err) so the request is answered", async () => {
    const boom: Error = new Error("pool acquire timeout");
    probeService.verifyProbeKey.mockRejectedValue(boom as never);

    const { next, middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: probeKey,
    });
    await middlewarePromise;

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
    expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    expect(probeService.updateLastAlive).not.toHaveBeenCalled();
  });
});

/*
 * The other half of diagnosing a Disconnected probe. The probe's own log can
 * prove a request left the machine and got no answer; only the server can
 * say whether it ever produced one. Without these two lines, "the probe timed
 * out" is an unfalsifiable claim about whose fault it is.
 */
describe("server-side timing of probe requests", () => {
  const probeId: ObjectID = ObjectID.generate();
  const probeKey: string = "test-probe-key";

  type ResponseListeners = Record<string, Array<() => void>>;

  function callMiddlewareWithEmitterResponse(): {
    listeners: ResponseListeners;
    middlewarePromise: Promise<void>;
  } {
    const listeners: ResponseListeners = {};

    const res: ExpressResponse = {
      on: (event: string, listener: () => void): void => {
        listeners[event] = [...(listeners[event] || []), listener];
      },
    } as unknown as ExpressResponse;

    const req: ProbeExpressRequest = {
      body: { probeId: probeId.toString(), probeKey: probeKey },
      url: "/alive",
    } as unknown as ProbeExpressRequest;

    return {
      listeners: listeners,
      middlewarePromise: ProbeAuthorization.isAuthorizedServiceMiddleware(
        req,
        res,
        jest.fn() as unknown as NextFunction,
      ),
    };
  }

  function fire(listeners: ResponseListeners, event: string): void {
    for (const listener of listeners[event] || []) {
      listener();
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    probeService.verifyProbeKey.mockResolvedValue(true as never);
    probeService.updateLastAlive.mockResolvedValue(undefined as never);
  });

  test("a request answered promptly is not logged", async () => {
    const { listeners, middlewarePromise } =
      callMiddlewareWithEmitterResponse();
    await middlewarePromise;

    fire(listeners, "finish");
    // 'close' always follows 'finish' on a normal response.
    fire(listeners, "close");

    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  test("a probe that hangs up before the response is sent is called out by id", async () => {
    const { listeners, middlewarePromise } =
      callMiddlewareWithEmitterResponse();
    await middlewarePromise;

    // 'close' with no preceding 'finish': the probe hit its own deadline.
    fire(listeners, "close");

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const message: string = String(loggerMock.warn.mock.calls[0]![0]);
    expect(message).toContain(probeId.toString());
    expect(message).toContain("/alive");
  });

  test("a bare response object — as unit tests supply — is not listened to", async () => {
    const { middlewarePromise } = callMiddleware({
      probeId: probeId.toString(),
      probeKey: probeKey,
    });

    // mockResponse has no .on; attaching listeners to it would throw.
    await expect(middlewarePromise).resolves.toBeUndefined();
  });
});

/*
 * A collection's key, checked before its report is parsed (#10222). A
 * vCenter's or an OpenStack cloud's collection is millions of JSON values,
 * so its key is checked first from the request's headers, then - for an
 * older probe that sends none - from the id and key its report opens with,
 * and only then is the report parsed. Every one of those checks is the same
 * check a body's key gets: the same lookup, the same refusals.
 */
describe("a collection's key, before its report is parsed", () => {
  const probeId: ObjectID = ObjectID.generate();
  const probeKey: string = "pr0be-(key)!*~ clé 東京 ";

  type Middleware = (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;

  async function run(
    middleware: Middleware,
    req: Dictionary<unknown>,
  ): Promise<{ req: ProbeExpressRequest; next: jest.Mock }> {
    const request: ProbeExpressRequest = {
      headers: {},
      ...req,
    } as unknown as ProbeExpressRequest;
    const next: jest.Mock = jest.fn();

    await middleware(request, mockResponse, next as unknown as NextFunction);

    return { req: request, next: next };
  }

  function sentError(): Error {
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
    return responseUtil.sendErrorResponse.mock.calls[0]![2] as Error;
  }

  // A report's bytes as every probe release writes them: key and id first.
  function reportBytes(key: string, id: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        probeKey: key,
        probeId: id,
        probeCapabilities: ["networkDevicePing"],
        status: "Succeeded",
        resourceMetrics: [],
      }),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    probeService.verifyProbeKey.mockResolvedValue(true as never);
    probeService.updateLastAlive.mockResolvedValue(undefined as never);
  });

  describe("from its headers", () => {
    test("a request with neither header goes on untouched: an older probe's key is in its body", async () => {
      const { req, next } = await run(
        ProbeAuthorization.isAuthorizedFromHeadersMiddleware,
        { headers: { "content-encoding": "gzip" } },
      );

      expect(next).toHaveBeenCalledWith();
      expect(req.probe).toBeUndefined();
      expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    });

    test("the id and key in the headers are checked as a body's are, and make the request the probe's", async () => {
      const { req, next } = await run(
        ProbeAuthorization.isAuthorizedFromHeadersMiddleware,
        {
          headers: ProbeKeyHeaders.build({
            probeId: probeId.toString().toUpperCase(),
            probeKey: probeKey,
          }),
        },
      );

      expect(next).toHaveBeenCalledWith();
      expect(req.probe).toBeInstanceOf(Probe);
      expect(req.probe?.id?.toString()).toBe(probeId.toString());

      // The key as the probe set it, decoded from the header.
      const verifyArgs: { probeId: ObjectID; probeKey: string } = probeService
        .verifyProbeKey.mock.calls[0]![0] as {
        probeId: ObjectID;
        probeKey: string;
      };
      expect(verifyArgs.probeId.toString()).toBe(probeId.toString());
      expect(verifyArgs.probeKey).toBe(probeKey);

      // Alive, with no release: the body that says it is unread.
      expect(probeService.updateLastAlive).toHaveBeenCalledTimes(1);
      expect(probeService.updateLastAlive.mock.calls[0]![1]).toBeUndefined();
    });

    test("a wrong key in the headers is refused as one in a body is, and the request goes no further", async () => {
      probeService.verifyProbeKey.mockResolvedValue(false as never);

      const { req, next } = await run(
        ProbeAuthorization.isAuthorizedFromHeadersMiddleware,
        {
          headers: ProbeKeyHeaders.build({
            probeId: probeId.toString(),
            probeKey: "a-wrong-key",
          }),
        },
      );

      expect(next).not.toHaveBeenCalled();
      expect(sentError()).toBeInstanceOf(BadDataException);
      expect(sentError().message).toBe("Invalid Probe ID or Probe Key");
      expect(req.probe).toBeUndefined();
      expect(probeService.updateLastAlive).not.toHaveBeenCalled();
    });

    test.each([
      [
        "only the id",
        { [PROBE_ID_HEADER]: "11111111-1111-4111-8111-111111111111" },
      ],
      ["only the key", { [PROBE_KEY_HEADER]: "a-key" }],
      [
        "an empty key",
        {
          [PROBE_ID_HEADER]: "11111111-1111-4111-8111-111111111111",
          [PROBE_KEY_HEADER]: "",
        },
      ],
      [
        "a key that is no URI-encoded text",
        {
          [PROBE_ID_HEADER]: "11111111-1111-4111-8111-111111111111",
          [PROBE_KEY_HEADER]: "%E0%A4%A",
        },
      ],
    ])(
      "%s is refused as a body without both is, before anything is looked up",
      async (_what: string, headers: Dictionary<string>) => {
        const { next } = await run(
          ProbeAuthorization.isAuthorizedFromHeadersMiddleware,
          { headers: headers },
        );

        expect(next).not.toHaveBeenCalled();
        expect(sentError().message).toBe("ProbeId or ProbeKey is missing");
        expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
      },
    );

    test("a lookup that fails reaches next(err), so the request is answered", async () => {
      const boom: Error = new Error("pool acquire timeout");
      probeService.verifyProbeKey.mockRejectedValue(boom as never);

      const { next } = await run(
        ProbeAuthorization.isAuthorizedFromHeadersMiddleware,
        {
          headers: ProbeKeyHeaders.build({
            probeId: probeId.toString(),
            probeKey: probeKey,
          }),
        },
      );

      expect(next).toHaveBeenCalledWith(boom);
    });
  });

  describe("from the id and key its report opens with", () => {
    test("bytes that open with them are checked before they are parsed, and make the request the probe's", async () => {
      const jsonParse: ReturnType<typeof jest.spyOn> = jest.spyOn(
        JSON,
        "parse",
      );

      try {
        const { req, next } = await run(
          ProbeAuthorization.isAuthorizedFromReportOpeningMiddleware,
          { body: reportBytes(probeKey, probeId.toString()) },
        );

        expect(next).toHaveBeenCalledWith();
        expect(req.probe?.id?.toString()).toBe(probeId.toString());
        expect(jsonParse).not.toHaveBeenCalled();
      } finally {
        jsonParse.mockRestore();
      }

      const verifyArgs: { probeId: ObjectID; probeKey: string } = probeService
        .verifyProbeKey.mock.calls[0]![0] as {
        probeId: ObjectID;
        probeKey: string;
      };
      expect(verifyArgs.probeKey).toBe(probeKey);
      expect(probeService.updateLastAlive.mock.calls[0]![1]).toBeUndefined();
    });

    test("a wrong key there is refused as one in a parsed body is", async () => {
      probeService.verifyProbeKey.mockResolvedValue(false as never);

      const { req, next } = await run(
        ProbeAuthorization.isAuthorizedFromReportOpeningMiddleware,
        { body: reportBytes("an-old-key", probeId.toString()) },
      );

      expect(next).not.toHaveBeenCalled();
      expect(sentError().message).toBe("Invalid Probe ID or Probe Key");
      expect(req.probe).toBeUndefined();
    });

    test("a request its headers authenticated is not checked again", async () => {
      const probe: Probe = new Probe();
      probe.id = probeId;

      const { next } = await run(
        ProbeAuthorization.isAuthorizedFromReportOpeningMiddleware,
        {
          probe: probe,
          body: reportBytes("whatever the report says", "someone else"),
        },
      );

      expect(next).toHaveBeenCalledWith();
      expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
    });

    test.each([
      [
        "bytes that open with another member",
        Buffer.from('{"status":"Failed","probeKey":"k","probeId":"i"}'),
      ],
      ["bytes that are no object", Buffer.from("[{},{}]")],
      [
        "a body parsed already",
        { probeKey: probeKey, probeId: probeId.toString() },
      ],
      ["no body", undefined],
    ])(
      "%s: the request goes on unauthenticated, to be parsed under a large route's limit",
      async (_what: string, body: unknown) => {
        const { req, next } = await run(
          ProbeAuthorization.isAuthorizedFromReportOpeningMiddleware,
          { body: body },
        );

        expect(next).toHaveBeenCalledWith();
        expect(req.probe).toBeUndefined();
        expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
        expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
      },
    );
  });

  describe("once its report is parsed", () => {
    test("a request authenticated before is not checked again from its body", async () => {
      const probe: Probe = new Probe();
      probe.id = probeId;

      const { req, next } = await run(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
        {
          probe: probe,
          // What the body says names nobody: the request is the probe's already.
          body: { probeId: ObjectID.generate().toString(), probeKey: "x" },
        },
      );

      expect(next).toHaveBeenCalledWith();
      expect(req.probe).toBe(probe);
      expect(probeService.verifyProbeKey).not.toHaveBeenCalled();
      expect(probeService.updateLastAlive).not.toHaveBeenCalled();
    });

    test("and is timed from there, as every probe request is", async () => {
      const probe: Probe = new Probe();
      probe.id = probeId;

      const listeners: Record<string, Array<() => void>> = {};
      const res: ExpressResponse = {
        on: (event: string, listener: () => void): void => {
          listeners[event] = [...(listeners[event] || []), listener];
        },
      } as unknown as ExpressResponse;

      await ProbeAuthorization.isAuthorizedServiceMiddleware(
        {
          probe: probe,
          body: {},
          url: "/probe/vmware/collection",
        } as unknown as ProbeExpressRequest,
        res,
        jest.fn() as unknown as NextFunction,
      );

      // The probe hung up before an answer: called out by its id.
      for (const listener of listeners["close"] || []) {
        listener();
      }

      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      expect(String(loggerMock.warn.mock.calls[0]![0])).toContain(
        probeId.toString(),
      );
    });

    test("a request no earlier check authenticated is checked from its body, as every probe route's is", async () => {
      const { req, next } = await run(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
        { body: { probeId: probeId.toString(), probeKey: probeKey } },
      );

      expect(next).toHaveBeenCalledWith();
      expect(req.probe?.id?.toString()).toBe(probeId.toString());
      expect(probeService.verifyProbeKey).toHaveBeenCalledTimes(1);
    });
  });
});

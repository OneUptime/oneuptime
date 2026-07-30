import ProbeService from "Common/Server/Services/ProbeService";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ExpressResponse, NextFunction } from "Common/Server/Utils/Express";
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

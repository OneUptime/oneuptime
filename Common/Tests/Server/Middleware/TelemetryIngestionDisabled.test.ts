import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

/*
 * The kill switch in front of every telemetry ingestion route.
 *
 * DISABLE_TELEMETRY_INGESTION is the lever an operator pulls when ingest is
 * the thing hurting them - a storage emergency, a runaway tenant, a migration.
 * What it must NOT do is make the senders angrier. An OTel collector, a Fluent
 * forwarder, a Pyroscope agent and a syslog shipper all treat a 5xx (and most
 * 4xx) as "retry with backoff, keep the batch", so refusing the data with an
 * error turns one disabled instance into a retry storm that outlives the
 * outage and fills the sender's own disk. 200 with an empty body is the one
 * answer every client accepts and forgets, which is why the data is dropped
 * on the floor behind a success rather than rejected.
 *
 * The other half is that the short-circuit happens HERE, before anything
 * parses a body or touches a queue. A middleware that called next() and let a
 * later handler answer would still pay for the payload it intends to discard.
 */

const HTTP_OK: number = 200;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    DisableTelemetryIngestion: false,
  };
});

import TelemetryIngestionDisabled from "../../../Server/Middleware/TelemetryIngestionDisabled";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";

interface MutableEnvironment {
  DisableTelemetryIngestion: boolean;
}

const environment: MutableEnvironment =
  EnvironmentConfig as unknown as MutableEnvironment;

/*
 * The middleware reads the flag through the module object on every call, so
 * flipping it here is what a restart with a different env would look like.
 */
const setIngestionDisabled: (disabled: boolean) => void = (
  disabled: boolean,
): void => {
  environment.DisableTelemetryIngestion = disabled;
};

interface MockedResponse {
  res: ExpressResponse;
  captured: CapturedResponse;
}

interface CapturedResponse {
  statusCode: number | null;
  body: unknown;
  sendCount: number;
}

const makeResponse: () => MockedResponse = (): MockedResponse => {
  const captured: CapturedResponse = {
    statusCode: null,
    body: undefined,
    sendCount: 0,
  };

  const res: Partial<ExpressResponse> = {
    status: (code: number): ExpressResponse => {
      captured.statusCode = code;
      return res as ExpressResponse;
    },
    send: (body?: unknown): ExpressResponse => {
      captured.body = body;
      captured.sendCount++;
      return res as ExpressResponse;
    },
  };

  return { res: res as ExpressResponse, captured };
};

const makeRequest: () => ExpressRequest = (): ExpressRequest => {
  return {
    method: "POST",
    url: "/otlp/v1/traces",
    headers: {},
  } as unknown as ExpressRequest;
};

describe("TelemetryIngestionDisabled", () => {
  beforeEach(() => {
    setIngestionDisabled(false);
  });

  describe("when ingestion is enabled (the default)", () => {
    test("hands the request on untouched", () => {
      const { res, captured } = makeResponse();
      let nextCalls: number = 0;

      const next: NextFunction = ((): void => {
        nextCalls++;
      }) as unknown as NextFunction;

      TelemetryIngestionDisabled.middleware(makeRequest(), res, next);

      expect(nextCalls).toBe(1);
      expect(captured.sendCount).toBe(0);
      expect(captured.statusCode).toBeNull();
    });

    test("isDisabled reports false", () => {
      expect(TelemetryIngestionDisabled.isDisabled()).toBe(false);
    });
  });

  describe("when ingestion is disabled", () => {
    beforeEach(() => {
      setIngestionDisabled(true);
    });

    test("answers 200 rather than an error, so senders do not retry", () => {
      /*
       * The single most important assertion in this file. A 503 here is what
       * turns a deliberate pause into a retry storm across every collector
       * pointed at this instance.
       */
      const { res, captured } = makeResponse();

      TelemetryIngestionDisabled.middleware(
        makeRequest(),
        res,
        (() => {}) as unknown as NextFunction,
      );

      expect(captured.statusCode).toBe(HTTP_OK);
    });

    test("answers with an empty body", () => {
      const { res, captured } = makeResponse();

      TelemetryIngestionDisabled.middleware(
        makeRequest(),
        res,
        (() => {}) as unknown as NextFunction,
      );

      expect(captured.body).toEqual({});
    });

    test("does not call next, so nothing downstream parses or queues the payload", () => {
      let nextCalls: number = 0;
      const { res } = makeResponse();

      TelemetryIngestionDisabled.middleware(makeRequest(), res, ((): void => {
        nextCalls++;
      }) as unknown as NextFunction);

      expect(nextCalls).toBe(0);
    });

    test("answers exactly once", () => {
      const { res, captured } = makeResponse();

      TelemetryIngestionDisabled.middleware(
        makeRequest(),
        res,
        (() => {}) as unknown as NextFunction,
      );

      expect(captured.sendCount).toBe(1);
    });

    test("isDisabled reports true, for the non-HTTP ingest paths", () => {
      /*
       * MqttServer has no middleware chain to sit in, so it asks this
       * directly. The flag and the middleware must agree.
       */
      expect(TelemetryIngestionDisabled.isDisabled()).toBe(true);
    });
  });

  test("the flag is read per request, not captured once at import", () => {
    /*
     * Both directions, in one test: the middleware must follow the current
     * value rather than whatever it was when the module loaded.
     */
    const first: MockedResponse = makeResponse();
    let nextCalls: number = 0;
    const next: NextFunction = ((): void => {
      nextCalls++;
    }) as unknown as NextFunction;

    TelemetryIngestionDisabled.middleware(makeRequest(), first.res, next);
    expect(nextCalls).toBe(1);

    setIngestionDisabled(true);

    const second: MockedResponse = makeResponse();
    TelemetryIngestionDisabled.middleware(makeRequest(), second.res, next);

    expect(nextCalls).toBe(1);
    expect(second.captured.statusCode).toBe(HTTP_OK);
  });
});

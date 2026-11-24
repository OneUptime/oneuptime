jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import ClientRefusalLog from "../../../Server/Utils/ClientRefusalLog";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import StartServer from "../../../Server/Utils/StartServer";
import Telemetry, { TelemetryCounter } from "../../../Server/Utils/Telemetry";
import CaptureSpan from "../../../Server/Utils/Telemetry/CaptureSpan";
import TelemetryContext from "../../../Server/Utils/Telemetry/TelemetryContext";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServerException from "../../../Types/Exception/ServerException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";
import {
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../../Types/Telemetry/UnitOfWork";
import {
  SpanStatusCode,
  clearExportedSpans,
  getExportedSpans,
  startExportingSpans,
  stopExportingSpans,
} from "../../Helpers/ExportedSpans";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  BodyServer,
  SentRequest,
  sendOverHttp,
  startBodyServer,
} from "../TestingUtils/RequestBodyOverHttp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ReadableSpan } from "@opentelemetry/sdk-trace-base";

/*
 * A CLIENT'S REFUSAL THROWN INSIDE A REQUEST WRITES NO LINE, WITH TRACES
 * EXPORTED (#10797).
 *
 * Through StartServer's own middleware - as every OneUptime service mounts
 * it, with its request scope, default routes and error handler - the real
 * logger and a real HTTP client, while OneUptime exports its own traces
 * (@CaptureSpan creates no span, and records nothing, otherwise). A route
 * calls a decorated method that throws, as a service throws
 * BadDataException or a permission check NotAuthorizedException, and
 * answers what it threw. The request's answer logs a client's refusal at
 * debug and counts it by route (ClientRefusalLog, #10768), but the
 * recorder also handed the thrown value to logger.error: a WARN-severity
 * line under the ERROR gate for every refused request, from anyone. What
 * reaches the console is counted at each level an operator can set:
 *
 *   - ERROR (config.example.env's): a burst of refusals writes nothing; a
 *     fault of the server's writes its error lines, as before;
 *   - WARN and INFO: one warn line a route and status a minute, the
 *     answer's, and none of the recorder's;
 *   - DEBUG: the recorder's debug line and the answer's, for each.
 *
 * The span keeps its `fault` event, and oneuptime.fault.count counts it.
 */

jest.setTimeout(120000);

const REFUSALS: Record<number, () => Exception> = {
  400: (): Exception => {
    return new BadDataException("The query is malformed.");
  },
  401: (): Exception => {
    return new NotAuthenticatedException("Your session has expired.");
  },
  403: (): Exception => {
    return new ForbiddenException("You may not see this project.");
  },
  404: (): Exception => {
    return new NotFoundException("This monitor does not exist.");
  },
  422: (): Exception => {
    return new NotAuthorizedException("This key has been disabled.");
  },
  429: (): Exception => {
    return new TooManyRequestsException(
      "Too many wrong keys. Try again later.",
    );
  },
};

const STATUSES: Array<number> = Object.keys(REFUSALS).map(Number);

const REFUSAL_WORDS: Array<string> = STATUSES.map((status: number): string => {
  return REFUSALS[status]!().message;
});

interface Fault {
  status: number;
  make: () => unknown;
}

// Faults of the server's, thrown the same way: each stays at error.
const FAULTS: Record<string, Fault> = {
  "type-error": {
    status: 500,
    make: (): unknown => {
      return new TypeError(
        "Cannot read properties of undefined (reading 'id')",
      );
    },
  },
  "server-exception": {
    status: 500,
    make: (): unknown => {
      return new ServerException("The queue did not take the job.");
    },
  },
  // 408, and the server's infrastructure.
  timeout: {
    status: 408,
    make: (): unknown => {
      return new TimeoutException("The SMTP server did not answer.");
    },
  },
  // A 4xx no class declares the client's: a defect.
  "base-exception-4xx": {
    status: 404,
    make: (): unknown => {
      return new Exception(ExceptionCode.NotFoundException, "No such row.");
    },
  },
  "declared-code-fault": {
    status: 400,
    make: (): unknown => {
      return new BadDataException("An invariant broke.").asCodeFault();
    },
  },
};

/*
 * A client's class, refused in a way the answer does not take for a
 * client's: it stays under logger.error (at WARN severity), as before.
 */
const UNEXPLAINED: Record<string, Fault> = {
  "no-words": {
    status: 400,
    make: (): unknown => {
      return new BadDataException("");
    },
  },
  "declared-user-error-5xx": {
    status: 500,
    make: (): unknown => {
      return new ServerException("Declared wrongly.").asUserError();
    },
  },
};

/*
 * A service that throws, as one does deep in a request: the value crosses
 * two decorated frames, and is recorded on the inner one.
 */
class RefusingService {
  @CaptureSpan()
  public static async lookUp(make: () => unknown): Promise<void> {
    await Promise.resolve();
    throw make();
  }

  @CaptureSpan()
  public static async handle(make: () => unknown): Promise<void> {
    await RefusingService.lookUp(make);
  }
}

interface Counted {
  error: number;
  warn: Array<string>;
  info: number;
  debugRefusals: number;
}

let consoleSpies: Record<string, ReturnType<typeof jest.spyOn>> = {};

const callsOf: (method: string) => Array<Array<unknown>> = (
  method: string,
): Array<Array<unknown>> => {
  return consoleSpies[method]!.mock.calls as Array<Array<unknown>>;
};

// A console line's text: an Exception arrives as the logger copies it to redact it.
const lineOf: (call: Array<unknown>) => string = (
  call: Array<unknown>,
): string => {
  if (call[0] instanceof Error) {
    return call[0].message;
  }

  return typeof call[0] === "string" ? call[0] : JSON.stringify(call[0]);
};

const counted: () => Counted = (): Counted => {
  return {
    error: callsOf("error").length,
    warn: callsOf("warn").map(lineOf),
    info: callsOf("info").length,
    debugRefusals: callsOf("debug").filter((call: Array<unknown>): boolean => {
      const line: string = lineOf(call);

      return REFUSAL_WORDS.some((words: string): boolean => {
        return Boolean(line) && line.includes(words);
      });
    }).length,
  };
};

// oneuptime.fault.count's increments, by error.class.
const faultCounts: Array<string> = [];

let server: BodyServer;

beforeAll(async () => {
  startExportingSpans();

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  app.post(
    "/decorated/answered/:status",
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      try {
        await RefusingService.handle(REFUSALS[Number(req.params["status"])]!);
        res.json({});
      } catch (err) {
        Response.sendErrorResponse(req, res, err as Exception);
      }
    },
  );
  app.post(
    "/decorated/handed-on/:status",
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      RefusingService.handle(REFUSALS[Number(req.params["status"])]!)
        .then((): void => {
          res.json({});
        })
        .catch(next);
    },
  );
  app.post(
    "/decorated/fault/:kind",
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
      const kind: string = String(req.params["kind"]);

      RefusingService.handle((FAULTS[kind] || UNEXPLAINED[kind])!.make)
        .then((): void => {
          res.json({});
        })
        .catch(next);
    },
  );

  await StartServer.addDefaultRoutes();

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
  stopExportingSpans();
});

beforeEach(() => {
  ClientRefusalLog.counter.clear();
  clearExportedSpans();
  faultCounts.length = 0;
  consoleSpies = {};

  for (const method of ["error", "warn", "info", "debug", "trace"] as const) {
    consoleSpies[method] = jest
      .spyOn(console, method)
      .mockImplementation((): void => {});
  }

  // OneUptime exports its own traces: @CaptureSpan makes and records spans.
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);

  // oneuptime.fault.count, made afresh through the spy.
  (Telemetry as unknown as { faultCounter: unknown }).faultCounter = null;
  jest.spyOn(Telemetry, "getCounter").mockImplementation(((data: {
    name: string;
  }): TelemetryCounter => {
    return {
      add: (_value: number, attributes?: Record<string, unknown>): void => {
        if (data.name === "oneuptime.fault.count") {
          faultCounts.push(String(attributes?.["error.class"]));
        }
      },
    } as unknown as TelemetryCounter;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (Telemetry as unknown as { faultCounter: unknown }).faultCounter = null;
});

const setLogLevel: (level: ConfigLogLevel) => void = (
  level: ConfigLogLevel,
): void => {
  jest.spyOn(logger, "getLogLevel").mockReturnValue(level);
};

interface Refused {
  path: string;
  status: number;
  // The route and status the answer counts it under.
  key: string;
}

// A burst of refusals, drawn: answered by the route, or handed on.
const drawBurst: (random: SeededRandom, size: number) => Array<Refused> = (
  random: SeededRandom,
  size: number,
): Array<Refused> => {
  return Array.from({ length: size }, (): Refused => {
    const status: number = STATUSES[random(STATUSES.length)]!;

    return random(2) === 0
      ? {
          path: `/decorated/answered/${status}`,
          status: status,
          key: `POST /decorated/answered/:status ${status}`,
        }
      : {
          path: `/decorated/handed-on/${status}`,
          status: status,
          key: `POST /decorated/handed-on/:status ${status}`,
        };
  });
};

const send: (path: string) => Promise<SentRequest> = (
  path: string,
): Promise<SentRequest> => {
  return sendOverHttp(server, {
    path: path,
    headers: { "content-type": "application/json" },
    body: Buffer.from("{}"),
  });
};

const sendBurst: (
  burst: Array<Refused>,
) => Promise<Array<SentRequest>> = async (
  burst: Array<Refused>,
): Promise<Array<SentRequest>> => {
  const sent: Array<SentRequest> = [];

  for (const refused of burst) {
    sent.push(await send(refused.path));
  }

  return sent;
};

// The spans of the decorated frame that threw, in the order they ended.
const throwingSpans: () => Array<ReadableSpan> = (): Array<ReadableSpan> => {
  return getExportedSpans().filter((span: ReadableSpan): boolean => {
    return span.name === "RefusingService.lookUp";
  });
};

const eventNames: (span: ReadableSpan) => Array<string> = (
  span: ReadableSpan,
): Array<string> => {
  return span.events.map((event: { name: string }): string => {
    return event.name;
  });
};

describe("a burst of client refusals thrown in decorated methods, with traces exported", () => {
  test("at LOG_LEVEL=ERROR, the default, writes not a line, and every refusal is answered as before", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    const burst: Array<Refused> = drawBurst(seededRandom(10797), 120);
    const sent: Array<SentRequest> = await sendBurst(burst);

    expect(counted()).toEqual({
      error: 0,
      warn: [],
      info: 0,
      debugRefusals: 0,
    });

    sent.forEach((request: SentRequest, index: number): void => {
      const refused: Refused = burst[index]!;
      const words: string = REFUSALS[refused.status]!().message;

      expect({ path: refused.path, answer: request.answer.json }).toEqual({
        path: refused.path,
        answer: refused.path.startsWith("/decorated/answered/")
          ? { message: words }
          : { error: words },
      });
      expect(request.answer.status).toBe(refused.status);
    });
  });

  test("the span keeps its fault event, and oneuptime.fault.count counts each refusal", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    const burst: Array<Refused> = drawBurst(seededRandom(20797), 30);

    await sendBurst(burst);

    const spans: Array<ReadableSpan> = throwingSpans();

    expect(spans).toHaveLength(burst.length);

    for (const span of spans) {
      // A fault event, never an exception event: no Issue, and status left unset.
      expect(eventNames(span)).toEqual(["fault"]);
      expect(span.status.code).toBe(SpanStatusCode.UNSET);
      expect([ErrorClass.UserError, ErrorClass.ExpectedDenial]).toContain(
        span.attributes["error.class"],
      );
    }

    // Once a refusal, however many frames it crossed.
    expect(faultCounts).toHaveLength(burst.length);
    expect(
      faultCounts.every((errorClass: string): boolean => {
        return (
          errorClass === ErrorClass.UserError ||
          errorClass === ErrorClass.ExpectedDenial
        );
      }),
    ).toBe(true);
  });

  test.each([
    ["WARN", ConfigLogLevel.WARN, 30797],
    ["INFO, the Helm chart's", ConfigLogLevel.INFO, 40797],
  ])(
    "at LOG_LEVEL=%s, writes the answer's one warn line for each route and status, and none of the recorder's",
    async (_level: string, level: ConfigLogLevel, seed: number) => {
      setLogLevel(level);

      const burst: Array<Refused> = drawBurst(seededRandom(seed), 60);

      await sendBurst(burst);

      const keys: Array<string> = Array.from(
        new Set(
          burst.map((refused: Refused): string => {
            return refused.key;
          }),
        ),
      );
      const result: Counted = counted();

      expect(result.error).toBe(0);
      expect(result.warn).toHaveLength(keys.length);

      for (const line of result.warn) {
        expect(line).toMatch(/^Refused 1 request from a client \(/);
      }
    },
  );

  test("at LOG_LEVEL=DEBUG, writes the recorder's debug line and the answer's for each refusal, and no error line", async () => {
    setLogLevel(ConfigLogLevel.DEBUG);

    const burst: Array<Refused> = drawBurst(seededRandom(50797), 40);

    await sendBurst(burst);

    expect(counted().error).toBe(0);
    expect(counted().debugRefusals).toBe(2 * burst.length);
  });
});

interface Lines {
  status: number;
  error: number;
  warn: number;
}

/*
 * The console lines one request writes at LOG_LEVEL=ERROR, with traces
 * exported or not. The recorder runs only when they are, so the difference
 * between the two is the recorder's own line, and the rest the answer's.
 */
const linesOf: (path: string, exported: boolean) => Promise<Lines> = async (
  path: string,
  exported: boolean,
): Promise<Lines> => {
  (Telemetry.isSpanExportEnabled as unknown as jest.Mock).mockReturnValue(
    exported,
  );

  for (const spy of Object.values(consoleSpies)) {
    spy.mockClear();
  }

  const sent: SentRequest = await send(path);

  return {
    status: sent.answer.status,
    error: counted().error,
    warn: counted().warn.length,
  };
};

describe("what the recorder itself writes, against the same request with traces not exported", () => {
  test("a client's refusal: nothing, answered or handed on, for every status", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    for (const status of STATUSES) {
      for (const path of [
        `/decorated/answered/${status}`,
        `/decorated/handed-on/${status}`,
      ]) {
        expect({ path, lines: await linesOf(path, true) }).toEqual({
          path,
          lines: await linesOf(path, false),
        });
      }
    }
  });

  test.each(Object.keys(FAULTS))(
    "a fault of the server's (%s): its error line, as before, and an exception event",
    async (kind: string) => {
      setLogLevel(ConfigLogLevel.ERROR);

      const path: string = `/decorated/fault/${kind}`;
      const unexported: Lines = await linesOf(path, false);

      clearExportedSpans();

      const exported: Lines = await linesOf(path, true);

      expect(exported).toEqual({
        ...unexported,
        status: FAULTS[kind]!.status,
        error: unexported.error + 1,
      });
      // The answer logs it at error too.
      expect(unexported.error).toBeGreaterThanOrEqual(1);

      const spans: Array<ReadableSpan> = throwingSpans();

      expect(spans).toHaveLength(1);
      expect(eventNames(spans[0]!)).toEqual(["exception"]);
      expect(spans[0]!.status.code).toBe(SpanStatusCode.ERROR);
    },
  );

  test.each(Object.keys(UNEXPLAINED))(
    "a client's class the answer does not take for a client's refusal (%s): its line under the ERROR gate, as before",
    async (kind: string) => {
      setLogLevel(ConfigLogLevel.ERROR);

      const path: string = `/decorated/fault/${kind}`;
      const unexported: Lines = await linesOf(path, false);
      const exported: Lines = await linesOf(path, true);

      // logger.error, which writes a client's class at WARN severity.
      expect(exported).toEqual({
        ...unexported,
        status: UNEXPLAINED[kind]!.status,
        warn: unexported.warn + 1,
      });
    },
  );
});

/*
 * Outside a request nothing answers a thrown value, so the recorder's line
 * is the only one: kept exactly as it was.
 */
describe("outside a request, with traces exported", () => {
  const runAs: (
    unitOfWork: UnitOfWork,
    make: () => unknown,
  ) => Promise<void> = async (
    unitOfWork: UnitOfWork,
    make: () => unknown,
  ): Promise<void> => {
    await TelemetryContext.runWithContext(
      { [UNIT_OF_WORK_ATTRIBUTE_KEY]: unitOfWork },
      async (): Promise<void> => {
        await RefusingService.handle(make).catch((): void => {});
      },
    );
  };

  test("a client's class thrown in a worker job is a code fault: an error line, at LOG_LEVEL=ERROR", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    await runAs(UnitOfWork.WorkerJob, REFUSALS[400]!);

    expect(counted().error).toBe(1);
    expect(counted().warn).toEqual([]);
    expect(eventNames(throwingSpans()[0]!)).toEqual(["exception"]);
  });

  test("a refusal a site declared a user error, in a probe check, keeps its WARN line under the ERROR gate", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    await runAs(UnitOfWork.ProbeCheck, (): unknown => {
      return new BadDataException(
        "The endpoint we were asked to check refused the connection.",
      ).asUserError();
    });

    expect(counted().error).toBe(0);
    expect(counted().warn).toEqual([
      expect.stringContaining(
        "The endpoint we were asked to check refused the connection.",
      ),
    ]);
    expect(eventNames(throwingSpans()[0]!)).toEqual(["fault"]);
  });
});

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
import AppMetrics from "../../../Server/Utils/Telemetry/AppMetrics";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServerException from "../../../Types/Exception/ServerException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
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

/*
 * A CLIENT'S REFUSALS WRITE NO ERROR LINE, OVER HTTP (#10768).
 *
 * Through StartServer's own middleware - as every OneUptime service mounts
 * it - with its default routes and its error handler, the real logger and a
 * real HTTP client. Every refusal of what a client sent was an error-level
 * line, at the default LOG_LEVEL=ERROR: a client could fill the log sink
 * and raise error alerts, one line a request, by sending what is refused.
 * What reaches the console is counted, at each level an operator can set:
 *
 *   - ERROR (config.example.env's): a burst of refusals writes nothing; a
 *     fault of the server's writes its error line, as before;
 *   - WARN and INFO (the Helm chart's): one warn line a route and status a
 *     minute, with the count;
 *   - DEBUG: a debug line a refusal.
 *
 * Every refused request is still counted by its route and status in the
 * request metrics (http.server.request.count).
 */

jest.setTimeout(120000);

const REFUSALS: Record<number, () => Exception> = {
  400: (): Exception => {
    return new BadDataException("Invalid Probe ID or Probe Key");
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
    return new TooManyRequestsException("Too many wrong keys. Try again later.");
  },
};

const STATUSES: Array<number> = Object.keys(REFUSALS).map(Number);

// The words of every refusal sent here, the default 404's among them.
const REFUSAL_WORDS: Array<string> = [
  ...STATUSES.map((status: number): string => {
    return REFUSALS[status]!().message;
  }),
  "Page not found - /no-such-page/",
];

interface Counted {
  error: number;
  warn: Array<string>;
  info: number;
  debugRefusals: number;
}

let consoleSpies: Record<string, ReturnType<typeof jest.spyOn>> = {};

const counted: () => Counted = (): Counted => {
  const calls: (method: string) => Array<Array<unknown>> = (
    method: string,
  ): Array<Array<unknown>> => {
    return consoleSpies[method]!.mock.calls as Array<Array<unknown>>;
  };

  return {
    error: calls("error").length,
    warn: calls("warn").map((call: Array<unknown>): string => {
      return String(call[0]);
    }),
    info: calls("info").length,
    // A refusal's line: the Exception, as the logger copies it to redact it.
    debugRefusals: calls("debug").filter((call: Array<unknown>): boolean => {
      const line: string =
        call[0] instanceof Error ? call[0].message : JSON.stringify(call[0]);

      return REFUSAL_WORDS.some((words: string): boolean => {
        return Boolean(line) && line.includes(words);
      });
    }).length,
  };
};

// Every request the metrics counted: its route and status.
const metered: Array<{ route: string; status: number }> = [];

let server: BodyServer;

beforeAll(async () => {
  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  app.post(
    "/client-refusals/answered/:status",
    (req: ExpressRequest, res: ExpressResponse) => {
      Response.sendErrorResponse(
        req,
        res,
        REFUSALS[Number(req.params["status"])]!(),
      );
    },
  );
  app.post(
    "/client-refusals/handed-on/:status",
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
      next(REFUSALS[Number(req.params["status"])]!());
    },
  );
  app.post(
    "/server-faults/answered",
    (req: ExpressRequest, res: ExpressResponse) => {
      Response.sendErrorResponse(
        req,
        res,
        new ServerException("The queue did not take the job."),
      );
    },
  );
  app.post(
    "/server-faults/handed-on",
    (_req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
      next(new TypeError("Cannot read properties of undefined (reading 'id')"));
    },
  );
  app.post(
    "/server-faults/timed-out",
    (_req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
      next(new TimeoutException("The SMTP server did not answer."));
    },
  );

  // Every other path is the 404 a scanner gets, and the error handler last.
  await StartServer.addDefaultRoutes();

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  ClientRefusalLog.counter.clear();
  metered.length = 0;

  consoleSpies = {};

  for (const method of ["error", "warn", "info", "debug", "trace"] as const) {
    consoleSpies[method] = jest
      .spyOn(console, method)
      .mockImplementation((): void => {});
  }

  jest.spyOn(AppMetrics, "getHttpRequestCounter").mockReturnValue({
    add: (_value: number, attributes: Record<string, string | number>): void => {
      metered.push({
        route: String(attributes["http.route"]),
        status: Number(attributes["http.response.status_code"]),
      });
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const setLogLevel: (level: ConfigLogLevel) => void = (
  level: ConfigLogLevel,
): void => {
  jest.spyOn(logger, "getLogLevel").mockReturnValue(level);
};

interface Refused {
  path: string;
  status: number;
  // The route and status a refusal is counted under.
  key: string;
}

// A burst of refusals, drawn: answered, handed on, and paths nothing answers.
const drawBurst: (random: SeededRandom, size: number) => Array<Refused> = (
  random: SeededRandom,
  size: number,
): Array<Refused> => {
  return Array.from({ length: size }, (): Refused => {
    const kind: number = random(3);
    const status: number = STATUSES[random(STATUSES.length)]!;

    if (kind === 0) {
      return {
        path: `/client-refusals/answered/${status}`,
        status: status,
        key: `POST /client-refusals/answered/:status ${status}`,
      };
    }

    if (kind === 1) {
      return {
        path: `/client-refusals/handed-on/${status}`,
        status: status,
        key: `POST /client-refusals/handed-on/:status ${status}`,
      };
    }

    return {
      path: `/no-such-page/${random(1000000)}`,
      status: 404,
      key: "POST * 404",
    };
  });
};

const sendBurst: (burst: Array<Refused>) => Promise<Array<SentRequest>> =
  async (burst: Array<Refused>): Promise<Array<SentRequest>> => {
    const sent: Array<SentRequest> = [];

    for (const refused of burst) {
      sent.push(
        await sendOverHttp(server, {
          path: refused.path,
          headers: { "content-type": "application/json" },
          body: Buffer.from("{}"),
        }),
      );
    }

    return sent;
  };

describe("a burst of refusals from clients", () => {
  test("at LOG_LEVEL=ERROR, the default, writes not a line, and every refusal is answered as before", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    const burst: Array<Refused> = drawBurst(seededRandom(10768), 120);
    const sent: Array<SentRequest> = await sendBurst(burst);

    expect(counted()).toEqual({
      error: 0,
      warn: [],
      info: 0,
      debugRefusals: 0,
    });

    // The answers a client reads are the ones it always got.
    sent.forEach((request: SentRequest, index: number): void => {
      const refused: Refused = burst[index]!;

      expect({ path: refused.path, status: request.answer.status }).toEqual({
        path: refused.path,
        status: refused.status,
      });
      expect(request.answer.json).toEqual(
        refused.path.startsWith("/client-refusals/answered/")
          ? { message: REFUSALS[refused.status]!().message }
          : refused.path.startsWith("/client-refusals/handed-on/")
            ? { error: REFUSALS[refused.status]!().message }
            : { message: `Page not found - ${refused.path}` },
      );
    });
  });

  test("at LOG_LEVEL=WARN, writes one warn line for each route and status, with the count, and no error line", async () => {
    setLogLevel(ConfigLogLevel.WARN);

    const burst: Array<Refused> = drawBurst(seededRandom(20768), 120);

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

    for (const key of keys) {
      expect({
        key,
        lines: result.warn.filter((line: string): boolean => {
          return line.startsWith(
            `Refused 1 request from a client (${key}) with "`,
          );
        }).length,
      }).toEqual({ key, lines: 1 });
    }

    // The rest of the minute is counted, for the next line.
    const held: Record<string, number> = Object.fromEntries(
      ClientRefusalLog.counter.getCounts(),
    );

    expect(
      Object.values(held).reduce((sum: number, count: number): number => {
        return sum + count;
      }, 0),
    ).toBe(burst.length - keys.length);
  });

  test("at LOG_LEVEL=INFO, the Helm chart's, the same: a warn line a route and status, no error line", async () => {
    setLogLevel(ConfigLogLevel.INFO);

    const burst: Array<Refused> = drawBurst(seededRandom(30768), 60);

    await sendBurst(burst);

    expect(counted().error).toBe(0);
    expect(counted().warn).toHaveLength(
      new Set(
        burst.map((refused: Refused): string => {
          return refused.key;
        }),
      ).size,
    );
  });

  test("at LOG_LEVEL=DEBUG, writes a debug line for each refusal, and no error line", async () => {
    setLogLevel(ConfigLogLevel.DEBUG);

    const burst: Array<Refused> = drawBurst(seededRandom(40768), 60);

    await sendBurst(burst);

    expect(counted().error).toBe(0);
    expect(counted().debugRefusals).toBe(burst.length);
  });

  test("is counted, request by request, by its route and status in the request metrics", async () => {
    setLogLevel(ConfigLogLevel.ERROR);

    const burst: Array<Refused> = drawBurst(seededRandom(50768), 60);

    await sendBurst(burst);

    expect(
      metered.map((entry: { route: string; status: number }): string => {
        return `POST ${entry.route} ${entry.status}`;
      }),
    ).toEqual(
      burst.map((refused: Refused): string => {
        return refused.key;
      }),
    );
  });
});

describe("a fault of the server's", () => {
  test.each([
    [
      "answered with a 5xx through sendErrorResponse",
      "/server-faults/answered",
      500,
    ],
    ["handed on as a TypeError", "/server-faults/handed-on", 500],
    [
      "handed on as a TimeoutException, whose 408 is the server's infrastructure",
      "/server-faults/timed-out",
      408,
    ],
  ])(
    "%s is written at error, at LOG_LEVEL=ERROR",
    async (_what: string, path: string, status: number) => {
      setLogLevel(ConfigLogLevel.ERROR);

      const sent: SentRequest = await sendOverHttp(server, {
        path: path,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
      });

      expect(sent.answer.status).toBe(status);
      expect(counted().error).toBeGreaterThanOrEqual(1);
      expect(counted().warn).toEqual([]);
    },
  );
});

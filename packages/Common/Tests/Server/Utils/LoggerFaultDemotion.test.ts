import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";
import {
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../../Types/Telemetry/UnitOfWork";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import ServerException from "../../../Types/Exception/ServerException";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE LOG HALF OF FAULT CLASSIFICATION.
 *
 * A log record goes to three places and they must be reasoned about
 * separately: process stdout, the in-memory ring buffer the master-admin
 * support bundle reads back, and the OpenTelemetry log exporter. The whole
 * point of the demotion is that it changes only the THIRD one's severity —
 * an operator staring at `docker logs` must still see "SMS notifications are
 * not enabled for this project", because that line is how they discover a
 * tenant misconfiguration.
 */

interface EmittedRecord {
  body: string;
  severityNumber?: SeverityNumber;
  attributes?: Record<string, unknown> | undefined;
}

const emitted: Array<EmittedRecord> = [];

jest.mock("../../../Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getLogger: (): unknown => {
        return {
          emit: (record: EmittedRecord): void => {
            emitted.push(record);
          },
        };
      },
    },
  };
});

import logger, { EXTERNAL_FAULT } from "../../../Server/Utils/Logger";
import TelemetryContext from "../../../Server/Utils/Telemetry/TelemetryContext";

function inUnitOfWork<T>(unitOfWork: UnitOfWork, fn: () => T): T {
  return TelemetryContext.runWithContext(
    { [UNIT_OF_WORK_ATTRIBUTE_KEY]: unitOfWork },
    fn,
  );
}

function lastEmitted(): EmittedRecord {
  const record: EmittedRecord | undefined = emitted[emitted.length - 1];

  if (!record) {
    throw new Error("nothing was emitted to the OTel log exporter");
  }

  return record;
}

let consoleError: ReturnType<typeof jest.spyOn>;
let consoleWarn: ReturnType<typeof jest.spyOn>;

describe("Logger fault demotion", () => {
  beforeEach((): void => {
    emitted.length = 0;

    /*
     * LOG_LEVEL=ERROR is what config.example.env ships, so it is the setting
     * most self-hosted Compose installs run. Every assertion here is made
     * under it deliberately: it is the configuration in which a naive
     * "route it through Logger.warn" implementation would silently delete
     * these lines from stdout.
     */
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.ERROR);

    consoleError = jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    consoleWarn = jest.spyOn(console, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("a user error inside a request is exported at WARN with error.class", () => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      logger.error(new BadDataException("Name is required"));
    });

    const record: EmittedRecord = lastEmitted();

    expect(record.severityNumber).toBe(SeverityNumber.WARN);
    expect(record.attributes?.["error.class"]).toBe(ErrorClass.UserError);
    expect(record.body).toContain("Name is required");
  });

  test("an expected denial inside a request is exported at WARN", () => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      logger.error(new NotAuthenticatedException("token expired"));
    });

    expect(lastEmitted().severityNumber).toBe(SeverityNumber.WARN);
    expect(lastEmitted().attributes?.["error.class"]).toBe(
      ErrorClass.ExpectedDenial,
    );
  });

  /*
   * THE OPERATIONAL REGRESSION THIS GUARDS.
   *
   * Logger.warn is gated on DEBUG/INFO/WARN. Implementing the demotion as
   * `return this.warn(...)` would therefore delete these lines from stdout AND
   * from the support-bundle ring buffer on every install running
   * LOG_LEVEL=ERROR — while looking correct on Helm, which ships INFO. The
   * demotion keeps the ERROR-level GATE and lowers only the exported severity.
   */
  test("the line still reaches the console under LOG_LEVEL=ERROR", () => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      logger.error(new BadDataException("SMS is not enabled for this project"));
    });

    expect(consoleWarn).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("the line still reaches the support-bundle ring buffer", () => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      logger.error(new BadDataException("a very findable message"));
    });

    const messages: string = logger
      .getRecentLogs()
      .map((entry: { message: string }): string => {
        return entry.message;
      })
      .join("\n");

    expect(messages).toContain("a very findable message");
  });

  /*
   * WARN is severityNumber 13; LogExceptionExtractor gates its stack-trace
   * body scanner at 17. So the demotion also closes the log-derived exception
   * path for these records — which matters because redactBody returns the FULL
   * STACK STRING whenever redaction fired, and that stack otherwise parses
   * straight into an Issue.
   */
  test("the exported severity is below the log-derived exception threshold", () => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      logger.error(new BadDataException("Name is required"));
    });

    const MIN_ERROR_SEVERITY_NUMBER: number = 17;
    expect(Number(lastEmitted().severityNumber)).toBeLessThan(
      MIN_ERROR_SEVERITY_NUMBER,
    );
  });
});

describe("Logger keeps real failures loud", () => {
  beforeEach((): void => {
    emitted.length = 0;
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.ERROR);
    consoleError = jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    consoleWarn = jest.spyOn(console, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "a plain Error",
      (): unknown => {
        return new Error("null is not an object");
      },
    ],
    [
      "a bare string",
      (): unknown => {
        return "something went very wrong";
      },
    ],
    [
      "a ServerException",
      (): unknown => {
        return new ServerException("boom");
      },
    ],
    [
      "a TimeoutException",
      (): unknown => {
        return new TimeoutException("timed out");
      },
    ],
    [
      "a JSON object",
      (): unknown => {
        return { what: "happened" };
      },
    ],
  ])("%s stays at ERROR", (_name: string, make: () => unknown) => {
    inUnitOfWork(UnitOfWork.HttpRequest, (): void => {
      logger.error(make());
    });

    expect(lastEmitted().severityNumber).toBe(SeverityNumber.ERROR);
    expect(consoleError).toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  /*
   * The unit-of-work promotion applies to logs exactly as it does to spans, so
   * an internal invariant thrown as BadDataException from a worker job stays
   * loud.
   */
  test("a user-error class escaping a worker job stays at ERROR", () => {
    inUnitOfWork(UnitOfWork.WorkerJob, (): void => {
      logger.error(new BadDataException("No job found with name: foo"));
    });

    expect(lastEmitted().severityNumber).toBe(SeverityNumber.ERROR);
    expect(lastEmitted().attributes?.["error.class"]).toBe(
      ErrorClass.CodeFault,
    );
  });

  test("with no telemetry scope at all, a user-error class stays at ERROR", () => {
    logger.error(new BadDataException("outside any scope"));

    expect(lastEmitted().severityNumber).toBe(SeverityNumber.ERROR);
  });

  test("every ERROR record also carries error.class, so the field is always queryable", () => {
    logger.error(new Error("plain"));

    expect(lastEmitted().attributes?.["error.class"]).toBe(
      ErrorClass.CodeFault,
    );
  });
});

describe("Logger EXTERNAL_FAULT", () => {
  beforeEach((): void => {
    emitted.length = 0;
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.ERROR);
    jest.spyOn(console, "error").mockImplementation((): void => {
      return undefined;
    });
    consoleWarn = jest.spyOn(console, "warn").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  /*
   * The probe, notification and subscriber-fanout call sites log a plain
   * STRING — there is no Error object to carry a tag — so they declare
   * themselves through this attribute instead. It is a SITE-LEVEL declaration,
   * so unlike a class default it survives the unit-of-work promotion: a probe
   * check has no HTTP request around it, and a customer's endpoint being down
   * is still not our defect.
   */
  test("a plain string stamped EXTERNAL_FAULT is demoted inside a probe check", () => {
    inUnitOfWork(UnitOfWork.ProbeCheck, (): void => {
      logger.error(
        "Website Monitor - Pinging https://customer.example - ERROR: ECONNREFUSED",
        EXTERNAL_FAULT,
      );
    });

    expect(lastEmitted().severityNumber).toBe(SeverityNumber.WARN);
    expect(lastEmitted().attributes?.["error.class"]).toBe(
      ErrorClass.UserError,
    );
    expect(consoleWarn).toHaveBeenCalled();
  });

  test("the same string WITHOUT the stamp stays at ERROR", () => {
    inUnitOfWork(UnitOfWork.ProbeCheck, (): void => {
      logger.error(
        "Website Monitor - Pinging https://customer.example - ERROR: ECONNREFUSED",
      );
    });

    expect(lastEmitted().severityNumber).toBe(SeverityNumber.ERROR);
  });

  test("caller attributes are preserved alongside the stamp", () => {
    inUnitOfWork(UnitOfWork.Notification, (): void => {
      logger.error("SMTP auth failed for tenant", {
        ...EXTERNAL_FAULT,
        projectId: "abc-123",
      });
    });

    expect(lastEmitted().attributes?.["projectId"]).toBe("abc-123");
    expect(lastEmitted().attributes?.["error.class"]).toBe(
      ErrorClass.UserError,
    );
  });

  /*
   * error.class must survive sanitizeAttributes, or the drop filters and
   * dashboards built on it would silently see "[REDACTED]" instead. Nothing in
   * SENSITIVE_KEY_FRAGMENTS matches "errorclass" or "user-error" today; this
   * pins it so adding a fragment cannot break the field by accident.
   */
  test("error.class is never redacted by the attribute sanitizer", () => {
    logger.error(new Error("plain"), { ...EXTERNAL_FAULT });

    expect(lastEmitted().attributes?.["error.class"]).toBe(
      ErrorClass.UserError,
    );
    expect(String(lastEmitted().attributes?.["error.class"])).not.toContain(
      "REDACTED",
    );
  });
});

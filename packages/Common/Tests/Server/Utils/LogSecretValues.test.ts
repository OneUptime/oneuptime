import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import { inspect } from "util";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  secretValueForms,
  secretValueFormsIn,
} from "../../Helpers/SecretValueForms";

/*
 * NO LOG LINE WRITES A MONITOR SECRET'S VALUE WHILE A PROBE RUNS ITS CHECK
 * (OneUptime issue #10875).
 *
 * The probe runs each check inside LogSecretValues.run with the values of
 * the Text secrets the server filled into its steps, and the logger hides
 * them in every line it writes there: at every level, in all three places a
 * line goes - stdout, the recent-log buffer the support bundle reads, and
 * the OpenTelemetry exporter - in the line's text, an error's message,
 * stack, cause and fields, an object's texts, keys and numbers, and its
 * attributes, in every form a check can say a value back in. Outside a run
 * nothing changes.
 */

interface EmittedRecord {
  body: string;
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

import logger from "../../../Server/Utils/Logger";
import LogSecretValues from "../../../Server/Utils/LogSecretValues";
import MonitorSecretValueRedaction, {
  HIDDEN_SECRET_MARKER,
  HiddenSecretValues,
} from "../../../Server/Utils/Monitor/MonitorSecretValueRedaction";
import { JSONValue } from "../../../Types/JSON";

type LogMethod = "info" | "error" | "warn" | "debug" | "trace";

const ALL_LEVELS: Array<LogMethod> = [
  "info",
  "error",
  "warn",
  "debug",
  "trace",
];

interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
}

let consoleSpies: Record<LogMethod, ConsoleSpy>;

/*
 * Everything written for the log calls made since the last clear: what the
 * console was handed, as it prints it, what the recent-log buffer kept,
 * and what telemetry received, attributes included.
 */
let recentLogsBefore: number = 0;

function sinkText(): string {
  const parts: Array<string> = [];

  for (const level of ALL_LEVELS) {
    for (const call of consoleSpies[level].mock.calls) {
      parts.push(
        call
          .map((argument: unknown): string => {
            return typeof argument === "string"
              ? argument
              : inspect(argument, { depth: null });
          })
          .join(" "),
      );
    }
  }

  for (const entry of logger.getRecentLogs().slice(recentLogsBefore)) {
    parts.push(entry.message);
  }

  for (const record of emitted) {
    parts.push(record.body);
    parts.push(JSON.stringify(record.attributes || {}));
  }

  return parts.join("\n");
}

function logAtEveryLevel(body: unknown, attributes?: unknown): void {
  for (const level of ALL_LEVELS) {
    (logger[level] as unknown as (body: unknown, attributes?: unknown) => void)(
      body,
      attributes,
    );
  }
}

// A value of the alphabets a secret is written in: quotes, spaces, unicode.
function makeSecret(random: SeededRandom): string {
  const alphabet: string = "abcXYZ019-_.~!$'()*+,;=:@/&<> \"\\é日";
  let secret: string = "Sk3y";

  for (let index: number = 0; index < 16; index++) {
    secret += alphabet.charAt(random(alphabet.length));
  }

  return `${secret}Q`;
}

function compiled(values: Array<string>): HiddenSecretValues {
  const read: HiddenSecretValues | null =
    MonitorSecretValueRedaction.compile(values);

  expect(read).not.toBeNull();

  return read!;
}

// No form of any of these values is left in the text, by either reading.
function expectNoValueIn(text: string, values: Array<string>): void {
  for (const value of values) {
    expect(secretValueFormsIn(text, value)).toEqual([]);
    expect(
      MonitorSecretValueRedaction.holdsValue(text, compiled([value])),
    ).toBe(false);
  }
}

describe("a monitor secret's value in the logger's lines while a check runs", () => {
  const random: SeededRandom = seededRandom(10875);

  beforeEach(() => {
    emitted.length = 0;
    recentLogsBefore = logger.getRecentLogs().length;

    // DEBUG: the level the issue is about, with every line on.
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.DEBUG);

    consoleSpies = {
      info: jest.spyOn(console, "info").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
      warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
      debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
      trace: jest.spyOn(console, "trace").mockImplementation(() => {}),
    } as unknown as Record<LogMethod, ConsoleSpy>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("outside a run, every line is written as it always was", () => {
    const secret: string = makeSecret(random);
    const body: { said: string } = { said: secret };
    const error: Error = new Error(`plain failure ${secret}`);

    logAtEveryLevel(`said back: ${secret}`);

    expect(sinkText()).toContain(`said back: ${secret}`);
    expect(LogSecretValues.isHiding()).toBe(false);
    // Bodies pass as they were handed in: the very object, the very error.
    expect(LogSecretValues.hideInBody(body)).toBe(body);
    expect(LogSecretValues.hideInBody(error)).toBe(error);
  });

  test("inside a run, an error that holds no value is still the error, so the console prints its stack", () => {
    const error: Error = new Error("plain failure");

    LogSecretValues.run([makeSecret(random)], () => {
      expect(LogSecretValues.hideInBody(error)).toBe(error);
    });
  });

  test("inside a run, no form of the value reaches stdout, the recent logs or telemetry, at any level", () => {
    for (let round: number = 0; round < 25; round++) {
      const secret: string = makeSecret(random);
      const forms: Array<string> = secretValueForms(secret);

      emitted.length = 0;
      recentLogsBefore = logger.getRecentLogs().length;
      jest.clearAllMocks();

      LogSecretValues.run([secret], () => {
        expect(LogSecretValues.isHiding()).toBe(true);

        // Every form in one line, each with text around it that stays.
        logAtEveryLevel(
          forms
            .map((form: string, index: number): string => {
              return `form ${index}: <${form}>`;
            })
            .join(" | "),
        );

        // An echoed response: the value in a text, a key, a header.
        logAtEveryLevel({
          responseBody: JSON.stringify({ args: { key: secret } }),
          responseHeaders: { "x-echo": secret, [secret]: "named by it" },
          nested: { deeper: [{ said: `token=${encodeURIComponent(secret)}` }] },
        });
      });

      const written: string = sinkText();

      expectNoValueIn(written, [secret]);
      // The lines are there, the value hidden in each, the rest kept.
      expect(written).toContain(HIDDEN_SECRET_MARKER);
      expect(written).toContain("form 0: <");
      expect(written).toContain("named by it");
      expect(written).toContain("token=");
      expect(emitted).toHaveLength(ALL_LEVELS.length * 2);
    }
  });

  test("an error's message, stack, cause, aggregate errors and fields keep no form of it", () => {
    const secret: string = makeSecret(random);

    LogSecretValues.run([secret], () => {
      logger.error(
        new Error(`page.goto: net::ERR_NAME_NOT_RESOLVED at ${secret}`),
      );

      // A cause is no field of the error's own: the console prints it anyway.
      logger.error(
        new Error("request failed", {
          cause: new Error(`refused for ${secret}`),
        }),
      );

      logger.error(
        new AggregateError(
          [new Error(`first ${JSON.stringify(secret)}`)],
          "all connection attempts failed",
        ),
      );

      // A client's error, holding the request it sent: the report itself.
      const clientError: Error & { config?: unknown } = new Error(
        "socket hang up",
      );
      clientError.config = {
        url: "https://oneuptime.example.com/probe-ingest/probe/response/ingest",
        data: JSON.stringify({
          probeMonitorResponse: { responseBody: secret },
        }),
      };
      logger.error(clientError);
    });

    const written: string = sinkText();

    expectNoValueIn(written, [secret]);
    expect(written).toContain("ERR_NAME_NOT_RESOLVED");
    expect(written).toContain("request failed");
    expect(written).toContain("all connection attempts failed");
    expect(written).toContain("socket hang up");
  });

  test("a value that is a number, or an attribute, is hidden too", () => {
    const pin: string = "90817263";
    const secret: string = makeSecret(random);

    LogSecretValues.run([pin, secret], () => {
      logger.info({ pin: 90817263, kept: 42 });
      logger.info("a line with attributes", {
        custom: `carries ${secret}`,
        count: 7,
      });
    });

    const written: string = sinkText();

    expectNoValueIn(written, [pin, secret]);
    expect(written).toContain("42");
    expect(written).toContain("a line with attributes");
    expect(
      emitted.some((record: EmittedRecord): boolean => {
        return record.attributes?.["count"] === 7;
      }),
    ).toBe(true);
  });

  test("a run's awaited work, timers and callbacks are inside it, and a run beside it keeps its own values", async () => {
    const first: string = makeSecret(random);
    const second: string = makeSecret(random);

    const check: (own: string, other: string) => Promise<void> = async (
      own: string,
      other: string,
    ): Promise<void> => {
      await LogSecretValues.run([own], async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
        logger.debug(`after an await: own=${own} other=${other}`);

        await new Promise<void>((resolve: () => void) => {
          setTimeout(() => {
            logger.debug(`in a timer: own=${own} other=${other}`);
            resolve();
          }, 1);
        });

        await Promise.resolve().then(() => {
          logger.debug(`in a callback: own=${own} other=${other}`);
        });
      });
    };

    await Promise.all([check(first, second), check(second, first)]);

    const lines: Array<string> = consoleSpies.debug.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );

    expect(lines).toHaveLength(6);

    for (const line of lines) {
      // Each run hid its own value; the other run's is not its to hide.
      const own: string = line.includes(`other=${second}`) ? first : second;
      expect(line).toContain(`own=${HIDDEN_SECRET_MARKER}`);
      expectNoValueIn(line.split(" other=")[0]!, [own]);
    }

    // Once the runs are over, nothing is hidden.
    logger.debug(`after: ${first}`);
    expect(String(consoleSpies.debug.mock.calls.at(-1)?.[0])).toBe(
      `after: ${first}`,
    );
  });

  test("a run inside another hides the values of both", () => {
    const outer: string = makeSecret(random);
    const inner: string = makeSecret(random);

    LogSecretValues.run([outer], () => {
      LogSecretValues.run([inner], () => {
        logger.warn(`outer ${outer} inner ${inner}`);
      });

      logger.warn(`back out: ${outer}`);
    });

    expectNoValueIn(sinkText(), [outer, inner]);
  });

  test("a value shorter than four characters is left alone, as it is in what a check reports", () => {
    LogSecretValues.run(["abc", "  x  "], () => {
      expect(LogSecretValues.isHiding()).toBe(false);
      logger.info("abc is part of ordinary text");
    });

    expect(sinkText()).toContain("abc is part of ordinary text");
  });

  test("a body that holds no value is written as itself, and one that cannot be read is written as [REDACTED]", () => {
    const secret: string = makeSecret(random);
    const body: { kept: string } = { kept: "nothing secret" };

    LogSecretValues.run([secret], () => {
      expect(LogSecretValues.hideInBody(body)).toBe(body);
      expect(LogSecretValues.hideInText("plain")).toBe("plain");

      const unreadable: Record<string, unknown> = new Proxy(
        {},
        {
          ownKeys: (): Array<string> => {
            throw new Error("no keys for you");
          },
        },
      );

      expect(LogSecretValues.hideInBody(unreadable)).toBe(HIDDEN_SECRET_MARKER);
    });

    // Outside a run: as handed in.
    expect(LogSecretValues.hideInText(`said ${secret}`)).toBe(`said ${secret}`);
  });
});

describe("MonitorSecretValueRedaction.redactAnyValue", () => {
  const random: SeededRandom = seededRandom(108751);

  test("hides a value in every text, key and number of a log body, and keeps the rest", () => {
    for (let round: number = 0; round < 50; round++) {
      const secret: string = makeSecret(random);
      const values: HiddenSecretValues = compiled([secret, "55667788"]);

      const body: JSONValue = {
        line: `echoed ${secret} back`,
        [secret]: "a key that is the value",
        list: [secret, { deep: encodeURIComponent(secret) }, 3],
        pin: 55667788,
        ok: true,
        json: JSON.stringify({ token: secret }),
      };

      const hidden: JSONValue = MonitorSecretValueRedaction.redactAnyValue(
        body,
        values,
      );

      expectNoValueIn(JSON.stringify(hidden), [secret, "55667788"]);
      expect(hidden).toMatchObject({
        line: `echoed ${HIDDEN_SECRET_MARKER} back`,
        [HIDDEN_SECRET_MARKER]: "a key that is the value",
        pin: HIDDEN_SECRET_MARKER,
        ok: true,
      });
      // A JSON text stays JSON.
      expect(JSON.parse((hidden as { json: string }).json) as unknown).toEqual({
        token: HIDDEN_SECRET_MARKER,
      });
      // The body handed in is never changed.
      expect((body as { line: string }).line).toBe(`echoed ${secret} back`);
    }
  });

  test("a body that holds no value, or no values to hide, is the very body", () => {
    const body: JSONValue = { line: "nothing to hide", list: [1, 2] };

    expect(
      MonitorSecretValueRedaction.redactAnyValue(
        body,
        compiled(["unrelated-value"]),
      ),
    ).toBe(body);
    expect(MonitorSecretValueRedaction.redactAnyValue(body, null)).toBe(body);
  });
});

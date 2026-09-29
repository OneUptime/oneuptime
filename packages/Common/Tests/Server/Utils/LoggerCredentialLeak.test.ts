import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import { inspect } from "util";
import { QueryFailedError } from "typeorm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * GHSA-3x69-fj58-3pc6 / GHSA-c4c2-r4hm-6pjj.
 *
 * A log record does not go to one place. It goes to process stdout, to the
 * in-memory recent-log ring buffer that the master-admin support bundle reads
 * back, and to the OpenTelemetry log exporter. A credential that survives any
 * one of those three is still leaked, so every test here asserts against all
 * three at once, at every log level -- including the levels that stay on in
 * production.
 *
 * The bodies below are the ones the removed call sites used to pass. Deleting
 * those calls is the fix; this file is the guarantee that re-adding one cannot
 * leak.
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

const SENTINEL: string = "sentinel-secret-value-a1b2c3d4";

/*
 * A TOTP code is six digits and has no distinctive shape, so it gets its own
 * sentinel -- the recent-log ring buffer is process-wide and outlives a single
 * test, and a common digit run would collide with the ids other cases log.
 */
const TOTP_SENTINEL: string = "907351";

type LogMethod = "info" | "error" | "warn" | "debug" | "trace";

const ALL_LEVELS: Array<LogMethod> = [
  "info",
  "error",
  "warn",
  "debug",
  "trace",
];

// Only the recorded calls matter here, so the spies are read through this.
interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
}

type ConsoleSpies = Record<LogMethod, ConsoleSpy>;

let consoleSpies: ConsoleSpies;

type CollectSinkTextFunction = () => string;

/*
 * Everything the process wrote for the log calls made so far: what went to
 * console, what the recent-log buffer kept, and what telemetry received.
 */
const collectSinkText: CollectSinkTextFunction = (): string => {
  const parts: Array<string> = [];

  for (const level of ALL_LEVELS) {
    for (const call of consoleSpies[level].mock.calls) {
      parts.push(
        call
          .map((argument: unknown) => {
            if (typeof argument === "string") {
              return argument;
            }

            return inspect(argument, { depth: null });
          })
          .join(" "),
      );
    }
  }

  for (const entry of logger.getRecentLogs()) {
    parts.push(entry.message);
  }

  for (const record of emitted) {
    parts.push(record.body);
    parts.push(JSON.stringify(record.attributes || {}));
  }

  return parts.join("\n");
};

type LogAtEveryLevelFunction = (body: unknown, attributes?: unknown) => void;

const logAtEveryLevel: LogAtEveryLevelFunction = (
  body: unknown,
  attributes?: unknown,
): void => {
  for (const level of ALL_LEVELS) {
    (logger[level] as unknown as (body: unknown, attributes?: unknown) => void)(
      body,
      attributes,
    );
  }
};

describe("logger never writes credentials to any sink", () => {
  beforeEach(() => {
    emitted.length = 0;

    // DEBUG is the level both advisories are about: on for troubleshooting.
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.DEBUG);

    consoleSpies = {
      info: jest.spyOn(console, "info").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
      warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
      debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
      trace: jest.spyOn(console, "trace").mockImplementation(() => {}),
    } as unknown as ConsoleSpies;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps a Slack token exchange out of stdout, recent logs and telemetry", () => {
    logAtEveryLevel({
      code: "1234567890.9876543210." + SENTINEL,
      client_id: "1234567890.1111111111",
      client_secret: SENTINEL,
      redirect_uri: "https://oneuptime.com/api/slack/auth/p/u",
    });

    logAtEveryLevel({
      ok: true,
      access_token: "xoxb-1111-2222-" + SENTINEL,
      authed_user: { id: "U1", access_token: "xoxp-3333-" + SENTINEL },
    });

    expect(collectSinkText()).not.toContain(SENTINEL);
    // The sinks did receive the records -- this is not passing by logging nothing.
    expect(emitted.length).toBe(ALL_LEVELS.length * 2);
  });

  it("keeps a Microsoft Teams token response out of every sink", () => {
    logAtEveryLevel({
      token_type: "Bearer",
      expires_in: 3599,
      access_token: "eyJ0eXAiOiJKV1QifQ.ey" + SENTINEL,
      refresh_token: "0.AQ" + SENTINEL,
    });

    expect(collectSinkText()).not.toContain(SENTINEL);
  });

  it("keeps a stringified login body out of every sink", () => {
    logAtEveryLevel(
      "Login request data: " +
        JSON.stringify(
          { data: { email: "user@example.com", password: SENTINEL } },
          null,
          2,
        ),
    );

    const output: string = collectSinkText();

    expect(output).not.toContain(SENTINEL);
    // Redaction removed the secret, not the log line.
    expect(output).toContain("Login request data");
  });

  it("keeps MFA material out of every sink", () => {
    logAtEveryLevel({
      data: {
        code: TOTP_SENTINEL,
        credential: { rawId: SENTINEL, response: { signature: SENTINEL } },
      },
    });

    const output: string = collectSinkText();

    expect(output).not.toContain(SENTINEL);
    expect(output).not.toContain(TOTP_SENTINEL);
  });

  it("redacts credentials carried in log attributes", () => {
    logAtEveryLevel("some message", {
      projectId: "1234",
      accessToken: SENTINEL,
    });

    const output: string = collectSinkText();

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain("1234");
  });

  it("redacts a credential inside an Error message and its stack", () => {
    logAtEveryLevel(
      new Error(`Slack token exchange failed: client_secret=${SENTINEL}`),
    );

    expect(collectSinkText()).not.toContain(SENTINEL);
  });

  it("drops database bind parameters carried on QueryFailedError", () => {
    const verificationToken: string = `0abc1234_${"A".repeat(43)}`;
    const driverError: Error & { code?: string } = Object.assign(
      new Error("database connection lost"),
      { code: "ECONNRESET" },
    );
    const error: QueryFailedError = new QueryFailedError(
      'UPDATE "UserTelegram" SET "isVerified" = $1 WHERE "verificationCode" = $2',
      [true, verificationToken],
      driverError,
    );

    logAtEveryLevel(error);

    const output: string = collectSinkText();
    expect(output).not.toContain(verificationToken);
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("UserTelegram");
  });

  it("still logs an ordinary message unchanged", () => {
    logger.debug("Exchanging Slack authorization code for an access token.");

    expect(logger.getRecentLogs(1)[0]?.message).toBe(
      "Exchanging Slack authorization code for an access token.",
    );
  });
});

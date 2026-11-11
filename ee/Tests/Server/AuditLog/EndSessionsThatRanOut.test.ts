import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import UserSessionService from "Common/Server/Services/UserSessionService";
import logger from "Common/Server/Utils/Logger";
import { SessionLengths } from "Common/Types/UserSession/SessionLength";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * The job that ends the sessions that ran out (issue #6762): every five
 * minutes, so each one's Session Timeout reaches the audit log within
 * minutes of happening. It runs only where something records the ends - on
 * OneUptime Cloud, or self-hosted with a license that covers audit logs -
 * and ends sessions by the server's own session lengths, never by lengths
 * it could not read.
 *
 * RunCron is captured, so loading the job registers nothing in Redis; the
 * job's own function is taken from the capture and run here.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import {
  END_SESSIONS_THAT_RAN_OUT_JOB_NAME,
  END_SESSIONS_THAT_RAN_OUT_JOB_TIMEOUT_IN_MS,
  endSessionsThatRanOut,
  isRecordingSessionEnds,
} from "../../../Server/AuditLog/Jobs/EndSessionsThatRanOut";

const LENGTHS: SessionLengths = {
  standard: { lengthInMinutes: 8 * 60, idleTimeoutInMinutes: 30 },
  sso: { lengthInMinutes: 8 * 60, idleTimeoutInMinutes: 30 },
};

const cronCall: () => Array<unknown> = (): Array<unknown> => {
  const cron: jest.Mock = (
    jest.requireMock("App/FeatureSet/Workers/Utils/Cron") as {
      default: jest.Mock;
    }
  ).default;

  const call: Array<unknown> | undefined = cron.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return args[0] === END_SESSIONS_THAT_RAN_OUT_JOB_NAME;
    },
  );

  expect(call).toBeDefined();

  return call!;
};

let endSessions: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule({ userSessionLengths: LENGTHS });
  endSessions = jest
    .spyOn(UserSessionService, "endSessionsThatRanOut")
    .mockResolvedValue(3 as never);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the job", () => {
  test("is the enterprise-owned name core keeps a placeholder for, every five minutes, never on startup", () => {
    expect(END_SESSIONS_THAT_RAN_OUT_JOB_NAME).toBe(
      "AuditLog:EndSessionsThatRanOut",
    );

    const options: {
      schedule: string;
      runOnStartup: boolean;
      timeoutInMS: number;
    } = cronCall()[1] as {
      schedule: string;
      runOnStartup: boolean;
      timeoutInMS: number;
    };

    expect(options.schedule).toBe(EVERY_FIVE_MINUTE);
    expect(options.runOnStartup).toBe(false);
    // Done well before the next run starts.
    expect(options.timeoutInMS).toBe(END_SESSIONS_THAT_RAN_OUT_JOB_TIMEOUT_IN_MS);
    expect(END_SESSIONS_THAT_RAN_OUT_JOB_TIMEOUT_IN_MS).toBeLessThan(
      5 * 60 * 1000,
    );
  });
});

describe("one run", () => {
  test("ends the sessions that ran out by the server's own session lengths", async () => {
    await expect(endSessionsThatRanOut()).resolves.toBe(3);

    expect(endSessions).toHaveBeenCalledTimes(1);
    expect(endSessions).toHaveBeenCalledWith(LENGTHS);
  });

  test("without session lengths, still ends the sessions whose refresh token ran out", async () => {
    installFakeEnterpriseModule({ userSessionLengths: null });

    await endSessionsThatRanOut();

    expect(endSessions).toHaveBeenCalledWith(null);
  });

  test("ends nothing while the license does not cover audit logs: nothing would record it", async () => {
    installFakeEnterpriseModule({
      userSessionLengths: LENGTHS,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(isRecordingSessionEnds()).toBe(false);
    await expect(endSessionsThatRanOut()).resolves.toBe(0);
    expect(endSessions).not.toHaveBeenCalled();
  });

  test("on OneUptime Cloud, always runs: any project may be on the Enterprise plan", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule({
      userSessionLengths: LENGTHS,
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    expect(isRecordingSessionEnds()).toBe(true);
    await endSessionsThatRanOut();
    expect(endSessions).toHaveBeenCalledTimes(1);
  });

  test("fails, ending nothing, when the session lengths cannot be read", async () => {
    const fake: ReturnType<typeof installFakeEnterpriseModule> =
      installFakeEnterpriseModule({ userSessionLengths: LENGTHS });
    fake.userSessionLengthsError = new Error("lengths unreadable");

    await expect(endSessionsThatRanOut()).rejects.toThrow(
      "lengths unreadable",
    );
    expect(endSessions).not.toHaveBeenCalled();
  });
});

describe("the scheduled run", () => {
  const scheduledRun: () => () => Promise<void> = (): (() => Promise<void>) => {
    return cronCall()[2] as () => Promise<void>;
  };

  test("says how many it ended, at debug level", async () => {
    const debug: jest.SpyInstance = jest
      .spyOn(logger, "debug")
      .mockImplementation((): void => {
        return undefined;
      });

    await scheduledRun()();

    expect(debug).toHaveBeenCalledWith(
      "AuditLog:EndSessionsThatRanOut: ended 3 session(s) that ran out.",
    );
  });

  test("never throws: a failed run is logged, and the next one tries again", async () => {
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    endSessions.mockRejectedValue(new Error("Postgres is down") as never);

    await expect(scheduledRun()()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "AuditLog:EndSessionsThatRanOut: the run failed:",
    );
  });
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Postgres and Valkey health evaluations are licensed: they run on the
 * Enterprise Edition with a license that covers instance health (and always on
 * OneUptime Cloud), and skip otherwise - quietly, keeping their schedule, so a
 * renewed license picks up on the next five-minute tick without a restart.
 *
 * Only the gate is under test: the lease (which would reach Postgres) is
 * replaced by a spy, and RunCron by a mock so loading a job module never
 * reaches Redis. Billing AND the edition are pinned in every test (CI's
 * config.env sets BILLING_ENABLED=true).
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

import * as InstanceHealthLock from "App/FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthLock";
import {
  evaluatePostgresHealth,
  runEvaluatePostgresHealthWithLock,
} from "../../../../Server/Workers/InstanceHealth/EvaluatePostgresHealth";
import {
  evaluateRedisHealth,
  runEvaluateRedisHealthWithLock,
} from "../../../../Server/Workers/InstanceHealth/EvaluateRedisHealth";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import logger from "Common/Server/Utils/Logger";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

interface Job {
  label: string;
  jobName: string;
  lockLabel: string;
  evaluate: () => Promise<void>;
  runWithLock: () => Promise<void>;
}

const JOBS: Array<Job> = [
  {
    label: "Postgres",
    jobName: "InstanceHealth:EvaluatePostgresHealth",
    lockLabel: "oneuptime:instance-health:postgres",
    evaluate: evaluatePostgresHealth,
    runWithLock: runEvaluatePostgresHealthWithLock,
  },
  {
    label: "Valkey",
    jobName: "InstanceHealth:EvaluateRedisHealth",
    lockLabel: "oneuptime:instance-health:redis",
    evaluate: evaluateRedisHealth,
    runWithLock: runEvaluateRedisHealthWithLock,
  },
];

interface EditionState {
  label: string;
  billing: boolean;
  install: () => void;
  runs: boolean;
}

const STATES: Array<EditionState> = [
  {
    label: "the Community Edition",
    billing: false,
    install: uninstallEnterpriseModule,
    runs: false,
  },
  {
    label: "the Community Edition with billing on",
    billing: true,
    install: uninstallEnterpriseModule,
    runs: false,
  },
  {
    label: "the Enterprise Edition without a license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing"),
      });
    },
    runs: false,
  },
  {
    label: "the Enterprise Edition with an expired license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
    },
    runs: false,
  },
  {
    label: "the Enterprise Edition with an invalid license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("invalid"),
      });
    },
    runs: false,
  },
  {
    label:
      "the Enterprise Edition with a license that leaves out instance health",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModuleWithFeatures([
        EnterpriseFeature.SSO,
        EnterpriseFeature.AuditLogs,
      ]);
    },
    runs: false,
  },
  {
    label: "the Enterprise Edition with a valid license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule();
    },
    runs: true,
  },
  {
    label: "the Enterprise Edition in its grace period",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("grace"),
      });
    },
    runs: true,
  },
  {
    label: "the Enterprise Edition with a license for instance health only",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModuleWithFeatures([
        EnterpriseFeature.InstanceHealth,
      ]);
    },
    runs: true,
  },
  {
    label: "OneUptime Cloud (billing on), whatever the license says",
    billing: true,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
    },
    runs: true,
  },
];

let leaseSpy: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  leaseSpy = jest
    .spyOn(InstanceHealthLock, "runWithInstanceHealthLease")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe.each(JOBS)("the $label health evaluation", (job: Job) => {
  test.each(STATES)("on $label: runs = $runs", async (state: EditionState) => {
    setTestBillingEnabled(state.billing);
    state.install();

    await job.runWithLock();

    if (!state.runs) {
      expect(leaseSpy).not.toHaveBeenCalled();
      return;
    }

    expect(leaseSpy).toHaveBeenCalledTimes(1);
    expect(leaseSpy).toHaveBeenCalledWith({
      jobName: job.jobName,
      lockLabel: job.lockLabel,
      leaseTtlInSeconds:
        InstanceHealthLock.INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
      run: job.evaluate,
    });
  });

  test("a license that lapses stops the next run, a renewal restarts it, no restart needed", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    await job.runWithLock();
    expect(leaseSpy).toHaveBeenCalledTimes(1);

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    await job.runWithLock();
    expect(leaseSpy).toHaveBeenCalledTimes(1);

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    await job.runWithLock();
    expect(leaseSpy).toHaveBeenCalledTimes(2);
  });

  test("a license that cannot be read skips the run instead of failing it", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: null,
    });
    fake.licensing.getSnapshotError = new Error("database blip");

    await expect(job.runWithLock()).resolves.toBeUndefined();
    expect(leaseSpy).not.toHaveBeenCalled();
  });

  test("a skipped run says why in the debug log", async () => {
    await job.runWithLock();

    expect(logger.debug).toHaveBeenCalledWith(
      `${job.jobName}: skipped. Instance health needs a OneUptime Enterprise license that includes it.`,
    );
  });
});

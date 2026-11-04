/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService imports it. Nothing password-related is under
 * test here, so the module is replaced with a factory.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import MonitorMaintenanceSuppression, {
  MonitorMaintenanceSuppressionResult,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A monitor of Data Observability stays quiet while what it watches is under
 * maintenance, so a planned backfill or migration pages nobody.
 */

const STORE: string = "7f9c24e8-3b12-4fef-91e2-111111111111";
const OTHER: string = "7f9c24e8-3b12-4fef-91e2-222222222222";

describe("whether a store under maintenance silences a monitor", () => {
  test("every store it watches is under maintenance", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingDataStoreIds({
        stores: [STORE],
        maintained: { dataStoreIds: new Set([STORE]) },
      }),
    ).toEqual([STORE]);
  });

  test("one still running keeps it alerting", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingDataStoreIds({
        stores: [STORE, OTHER],
        maintained: { dataStoreIds: new Set([STORE]) },
      }),
    ).toEqual([]);
  });

  test("a monitor that watches none is left alone", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingDataStoreIds({
        stores: [],
        maintained: { dataStoreIds: new Set([STORE]) },
      }),
    ).toEqual([]);
  });

  test("no maintenance at all silences nothing", () => {
    expect(
      MonitorMaintenanceSuppression.getSuppressingDataStoreIds({
        stores: [STORE],
        maintained: {},
      }),
    ).toEqual([]);
  });
});

describe("what it means for the evaluation", () => {
  test("a suppressing store silences the monitor, as a database does", () => {
    const result: MonitorMaintenanceSuppressionResult = {
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
      suppressingDataStoreIds: [STORE],
    };

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      true,
    );
  });

  test("none, and it is not", () => {
    expect(
      MonitorMaintenanceSuppression.isMonitorSuppressed({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      }),
    ).toBe(false);
  });
});

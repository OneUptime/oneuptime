import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { SeatUsage } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The seat arithmetic (EnterpriseLicenseSeats) and the license-response
 * mapper (EnterpriseLicenseSync) moved from core into ee/Server/License/, next
 * to their only callers. These tests pin that each caller really goes through
 * the ee module: a spy on the ee export sees the call, and the result the
 * caller acts on is the one the ee module computed.
 */

// CI's config.env sets BILLING_ENABLED=true; this suite pins it per test.
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

// ReportUserCount registers itself with RunCron at import time.
jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import EnterpriseLicenseSeatsUtil from "../../../Server/License/EnterpriseLicenseSeats";
import EnterpriseLicenseSeatUtil from "../../../Server/License/EnterpriseLicenseSeatUtil";
import EnterpriseLicenseSyncUtil from "../../../Server/License/EnterpriseLicenseSync";
import { LicenseInputs } from "../../../Server/License/LicenseInputs";
import licenseProvider from "../../../Server/License/LicenseProvider";
import LicenseStore from "../../../Server/License/LicenseStore";
import { reportUserCount } from "../../../Server/License/Jobs/ReportUserCount";

const INSTANCE_ID: ObjectID = ObjectID.generate();

const makeInputs: () => LicenseInputs = (): LicenseInputs => {
  return {
    hasConfigRow: true,
    licenseKey: "acme-license-key",
    token: null,
    storedColumns: {},
    instanceId: INSTANCE_ID.toString(),
    currentUserCount: 4,
    instances: [],
  };
};

beforeEach(() => {
  setTestBillingEnabled(false);
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return;
  });
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("EnterpriseLicenseSeatUtil uses ee's EnterpriseLicenseSeats", () => {
  it("computes seat usage through the ee seat arithmetic", () => {
    const getSeatUsage: jest.SpyInstance = jest.spyOn(
      EnterpriseLicenseSeatsUtil,
      "getSeatUsage",
    );

    const usage: SeatUsage = EnterpriseLicenseSeatUtil.getSeatUsageFromLicense({
      inputs: makeInputs(),
      snapshot: createLicenseSnapshot({ userLimit: 10 }),
      localUserCount: 3,
    });

    expect(getSeatUsage).toHaveBeenCalledTimes(1);
    expect(getSeatUsage).toHaveBeenCalledWith({
      userLimit: 10,
      localUserCount: 3,
      aggregatedUserCount: 4,
      instances: [],
      thisInstanceId: INSTANCE_ID.toString(),
    });
    expect(usage).toEqual(getSeatUsage.mock.results[0]?.value);
    expect(usage.isEnforced).toBe(true);
  });

  it("refuses a user with the ee module's seat-limit message", async () => {
    // Worked out before the spy exists, so the spy only sees the caller's call.
    const expectedMessage: string =
      EnterpriseLicenseSeatsUtil.getSeatLimitReachedMessage({
        seatsInUse: 10,
        userLimit: 10,
      });
    const getMessage: jest.SpyInstance = jest.spyOn(
      EnterpriseLicenseSeatsUtil,
      "getSeatLimitReachedMessage",
    );

    const refusal: Promise<void> =
      EnterpriseLicenseSeatUtil.assertSeatAvailableForNewUser({
        inputs: makeInputs(),
        snapshot: createLicenseSnapshot({ userLimit: 10 }),
        getLocalUserCount: async (): Promise<number> => {
          return 10;
        },
      });

    await expect(refusal).rejects.toThrow(BadDataException);
    await expect(refusal).rejects.toThrow(expectedMessage);
    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(getMessage).toHaveBeenCalledWith({ seatsInUse: 10, userLimit: 10 });
  });

  // Negative control: no usable license, so the ee arithmetic is never asked.
  it("does not consult the seat arithmetic where nothing is enforced", async () => {
    const getSeatUsage: jest.SpyInstance = jest.spyOn(
      EnterpriseLicenseSeatsUtil,
      "getSeatUsage",
    );

    const usage: SeatUsage | null =
      await EnterpriseLicenseSeatUtil.getSeatUsageForLicense({
        inputs: makeInputs(),
        snapshot: createLicenseSnapshotWithStatus("expired"),
        getLocalUserCount: async (): Promise<number> => {
          return 10;
        },
      });

    expect(usage).toBeNull();
    expect(getSeatUsage).not.toHaveBeenCalled();
  });
});

describe("ReportUserCount uses ee's EnterpriseLicenseSync", () => {
  beforeEach(() => {
    const config: GlobalConfig = new GlobalConfig();
    config.enterpriseLicenseKey = "acme-license-key";
    config.instanceId = INSTANCE_ID;

    jest.spyOn(LicenseStore, "readLicenseConfig").mockResolvedValue(config);
    jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(GlobalConfigService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(licenseProvider, "refresh")
      .mockResolvedValue(undefined as never);
  });

  it("maps the license server's response with the ee mapper and stores its result", async () => {
    const body: JSONObject = { userLimit: 150, currentUserCount: 42 };
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, body, {}) as never);
    const mapResponse: jest.SpyInstance = jest.spyOn(
      EnterpriseLicenseSyncUtil,
      "getGlobalConfigUpdateFromLicenseResponse",
    );

    await reportUserCount();

    expect(mapResponse).toHaveBeenCalledTimes(1);
    expect(mapResponse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ payload: body }),
    );
    expect(GlobalConfigService.updateOneById).toHaveBeenCalledTimes(1);
    expect(GlobalConfigService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enterpriseLicenseUserLimit: 150,
          enterpriseLicenseCurrentUserCount: 42,
        }),
      }),
    );
    expect(licenseProvider.refresh).toHaveBeenCalledTimes(1);
  });

  /*
   * Negative control: what gets written is whatever the ee mapper returns, so
   * a mapper that finds nothing storable means nothing is written.
   */
  it("writes nothing when the ee mapper finds nothing to store", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { userLimit: 150 }, {}) as never,
      );
    jest
      .spyOn(
        EnterpriseLicenseSyncUtil,
        "getGlobalConfigUpdateFromLicenseResponse",
      )
      .mockReturnValue({ updateData: {}, warnings: [] });

    await reportUserCount();

    expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
    expect(licenseProvider.refresh).not.toHaveBeenCalled();
  });
});

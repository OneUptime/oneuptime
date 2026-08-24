import { EVERY_DAY } from "Common/Utils/CronTime";
import { beforeEach, afterEach, describe, expect, it } from "@jest/globals";

/*
 * The daily call home, and the bug it was reported for.
 *
 * A customer raised their seat limit on oneuptime.com. Their self-hosted
 * installation called home every day exactly as designed, and the modal went
 * on showing the old limit — not for a day, forever, because the only other
 * writer of that column is a human re-typing the license key into a box that
 * is hidden while the license is valid. The job read four fields out of the
 * response and dropped userLimit, which the license server had been sending
 * all along.
 *
 * What these tests pin:
 *   1. the seat limit (and the expiry, company name, evaluation flag and
 *      token) actually reach GlobalConfig,
 *   2. the three-state contract that makes that safe — a field the server did
 *      not mention leaves the stored column alone, so an installation upgraded
 *      ahead of oneuptime.com cannot have its license blanked,
 *   3. one bad field no longer costs the whole day's sync,
 *   4. the gating and the report body, so the fix did not disturb them.
 *
 * The job registers itself through RunCron at import time and exports nothing,
 * so Cron is mocked to capture the handler and each test drives one tick.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

interface CapturedJob {
  options: CronOptions;
  handler: CronHandler;
}

// Must be declared before the job import so the mock factory closure sees it.
const mockCapturedJobs: Record<string, CapturedJob> = {};

let mockBillingEnabled: boolean = false;
let mockEnterpriseEdition: boolean = true;

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, handler: runFunction };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

/*
 * Only the two deployment flags are swapped; everything else in this module
 * stays real. They have to be live accessors rather than values, because
 * object spread compiles to Object.assign, which reads each accessor once and
 * flattens it to whatever it returned at that moment — and the job reads these
 * when it runs, not when it was imported.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    IsDevelopment: false,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  Object.defineProperty(mocked, "IsEnterpriseEdition", {
    get: (): boolean => {
      return mockEnterpriseEdition;
    },
  });

  return mocked;
});

/*
 * Imported after the mocks and after the `mock*` bindings they close over:
 * TypeScript emits requires where the import sits, so an import hoisted above
 * those `let`s would touch them in their temporal dead zone.
 */
import "../../../../FeatureSet/Workers/Jobs/EnterpriseLicense/ReportUserCount";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserService from "Common/Server/Services/UserService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import User from "Common/Models/DatabaseModels/User";
import API from "Common/Utils/API";
import Crypto from "Common/Utils/Crypto";
import Email from "Common/Types/Email";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

const JOB_NAME: string = "EnterpriseLicense:ReportUserCount";
const LICENSE_KEY: string = "acme-license-key";
const INSTANCE_ID: ObjectID = ObjectID.generate();

type SpiedApi = {
  mockResolvedValue: (value: unknown) => void;
  mock: { calls: Array<Array<unknown>> };
};

let apiPost: SpiedApi;

type RunTickFunction = () => Promise<void>;

const runTick: RunTickFunction = async (): Promise<void> => {
  const captured: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

  if (!captured) {
    throw new Error(
      "ReportUserCount did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await captured.handler();
};

type MakeUserFunction = (email: string) => User;

const makeUser: MakeUserFunction = (email: string): User => {
  return { email: new Email(email) } as unknown as User;
};

type RespondFunction = (body: JSONObject, statusCode?: number) => void;

const respondWith: RespondFunction = (
  body: JSONObject,
  statusCode: number = 200,
): void => {
  apiPost.mockResolvedValue(new HTTPResponse<JSONObject>(statusCode, body, {}));
};

/*
 * The body oneuptime.com sends back for a healthy license, matching
 * Common/Server/API/EnterpriseLicenseAPI.ts.
 */
type ServerBodyFunction = (overrides?: JSONObject) => JSONObject;

const serverBody: ServerBodyFunction = (overrides?: JSONObject): JSONObject => {
  return {
    companyName: "Acme Inc",
    expiresAt: "2027-01-01T00:00:00.000Z",
    licenseKey: LICENSE_KEY,
    userLimit: 150,
    currentUserCount: 3,
    userCountUpdatedAt: "2026-08-24T09:59:00.000Z",
    isEvaluationLicense: false,
    instances: [{ instanceId: INSTANCE_ID.toString(), host: "acme.internal" }],
    token: "signed.jwt.token",
    ...overrides,
  };
};

type GetLicenseUpdateFunction = () => JSONObject;

/*
 * The data payload of the single license write. Anything the job persists on
 * the way in (a generated instance id) is filtered out so the assertions are
 * about the sync and nothing else.
 */
const getLicenseUpdate: GetLicenseUpdateFunction = (): JSONObject => {
  const calls: Array<Array<unknown>> = (
    GlobalConfigService.updateOneById as unknown as SpiedApi
  ).mock.calls;

  const licenseWrites: Array<JSONObject> = calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as JSONObject)["data"] as JSONObject;
    })
    .filter((data: JSONObject): boolean => {
      return !Object.prototype.hasOwnProperty.call(data, "instanceId");
    });

  expect(licenseWrites).toHaveLength(1);

  return licenseWrites[0] as JSONObject;
};

describe("EnterpriseLicense:ReportUserCount", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockBillingEnabled = false;
    mockEnterpriseEdition = true;

    (GlobalConfigService.findOneById as unknown as SpiedApi).mockResolvedValue({
      enterpriseLicenseKey: LICENSE_KEY,
      instanceId: INSTANCE_ID,
    } as unknown as GlobalConfig);

    (
      GlobalConfigService.updateOneById as unknown as SpiedApi
    ).mockResolvedValue(undefined);

    (UserService.findBy as unknown as SpiedApi).mockResolvedValue([
      makeUser("a@acme.com"),
      makeUser("b@acme.com"),
      makeUser("c@acme.com"),
    ]);

    apiPost = jest.spyOn(API, "post") as unknown as SpiedApi;

    respondWith(serverBody());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("registration", () => {
    it("runs once a day and does not fire on boot", () => {
      const captured: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

      expect(captured).toBeDefined();
      expect(captured!.options.schedule).toBe(EVERY_DAY);
      expect(captured!.options.runOnStartup).toBe(false);
    });
  });

  describe("who reports", () => {
    it("stays silent on oneuptime.com itself, which issues the licenses", async () => {
      mockBillingEnabled = true;

      await runTick();

      expect(API.post).not.toHaveBeenCalled();
      expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
    });

    it("stays silent on a community edition install", async () => {
      mockEnterpriseEdition = false;

      await runTick();

      expect(API.post).not.toHaveBeenCalled();
    });

    it("stays silent when no license key has been entered yet", async () => {
      (
        GlobalConfigService.findOneById as unknown as SpiedApi
      ).mockResolvedValue({} as unknown as GlobalConfig);

      await runTick();

      expect(API.post).not.toHaveBeenCalled();
      expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("what it reports", () => {
    it("sends the key, the seat count, this instance's identity and its version", async () => {
      await runTick();

      const body: JSONObject = (apiPost.mock.calls[0]![0] as JSONObject)[
        "data"
      ] as JSONObject;

      expect(body["licenseKey"]).toBe(LICENSE_KEY);
      expect(body["userCount"]).toBe(3);
      expect(body["instanceId"]).toBe(INSTANCE_ID.toString());
      expect(body).toHaveProperty("host");
      expect(body).toHaveProperty("version");
    });

    it("sends hashes rather than addresses, so users stay anonymous", async () => {
      await runTick();

      const body: JSONObject = (apiPost.mock.calls[0]![0] as JSONObject)[
        "data"
      ] as JSONObject;

      expect(body["userEmailHashes"]).toEqual([
        Crypto.getSha256Hash("a@acme.com"),
        Crypto.getSha256Hash("b@acme.com"),
        Crypto.getSha256Hash("c@acme.com"),
      ]);
      expect(JSON.stringify(body["userEmailHashes"])).not.toContain("acme.com");
    });

    it("counts the same person once however they capitalized their address", async () => {
      (UserService.findBy as unknown as SpiedApi).mockResolvedValue([
        makeUser("A@Acme.com"),
        makeUser(" a@acme.com "),
      ]);

      await runTick();

      const body: JSONObject = (apiPost.mock.calls[0]![0] as JSONObject)[
        "data"
      ] as JSONObject;

      expect(body["userCount"]).toBe(1);
    });

    it("generates and persists an instance id for an install that predates them", async () => {
      (
        GlobalConfigService.findOneById as unknown as SpiedApi
      ).mockResolvedValue({
        enterpriseLicenseKey: LICENSE_KEY,
      } as unknown as GlobalConfig);

      await runTick();

      const calls: Array<Array<unknown>> = (
        GlobalConfigService.updateOneById as unknown as SpiedApi
      ).mock.calls;

      const instanceWrite: JSONObject | undefined = calls
        .map((call: Array<unknown>): JSONObject => {
          return (call[0] as JSONObject)["data"] as JSONObject;
        })
        .find((data: JSONObject): boolean => {
          return Object.prototype.hasOwnProperty.call(data, "instanceId");
        });

      expect(instanceWrite).toBeDefined();

      const reported: JSONObject = (apiPost.mock.calls[0]![0] as JSONObject)[
        "data"
      ] as JSONObject;

      // The id it persisted is the id it reported.
      expect(reported["instanceId"]).toBe(
        (instanceWrite!["instanceId"] as ObjectID).toString(),
      );
    });
  });

  describe("what it brings back - the reported bug", () => {
    it("stores the seat limit the license server just told it", async () => {
      await runTick();

      expect(getLicenseUpdate()["enterpriseLicenseUserLimit"]).toBe(150);
    });

    it("stores a lowered seat limit too", async () => {
      respondWith(serverBody({ userLimit: 5 }));

      await runTick();

      expect(getLicenseUpdate()["enterpriseLicenseUserLimit"]).toBe(5);
    });

    it("clears the seat limit when the license no longer has one", async () => {
      respondWith(serverBody({ userLimit: null }));

      await runTick();

      const update: JSONObject = getLicenseUpdate();

      expect(Object.keys(update)).toContain("enterpriseLicenseUserLimit");
      expect(update["enterpriseLicenseUserLimit"]).toBeNull();
    });

    it("stores the renewed expiry, the company name and the fresh token", async () => {
      await runTick();

      const update: JSONObject = getLicenseUpdate();

      expect(update["enterpriseLicenseExpiresAt"]).toEqual(
        new Date("2027-01-01T00:00:00.000Z"),
      );
      expect(update["enterpriseCompanyName"]).toBe("Acme Inc");
      expect(update["enterpriseLicenseToken"]).toBe("signed.jwt.token");
    });

    it("stores the deduplicated count across every instance, not this one's count", async () => {
      /*
       * This install has 3 users; the license spans instances totalling 11.
       * The number the customer is measured against is the license-wide one.
       */
      respondWith(serverBody({ currentUserCount: 11 }));

      await runTick();

      expect(getLicenseUpdate()["enterpriseLicenseCurrentUserCount"]).toBe(11);
    });

    it("stores the evaluation flag and the instance list", async () => {
      respondWith(serverBody({ isEvaluationLicense: true }));

      await runTick();

      const update: JSONObject = getLicenseUpdate();

      expect(update["enterpriseLicenseIsEvaluation"]).toBe(true);
      expect(update["enterpriseLicenseInstances"]).toHaveLength(1);
    });

    it("writes to the singleton config row with hooks off", async () => {
      await runTick();

      const calls: Array<Array<unknown>> = (
        GlobalConfigService.updateOneById as unknown as SpiedApi
      ).mock.calls;

      const licenseCall: JSONObject = calls[calls.length - 1]![0] as JSONObject;

      expect((licenseCall["id"] as ObjectID).toString()).toBe(
        ObjectID.getZeroObjectID().toString(),
      );
      expect(licenseCall["props"]).toEqual({
        isRoot: true,
        ignoreHooks: true,
      });
    });

    it("writes the license state exactly once per tick", async () => {
      await runTick();

      expect(GlobalConfigService.updateOneById).toHaveBeenCalledTimes(1);
    });

    it("never adopts a license key handed to it by the response", async () => {
      respondWith(serverBody({ licenseKey: "somebody-elses-key" }));

      await runTick();

      expect(Object.keys(getLicenseUpdate())).not.toContain(
        "enterpriseLicenseKey",
      );
    });
  });

  describe("talking to an oneuptime.com older than this build", () => {
    it("leaves every field the old server never mentions exactly as it was", async () => {
      /*
       * The pre-change /report-user-count body, verbatim. The seat limit was
       * always in it, so the fix works against every deployed license server;
       * the fields added alongside it must be a no-op here rather than a
       * clear, or upgrading ahead of oneuptime.com would blank a live license.
       */
      respondWith({
        currentUserCount: 3,
        userCountUpdatedAt: "2026-08-24T09:59:00.000Z",
        userLimit: 150,
        isEvaluationLicense: false,
        instances: [],
      });

      await runTick();

      const update: JSONObject = getLicenseUpdate();

      expect(update["enterpriseLicenseUserLimit"]).toBe(150);
      expect(Object.keys(update)).not.toContain("enterpriseLicenseExpiresAt");
      expect(Object.keys(update)).not.toContain("enterpriseCompanyName");
      expect(Object.keys(update)).not.toContain("enterpriseLicenseToken");
    });
  });

  describe("when the answer is not what it should be", () => {
    it("keeps the stored license state when the call home fails", async () => {
      apiPost.mockResolvedValue(new HTTPErrorResponse(500, {}, {}));

      await runTick();

      expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("keeps the stored license state when the body is empty", async () => {
      respondWith({});

      await runTick();

      expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it("still syncs the license terms when only the count is unusable", async () => {
      /*
       * The job used to give up here, so one malformed number also cost the
       * customer that day's seat limit and expiry.
       */
      respondWith(serverBody({ currentUserCount: "lots" }));

      await runTick();

      const update: JSONObject = getLicenseUpdate();

      expect(update["enterpriseLicenseUserLimit"]).toBe(150);
      expect(update["enterpriseLicenseExpiresAt"]).toEqual(
        new Date("2027-01-01T00:00:00.000Z"),
      );
      expect(Object.keys(update)).not.toContain(
        "enterpriseLicenseCurrentUserCount",
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("still syncs the count when only the seat limit is unusable", async () => {
      respondWith(serverBody({ userLimit: "one hundred and fifty" }));

      await runTick();

      const update: JSONObject = getLicenseUpdate();

      expect(update["enterpriseLicenseCurrentUserCount"]).toBe(3);
      expect(Object.keys(update)).not.toContain("enterpriseLicenseUserLimit");
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

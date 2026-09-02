import EnterpriseLicenseAPI from "../../../Server/API/EnterpriseLicenseAPI";
import EnterpriseLicenseService from "../../../Server/Services/EnterpriseLicenseService";
import EnterpriseLicenseInstanceService from "../../../Server/Services/EnterpriseLicenseInstanceService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../../Models/DatabaseModels/EnterpriseLicenseInstance";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import PositiveNumber from "../../../Types/PositiveNumber";
import { JSONObject } from "../../../Types/JSON";
import EnterpriseLicenseSyncUtil, {
  EnterpriseLicenseSyncResult,
} from "../../../Utils/EnterpriseLicense/EnterpriseLicenseSync";
import EnterpriseLicenseUsageUtil from "../../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import EnterpriseLicenseUserCountSource from "../../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import EnterpriseLicenseInstanceSummary from "../../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { beforeEach, afterEach, describe, expect, it } from "@jest/globals";

/*
 * The license-server half of the seat-limit sync.
 *
 * /report-user-count is the daily call a self-hosted installation makes, and
 * its response is the ONLY thing that installation can learn from without a
 * human re-typing the license key. It used to answer with the usage numbers
 * and the seat limit but nothing else, and the job on the other end dropped
 * the seat limit on the floor — so raising a customer's limit on oneuptime.com
 * never reached the installation enforcing it.
 *
 * These tests pin the response as a complete statement of the license terms,
 * and pin the one thing that must NOT be unconditional: an expired license
 * still gets a straight answer (it has to keep reporting, the expiry emails
 * are built from those reports) but it does not get a fresh token.
 */

/*
 * PasswordHash carries a pre-existing TS diagnostic that fails any suite whose
 * require graph reaches it, and DatabaseService — the base of every concrete
 * service below — imports it. Replaced with a factory rather than automocked,
 * because an automock still type-checks the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
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

/*
 * Same story as PasswordHash: a pre-existing local-only TS diagnostic in a
 * module the service graph drags in. Nothing here verifies a code.
 */
jest.mock("../../../Server/Utils/VerificationCode", () => {
  return {
    __esModule: true,
    default: {
      generate: jest.fn(),
      hashCode: jest.fn(),
      isHashEqual: jest.fn(),
      generateUnusableHash: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

/*
 * Signed with the server's own secret in production; here it only has to be
 * deterministic and countable, so the expiry gating can be asserted on whether
 * it was called at all.
 */
jest.mock("../../../Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      signJsonPayload: jest.fn().mockReturnValue("signed.jwt.token"),
    },
  };
});

jest.mock("../../../Server/Services/EnterpriseLicenseService");
jest.mock("../../../Server/Services/EnterpriseLicenseInstanceService");

const REPORT_ROUTE: string = "/enterprise-license/report-user-count";
const VALIDATE_ROUTE: string = "/enterprise-license/validate";
const ACTIVE_USAGE_ROUTE: string =
  "/enterprise-license/:enterpriseLicenseId/active-usage";

const LICENSE_ID: ObjectID = ObjectID.generate();
const LICENSE_KEY: string = "acme-license-key";

// A hash the sanitizer accepts: 64 hex characters.
type HashFunction = (seed: string) => string;

const hashOf: HashFunction = (seed: string): string => {
  return seed
    .repeat(64)
    .replace(/[^a-f0-9]/g, "a")
    .substring(0, 64);
};

/*
 * Overrides are loosely typed on purpose: several tests need to express
 * "this column is not set", which exactOptionalPropertyTypes forbids on
 * Partial<EnterpriseLicense>.
 */
type MakeLicenseFunction = (
  overrides?: Record<string, unknown>,
) => EnterpriseLicense;

const makeLicense: MakeLicenseFunction = (
  overrides?: Record<string, unknown>,
): EnterpriseLicense => {
  return {
    id: LICENSE_ID,
    companyName: "Acme Inc",
    licenseKey: LICENSE_KEY,
    expiresAt: OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 90),
    userLimit: 150,
    currentUserCount: 42,
    userCountUpdatedAt: OneUptimeDate.getCurrentDate(),
    isEvaluationLicense: false,
    ...overrides,
  } as unknown as EnterpriseLicense;
};

type MakeInstanceFunction = (
  overrides?: Record<string, unknown>,
) => EnterpriseLicenseInstance;

interface LicenseUsageReportResultForTest {
  reportedAt: Date;
  instances: Array<EnterpriseLicenseInstance>;
  currentUserCount: number;
}

const makeInstance: MakeInstanceFunction = (
  overrides?: Record<string, unknown>,
): EnterpriseLicenseInstance => {
  return {
    id: ObjectID.generate(),
    instanceId: "instance-1",
    host: "oneuptime.acme.internal",
    userCount: 2,
    userEmailHashes: [hashOf("1"), hashOf("2")],
    lastReportedAt: OneUptimeDate.getCurrentDate(),
    oneuptimeVersion: "12.0.19",
    ...overrides,
  } as unknown as EnterpriseLicenseInstance;
};

type GetResponseBodyFunction = () => JSONObject;

/*
 * The third argument of the single sendJsonObjectResponse call: the literal
 * body that goes on the wire.
 */
const getResponseBody: GetResponseBodyFunction = (): JSONObject => {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
};

describe("EnterpriseLicenseAPI POST /enterprise-license/report-user-count", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  type CallRouteFunction = (route?: string) => Promise<void>;

  const callRoute: CallRouteFunction = async (
    route: string = REPORT_ROUTE,
  ): Promise<void> => {
    await mockRouter
      .match("post", route)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    new EnterpriseLicenseAPI();

    EnterpriseLicenseService.findOneBy = jest
      .fn()
      .mockResolvedValue(makeLicense());
    EnterpriseLicenseService.updateOneById = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseService.runWithUsageAggregationLock = jest
      .fn()
      .mockImplementation(
        async (data: { fn: () => Promise<unknown> }): Promise<unknown> => {
          return await data.fn();
        },
      );

    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([]);
    EnterpriseLicenseInstanceService.findOneBy = jest
      .fn()
      .mockResolvedValue(null);
    EnterpriseLicenseInstanceService.updateOneById = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseInstanceService.create = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseInstanceService.countBy = jest
      .fn()
      .mockResolvedValue(new PositiveNumber(0));

    mockRequest = {
      body: {
        licenseKey: LICENSE_KEY,
        userCount: 2,
        instanceId: "instance-1",
        host: "oneuptime.acme.internal",
        version: "12.0.19",
        userEmailHashes: [hashOf("1"), hashOf("2")],
        masterAdminEmails: ["admin@acme.com"],
      },
    } as unknown as OneUptimeRequest;

    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the license terms it reports back", () => {
    it("returns the seat limit, which is the field the installation was missing", async () => {
      await callRoute();

      expect(getResponseBody()["userLimit"]).toBe(150);
    });

    it("returns null for a license with no seat limit, so the limit can be cleared", async () => {
      EnterpriseLicenseService.findOneBy = jest
        .fn()
        .mockResolvedValue(makeLicense({ userLimit: undefined }));

      await callRoute();

      expect(getResponseBody()).toHaveProperty("userLimit", null);
    });

    it("returns the company name and the expiry, so a renewal reaches the installation", async () => {
      const expiresAt: Date = new Date("2027-01-01T00:00:00.000Z");

      EnterpriseLicenseService.findOneBy = jest
        .fn()
        .mockResolvedValue(makeLicense({ expiresAt: expiresAt }));

      await callRoute();

      const body: JSONObject = getResponseBody();

      expect(body["companyName"]).toBe("Acme Inc");
      expect(body["expiresAt"]).toBe("2027-01-01T00:00:00.000Z");
    });

    it("selects the term columns it reports - a trimmed select is how this broke", async () => {
      await callRoute();

      expect(EnterpriseLicenseService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { licenseKey: LICENSE_KEY },
          select: expect.objectContaining({
            companyName: true,
            expiresAt: true,
            licenseKey: true,
            userLimit: true,
            isEvaluationLicense: true,
          }),
        }),
      );
    });

    it("mirrors the evaluation flag", async () => {
      EnterpriseLicenseService.findOneBy = jest
        .fn()
        .mockResolvedValue(makeLicense({ isEvaluationLicense: true }));

      await callRoute();

      expect(getResponseBody()["isEvaluationLicense"]).toBe(true);
    });

    it("reports the usage numbers alongside the terms", async () => {
      await callRoute();

      const body: JSONObject = getResponseBody();

      expect(body["currentUserCount"]).toBe(2);
      expect(typeof body["userCountUpdatedAt"]).toBe("string");
    });
  });

  describe("the token", () => {
    it("mints one for a live license", async () => {
      await callRoute();

      expect(getResponseBody()["token"]).toBe("signed.jwt.token");
      expect(JSONWebToken.signJsonPayload).toHaveBeenCalledTimes(1);
    });

    it("signs the current terms into it, not a stale copy", async () => {
      await callRoute();

      expect(JSONWebToken.signJsonPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          companyName: "Acme Inc",
          licenseKey: LICENSE_KEY,
          userLimit: 150,
        }),
        expect.any(Number),
      );
    });

    it("withholds it once the license has expired, rather than renewing it daily", async () => {
      EnterpriseLicenseService.findOneBy = jest.fn().mockResolvedValue(
        makeLicense({
          expiresAt: OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -1,
          ),
        }),
      );

      await callRoute();

      expect(getResponseBody()).toHaveProperty("token", null);
      expect(JSONWebToken.signJsonPayload).not.toHaveBeenCalled();
    });

    it("still answers an expired license in full, because it must keep reporting", async () => {
      const expiredAt: Date = OneUptimeDate.addRemoveDays(
        OneUptimeDate.getCurrentDate(),
        -1,
      );

      EnterpriseLicenseService.findOneBy = jest
        .fn()
        .mockResolvedValue(makeLicense({ expiresAt: expiredAt }));

      await callRoute();

      const body: JSONObject = getResponseBody();

      /*
       * The expiry notification emails are built from what expired instances
       * keep reporting, so this route deliberately does not reject them the
       * way /validate does. Telling them the truth about the expiry is what
       * makes the installation show itself as expired.
       */
      expect(nextFunction).not.toHaveBeenCalled();
      expect(body["expiresAt"]).toBe(expiredAt.toISOString());
      expect(body["userLimit"]).toBe(150);
    });

    it("withholds it for a license with no expiry set at all", async () => {
      EnterpriseLicenseService.findOneBy = jest
        .fn()
        .mockResolvedValue(makeLicense({ expiresAt: undefined }));

      await callRoute();

      const body: JSONObject = getResponseBody();

      expect(body).toHaveProperty("token", null);
      expect(body).toHaveProperty("expiresAt", null);
    });
  });

  describe("input validation", () => {
    it("rejects a missing license key", async () => {
      mockRequest.body["licenseKey"] = undefined;

      await callRoute();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("License key is required"),
      );
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    it.each([
      ["a missing count", undefined],
      ["a negative count", -1],
      ["a fractional count", 1.5],
      ["a non-numeric count", "many"],
    ])("rejects %s", async (_label: string, value: unknown) => {
      mockRequest.body["userCount"] = value;

      await callRoute();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("userCount must be a non-negative integer"),
      );
    });

    it("accepts a count of zero", async () => {
      mockRequest.body["userCount"] = 0;
      mockRequest.body["userEmailHashes"] = [];

      await callRoute();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getResponseBody()["currentUserCount"]).toBe(0);
    });

    it("rejects an unknown license key", async () => {
      EnterpriseLicenseService.findOneBy = jest.fn().mockResolvedValue(null);

      await callRoute();

      expect(nextFunction).toHaveBeenCalledWith(
        new BadDataException("License key is invalid"),
      );
    });

    it("stays unauthenticated - instances report before anyone signs in", () => {
      expect(mockRouter.match("post", REPORT_ROUTE).middlewares).toHaveLength(
        0,
      );
    });
  });

  describe("usage accounting", () => {
    it("records this instance's usage against the license", async () => {
      await callRoute();

      expect(EnterpriseLicenseInstanceService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            instanceId: "instance-1",
            userCount: 2,
          }),
        }),
      );
      expect(
        EnterpriseLicenseService.runWithUsageAggregationLock,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseId: LICENSE_ID,
          fn: expect.any(Function),
        }),
      );
    });

    it("serializes concurrent reports so an older partial snapshot cannot win", async () => {
      const instanceRows: Array<EnterpriseLicenseInstance> = [];
      const events: Array<string> = [];
      let lockTail: Promise<void> = Promise.resolve();

      EnterpriseLicenseService.runWithUsageAggregationLock = jest
        .fn()
        .mockImplementation(
          async (data: {
            fn: () => Promise<LicenseUsageReportResultForTest>;
          }): Promise<LicenseUsageReportResultForTest> => {
            const predecessor: Promise<void> = lockTail;
            let releaseLock: () => void = (): void => {};
            lockTail = new Promise<void>((resolve: () => void) => {
              releaseLock = resolve;
            });

            await predecessor;
            try {
              return await data.fn();
            } finally {
              releaseLock();
            }
          },
        );
      EnterpriseLicenseInstanceService.findOneBy = jest
        .fn()
        .mockImplementation(
          async (args: {
            query: { instanceId: string };
          }): Promise<EnterpriseLicenseInstance | null> => {
            return (
              instanceRows.find(
                (instance: EnterpriseLicenseInstance): boolean => {
                  return instance.instanceId === args.query.instanceId;
                },
              ) || null
            );
          },
        );
      EnterpriseLicenseInstanceService.create = jest
        .fn()
        .mockImplementation(
          async (args: {
            data: EnterpriseLicenseInstance;
          }): Promise<EnterpriseLicenseInstance> => {
            instanceRows.push(args.data);
            events.push(`upsert:${args.data.instanceId}`);
            await Promise.resolve();
            return args.data;
          },
        );
      EnterpriseLicenseInstanceService.findBy = jest
        .fn()
        .mockImplementation(
          async (): Promise<Array<EnterpriseLicenseInstance>> => {
            events.push(
              `read:${instanceRows
                .map((instance: EnterpriseLicenseInstance): string => {
                  return instance.instanceId || "";
                })
                .join(",")}`,
            );
            await Promise.resolve();
            return [...instanceRows];
          },
        );
      EnterpriseLicenseService.updateOneById = jest
        .fn()
        .mockImplementation(
          async (args: {
            data: { currentUserCount: number };
          }): Promise<number> => {
            events.push(`write:${args.data.currentUserCount}`);
            await Promise.resolve();
            return 1;
          },
        );

      const makeConcurrentRequest: (
        instanceId: string,
        hash: string,
      ) => OneUptimeRequest = (
        instanceId: string,
        hash: string,
      ): OneUptimeRequest => {
        return {
          body: {
            licenseKey: LICENSE_KEY,
            userCount: 1,
            instanceId,
            userEmailHashes: [hash],
          },
        } as unknown as OneUptimeRequest;
      };
      const firstNext: NextFunction = jest.fn();
      const secondNext: NextFunction = jest.fn();
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "post",
        REPORT_ROUTE,
      );

      await Promise.all([
        route.handlerFunction(
          makeConcurrentRequest("instance-a", hashOf("a")),
          mockResponse,
          firstNext,
        ),
        route.handlerFunction(
          makeConcurrentRequest("instance-b", hashOf("b")),
          mockResponse,
          secondNext,
        ),
      ]);

      expect(firstNext).not.toHaveBeenCalled();
      expect(secondNext).not.toHaveBeenCalled();
      expect(events).toEqual([
        "upsert:instance-a",
        "read:instance-a",
        "write:1",
        "upsert:instance-b",
        "read:instance-a,instance-b",
        "write:2",
      ]);
      expect(
        (
          EnterpriseLicenseService.updateOneById as unknown as jest.Mock
        ).mock.calls.map((call: Array<unknown>): number => {
          return (call[0] as { data: { currentUserCount: number } }).data
            .currentUserCount;
        }),
      ).toEqual([1, 2]);
    });

    it("counts a user on two instances once", async () => {
      const shared: string = hashOf("1");

      EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
        makeInstance({
          instanceId: "instance-1",
          userCount: 2,
          userEmailHashes: [shared, hashOf("2")],
        }),
        makeInstance({
          instanceId: "instance-2",
          userCount: 2,
          userEmailHashes: [shared, hashOf("3")],
        }),
      ]);

      await callRoute();

      // Union of {1,2} and {1,3} is three seats, not four.
      expect(getResponseBody()["currentUserCount"]).toBe(3);
    });

    it("writes the deduplicated count back onto the license row", async () => {
      EnterpriseLicenseInstanceService.findBy = jest
        .fn()
        .mockResolvedValue([makeInstance()]);

      await callRoute();

      expect(EnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: LICENSE_ID,
          data: expect.objectContaining({ currentUserCount: 2 }),
        }),
      );
    });

    it("never writes the seat limit back from a report", async () => {
      /*
       * The limit flows one way only: oneuptime.com to the installation. A
       * report that could raise it would make the license meaningless.
       */
      await callRoute();

      const updateCall: JSONObject = (
        EnterpriseLicenseService.updateOneById as unknown as jest.Mock
      ).mock.calls[0]![0] as JSONObject;

      expect(Object.keys(updateCall["data"] as JSONObject)).toEqual([
        "currentUserCount",
        "userCountUpdatedAt",
        "userCountSource",
      ]);
      expect((updateCall["data"] as JSONObject)["userCountSource"]).toBe(
        EnterpriseLicenseUserCountSource.Instance,
      );
    });

    it("marks a week-silent instance inactive, excludes its users, and still lists it", async () => {
      const reportedAt: Date = new Date("2026-09-02T12:00:00.000Z");

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(reportedAt);

      EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
        makeInstance({
          instanceId: "live",
          userCount: 1,
          userEmailHashes: [hashOf("1")],
          lastReportedAt: reportedAt,
        }),
        makeInstance({
          instanceId: "inactive",
          userCount: 2,
          userEmailHashes: [hashOf("2"), hashOf("3")],
          lastReportedAt: new Date(
            reportedAt.getTime() -
              EnterpriseLicenseUsageUtil.InstanceUsageFreshnessInDays *
                24 *
                60 *
                60 *
                1000,
          ),
        }),
      ]);

      await callRoute();

      const body: JSONObject = getResponseBody();

      expect(body["currentUserCount"]).toBe(1);
      expect(body["instances"]).toHaveLength(2);
      expect(body["instances"]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            instanceId: "live",
            isCountedTowardsUsage: true,
          }),
          expect.objectContaining({
            instanceId: "inactive",
            userCount: 2,
            isCountedTowardsUsage: false,
          }),
        ]),
      );
      expect(EnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: LICENSE_ID,
          data: expect.objectContaining({ currentUserCount: 1 }),
        }),
      );
    });

    it("counts users an instance could not send hashes for, so a huge install is not undercounted", async () => {
      /*
       * Hash lists are capped, so an instance may report more users than
       * hashes. The overflow cannot be deduplicated against anyone else and is
       * counted as-is.
       */
      EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
        makeInstance({
          instanceId: "big",
          userCount: 10,
          userEmailHashes: [hashOf("1"), hashOf("2")],
        }),
      ]);

      await callRoute();

      expect(getResponseBody()["currentUserCount"]).toBe(10);
    });

    it("retains a legacy heartbeat without letting it stomp the active modern count", async () => {
      mockRequest.body["instanceId"] = undefined;
      mockRequest.body["userCount"] = 99;

      EnterpriseLicenseInstanceService.findBy = jest
        .fn()
        .mockResolvedValue([makeInstance()]);

      await callRoute();

      expect(getResponseBody()["currentUserCount"]).toBe(2);
      expect(EnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: LICENSE_ID,
          data: {
            legacyUserCount: 99,
            legacyUserCountUpdatedAt: expect.any(Date),
          },
        }),
      );
    });

    it("accepts a live legacy report after every modern instance becomes inactive", async () => {
      const reportedAt: Date = new Date("2026-09-02T12:00:00.000Z");
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(reportedAt);
      mockRequest.body["instanceId"] = undefined;
      mockRequest.body["userCount"] = 19;

      EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
        makeInstance({
          lastReportedAt: OneUptimeDate.addRemoveDays(reportedAt, -7),
          userCount: 50,
        }),
      ]);

      await callRoute();

      expect(getResponseBody()["currentUserCount"]).toBe(19);
      expect(EnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentUserCount: 19,
            legacyUserCount: 19,
            legacyUserCountUpdatedAt: reportedAt,
            userCountSource: EnterpriseLicenseUserCountSource.Legacy,
          }),
        }),
      );
    });

    it("accepts a legacy report while the only tracked instance has registered but not reported usage", async () => {
      mockRequest.body["instanceId"] = undefined;
      mockRequest.body["userCount"] = 19;

      EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
        makeInstance({
          createdAt: OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -1,
          ),
          lastReportedAt: undefined,
          userCount: undefined,
          userEmailHashes: undefined,
        }),
      ]);

      await callRoute();

      expect(getResponseBody()["currentUserCount"]).toBe(19);
      expect(EnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: LICENSE_ID,
          data: expect.objectContaining({ currentUserCount: 19 }),
        }),
      );
    });
  });
});

describe("EnterpriseLicenseAPI GET active usage snapshot", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;
  const calculatedAt: Date = new Date("2026-09-02T12:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();

    new EnterpriseLicenseAPI();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(calculatedAt);

    EnterpriseLicenseService.findOneById = jest
      .fn()
      .mockResolvedValue(makeLicense({ userCountUpdatedAt: calculatedAt }));
    EnterpriseLicenseService.runWithUsageAggregationLock = jest
      .fn()
      .mockImplementation(
        async (data: { fn: () => Promise<unknown> }): Promise<unknown> => {
          return await data.fn();
        },
      );
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([]);

    mockRequest = {
      params: {
        enterpriseLicenseId: LICENSE_ID.toString(),
      },
    } as unknown as OneUptimeRequest;
    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const callRoute: () => Promise<void> = async (): Promise<void> => {
    await mockRouter
      .match("get", ACTIVE_USAGE_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  it("is restricted to authenticated master admins", () => {
    expect(mockRouter.match("get", ACTIVE_USAGE_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  it("returns one cutoff-aligned count and active-instance list without hashes", async () => {
    const active: EnterpriseLicenseInstance = makeInstance({
      lastReportedAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
      userEmailHashes: [hashOf("1"), hashOf("2")],
      masterAdminEmails: [" Admin@Acme.com "],
    });
    const newlyRegistered: EnterpriseLicenseInstance = makeInstance({
      lastReportedAt: undefined,
      createdAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
      userCount: undefined,
      userEmailHashes: undefined,
      masterAdminEmails: ["admin@acme.com", "owner@acme.com"],
    });
    const inactive: EnterpriseLicenseInstance = makeInstance({
      lastReportedAt: OneUptimeDate.addRemoveDays(calculatedAt, -7),
      userCount: 2,
      userEmailHashes: [hashOf("2"), hashOf("3")],
    });

    EnterpriseLicenseInstanceService.findBy = jest
      .fn()
      .mockResolvedValue([active, newlyRegistered, inactive]);

    await callRoute();

    expect(nextFunction).not.toHaveBeenCalled();
    expect(getResponseBody()).toEqual({
      currentUserCount: 2,
      activeInstanceIds: [
        active.id!.toString(),
        newlyRegistered.id!.toString(),
      ],
      masterAdminEmails: ["admin@acme.com", "owner@acme.com"],
      calculatedAt: calculatedAt.toISOString(),
      lastUsageReportedAt: calculatedAt.toISOString(),
      nextInstanceStatusChangeAt: OneUptimeDate.addRemoveDays(
        calculatedAt,
        6,
      ).toISOString(),
    });
    expect(JSON.stringify(getResponseBody())).not.toContain(hashOf("1"));
  });

  it("returns zero when every tracked instance is inactive", async () => {
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
      makeInstance({
        lastReportedAt: OneUptimeDate.addRemoveDays(calculatedAt, -8),
        userCount: 50,
      }),
    ]);

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 0,
        activeInstanceIds: [],
        nextInstanceStatusChangeAt: null,
      }),
    );
  });

  it("uses a fresh legacy count after every modern instance becomes inactive", async () => {
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 17,
        userCountUpdatedAt: OneUptimeDate.addRemoveDays(calculatedAt, -7),
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
      }),
    );
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
      makeInstance({
        lastReportedAt: OneUptimeDate.addRemoveDays(calculatedAt, -7),
        userCount: 50,
      }),
    ]);

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 17,
        activeInstanceIds: [],
      }),
    );
  });

  it("does not preserve an inactive modern aggregate because another instance registered later", async () => {
    const inactiveAt: Date = OneUptimeDate.addRemoveDays(calculatedAt, -7);
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 50,
        userCountUpdatedAt: inactiveAt,
      }),
    );
    const newlyRegistered: EnterpriseLicenseInstance = makeInstance({
      createdAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
      lastReportedAt: undefined,
      userCount: undefined,
      userEmailHashes: undefined,
    });
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
      makeInstance({
        lastReportedAt: inactiveAt,
        userCount: 50,
      }),
      newlyRegistered,
    ]);

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 0,
        activeInstanceIds: [newlyRegistered.id!.toString()],
      }),
    );
  });

  it("schedules an exact refresh when a legacy-only heartbeat expires", async () => {
    const legacyReportedAt: Date = OneUptimeDate.addRemoveDays(
      calculatedAt,
      -1,
    );
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 17,
        userCountUpdatedAt: legacyReportedAt,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: legacyReportedAt,
      }),
    );

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 17,
        activeInstanceIds: [],
        nextInstanceStatusChangeAt: OneUptimeDate.addRemoveDays(
          calculatedAt,
          6,
        ).toISOString(),
      }),
    );
  });

  it("preserves a legacy stored count when no instance rows exist", async () => {
    EnterpriseLicenseService.findOneById = jest
      .fn()
      .mockResolvedValue(makeLicense({ currentUserCount: 17 }));

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 17,
        activeInstanceIds: [],
        nextInstanceStatusChangeAt: OneUptimeDate.addRemoveDays(
          calculatedAt,
          7,
        ).toISOString(),
      }),
    );
  });

  it("preserves a legacy stored count when an instance has registered but not reported usage", async () => {
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 17,
        userCountUpdatedAt: OneUptimeDate.addRemoveDays(calculatedAt, -8),
      }),
    );
    const registeredInstance: EnterpriseLicenseInstance = makeInstance({
      createdAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
      lastReportedAt: undefined,
      userCount: undefined,
      userEmailHashes: undefined,
    });
    EnterpriseLicenseInstanceService.findBy = jest
      .fn()
      .mockResolvedValue([registeredInstance]);

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 17,
        activeInstanceIds: [registeredInstance.id!.toString()],
      }),
    );
  });

  it("drops a legacy count when its report and every registration reach one week old", async () => {
    const inactiveAt: Date = OneUptimeDate.addRemoveDays(calculatedAt, -7);
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 17,
        userCountUpdatedAt: inactiveAt,
      }),
    );
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
      makeInstance({
        createdAt: inactiveAt,
        lastReportedAt: undefined,
        userCount: undefined,
        userEmailHashes: undefined,
      }),
    ]);

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 0,
        activeInstanceIds: [],
        nextInstanceStatusChangeAt: null,
      }),
    );
  });

  it("does not extend an expired dedicated legacy heartbeat with a newer modern timestamp", async () => {
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 17,
        userCountUpdatedAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
        userCountSource: EnterpriseLicenseUserCountSource.Legacy,
        legacyUserCount: 17,
        legacyUserCountUpdatedAt: OneUptimeDate.addRemoveDays(calculatedAt, -7),
      }),
    );

    await callRoute();

    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 0,
        activeInstanceIds: [],
        nextInstanceStatusChangeAt: null,
      }),
    );
  });

  it("selects the legacy report timestamp needed for the bounded fallback", async () => {
    await callRoute();

    expect(EnterpriseLicenseService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          currentUserCount: true,
          userCountUpdatedAt: true,
          userCountSource: true,
          legacyUserCount: true,
          legacyUserCountUpdatedAt: true,
        }),
      }),
    );
  });

  it("serializes the license and instance reads with usage reports", async () => {
    await callRoute();

    expect(
      EnterpriseLicenseService.runWithUsageAggregationLock,
    ).toHaveBeenCalledWith({
      licenseId: LICENSE_ID,
      fn: expect.any(Function),
    });
    expect(
      (EnterpriseLicenseService.findOneById as unknown as jest.Mock).mock
        .invocationCallOrder[0],
    ).toBeGreaterThan(
      (
        EnterpriseLicenseService.runWithUsageAggregationLock as unknown as jest.Mock
      ).mock.invocationCallOrder[0]!,
    );
  });

  it("cannot expose a reported instance with the previous license timestamp", async () => {
    const previousReportAt: Date = OneUptimeDate.addRemoveDays(
      calculatedAt,
      -8,
    );
    const licenseState: EnterpriseLicense = makeLicense({
      currentUserCount: 50,
      userCountUpdatedAt: previousReportAt,
    });
    const instanceState: EnterpriseLicenseInstance = makeInstance({
      lastReportedAt: previousReportAt,
      userCount: 50,
    });
    let lockTail: Promise<void> = Promise.resolve();
    let releaseInstanceUpdate: () => void = (): void => {};
    let markInstanceUpdateStarted: () => void = (): void => {};
    const instanceUpdateStarted: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        markInstanceUpdateStarted = resolve;
      },
    );
    const instanceUpdateGate: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseInstanceUpdate = resolve;
      },
    );

    EnterpriseLicenseService.runWithUsageAggregationLock = jest
      .fn()
      .mockImplementation(
        async (data: { fn: () => Promise<unknown> }): Promise<unknown> => {
          const predecessor: Promise<void> = lockTail;
          let releaseLock: () => void = (): void => {};
          lockTail = new Promise<void>((resolve: () => void) => {
            releaseLock = resolve;
          });

          await predecessor;
          try {
            return await data.fn();
          } finally {
            releaseLock();
          }
        },
      );
    EnterpriseLicenseService.findOneBy = jest
      .fn()
      .mockResolvedValue(licenseState);
    EnterpriseLicenseService.findOneById = jest
      .fn()
      .mockImplementation(async (): Promise<EnterpriseLicense> => {
        return licenseState;
      });
    EnterpriseLicenseService.updateOneById = jest
      .fn()
      .mockImplementation(
        async (args: { data: Partial<EnterpriseLicense> }): Promise<number> => {
          Object.assign(licenseState, args.data);
          return 1;
        },
      );
    EnterpriseLicenseInstanceService.findOneBy = jest
      .fn()
      .mockResolvedValue(instanceState);
    EnterpriseLicenseInstanceService.updateOneById = jest
      .fn()
      .mockImplementation(
        async (args: {
          data: Partial<EnterpriseLicenseInstance>;
        }): Promise<number> => {
          Object.assign(instanceState, args.data);
          markInstanceUpdateStarted();
          await instanceUpdateGate;
          return 1;
        },
      );
    EnterpriseLicenseInstanceService.findBy = jest
      .fn()
      .mockImplementation(
        async (): Promise<Array<EnterpriseLicenseInstance>> => {
          return [instanceState];
        },
      );

    const reportRequest: OneUptimeRequest = {
      body: {
        licenseKey: LICENSE_KEY,
        userCount: 2,
        instanceId: "instance-1",
        userEmailHashes: [hashOf("1"), hashOf("2")],
      },
    } as unknown as OneUptimeRequest;
    const reportPromise: Promise<void> = Promise.resolve(
      mockRouter
        .match("post", REPORT_ROUTE)
        .handlerFunction(reportRequest, mockResponse, nextFunction),
    );

    await instanceUpdateStarted;

    const snapshotPromise: Promise<void> = callRoute();

    releaseInstanceUpdate();
    await Promise.all([reportPromise, snapshotPromise]);

    expect(nextFunction).not.toHaveBeenCalled();
    const responseBodies: Array<JSONObject> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[2] as JSONObject;
    });
    const snapshotBody: JSONObject = responseBodies.find(
      (body: JSONObject): boolean => {
        return Array.isArray(body["activeInstanceIds"]);
      },
    )!;

    expect(snapshotBody["currentUserCount"]).toBe(2);
    expect(snapshotBody["activeInstanceIds"]).toEqual([
      instanceState.id!.toString(),
    ]);
    expect(snapshotBody["lastUsageReportedAt"]).toBe(
      calculatedAt.toISOString(),
    );
  });

  it("does not disclose whether an unknown license has instance usage", async () => {
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(null);

    await callRoute();

    expect(nextFunction).toHaveBeenCalledWith(
      new BadDataException("Enterprise license not found"),
    );
    expect(EnterpriseLicenseInstanceService.findBy).not.toHaveBeenCalled();
  });
});

describe("EnterpriseLicenseAPI POST /enterprise-license/validate", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    new EnterpriseLicenseAPI();

    EnterpriseLicenseService.findOneBy = jest
      .fn()
      .mockResolvedValue(makeLicense());
    EnterpriseLicenseService.findOneById = jest
      .fn()
      .mockResolvedValue(makeLicense());
    EnterpriseLicenseService.runWithUsageAggregationLock = jest
      .fn()
      .mockImplementation(
        async (data: { fn: () => Promise<unknown> }): Promise<unknown> => {
          return await data.fn();
        },
      );
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([]);
    EnterpriseLicenseInstanceService.findOneBy = jest
      .fn()
      .mockResolvedValue(null);
    EnterpriseLicenseInstanceService.create = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseInstanceService.updateOneById = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseInstanceService.countBy = jest
      .fn()
      .mockResolvedValue(new PositiveNumber(0));

    mockRequest = {
      body: {
        licenseKey: LICENSE_KEY,
        instanceId: "instance-1",
        host: "oneuptime.acme.internal",
        version: "12.0.19",
      },
    } as unknown as OneUptimeRequest;

    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("still answers with the same terms after the shared refactor", async () => {
    const expiresAt: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      90,
    );

    EnterpriseLicenseService.findOneBy = jest
      .fn()
      .mockResolvedValue(makeLicense({ expiresAt: expiresAt }));

    await mockRouter
      .match("post", VALIDATE_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();

    const body: JSONObject = getResponseBody();

    expect(body["companyName"]).toBe("Acme Inc");
    expect(body["licenseKey"]).toBe(LICENSE_KEY);
    expect(body["userLimit"]).toBe(150);
    expect(body["expiresAt"]).toBe(expiresAt.toISOString());
    expect(body["token"]).toBe("signed.jwt.token");
  });

  it("serializes registration and re-reads usage inside the aggregation lock", async () => {
    const events: Array<string> = [];
    let isInsideUsageLock: boolean = false;

    EnterpriseLicenseService.runWithUsageAggregationLock = jest
      .fn()
      .mockImplementation(
        async (data: { fn: () => Promise<unknown> }): Promise<unknown> => {
          events.push("lock");
          isInsideUsageLock = true;

          try {
            return await data.fn();
          } finally {
            isInsideUsageLock = false;
          }
        },
      );
    EnterpriseLicenseInstanceService.create = jest
      .fn()
      .mockImplementation(async (): Promise<void> => {
        expect(isInsideUsageLock).toBe(true);
        events.push("register");
      });
    EnterpriseLicenseInstanceService.findBy = jest
      .fn()
      .mockImplementation(
        async (): Promise<Array<EnterpriseLicenseInstance>> => {
          expect(isInsideUsageLock).toBe(true);
          events.push("instances");
          return [];
        },
      );
    EnterpriseLicenseService.findOneById = jest
      .fn()
      .mockImplementation(async (): Promise<EnterpriseLicense> => {
        expect(isInsideUsageLock).toBe(true);
        events.push("license");
        return makeLicense({
          currentUserCount: 17,
          userCountUpdatedAt: new Date("2026-09-01T12:00:00.000Z"),
        });
      });

    await mockRouter
      .match("post", VALIDATE_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(events).toEqual(["lock", "register", "instances", "license"]);
    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 17,
        userCountUpdatedAt: "2026-09-01T12:00:00.000Z",
      }),
    );
    expect(
      EnterpriseLicenseService.runWithUsageAggregationLock,
    ).toHaveBeenCalledWith({
      licenseId: LICENSE_ID,
      fn: expect.any(Function),
    });
  });

  it("returns an active-only aggregate with matching per-instance provenance", async () => {
    const calculatedAt: Date = new Date("2026-09-02T12:00:00.000Z");
    const inactiveInstance: EnterpriseLicenseInstance = makeInstance({
      instanceId: "instance-1",
      userCount: 80,
      lastReportedAt: OneUptimeDate.addRemoveDays(calculatedAt, -7),
    });
    const activeInstance: EnterpriseLicenseInstance = makeInstance({
      instanceId: "instance-2",
      userCount: 100,
      lastReportedAt: OneUptimeDate.addRemoveDays(calculatedAt, -1),
    });

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(calculatedAt);
    EnterpriseLicenseInstanceService.findOneBy = jest
      .fn()
      .mockResolvedValue(inactiveInstance);
    EnterpriseLicenseInstanceService.findBy = jest
      .fn()
      .mockResolvedValue([inactiveInstance, activeInstance]);
    EnterpriseLicenseService.findOneById = jest.fn().mockResolvedValue(
      makeLicense({
        currentUserCount: 180,
        userCountUpdatedAt: calculatedAt,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      }),
    );

    await mockRouter
      .match("post", VALIDATE_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(getResponseBody()).toEqual(
      expect.objectContaining({
        currentUserCount: 100,
        instances: expect.arrayContaining([
          expect.objectContaining({
            instanceId: "instance-1",
            userCount: 80,
            isCountedTowardsUsage: false,
          }),
          expect.objectContaining({
            instanceId: "instance-2",
            userCount: 100,
            isCountedTowardsUsage: true,
          }),
        ]),
      }),
    );
  });

  it("keeps rejecting an expired license, unlike the report route", async () => {
    EnterpriseLicenseService.findOneBy = jest.fn().mockResolvedValue(
      makeLicense({
        expiresAt: OneUptimeDate.addRemoveDays(
          OneUptimeDate.getCurrentDate(),
          -1,
        ),
      }),
    );

    await mockRouter
      .match("post", VALIDATE_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledWith(
      new BadDataException("License key has expired"),
    );
  });
});

describe("the contract between the two halves of the sync", () => {
  let nextFunction: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    new EnterpriseLicenseAPI();

    EnterpriseLicenseService.findOneBy = jest
      .fn()
      .mockResolvedValue(makeLicense());
    EnterpriseLicenseService.updateOneById = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseService.runWithUsageAggregationLock = jest
      .fn()
      .mockImplementation(
        async (data: { fn: () => Promise<unknown> }): Promise<unknown> => {
          return await data.fn();
        },
      );
    EnterpriseLicenseInstanceService.findBy = jest
      .fn()
      .mockResolvedValue([makeInstance()]);
    EnterpriseLicenseInstanceService.findOneBy = jest
      .fn()
      .mockResolvedValue(null);
    EnterpriseLicenseInstanceService.create = jest
      .fn()
      .mockResolvedValue(undefined);
    EnterpriseLicenseInstanceService.countBy = jest
      .fn()
      .mockResolvedValue(new PositiveNumber(0));

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lands every license term when the real response body is fed to the real mapper", async () => {
    /*
     * The end of the bug, asserted end to end: the literal object the license
     * server puts on the wire, through the mapper the installation runs. If
     * either side renames a field, this fails and nothing else has to.
     */
    await mockRouter.match("post", REPORT_ROUTE).handlerFunction(
      {
        body: {
          licenseKey: LICENSE_KEY,
          userCount: 2,
          instanceId: "instance-1",
          host: "oneuptime.acme.internal",
          version: "12.0.19",
          userEmailHashes: [hashOf("1"), hashOf("2")],
          masterAdminEmails: ["admin@acme.com"],
        },
      } as unknown as OneUptimeRequest,
      {
        send: jest.fn(),
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as OneUptimeResponse,
      nextFunction,
    );

    expect(nextFunction).not.toHaveBeenCalled();

    const wireBody: JSONObject = getResponseBody();

    const result: EnterpriseLicenseSyncResult =
      EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
        payload: wireBody,
        reportedAt: OneUptimeDate.getCurrentDate(),
      });

    expect(result.warnings).toEqual([]);
    expect(result.updateData.enterpriseLicenseUserLimit).toBe(150);
    expect(result.updateData.enterpriseLicenseCurrentUserCount).toBe(2);
    expect(result.updateData.enterpriseCompanyName).toBe("Acme Inc");
    expect(result.updateData.enterpriseLicenseIsEvaluation).toBe(false);
    expect(result.updateData.enterpriseLicenseToken).toBe("signed.jwt.token");
    expect(result.updateData.enterpriseLicenseExpiresAt).toBeInstanceOf(Date);
    expect(result.updateData.enterpriseLicenseInstances).toHaveLength(1);
    expect(
      (
        result.updateData.enterpriseLicenseInstances as
          | Array<EnterpriseLicenseInstanceSummary>
          | undefined
      )?.[0]?.isCountedTowardsUsage,
    ).toBe(true);

    // The installation never adopts a key handed to it by a response.
    expect(Object.keys(result.updateData)).not.toContain(
      "enterpriseLicenseKey",
    );
  });
});

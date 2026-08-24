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
      ]);
    });

    it("leaves a decommissioned instance out of the seat count but still lists it", async () => {
      EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([
        makeInstance({
          instanceId: "live",
          userCount: 1,
          userEmailHashes: [hashOf("1")],
        }),
        makeInstance({
          instanceId: "retired",
          userCount: 2,
          userEmailHashes: [hashOf("2"), hashOf("3")],
          lastReportedAt: OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -400,
          ),
        }),
      ]);

      await callRoute();

      const body: JSONObject = getResponseBody();

      expect(body["currentUserCount"]).toBe(1);
      expect(body["instances"]).toHaveLength(2);
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

    it("does not let a legacy report with no instance id stomp the deduplicated count", async () => {
      mockRequest.body["instanceId"] = undefined;
      mockRequest.body["userCount"] = 99;

      EnterpriseLicenseInstanceService.findBy = jest
        .fn()
        .mockResolvedValue([makeInstance()]);

      await callRoute();

      expect(getResponseBody()["currentUserCount"]).toBe(2);
      expect(EnterpriseLicenseService.updateOneById).not.toHaveBeenCalled();
    });
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
    EnterpriseLicenseInstanceService.findBy = jest.fn().mockResolvedValue([]);
    EnterpriseLicenseInstanceService.findOneBy = jest
      .fn()
      .mockResolvedValue(null);
    EnterpriseLicenseInstanceService.create = jest
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

    // The installation never adopts a key handed to it by a response.
    expect(Object.keys(result.updateData)).not.toContain(
      "enterpriseLicenseKey",
    );
  });
});

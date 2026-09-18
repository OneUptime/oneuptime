import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /enterprise-license/:enterpriseLicenseId/offline-token {instanceId}
 *
 * The OneUptime Cloud master admin's "download offline license token": an
 * EdDSA license bound to one installation's instance id. Pinned here: who may
 * call it (master admins, OneUptime Cloud only), what it refuses (bad ids, an
 * expired license, a server without a trusted EdDSA key), and that the token
 * it returns is exactly what an installation of this build accepts - on that
 * instance and no other.
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

jest.mock("Common/Server/Utils/Express", () => {
  const helpers: typeof import("Common/Tests/Server/API/Helpers") =
    jest.requireActual(
      "Common/Tests/Server/API/Helpers",
    ) as typeof import("Common/Tests/Server/API/Helpers");

  return {
    getRouter: () => {
      return helpers.mockRouter;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/EnterpriseLicenseService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
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

import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import EnterpriseLicenseService from "Common/Server/Services/EnterpriseLicenseService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import EnterpriseLicenseOfflineTokenAPI, {
  OFFLINE_LICENSE_TOKEN_ROUTE,
} from "../../../Server/LicenseServer/EnterpriseLicenseOfflineTokenAPI";
import LicenseSigner, {
  ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
} from "../../../Server/LicenseServer/LicenseSigner";
import {
  classifyLicenseToken,
  LicenseTokenClassification,
} from "../../../Server/License/LicenseToken";
import {
  setTrustedLicenseKeysForTests,
  TrustedLicenseKey,
} from "../../../Server/License/TrustedLicenseKeys";
import {
  collectLoggedText,
  decodeTokenPart,
  generateEd25519KeyPair,
  TestKeyPair,
  toPrivatePem,
  toTrustedKey,
} from "./LicenseServerTestKit";

type MockedFn = ReturnType<typeof jest.fn>;

const findOneByIdMock: MockedFn =
  EnterpriseLicenseService.findOneById as unknown as MockedFn;
const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const SIGNING_KEY: TestKeyPair = generateEd25519KeyPair();
const TRUSTED: TrustedLicenseKey = toTrustedKey(SIGNING_KEY);

const LICENSE_ID: string = "4a1f0c2d-5e6b-4c7d-8e9f-a0b1c2d3e4f5";
const INSTANCE_ID: string = "0b6d8f7e-1c2a-4e3b-9d4f-5a6b7c8d9e0f";
const OTHER_INSTANCE_ID: string = "11111111-2222-4333-8444-555555555555";
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const LICENSE_EXPIRES_AT: Date = new Date(
  Math.floor((Date.now() + 200 * DAY_IN_MS) / 1000) * 1000,
);

const makeLicense: (
  overrides?: Record<string, unknown>,
) => EnterpriseLicense = (
  overrides?: Record<string, unknown>,
): EnterpriseLicense => {
  return {
    id: new ObjectID(LICENSE_ID),
    companyName: "Acme Inc",
    licenseKey: "acme-license-key",
    expiresAt: LICENSE_EXPIRES_AT,
    userLimit: 150,
    isEvaluationLicense: false,
    ...(overrides || {}),
  } as unknown as EnterpriseLicense;
};

const useSigningKey: (data: {
  rawKey: string | undefined;
  trustedKeys: ReadonlyArray<TrustedLicenseKey>;
}) => void = (data: {
  rawKey: string | undefined;
  trustedKeys: ReadonlyArray<TrustedLicenseKey>;
}): void => {
  if (data.rawKey === undefined) {
    delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  } else {
    process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] = data.rawKey;
  }

  setTrustedLicenseKeysForTests(data.trustedKeys);
  LicenseSigner.resetForTests();
  LicenseSigner.init();
};

describe("POST /enterprise-license/:enterpriseLicenseId/offline-token", () => {
  let nextFunction: NextFunction;

  const callRoute: (data: {
    licenseId?: string;
    body?: unknown;
  }) => Promise<void> = async (data: {
    licenseId?: string;
    body?: unknown;
  }): Promise<void> => {
    await mockRouter.match("post", OFFLINE_LICENSE_TOKEN_ROUTE).handlerFunction(
      {
        params: { enterpriseLicenseId: data.licenseId ?? LICENSE_ID },
        body: data.body === undefined ? { instanceId: INSTANCE_ID } : data.body,
      } as unknown as OneUptimeRequest,
      {} as unknown as OneUptimeResponse,
      nextFunction,
    );
  };

  const errorPassedToNext: () => Exception = (): Exception => {
    const calls: Array<Array<unknown>> = (nextFunction as unknown as MockedFn)
      .mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    return calls[0]?.[0] as Exception;
  };

  const responseBody: () => JSONObject = (): JSONObject => {
    expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);

    return sendJsonObjectResponseMock.mock.calls[0]?.[2] as JSONObject;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    new EnterpriseLicenseOfflineTokenAPI();

    setTestBillingEnabled(true);
    useSigningKey({
      rawKey: toPrivatePem(SIGNING_KEY),
      trustedKeys: [TRUSTED],
    });
    findOneByIdMock.mockResolvedValue(makeLicense() as never);
    nextFunction = jest.fn() as unknown as NextFunction;
  });

  afterEach(() => {
    setTestBillingEnabled(false);
    delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
    setTrustedLicenseKeysForTests(null);
    LicenseSigner.resetForTests();
  });

  describe("who may call it", () => {
    test("is registered for master admins only", () => {
      expect(
        mockRouter.match("post", OFFLINE_LICENSE_TOKEN_ROUTE).middlewares,
      ).toEqual([MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware]);
    });

    test("the master admin gate refuses a request with no session", async () => {
      const next: NextFunction = jest.fn() as unknown as NextFunction;

      await MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware(
        { headers: {}, cookies: {}, query: {} } as unknown as OneUptimeRequest,
        {} as unknown as OneUptimeResponse,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
      expect((sendErrorResponseMock.mock.calls[0]?.[2] as Exception).code).toBe(
        ExceptionCode.NotAuthorizedException,
      );
    });

    test("is refused outside OneUptime Cloud (billing disabled), before any lookup", async () => {
      setTestBillingEnabled(false);

      await callRoute({});

      expect(errorPassedToNext()).toEqual(
        new BadDataException(
          "Offline license tokens are issued only by OneUptime Cloud.",
        ),
      );
      expect(findOneByIdMock).not.toHaveBeenCalled();
      expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
    });
  });

  describe("what it refuses", () => {
    const BAD_INSTANCE_BODIES: Array<[string, unknown]> = [
      ["no body", {}],
      ["an empty instance id", { instanceId: "" }],
      ["a non-UUID instance id", { instanceId: "prod-cluster" }],
      ["a number", { instanceId: 42 }],
      ["a UUID with trailing junk", { instanceId: `${INSTANCE_ID}x` }],
    ];

    test.each(BAD_INSTANCE_BODIES)(
      "%s, with a 400 that says what an instance id is",
      async (_label: string, body: unknown) => {
        await callRoute({ body });

        const error: Exception = errorPassedToNext();

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toContain("instance ID (a UUID)");
        expect(findOneByIdMock).not.toHaveBeenCalled();
      },
    );

    const UNCONFIGURED_CASES: Array<
      [string, string | undefined, Array<TrustedLicenseKey>]
    > = [
      ["no signing key", undefined, [TRUSTED]],
      ["a signing key this build does not trust", "trusted-later", []],
    ];

    test.each(UNCONFIGURED_CASES)(
      "a server with %s: 400, naming the missing configuration",
      async (
        _label: string,
        rawKey: string | undefined,
        trustedKeys: Array<TrustedLicenseKey>,
      ) => {
        useSigningKey({
          rawKey:
            rawKey === "trusted-later" ? toPrivatePem(SIGNING_KEY) : rawKey,
          trustedKeys,
        });

        await callRoute({});

        const error: Exception = errorPassedToNext();

        expect(error).toBeInstanceOf(BadDataException);
        expect(error.message).toContain("EdDSA license signing");
        expect(error.message).toContain(
          ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
        );
        expect(findOneByIdMock).not.toHaveBeenCalled();
      },
    );

    test("a license id that is not an id: not found, without a lookup", async () => {
      await callRoute({ licenseId: "../../etc" });

      expect(errorPassedToNext()).toEqual(
        new BadDataException("Enterprise license not found"),
      );
      expect(findOneByIdMock).not.toHaveBeenCalled();
    });

    test("an unknown license: not found", async () => {
      findOneByIdMock.mockResolvedValue(null as never);

      await callRoute({});

      expect(errorPassedToNext()).toEqual(
        new BadDataException("Enterprise license not found"),
      );
    });

    const DEAD_LICENSE_CASES: Array<[string, Date | undefined]> = [
      ["has expired", new Date(Date.now() - DAY_IN_MS)],
      ["has no expiry", undefined],
    ];

    test.each(DEAD_LICENSE_CASES)(
      "a license that %s: 400",
      async (_label: string, expiresAt: unknown) => {
        findOneByIdMock.mockResolvedValue(makeLicense({ expiresAt }) as never);

        await callRoute({});

        expect(errorPassedToNext().message).toContain(
          "Renew it before issuing an offline license token",
        );
        expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("the token it issues", () => {
    test("reads the license as root with the columns the token needs", async () => {
      await callRoute({});

      expect(findOneByIdMock).toHaveBeenCalledWith({
        id: new ObjectID(LICENSE_ID),
        select: {
          _id: true,
          companyName: true,
          licenseKey: true,
          expiresAt: true,
          userLimit: true,
          isEvaluationLicense: true,
        },
        props: {
          isRoot: true,
        },
      });
    });

    test("answers with the token, its key id, the license, the instance and the expiry", async () => {
      await callRoute({});

      expect(nextFunction).not.toHaveBeenCalled();

      const body: JSONObject = responseBody();

      expect(Object.keys(body).sort()).toEqual(
        ["expiresAt", "instanceId", "kid", "licenseId", "token"].sort(),
      );
      expect(body["kid"]).toBe(TRUSTED.kid);
      expect(body["licenseId"]).toBe(LICENSE_ID);
      expect(body["instanceId"]).toBe(INSTANCE_ID);
      expect(body["expiresAt"]).toBe(LICENSE_EXPIRES_AT.toISOString());
      expect(decodeTokenPart(body["token"] as string, 0)["alg"]).toBe("EdDSA");
    });

    test("is a verified license on the instance it names, and invalid on any other", async () => {
      await callRoute({});

      const token: string = responseBody()["token"] as string;
      const classifyOn: (
        localInstanceId: string,
      ) => LicenseTokenClassification = (
        localInstanceId: string,
      ): LicenseTokenClassification => {
        return classifyLicenseToken({
          token,
          storedColumns: {},
          now: new Date(),
          trustedKeys: [TRUSTED],
          localInstanceId,
          graceDays: 14,
          acceptUnverified: false,
        });
      };

      const here: LicenseTokenClassification = classifyOn(INSTANCE_ID);

      expect(here.status).toBe("valid");
      expect(here.verification).toBe("verified");
      expect(here.licenseId).toBe(LICENSE_ID);
      expect(here.instanceId).toBe(INSTANCE_ID);
      expect(here.companyName).toBe("Acme Inc");
      expect(here.userLimit).toBe(150);

      const elsewhere: LicenseTokenClassification =
        classifyOn(OTHER_INSTANCE_ID);

      expect(elsewhere.status).toBe("invalid");
      expect(elsewhere.reason).toBe("instance-mismatch");
    });

    test("binds the id as the installation stores it (lower case, trimmed)", async () => {
      await callRoute({
        body: { instanceId: `  ${INSTANCE_ID.toUpperCase()} ` },
      });

      const body: JSONObject = responseBody();

      expect(body["instanceId"]).toBe(INSTANCE_ID);
      expect(decodeTokenPart(body["token"] as string, 1)["instanceId"]).toBe(
        INSTANCE_ID,
      );
    });

    test("is logged as issued - the license and instance, never the token", async () => {
      await callRoute({});

      const token: string = responseBody()["token"] as string;
      const infoMock: MockedFn = logger.info as unknown as MockedFn;
      const logged: string = collectLoggedText([
        infoMock,
        logger.warn as unknown as MockedFn,
        logger.error as unknown as MockedFn,
        logger.debug as unknown as MockedFn,
      ]);

      expect(
        infoMock.mock.calls.some((call: Array<unknown>) => {
          const line: string = String(call[0]);
          return (
            line.includes("offline license token") &&
            line.includes(LICENSE_ID) &&
            line.includes(INSTANCE_ID)
          );
        }),
      ).toBe(true);
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(token.split(".")[2] as string);
    });
  });
});

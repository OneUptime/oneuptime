import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The license server's "Can be white-labelled" switch
 * (EnterpriseLicense.canBeWhiteLabelled), from the license row to the token
 * an installation verifies.
 *
 * What these pin:
 *   - the switch travels in the SIGNED token only - /validate,
 *     /report-user-count and the offline token - as canBeWhiteLabelled: true;
 *   - a license without the switch gets exactly the token it got before the
 *     switch existed: no claim at all, not even false;
 *   - the JSON answers an installation receives never name the switch, on or
 *     off: an installation learns it from nowhere a customer could read
 *     without decoding a token issued to a license that has it;
 *   - the legacy HS256 token, which no installation can verify, never
 *     carries it.
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

jest.mock("Common/Server/Utils/PasswordHash", () => {
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

jest.mock("Common/Server/Utils/VerificationCode", () => {
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

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      signJsonPayload: jest.fn().mockReturnValue("legacy.jwt.token"),
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

jest.mock("Common/Server/Services/EnterpriseLicenseService");
jest.mock("Common/Server/Services/EnterpriseLicenseInstanceService");

import EnterpriseLicenseService from "Common/Server/Services/EnterpriseLicenseService";
import EnterpriseLicenseInstanceService from "Common/Server/Services/EnterpriseLicenseInstanceService";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import Response from "Common/Server/Utils/Response";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "Common/Server/Utils/Express";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import EnterpriseLicenseAPI from "../../../Server/LicenseServer/EnterpriseLicenseAPI";
import EnterpriseLicenseOfflineTokenAPI, {
  OfflineLicenseTokenResponse,
} from "../../../Server/LicenseServer/EnterpriseLicenseOfflineTokenAPI";
import LicenseSigner, {
  ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
  LicenseTokenSubject,
} from "../../../Server/LicenseServer/LicenseSigner";
import {
  classifyLicenseToken,
  LicenseTokenClaims,
  LicenseTokenClassification,
} from "../../../Server/License/LicenseToken";
import {
  setTrustedLicenseKeysForTests,
  TrustedLicenseKey,
} from "../../../Server/License/TrustedLicenseKeys";
import {
  decodeTokenPart,
  generateEd25519KeyPair,
  TestKeyPair,
  toPrivatePem,
  toTrustedKey,
} from "./LicenseServerTestKit";

type MockedFn = ReturnType<typeof jest.fn>;

const SIGNING_KEY: TestKeyPair = generateEd25519KeyPair();
const TRUSTED: TrustedLicenseKey = toTrustedKey(SIGNING_KEY);
const LICENSE_ID: string = "4a1f0c2d-5e6b-4c7d-8e9f-a0b1c2d3e4f5";
const LICENSE_KEY: string = "acme-license-key";
const INSTANCE_ID: string = "0b6d8f7e-1c2a-4e3b-9d4f-5a6b7c8d9e0f";

const VALIDATE_ROUTE: string = "/enterprise-license/validate";
const REPORT_ROUTE: string = "/enterprise-license/report-user-count";

const WHITE_LABEL_WORDS: RegExp = /white.?label/i;

const makeLicense: (canBeWhiteLabelled: boolean) => EnterpriseLicense = (
  canBeWhiteLabelled: boolean,
): EnterpriseLicense => {
  return {
    id: new ObjectID(LICENSE_ID),
    _id: LICENSE_ID,
    companyName: "Acme Reseller Inc",
    licenseKey: LICENSE_KEY,
    expiresAt: OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 90),
    userLimit: 150,
    currentUserCount: 42,
    userCountUpdatedAt: OneUptimeDate.getCurrentDate(),
    isEvaluationLicense: false,
    canBeWhiteLabelled,
  } as unknown as EnterpriseLicense;
};

const subjectFor: (
  overrides?: Partial<LicenseTokenSubject>,
) => LicenseTokenSubject = (
  overrides?: Partial<LicenseTokenSubject>,
): LicenseTokenSubject => {
  return {
    licenseId: LICENSE_ID,
    licenseKey: LICENSE_KEY,
    companyName: "Acme Reseller Inc",
    userLimit: 150,
    isEvaluation: false,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    ...(overrides || {}),
  };
};

const classifyAsInstallation: (
  token: string,
  localInstanceId?: string | null,
) => LicenseTokenClassification = (
  token: string,
  localInstanceId?: string | null,
): LicenseTokenClassification => {
  return classifyLicenseToken({
    token,
    storedColumns: {},
    now: new Date(),
    trustedKeys: [TRUSTED],
    localInstanceId: localInstanceId === undefined ? null : localInstanceId,
    graceDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
    trialDays: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
    acceptUnverified: false,
  });
};

const useSigningKey: () => void = (): void => {
  process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] =
    toPrivatePem(SIGNING_KEY);
  setTrustedLicenseKeysForTests([TRUSTED]);
  LicenseSigner.resetForTests();
  LicenseSigner.init();
};

const useLegacySigning: () => void = (): void => {
  delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  setTrustedLicenseKeysForTests([TRUSTED]);
  LicenseSigner.resetForTests();
  LicenseSigner.init();
};

const getResponseBody: () => JSONObject = (): JSONObject => {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as MockedFn
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
};

const callRoute: (route: string) => Promise<void> = async (
  route: string,
): Promise<void> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("post", route).handlerFunction(
    {
      body: {
        licenseKey: LICENSE_KEY,
        userCount: 2,
        instanceId: "instance-1",
      },
    } as unknown as OneUptimeRequest,
    {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse,
    next,
  );

  expect(next).not.toHaveBeenCalled();
};

const installLicense: (canBeWhiteLabelled: boolean) => void = (
  canBeWhiteLabelled: boolean,
): void => {
  EnterpriseLicenseService.findOneBy = jest
    .fn()
    .mockResolvedValue(makeLicense(canBeWhiteLabelled)) as never;
  EnterpriseLicenseService.findOneById = jest
    .fn()
    .mockResolvedValue(makeLicense(canBeWhiteLabelled)) as never;
};

beforeEach(() => {
  jest.clearAllMocks();
  setTestBillingEnabled(true);

  new EnterpriseLicenseAPI();

  EnterpriseLicenseService.updateOneById = jest
    .fn()
    .mockResolvedValue(undefined) as never;
  EnterpriseLicenseService.runWithUsageAggregationLock = jest
    .fn()
    .mockImplementation((async (data: {
      fn: () => Promise<unknown>;
    }): Promise<unknown> => {
      return await data.fn();
    }) as never) as never;
  EnterpriseLicenseInstanceService.findBy = jest
    .fn()
    .mockResolvedValue([]) as never;
  EnterpriseLicenseInstanceService.findOneBy = jest
    .fn()
    .mockResolvedValue(null) as never;
  EnterpriseLicenseInstanceService.updateOneById = jest
    .fn()
    .mockResolvedValue(undefined) as never;
  EnterpriseLicenseInstanceService.create = jest
    .fn()
    .mockResolvedValue(undefined) as never;
  EnterpriseLicenseInstanceService.countBy = jest
    .fn()
    .mockResolvedValue(new PositiveNumber(0)) as never;
});

afterEach(() => {
  delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  setTrustedLicenseKeysForTests(null);
  LicenseSigner.resetForTests();
  setTestBillingEnabled(false);
});

describe("LicenseSigner.buildClaims", () => {
  test("adds canBeWhiteLabelled: true for a license with the switch on", () => {
    const claims: LicenseTokenClaims = LicenseSigner.buildClaims({
      subject: subjectFor({ canBeWhiteLabelled: true }),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      now: new Date(),
    });

    expect(claims.canBeWhiteLabelled).toBe(true);
  });

  test.each([false, undefined])(
    "leaves the claim out entirely for a license with the switch %s",
    (canBeWhiteLabelled: boolean | undefined) => {
      const claims: LicenseTokenClaims = LicenseSigner.buildClaims({
        subject: subjectFor(
          canBeWhiteLabelled === undefined ? {} : { canBeWhiteLabelled },
        ),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        now: new Date(),
      });

      expect(Object.keys(claims)).not.toContain("canBeWhiteLabelled");
    },
  );
});

describe("EnterpriseLicenseAPI.getTokenSubject", () => {
  test("reads the switch from the license row", () => {
    expect(
      EnterpriseLicenseAPI.getTokenSubject(makeLicense(true))
        .canBeWhiteLabelled,
    ).toBe(true);
    expect(
      EnterpriseLicenseAPI.getTokenSubject(makeLicense(false))
        .canBeWhiteLabelled,
    ).toBe(false);
  });

  test("a row read without the column (an older select) means off", () => {
    const license: EnterpriseLicense = makeLicense(false);
    delete (license as unknown as Record<string, unknown>)[
      "canBeWhiteLabelled"
    ];

    expect(
      EnterpriseLicenseAPI.getTokenSubject(license).canBeWhiteLabelled,
    ).toBe(false);
  });
});

describe.each([
  ["/validate", VALIDATE_ROUTE],
  ["/report-user-count", REPORT_ROUTE],
])("%s with an EdDSA signing key", (_label: string, route: string) => {
  beforeEach(() => {
    useSigningKey();
  });

  test("signs the switch into the token when the license has it", async () => {
    installLicense(true);

    await callRoute(route);

    const token: string = getResponseBody()["token"] as string;
    const classification: LicenseTokenClassification =
      classifyAsInstallation(token);

    expect(classification.reason).toBe("verified");
    expect(classification.canBeWhiteLabelled).toBe(true);
    expect(decodeTokenPart(token, 1)["canBeWhiteLabelled"]).toBe(true);
  });

  test("signs no claim at all when the license does not have it", async () => {
    installLicense(false);

    await callRoute(route);

    const token: string = getResponseBody()["token"] as string;

    expect(classifyAsInstallation(token).canBeWhiteLabelled).toBe(false);
    expect(decodeTokenPart(token, 1)).not.toHaveProperty("canBeWhiteLabelled");
  });

  test.each([true, false])(
    "never names the switch in the JSON answer (switch %s)",
    async (canBeWhiteLabelled: boolean) => {
      installLicense(canBeWhiteLabelled);

      await callRoute(route);

      const body: JSONObject = { ...getResponseBody() };
      delete body["token"];

      expect(Object.keys(body)).not.toContain("canBeWhiteLabelled");
      expect(JSON.stringify(body)).not.toMatch(WHITE_LABEL_WORDS);
    },
  );

  test("reads the switch with the license", async () => {
    installLicense(true);

    await callRoute(route);

    expect(EnterpriseLicenseService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ canBeWhiteLabelled: true }),
      }),
    );
  });
});

describe("the legacy HS256 token (no signing key)", () => {
  test.each([
    ["/validate", VALIDATE_ROUTE],
    ["/report-user-count", REPORT_ROUTE],
  ])(
    "%s signs exactly the payload it always did, without the switch",
    async (_label: string, route: string) => {
      useLegacySigning();
      installLicense(true);

      await callRoute(route);

      const signJsonPayloadMock: MockedFn =
        JSONWebToken.signJsonPayload as unknown as MockedFn;

      expect(signJsonPayloadMock).toHaveBeenCalledTimes(1);
      expect(
        Object.keys(signJsonPayloadMock.mock.calls[0]![0] as JSONObject).sort(),
      ).toEqual(["companyName", "expiresAt", "licenseKey", "userLimit"]);
      expect(getResponseBody()["token"]).toBe("legacy.jwt.token");
    },
  );
});

describe("the offline license token", () => {
  beforeEach(() => {
    useSigningKey();
  });

  test("carries the switch, bound to the installation it is issued for", async () => {
    installLicense(true);

    const issued: OfflineLicenseTokenResponse =
      await EnterpriseLicenseOfflineTokenAPI.issueToken({
        licenseId: LICENSE_ID,
        instanceId: INSTANCE_ID,
      });

    const classification: LicenseTokenClassification = classifyAsInstallation(
      issued.token,
      INSTANCE_ID,
    );

    expect(classification.reason).toBe("verified");
    expect(classification.instanceId).toBe(INSTANCE_ID);
    expect(classification.canBeWhiteLabelled).toBe(true);
  });

  test("carries no claim for a license without the switch", async () => {
    installLicense(false);

    const issued: OfflineLicenseTokenResponse =
      await EnterpriseLicenseOfflineTokenAPI.issueToken({
        licenseId: LICENSE_ID,
        instanceId: INSTANCE_ID,
      });

    expect(decodeTokenPart(issued.token, 1)).not.toHaveProperty(
      "canBeWhiteLabelled",
    );
    expect(
      classifyAsInstallation(issued.token, INSTANCE_ID).canBeWhiteLabelled,
    ).toBe(false);
  });
});

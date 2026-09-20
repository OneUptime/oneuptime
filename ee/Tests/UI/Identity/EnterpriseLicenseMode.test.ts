import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * How the identity screens read the license: GET /api/global-config/license
 * -> Editable / Grace / ReadOnly / NotIncluded / Unknown. The server enforces
 * read-only on its own (402 on create and update); this only decides what the
 * screens show, so the rule that matters most is "never lock a screen on a
 * response we do not understand".
 *
 * NotIncluded: a usable license whose `features` leave out the feature a
 * screen is about. The server does not run that feature (the license must
 * include it - EnterpriseLicenseSnapshotUtil.entitles), so the screen must
 * not report it as running. Only an explicit list that lacks the feature
 * counts: "all", the wildcard, or no readable list never does.
 *
 * Billing is pinned in every test: CI's config.env sets BILLING_ENABLED=true.
 */

let billingEnabledForTest: boolean = false;

jest.mock("Common/UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

const mockFetch: jest.Mock = jest.fn();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockFetch(...args);
      },
    },
  };
});

import {
  EnterpriseLicenseMode,
  LICENSED_FEATURES_WILDCARD,
  LICENSE_ROUTE,
  LicensedFeature,
  READ_ONLY_LICENSE_STATUSES,
  fetchEnterpriseLicenseMode,
  getEnterpriseLicenseMode,
  getEnterpriseLicenseUrl,
  isEnterpriseConfigurationReadOnly,
  isFeatureLeftOutOfLicense,
} from "../../../Dashboard/SSO/License/EnterpriseLicenseMode";
import EnterpriseFeature, {
  ENTERPRISE_FEATURE_WILDCARD,
} from "Common/Server/Enterprise/EnterpriseFeature";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

const answer: (
  isSuccess: boolean,
  data: JSONObject | null,
) => { isSuccess: () => boolean; data: JSONObject | null } = (
  isSuccess: boolean,
  data: JSONObject | null,
): { isSuccess: () => boolean; data: JSONObject | null } => {
  return {
    isSuccess: (): boolean => {
      return isSuccess;
    },
    data,
  };
};

beforeEach(() => {
  billingEnabledForTest = false;
  mockFetch.mockReset();
});

afterEach(() => {
  billingEnabledForTest = false;
});

describe("getEnterpriseLicenseMode", () => {
  test.each([
    ["valid", EnterpriseLicenseMode.Editable],
    ["grace", EnterpriseLicenseMode.Grace],
    ["missing", EnterpriseLicenseMode.ReadOnly],
    ["expired", EnterpriseLicenseMode.ReadOnly],
    ["invalid", EnterpriseLicenseMode.ReadOnly],
  ])(
    "snapshot status %s -> %s",
    (status: string, mode: EnterpriseLicenseMode) => {
      expect(getEnterpriseLicenseMode({ status })).toBe(mode);
    },
  );

  test("the snapshot status wins over licenseValid", () => {
    expect(
      getEnterpriseLicenseMode({ status: "expired", licenseValid: true }),
    ).toBe(EnterpriseLicenseMode.ReadOnly);
    expect(
      getEnterpriseLicenseMode({ status: "grace", licenseValid: true }),
    ).toBe(EnterpriseLicenseMode.Grace);
    expect(
      getEnterpriseLicenseMode({ status: "valid", licenseValid: false }),
    ).toBe(EnterpriseLicenseMode.Editable);
  });

  test("falls back to licenseValid from a server that sends no status", () => {
    expect(getEnterpriseLicenseMode({ licenseValid: true })).toBe(
      EnterpriseLicenseMode.Editable,
    );
    expect(getEnterpriseLicenseMode({ licenseValid: false })).toBe(
      EnterpriseLicenseMode.ReadOnly,
    );
  });

  test.each([
    ["no payload", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["an unknown status", { status: "suspended" }],
    ["a non-string status", { status: 3 }],
    ["a non-boolean licenseValid", { licenseValid: "false" }],
  ])(
    "never locks a screen on a response it does not understand (%s)",
    (_name: string, payload: unknown) => {
      expect(
        getEnterpriseLicenseMode(payload as JSONObject | null | undefined),
      ).toBe(EnterpriseLicenseMode.Unknown);
    },
  );

  test("the read-only statuses are the snapshot's unusable ones", () => {
    expect([...READ_ONLY_LICENSE_STATUSES].sort()).toEqual(
      ["expired", "invalid", "missing"].sort(),
    );
  });
});

describe("the license features a screen is about", () => {
  test("LicensedFeature values are the server's EnterpriseFeature values (the license format)", () => {
    expect(LicensedFeature.SSO).toBe(EnterpriseFeature.SSO);
    expect(LicensedFeature.SCIM).toBe(EnterpriseFeature.SCIM);
    expect(LicensedFeature.AuditLogs).toBe(EnterpriseFeature.AuditLogs);
    expect(LICENSED_FEATURES_WILDCARD).toBe(ENTERPRISE_FEATURE_WILDCARD);

    const serverValues: Array<string> = Object.values(EnterpriseFeature);

    for (const value of Object.values(LicensedFeature)) {
      expect(serverValues).toContain(value);
    }
  });

  test.each([
    ["a list without it", { features: ["scim", "audit-logs"] }, true],
    ["an empty list", { features: [] }, true],
    ["a list with it", { features: ["sso"] }, false],
    ["a list with the wildcard", { features: ["scim", "*"] }, false],
    ['"all"', { features: "all" }, false],
    ["no features field (an older server)", {}, false],
    ["null", { features: null }, false],
    ["a list that is not all names", { features: ["scim", 3] }, false],
    ["a string that is not all", { features: "sso" }, false],
  ])(
    "SSO left out of %s: %s",
    (_name: string, payload: JSONObject, leftOut: boolean) => {
      expect(isFeatureLeftOutOfLicense(payload, LicensedFeature.SSO)).toBe(
        leftOut,
      );
    },
  );

  test("no payload never leaves anything out", () => {
    expect(isFeatureLeftOutOfLicense(null, LicensedFeature.SSO)).toBe(false);
    expect(isFeatureLeftOutOfLicense(undefined, LicensedFeature.SCIM)).toBe(
      false,
    );
  });

  test.each([
    [
      "valid",
      { status: "valid", features: ["scim"] },
      EnterpriseLicenseMode.NotIncluded,
    ],
    [
      "in its grace period",
      { status: "grace", features: ["scim"] },
      EnterpriseLicenseMode.NotIncluded,
    ],
    [
      "valid, by licenseValid alone",
      { licenseValid: true, features: ["scim"] },
      EnterpriseLicenseMode.NotIncluded,
    ],
    // A lapse says more than "not included": everything stopped.
    [
      "expired",
      { status: "expired", features: ["scim"] },
      EnterpriseLicenseMode.ReadOnly,
    ],
    [
      "missing",
      { status: "missing", features: [] },
      EnterpriseLicenseMode.ReadOnly,
    ],
    // Nothing is claimed on an answer this does not understand.
    [
      "unknown status",
      { status: "suspended", features: ["scim"] },
      EnterpriseLicenseMode.Unknown,
    ],
  ])(
    "a license %s that leaves SSO out -> %s on an SSO screen",
    (_name: string, payload: JSONObject, mode: EnterpriseLicenseMode) => {
      expect(getEnterpriseLicenseMode(payload, LicensedFeature.SSO)).toBe(mode);
    },
  );

  test("only the screen's own feature matters", () => {
    const payload: JSONObject = { status: "valid", features: ["scim"] };

    expect(getEnterpriseLicenseMode(payload, LicensedFeature.SSO)).toBe(
      EnterpriseLicenseMode.NotIncluded,
    );
    expect(getEnterpriseLicenseMode(payload, LicensedFeature.SCIM)).toBe(
      EnterpriseLicenseMode.Editable,
    );
    expect(getEnterpriseLicenseMode(payload, LicensedFeature.AuditLogs)).toBe(
      EnterpriseLicenseMode.NotIncluded,
    );
  });

  test.each([
    ["every feature", { status: "valid", features: "all" }],
    ["the wildcard", { status: "valid", features: ["*"] }],
    ["no features field", { status: "valid" }],
    ["an unreadable features field", { status: "valid", features: 7 }],
  ])(
    "a valid license with %s stays Editable on every screen",
    (_name: string, payload: JSONObject) => {
      for (const feature of Object.values(LicensedFeature)) {
        expect(getEnterpriseLicenseMode(payload, feature)).toBe(
          EnterpriseLicenseMode.Editable,
        );
      }
    },
  );

  test("a screen that names no feature never gets NotIncluded", () => {
    expect(getEnterpriseLicenseMode({ status: "valid", features: [] })).toBe(
      EnterpriseLicenseMode.Editable,
    );
    expect(getEnterpriseLicenseMode({ status: "grace", features: [] })).toBe(
      EnterpriseLicenseMode.Grace,
    );
  });
});

describe("isEnterpriseConfigurationReadOnly", () => {
  test.each([
    [EnterpriseLicenseMode.ReadOnly, true],
    [EnterpriseLicenseMode.NotIncluded, true],
    [EnterpriseLicenseMode.Grace, false],
    [EnterpriseLicenseMode.Editable, false],
    [EnterpriseLicenseMode.Unknown, false],
  ])("%s -> %s", (mode: EnterpriseLicenseMode, readOnly: boolean) => {
    expect(isEnterpriseConfigurationReadOnly(mode)).toBe(readOnly);
  });
});

describe("fetchEnterpriseLicenseMode", () => {
  test("asks GET /api/global-config/license", async () => {
    mockFetch.mockResolvedValue(answer(true, { status: "valid" }));

    await expect(fetchEnterpriseLicenseMode()).resolves.toBe(
      EnterpriseLicenseMode.Editable,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const options: { method: HTTPMethod; url: URL } = mockFetch.mock
      .calls[0]![0] as { method: HTTPMethod; url: URL };

    expect(options.method).toBe(HTTPMethod.GET);
    expect(options.url.toString()).toBe(getEnterpriseLicenseUrl().toString());
    expect(options.url.toString()).toContain("/global-config/license");
    expect(LICENSE_ROUTE.toString()).toBe("/global-config/license");
  });

  test.each([
    [{ status: "expired" }, EnterpriseLicenseMode.ReadOnly],
    [{ status: "grace" }, EnterpriseLicenseMode.Grace],
    [{ licenseValid: false }, EnterpriseLicenseMode.ReadOnly],
  ])(
    "maps the answer %j -> %s",
    async (payload: JSONObject, mode: EnterpriseLicenseMode) => {
      mockFetch.mockResolvedValue(answer(true, payload));

      await expect(fetchEnterpriseLicenseMode()).resolves.toBe(mode);
    },
  );

  test("passes the screen's feature on: a license that leaves it out is NotIncluded", async () => {
    mockFetch.mockResolvedValue(
      answer(true, { status: "valid", features: ["sso", "scim"] }),
    );

    await expect(
      fetchEnterpriseLicenseMode(LicensedFeature.AuditLogs),
    ).resolves.toBe(EnterpriseLicenseMode.NotIncluded);
    await expect(fetchEnterpriseLicenseMode(LicensedFeature.SSO)).resolves.toBe(
      EnterpriseLicenseMode.Editable,
    );
    await expect(fetchEnterpriseLicenseMode()).resolves.toBe(
      EnterpriseLicenseMode.Editable,
    );
  });

  test("a failed request is Unknown, not read-only", async () => {
    mockFetch.mockResolvedValue(answer(false, { status: "expired" }));

    await expect(fetchEnterpriseLicenseMode()).resolves.toBe(
      EnterpriseLicenseMode.Unknown,
    );
  });

  test("a thrown request is Unknown, and never rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    await expect(fetchEnterpriseLicenseMode()).resolves.toBe(
      EnterpriseLicenseMode.Unknown,
    );
  });

  test("OneUptime Cloud (billing on) never asks: plans gate these features there", async () => {
    billingEnabledForTest = true;
    mockFetch.mockResolvedValue(answer(true, { status: "missing" }));

    await expect(fetchEnterpriseLicenseMode()).resolves.toBe(
      EnterpriseLicenseMode.Editable,
    );
    await expect(fetchEnterpriseLicenseMode(LicensedFeature.SSO)).resolves.toBe(
      EnterpriseLicenseMode.Editable,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * How the identity screens read the license: GET /api/global-config/license
 * -> Editable / Grace / ReadOnly / Unknown. The server enforces read-only on
 * its own (402 on create and update); this only decides what the screens
 * show, so the rule that matters most is "never lock a screen on a response
 * we do not understand".
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
  LICENSE_ROUTE,
  READ_ONLY_LICENSE_STATUSES,
  fetchEnterpriseLicenseMode,
  getEnterpriseLicenseMode,
  getEnterpriseLicenseUrl,
  isEnterpriseConfigurationReadOnly,
} from "../../../Dashboard/SSO/License/EnterpriseLicenseMode";
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

describe("isEnterpriseConfigurationReadOnly", () => {
  test.each([
    [EnterpriseLicenseMode.ReadOnly, true],
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
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

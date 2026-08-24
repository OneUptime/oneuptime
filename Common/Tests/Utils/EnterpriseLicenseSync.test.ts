import EnterpriseLicenseSyncUtil, {
  EnterpriseLicenseSyncResult,
} from "../../Utils/EnterpriseLicense/EnterpriseLicenseSync";
import { JSONObject } from "../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * The mapper that turns a license-server response into the GlobalConfig
 * columns a self-hosted installation mirrors.
 *
 * This exists because of a real, reported bug: a customer raised their seat
 * limit on oneuptime.com, their installation called home every day as
 * designed, and the modal kept showing the old limit forever. The daily job
 * read four fields out of the response and silently dropped userLimit, and the
 * only other writer of that column is a human re-typing the license key.
 *
 * Every field here is three-state, and keeping those states apart IS the
 * contract:
 *
 *   key absent -> leave the stored column alone. This is what an oneuptime.com
 *                 older than the installation looks like, and collapsing it to
 *                 null would let a daily report wipe a valid license expiry
 *                 and take the installation down.
 *   null       -> the server means "no value"; write null.
 *   a value    -> validate, then write.
 *
 * The absent case cannot be asserted with toBeUndefined(): reading a missing
 * key and reading a key set to undefined both give undefined, and only one of
 * them is safe to hand to updateOneById. Every "left alone" assertion below
 * therefore goes through Object.keys / toHaveProperty.
 */

const REPORTED_AT: Date = new Date("2026-08-24T10:00:00.000Z");

type SyncFunction = (payload: JSONObject) => EnterpriseLicenseSyncResult;

const sync: SyncFunction = (
  payload: JSONObject,
): EnterpriseLicenseSyncResult => {
  return EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
    payload: payload,
    reportedAt: REPORTED_AT,
  });
};

type KeysFunction = (payload: JSONObject) => Array<string>;

const keys: KeysFunction = (payload: JSONObject): Array<string> => {
  return Object.keys(sync(payload).updateData);
};

/*
 * The exact body Common/Server/API/EnterpriseLicenseAPI.ts sends from
 * /report-user-count for a healthy license. Kept in one place so the contract
 * test at the bottom and the happy-path tests cannot drift apart.
 */
type ServerResponseFunction = (overrides?: JSONObject) => JSONObject;

const serverResponse: ServerResponseFunction = (
  overrides?: JSONObject,
): JSONObject => {
  return {
    companyName: "Acme Inc",
    expiresAt: "2027-01-01T00:00:00.000Z",
    licenseKey: "the-key-the-server-knows",
    userLimit: 150,
    currentUserCount: 42,
    userCountUpdatedAt: "2026-08-24T09:59:00.000Z",
    isEvaluationLicense: false,
    instances: [
      {
        instanceId: "instance-1",
        host: "oneuptime.acme.internal",
        userCount: 42,
        lastReportedAt: "2026-08-24T09:59:00.000Z",
        version: "12.0.19",
      },
    ],
    token: "signed.jwt.token",
    ...overrides,
  };
};

describe("EnterpriseLicenseSyncUtil - the reported bug: the seat limit", () => {
  it("writes a raised seat limit, which is the regression this whole file guards", () => {
    const result: EnterpriseLicenseSyncResult = sync({ userLimit: 150 });

    expect(result.updateData.enterpriseLicenseUserLimit).toBe(150);
    expect(result.warnings).toEqual([]);
  });

  it("writes a lowered seat limit too - the sync is not one-directional", () => {
    expect(sync({ userLimit: 5 }).updateData.enterpriseLicenseUserLimit).toBe(
      5,
    );
  });

  it("writes an explicit null, so clearing the limit on oneuptime.com clears it here", () => {
    const result: EnterpriseLicenseSyncResult = sync({ userLimit: null });

    expect(Object.keys(result.updateData)).toContain(
      "enterpriseLicenseUserLimit",
    );
    expect(result.updateData.enterpriseLicenseUserLimit).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it("leaves the stored limit alone when the server never mentions it", () => {
    // An oneuptime.com older than this build. Must be a no-op, not a clear.
    expect(keys({ currentUserCount: 3 })).not.toContain(
      "enterpriseLicenseUserLimit",
    );
  });

  it("treats an explicit undefined as silence, not as a clear", () => {
    expect(keys({ userLimit: undefined })).not.toContain(
      "enterpriseLicenseUserLimit",
    );
  });

  it("writes zero rather than skipping it on a truthiness check", () => {
    const result: EnterpriseLicenseSyncResult = sync({ userLimit: 0 });

    expect(Object.keys(result.updateData)).toContain(
      "enterpriseLicenseUserLimit",
    );
    expect(result.updateData.enterpriseLicenseUserLimit).toBe(0);
  });

  it.each([
    ["a numeric string", "150"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a fraction", 12.5],
    ["a negative number", -1],
    ["a boolean", true],
    ["an object", {}],
    ["an array", [150]],
  ])(
    "refuses to store %s as the seat limit, and says so",
    (_label: string, value: unknown) => {
      const result: EnterpriseLicenseSyncResult = sync({
        userLimit: value,
      } as JSONObject);

      expect(Object.keys(result.updateData)).not.toContain(
        "enterpriseLicenseUserLimit",
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("userLimit");
    },
  );
});

describe("EnterpriseLicenseSyncUtil - user count and its timestamp", () => {
  it("stores the deduplicated count the server computed across every instance", () => {
    const result: EnterpriseLicenseSyncResult = sync({
      currentUserCount: 42,
      userCountUpdatedAt: "2026-08-24T09:59:00.000Z",
    });

    expect(result.updateData.enterpriseLicenseCurrentUserCount).toBe(42);
    expect(result.updateData.enterpriseLicenseUserCountUpdatedAt).toEqual(
      new Date("2026-08-24T09:59:00.000Z"),
    );
  });

  it("falls back to the caller's clock when the server sends a count but no stamp", () => {
    const result: EnterpriseLicenseSyncResult = sync({ currentUserCount: 7 });

    expect(result.updateData.enterpriseLicenseUserCountUpdatedAt).toEqual(
      REPORTED_AT,
    );
  });

  it("falls back to the caller's clock when the stamp is unparseable", () => {
    const result: EnterpriseLicenseSyncResult = sync({
      currentUserCount: 7,
      userCountUpdatedAt: "last tuesday",
    });

    expect(result.updateData.enterpriseLicenseUserCountUpdatedAt).toEqual(
      REPORTED_AT,
    );
  });

  it("stores a count of zero", () => {
    const result: EnterpriseLicenseSyncResult = sync({ currentUserCount: 0 });

    expect(result.updateData.enterpriseLicenseCurrentUserCount).toBe(0);
  });

  it("never stamps a timestamp onto a count it did not store", () => {
    /*
     * A fresh stamp on a stale count is the specific lie that made this bug
     * hard to see: the modal reads "last reported today" underneath a number
     * from weeks ago.
     */
    const result: EnterpriseLicenseSyncResult = sync({
      currentUserCount: "many",
      userCountUpdatedAt: "2026-08-24T09:59:00.000Z",
    } as JSONObject);

    expect(Object.keys(result.updateData)).not.toContain(
      "enterpriseLicenseCurrentUserCount",
    );
    expect(Object.keys(result.updateData)).not.toContain(
      "enterpriseLicenseUserCountUpdatedAt",
    );
  });

  it.each([
    ["a string", "42"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a fraction", 4.5],
    ["a negative number", -3],
  ])(
    "keeps the previously stored usage when the count arrives as %s",
    (_label: string, value: unknown) => {
      const result: EnterpriseLicenseSyncResult = sync({
        currentUserCount: value,
      } as JSONObject);

      expect(Object.keys(result.updateData)).not.toContain(
        "enterpriseLicenseCurrentUserCount",
      );
      expect(result.warnings).toHaveLength(1);
    },
  );

  it("keeps the previously stored usage when the server reports null", () => {
    const result: EnterpriseLicenseSyncResult = sync({
      currentUserCount: null,
    });

    expect(Object.keys(result.updateData)).not.toContain(
      "enterpriseLicenseCurrentUserCount",
    );
    expect(result.warnings).toHaveLength(1);
  });

  it("leaves both usage columns alone when the server never mentions the count", () => {
    expect(keys({ userLimit: 10 })).toEqual(["enterpriseLicenseUserLimit"]);
  });

  it("still syncs everything else when only the count is unusable", () => {
    /*
     * The job used to bail out entirely here, so one malformed count also cost
     * the customer that day's seat limit, expiry and evaluation flag.
     */
    const result: EnterpriseLicenseSyncResult = sync(
      serverResponse({ currentUserCount: "nope" }),
    );

    expect(result.updateData.enterpriseLicenseUserLimit).toBe(150);
    expect(result.updateData.enterpriseLicenseExpiresAt).toEqual(
      new Date("2027-01-01T00:00:00.000Z"),
    );
    expect(result.updateData.enterpriseLicenseIsEvaluation).toBe(false);
    expect(result.updateData.enterpriseCompanyName).toBe("Acme Inc");
    expect(result.updateData.enterpriseLicenseToken).toBe("signed.jwt.token");
  });
});

describe("EnterpriseLicenseSyncUtil - expiry", () => {
  it("stores a renewal, so extending a license on oneuptime.com reaches the installation", () => {
    const result: EnterpriseLicenseSyncResult = sync({
      expiresAt: "2027-01-01T00:00:00.000Z",
    });

    expect(result.updateData.enterpriseLicenseExpiresAt).toEqual(
      new Date("2027-01-01T00:00:00.000Z"),
    );
  });

  it("stores an expiry in the past, because an instance must be able to learn it expired", () => {
    const result: EnterpriseLicenseSyncResult = sync({
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    expect(result.updateData.enterpriseLicenseExpiresAt).toEqual(
      new Date("2020-01-01T00:00:00.000Z"),
    );
  });

  it("leaves the stored expiry alone when the server never mentions it", () => {
    /*
     * The compatibility case that matters most: an installation upgraded ahead
     * of oneuptime.com must not have its expiry blanked and go dark.
     */
    expect(keys({ currentUserCount: 1 })).not.toContain(
      "enterpriseLicenseExpiresAt",
    );
  });

  it("treats an explicit null as silence - a report never strips an expiry", () => {
    expect(keys({ expiresAt: null })).not.toContain(
      "enterpriseLicenseExpiresAt",
    );
    expect(sync({ expiresAt: null }).warnings).toEqual([]);
  });

  it.each([
    ["an unparseable string", "not a date"],
    ["an empty string", ""],
    ["a number", 1767225600000],
    ["a boolean", true],
  ])(
    "keeps the stored expiry when the server sends %s, and says so",
    (_label: string, value: unknown) => {
      const result: EnterpriseLicenseSyncResult = sync({
        expiresAt: value,
      } as JSONObject);

      expect(Object.keys(result.updateData)).not.toContain(
        "enterpriseLicenseExpiresAt",
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("expiresAt");
    },
  );

  it("accepts a Date instance, in case the transport ever deserializes one", () => {
    const expiry: Date = new Date("2027-06-01T00:00:00.000Z");

    expect(
      sync({ expiresAt: expiry }).updateData.enterpriseLicenseExpiresAt,
    ).toEqual(expiry);
  });
});

describe("EnterpriseLicenseSyncUtil - evaluation flag", () => {
  it.each([
    [true, true],
    [false, false],
  ])(
    "mirrors the boolean the server sent (%s)",
    (value: boolean, expected: boolean) => {
      expect(
        sync({ isEvaluationLicense: value }).updateData
          .enterpriseLicenseIsEvaluation,
      ).toBe(expected);
    },
  );

  it("leaves the stored flag alone when the server never mentions it", () => {
    expect(keys({ userLimit: 1 })).not.toContain(
      "enterpriseLicenseIsEvaluation",
    );
  });

  it.each([
    ['the string "true"', "true"],
    ["a number", 1],
    ["null", null],
  ])(
    "refuses to guess at %s and keeps the stored flag",
    (_label: string, value: unknown) => {
      const result: EnterpriseLicenseSyncResult = sync({
        isEvaluationLicense: value,
      } as JSONObject);

      expect(Object.keys(result.updateData)).not.toContain(
        "enterpriseLicenseIsEvaluation",
      );
      expect(result.warnings).toHaveLength(1);
    },
  );
});

describe("EnterpriseLicenseSyncUtil - company name", () => {
  it("stores a rename", () => {
    expect(
      sync({ companyName: "Acme Inc" }).updateData.enterpriseCompanyName,
    ).toBe("Acme Inc");
  });

  it("trims what it stores", () => {
    expect(
      sync({ companyName: "  Acme Inc  " }).updateData.enterpriseCompanyName,
    ).toBe("Acme Inc");
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["null", null],
    ["a number", 42],
  ])(
    "keeps the stored name rather than blanking the modal for %s",
    (_label: string, value: unknown) => {
      expect(
        Object.keys(sync({ companyName: value } as JSONObject).updateData),
      ).not.toContain("enterpriseCompanyName");
    },
  );

  it("leaves the stored name alone when the server never mentions it", () => {
    expect(keys({ userLimit: 1 })).not.toContain("enterpriseCompanyName");
  });
});

describe("EnterpriseLicenseSyncUtil - token", () => {
  it("stores a freshly signed token", () => {
    expect(sync({ token: "a.b.c" }).updateData.enterpriseLicenseToken).toBe(
      "a.b.c",
    );
  });

  it.each([
    ["null, as an expired license gets", null],
    ["an empty string", ""],
    ["a non-string", 7],
  ])(
    "never clears the stored token for %s",
    (_label: string, value: unknown) => {
      /*
       * An expired license is legitimately issued no token. Clearing the stored
       * one would compound an expiry the customer may be in the middle of
       * renewing, and the refreshed expiresAt already tells the truth.
       */
      expect(
        Object.keys(sync({ token: value } as JSONObject).updateData),
      ).not.toContain("enterpriseLicenseToken");
    },
  );

  it("leaves the stored token alone when the server never mentions it", () => {
    expect(keys({ userLimit: 1 })).not.toContain("enterpriseLicenseToken");
  });
});

describe("EnterpriseLicenseSyncUtil - instances", () => {
  it("stores the instance list", () => {
    const instances: Array<JSONObject> = [
      { instanceId: "a", host: "a.example.com" },
    ];

    expect(
      sync({ instances: instances } as JSONObject).updateData
        .enterpriseLicenseInstances,
    ).toEqual(instances);
  });

  it("stores an empty list, so a license that lost its instances shows none", () => {
    const result: EnterpriseLicenseSyncResult = sync({ instances: [] });

    expect(Object.keys(result.updateData)).toContain(
      "enterpriseLicenseInstances",
    );
    expect(result.updateData.enterpriseLicenseInstances).toEqual([]);
  });

  it.each([
    ["null", null],
    ["an object", {}],
    ["a string", "instance"],
  ])(
    "keeps the stored list when the server sends %s",
    (_label: string, value: unknown) => {
      const result: EnterpriseLicenseSyncResult = sync({
        instances: value,
      } as JSONObject);

      expect(Object.keys(result.updateData)).not.toContain(
        "enterpriseLicenseInstances",
      );
      expect(result.warnings).toHaveLength(1);
    },
  );

  it("leaves the stored list alone when the server never mentions it", () => {
    expect(keys({ userLimit: 1 })).not.toContain("enterpriseLicenseInstances");
  });
});

describe("EnterpriseLicenseSyncUtil - what it must never write", () => {
  it("never syncs the license key back onto the installation", () => {
    /*
     * The installation authenticates with the key it already holds. A response
     * must not be able to swap it for a different one.
     */
    expect(keys(serverResponse())).not.toContain("enterpriseLicenseKey");
  });

  it("never invents columns from unknown fields", () => {
    expect(
      keys({ somethingNew: "from a future oneuptime.com" } as JSONObject),
    ).toEqual([]);
  });

  it("returns an empty update for an empty response rather than a pile of nulls", () => {
    const result: EnterpriseLicenseSyncResult = sync({});

    expect(result.updateData).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("survives a null payload", () => {
    const result: EnterpriseLicenseSyncResult =
      EnterpriseLicenseSyncUtil.getGlobalConfigUpdateFromLicenseResponse({
        payload: null as unknown as JSONObject,
        reportedAt: REPORTED_AT,
      });

    expect(result.updateData).toEqual({});
  });
});

describe("EnterpriseLicenseSyncUtil - the whole response at once", () => {
  it("mirrors every field of a healthy report", () => {
    const result: EnterpriseLicenseSyncResult = sync(serverResponse());

    expect(result.warnings).toEqual([]);
    expect(result.updateData).toEqual({
      enterpriseCompanyName: "Acme Inc",
      enterpriseLicenseExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
      enterpriseLicenseUserLimit: 150,
      enterpriseLicenseCurrentUserCount: 42,
      enterpriseLicenseUserCountUpdatedAt: new Date("2026-08-24T09:59:00.000Z"),
      enterpriseLicenseIsEvaluation: false,
      enterpriseLicenseToken: "signed.jwt.token",
      enterpriseLicenseInstances: [
        {
          instanceId: "instance-1",
          host: "oneuptime.acme.internal",
          userCount: 42,
          lastReportedAt: "2026-08-24T09:59:00.000Z",
          version: "12.0.19",
        },
      ],
    });
  });

  it("is a no-op against the response an oneuptime.com from before this change would send", () => {
    /*
     * The old /report-user-count body, verbatim. userLimit already shipped in
     * it, so the fix works against every deployed license server; the fields
     * added alongside it must simply be left alone.
     */
    const legacyBody: JSONObject = {
      currentUserCount: 42,
      userCountUpdatedAt: "2026-08-24T09:59:00.000Z",
      userLimit: 150,
      isEvaluationLicense: false,
      instances: [],
    };

    const result: EnterpriseLicenseSyncResult = sync(legacyBody);

    expect(result.warnings).toEqual([]);
    expect(Object.keys(result.updateData).sort()).toEqual([
      "enterpriseLicenseCurrentUserCount",
      "enterpriseLicenseInstances",
      "enterpriseLicenseIsEvaluation",
      "enterpriseLicenseUserCountUpdatedAt",
      "enterpriseLicenseUserLimit",
    ]);
    expect(result.updateData.enterpriseLicenseUserLimit).toBe(150);
  });
});

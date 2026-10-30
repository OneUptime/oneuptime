import { describe, expect, test } from "@jest/globals";
import {
  ALL_DATA_STORE_EXPOSURES,
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DATA_STORE_EXPOSURE_WEIGHT,
  DataStoreExposure,
  DataStorePostureFacts,
  getDataStoreExposure,
  tlsVersionNumber,
} from "../../../Types/DataSecurity/DataStorePosture";

/*
 * WHERE A STORE SITS, FROM ITS FACTS.
 *
 * Public beats shared with other accounts, which beats reachable from the
 * internet. A store is Private only when nothing that decides it is
 * missing: a policy or network fact the reader could not read (null) makes
 * it Unknown, unless another fact settles it - public access blocked
 * outright, public network access off.
 */

const READ_AT: string = "2026-10-27T11:00:00Z";

function exposureOf(
  facts: Omit<DataStorePostureFacts, "readAt">,
): DataStoreExposure {
  return getDataStoreExposure({ readAt: READ_AT, ...facts });
}

describe("getDataStoreExposure", () => {
  test("is Unknown when nothing was read", () => {
    expect(getDataStoreExposure(null)).toBe(DataStoreExposure.Unknown);
    expect(getDataStoreExposure(undefined)).toBe(DataStoreExposure.Unknown);
    expect(getDataStoreExposure({ publicRead: true })).toBe(
      DataStoreExposure.Unknown,
    );
  });

  test("is Public when anyone can read or write the store or restore a snapshot of it", () => {
    expect(exposureOf({ publicRead: true })).toBe(DataStoreExposure.Public);
    expect(exposureOf({ publicRead: false, publicWrite: true })).toBe(
      DataStoreExposure.Public,
    );
    expect(exposureOf({ snapshotPublic: true })).toBe(DataStoreExposure.Public);
  });

  test("puts Public before every other exposure", () => {
    expect(
      exposureOf({
        publicRead: true,
        sharedWithExternal: ["123456789012"],
        publicNetworkAccess: true,
        openToAllAddresses: true,
      }),
    ).toBe(DataStoreExposure.Public);
    // A fact that could not be read does not hide one that says Public.
    expect(exposureOf({ publicRead: null, snapshotPublic: true })).toBe(
      DataStoreExposure.Public,
    );
  });

  test("is Other accounts when outsiders hold access, before reachability", () => {
    expect(exposureOf({ sharedWithExternal: ["123456789012"] })).toBe(
      DataStoreExposure.OtherAccounts,
    );
    expect(exposureOf({ snapshotSharedWith: ["123456789012"] })).toBe(
      DataStoreExposure.OtherAccounts,
    );
    expect(
      exposureOf({
        sharedWithExternal: ["123456789012"],
        publicNetworkAccess: true,
      }),
    ).toBe(DataStoreExposure.OtherAccounts);
    expect(
      exposureOf({ publicRead: null, sharedWithExternal: ["tenant-2"] }),
    ).toBe(DataStoreExposure.OtherAccounts);
  });

  test("is Internet reachable when its endpoint or firewall lets the internet in", () => {
    expect(exposureOf({ publicNetworkAccess: true })).toBe(
      DataStoreExposure.InternetReachable,
    );
    expect(
      exposureOf({ publicNetworkAccess: false, openToAllAddresses: true }),
    ).toBe(DataStoreExposure.InternetReachable);
    expect(exposureOf({ publicRead: null, publicNetworkAccess: true })).toBe(
      DataStoreExposure.InternetReachable,
    );
  });

  test("is Unknown when the store's policy could not be read", () => {
    expect(exposureOf({ publicRead: null, publicWrite: false })).toBe(
      DataStoreExposure.Unknown,
    );
    expect(exposureOf({ publicRead: false, publicWrite: null })).toBe(
      DataStoreExposure.Unknown,
    );
    expect(exposureOf({ publicRead: null, blockPublicAccess: false })).toBe(
      DataStoreExposure.Unknown,
    );
    expect(exposureOf({ publicRead: null, blockPublicAccess: null })).toBe(
      DataStoreExposure.Unknown,
    );
  });

  test("is Private when public access is blocked outright, whatever the policy says", () => {
    expect(
      exposureOf({
        publicRead: null,
        publicWrite: null,
        blockPublicAccess: true,
      }),
    ).toBe(DataStoreExposure.Private);
  });

  test("is Unknown when the network rules could not be read", () => {
    expect(exposureOf({ publicNetworkAccess: null })).toBe(
      DataStoreExposure.Unknown,
    );
    expect(
      exposureOf({ publicNetworkAccess: null, openToAllAddresses: false }),
    ).toBe(DataStoreExposure.Unknown);
    expect(exposureOf({ openToAllAddresses: null })).toBe(
      DataStoreExposure.Unknown,
    );
  });

  test("is Private when public network access is off, so the firewall's rules do not matter", () => {
    expect(
      exposureOf({ publicNetworkAccess: false, openToAllAddresses: null }),
    ).toBe(DataStoreExposure.Private);
  });

  test("is Private when every fact that decides it says so", () => {
    expect(
      exposureOf({
        publicRead: false,
        publicWrite: false,
        blockPublicAccess: false,
        publicNetworkAccess: false,
        openToAllAddresses: false,
        sharedWithExternal: [],
        snapshotSharedWith: [],
        snapshotPublic: false,
      }),
    ).toBe(DataStoreExposure.Private);
  });

  test("is Private for a kind with no reachability facts at all", () => {
    // A DynamoDB table or an EFS file system: only encryption and recovery.
    expect(
      exposureOf({ encryptedAtRest: true, pointInTimeRecovery: false }),
    ).toBe(DataStoreExposure.Private);
    expect(exposureOf({})).toBe(DataStoreExposure.Private);
  });

  test("leaves facts other than reachability out of it", () => {
    expect(
      exposureOf({
        encryptedAtRest: null,
        accessLogging: null,
        versioning: null,
      }),
    ).toBe(DataStoreExposure.Private);
  });
});

describe("exposure labels and weights", () => {
  test("describe and weigh every exposure, most exposed heaviest", () => {
    for (const exposure of ALL_DATA_STORE_EXPOSURES) {
      expect(DATA_STORE_EXPOSURE_DESCRIPTION[exposure].length).toBeGreaterThan(
        0,
      );
      expect(DATA_STORE_EXPOSURE_WEIGHT[exposure]).toBeGreaterThanOrEqual(0);
      expect(DATA_STORE_EXPOSURE_WEIGHT[exposure]).toBeLessThanOrEqual(1);
    }

    expect(
      DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.Public],
    ).toBeGreaterThan(
      DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.OtherAccounts],
    );
    expect(
      DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.OtherAccounts],
    ).toBeGreaterThan(
      DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.InternetReachable],
    );
    expect(
      DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.InternetReachable],
    ).toBeGreaterThan(DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.Unknown]);
    expect(
      DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.Unknown],
    ).toBeGreaterThan(DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.Private]);
    expect(DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.Private]).toBe(0);
  });
});

describe("tlsVersionNumber", () => {
  test.each([
    ["1.0", 1],
    ["1.1", 1.1],
    ["1.2", 1.2],
    ["TLS1_0", 1],
    ["TLS1_2", 1.2],
    ["TLSv1.3", 1.3],
    ["TLS 1.1", 1.1],
    ["tls1.2", 1.2],
  ])("reads %j as %d", (version: string, number: number) => {
    expect(tlsVersionNumber(version)).toBeCloseTo(number);
  });

  test("is 0 for no version or one it cannot read", () => {
    expect(tlsVersionNumber(null)).toBe(0);
    expect(tlsVersionNumber(undefined)).toBe(0);
    expect(tlsVersionNumber("")).toBe(0);
    expect(tlsVersionNumber("modern")).toBe(0);
  });

  test("orders versions as people mean them", () => {
    expect(tlsVersionNumber("TLS1_0")).toBeLessThan(tlsVersionNumber("1.2"));
    expect(tlsVersionNumber("1.2")).toBeLessThan(tlsVersionNumber("TLSv1.3"));
  });
});

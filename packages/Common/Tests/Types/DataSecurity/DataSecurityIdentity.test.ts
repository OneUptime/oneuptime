import {
  DATA_SECURITY_IDENTITY_TYPES,
  DataSecurityIdentityReach,
  IDENTITY_BREADTH_POINTS,
  IDENTITY_SENSITIVITY_POINTS,
  getDataSecurityIdentityKey,
  getIdentityRiskFactors,
  getIdentityRiskScore,
  higherAccessLevel,
  isChangingAccessLevel,
  isSensitiveForAccess,
} from "../../../Types/DataSecurity/DataSecurityIdentity";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "../../../Types/DataSecurity/DataStoreAccess";
import { describe, expect, test } from "@jest/globals";

/*
 * How much harm an identity could do with what it reaches, from 0 to 100:
 * the most sensitive data it reaches, whether it can change sensitive
 * data, whether it is anyone at all or outside the connected accounts,
 * whether it goes unused while reaching something sensitive, and how many
 * sensitive stores it reaches - each part named, as the identity's page
 * shows them.
 */

function reach(
  extra: Partial<DataSecurityIdentityReach> = {},
): DataSecurityIdentityReach {
  return {
    highestSensitivity: DataSensitivity.Public,
    canChangeSensitiveData: false,
    isPublic: false,
    isExternal: false,
    isUnused: false,
    sensitiveStoreCount: 0,
    ...extra,
  };
}

describe("an identity's risk score", () => {
  test("reaching nothing sensitive, from inside, is no risk", () => {
    expect(getIdentityRiskFactors(reach())).toEqual([]);
    expect(getIdentityRiskScore(reach())).toBe(0);
  });

  test("each part, named, with its points", () => {
    expect(
      getIdentityRiskFactors(
        reach({
          highestSensitivity: DataSensitivity.Restricted,
          canChangeSensitiveData: true,
          isExternal: true,
          isUnused: true,
          sensitiveStoreCount: 3,
        }),
      ),
    ).toEqual([
      { label: "Reaches Restricted data", points: 50 },
      { label: "Can change sensitive data", points: 15 },
      { label: "Outside your accounts", points: 15 },
      { label: "Not used lately", points: 10 },
      { label: "Sensitive stores it reaches", points: 3 },
    ]);
  });

  test("anyone on the internet counts once, above outside", () => {
    expect(
      getIdentityRiskFactors(reach({ isPublic: true, isExternal: true })),
    ).toEqual([{ label: "Anyone on the internet", points: 20 }]);
  });

  test("going unused counts only for an identity that reaches something sensitive", () => {
    expect(getIdentityRiskScore(reach({ isUnused: true }))).toBe(0);
    expect(
      getIdentityRiskScore(
        reach({
          isUnused: true,
          highestSensitivity: DataSensitivity.Internal,
        }),
      ),
    ).toBe(IDENTITY_SENSITIVITY_POINTS[DataSensitivity.Internal] + 10);
  });

  test("breadth counts up to its cap, and the score never passes 100", () => {
    expect(
      getIdentityRiskScore(
        reach({
          highestSensitivity: DataSensitivity.Confidential,
          sensitiveStoreCount: 400,
        }),
      ),
    ).toBe(30 + IDENTITY_BREADTH_POINTS);
    expect(
      getIdentityRiskScore(
        reach({
          highestSensitivity: DataSensitivity.Restricted,
          canChangeSensitiveData: true,
          isPublic: true,
          isUnused: true,
          sensitiveStoreCount: 40,
        }),
      ),
    ).toBe(100);
  });

  test("a sensitivity that is not one is Public; negative or fractional counts round down to nothing more", () => {
    expect(
      getIdentityRiskScore(
        reach({
          highestSensitivity: "Secret" as DataSensitivity,
          sensitiveStoreCount: -3,
        }),
      ),
    ).toBe(0);
    expect(
      getIdentityRiskScore(
        reach({
          highestSensitivity: DataSensitivity.Confidential,
          sensitiveStoreCount: 2.9,
        }),
      ),
    ).toBe(32);
  });
});

describe("levels, sensitivity and keys", () => {
  test("the higher of two access levels; nothing reads as nothing", () => {
    expect(
      higherAccessLevel(DataStoreAccessLevel.Read, DataStoreAccessLevel.Admin),
    ).toBe(DataStoreAccessLevel.Admin);
    expect(higherAccessLevel(undefined, DataStoreAccessLevel.Write)).toBe(
      DataStoreAccessLevel.Write,
    );
    expect(higherAccessLevel(DataStoreAccessLevel.Read, "Owner")).toBe(
      DataStoreAccessLevel.Read,
    );
    expect(higherAccessLevel(undefined, undefined)).toBeUndefined();
  });

  test("Write and Admin change data; Read does not", () => {
    expect(isChangingAccessLevel(DataStoreAccessLevel.Write)).toBe(true);
    expect(isChangingAccessLevel(DataStoreAccessLevel.Admin)).toBe(true);
    expect(isChangingAccessLevel(DataStoreAccessLevel.Read)).toBe(false);
    expect(isChangingAccessLevel(undefined)).toBe(false);
  });

  test("Confidential and Restricted are what an identity's reach counts", () => {
    expect(isSensitiveForAccess(DataSensitivity.Restricted)).toBe(true);
    expect(isSensitiveForAccess(DataSensitivity.Confidential)).toBe(true);
    expect(isSensitiveForAccess(DataSensitivity.Internal)).toBe(false);
    expect(isSensitiveForAccess(DataSensitivity.Public)).toBe(false);
    expect(isSensitiveForAccess("Top secret")).toBe(false);
  });

  test("an identity's key is its principal, trimmed and bounded, its case kept", () => {
    expect(getDataSecurityIdentityKey("  arn:aws:iam::1:role/App  ")).toBe(
      "arn:aws:iam::1:role/App",
    );
    expect(getDataSecurityIdentityKey("x".repeat(600))).toHaveLength(500);
    expect(getDataSecurityIdentityKey("")).toBe("");
  });

  test("every principal type an access entry has, the public first", () => {
    expect([...DATA_SECURITY_IDENTITY_TYPES].sort()).toEqual(
      Object.values(DataStorePrincipalType).sort(),
    );
    expect(DATA_SECURITY_IDENTITY_TYPES[0]).toBe(DataStorePrincipalType.Public);
  });
});

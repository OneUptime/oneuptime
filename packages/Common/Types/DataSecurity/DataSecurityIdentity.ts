import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "./DataSensitivity";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "./DataStoreAccess";

/*
 * WHO CAN REACH THE PROJECT'S DATA, ONE IDENTITY AT A TIME.
 *
 * Access is read store by store - each store's grants (DataStoreAccess) -
 * but the questions people ask of it are about identities: what can this
 * role reach, who can read card numbers, which identities could do the
 * most harm, which have not been used in months. So every principal that
 * reaches a store is also one DataSecurityIdentity, worked out by the
 * evaluator from all of its grants: how many stores it reaches and how
 * sensitive the most sensitive one is, whether it can change sensitive
 * data, whether it is outside the project's connected accounts or anyone
 * at all, when it was last used, and a risk score that ranks identities
 * by the harm they could do.
 *
 * Kept free of anything server-only: the Dashboard explains the score with
 * the same parts the server added up.
 */

// What the evaluator adds up for one identity, from all of its grants.
export interface DataSecurityIdentityReach {
  highestSensitivity: DataSensitivity;
  // Write or Admin on a Confidential or Restricted store.
  canChangeSensitiveData: boolean;
  isPublic: boolean;
  isExternal: boolean;
  isUnused: boolean;
  // Confidential or Restricted stores it reaches.
  sensitiveStoreCount: number;
}

// The points the most sensitive data an identity reaches is worth.
export const IDENTITY_SENSITIVITY_POINTS: Readonly<
  Record<DataSensitivity, number>
> = {
  [DataSensitivity.Restricted]: 50,
  [DataSensitivity.Confidential]: 30,
  [DataSensitivity.Internal]: 10,
  [DataSensitivity.Public]: 0,
};

export const IDENTITY_CHANGE_POINTS: number = 15;
export const IDENTITY_PUBLIC_POINTS: number = 20;
export const IDENTITY_EXTERNAL_POINTS: number = 15;
export const IDENTITY_UNUSED_POINTS: number = 10;
// One point for each sensitive store it reaches, up to this many.
export const IDENTITY_BREADTH_POINTS: number = 5;

export interface IdentityRiskFactor {
  // What the part is, in a few words, for the identity's page.
  label: string;
  points: number;
}

/*
 * The parts of an identity's risk score, each with its points: what it
 * reaches, whether it can change it, who it is - anyone at all, or outside
 * the connected accounts - whether it goes unused (access nobody needs,
 * only when it reaches something sensitive) and how many sensitive stores
 * it reaches.
 */
export function getIdentityRiskFactors(
  reach: DataSecurityIdentityReach,
): Array<IdentityRiskFactor> {
  const factors: Array<IdentityRiskFactor> = [];
  const sensitivity: DataSensitivity = isDataSensitivity(
    reach.highestSensitivity,
  )
    ? reach.highestSensitivity
    : DataSensitivity.Public;
  const sensitivityPoints: number = IDENTITY_SENSITIVITY_POINTS[sensitivity];

  if (sensitivityPoints > 0) {
    factors.push({
      label: `Reaches ${sensitivity} data`,
      points: sensitivityPoints,
    });
  }

  if (reach.canChangeSensitiveData) {
    factors.push({
      label: "Can change sensitive data",
      points: IDENTITY_CHANGE_POINTS,
    });
  }

  if (reach.isPublic) {
    factors.push({
      label: "Anyone on the internet",
      points: IDENTITY_PUBLIC_POINTS,
    });
  } else if (reach.isExternal) {
    factors.push({
      label: "Outside your accounts",
      points: IDENTITY_EXTERNAL_POINTS,
    });
  }

  if (reach.isUnused && sensitivityPoints > 0) {
    factors.push({
      label: "Not used in 90 days",
      points: IDENTITY_UNUSED_POINTS,
    });
  }

  const breadth: number = Math.min(
    IDENTITY_BREADTH_POINTS,
    Math.max(0, Math.floor(reach.sensitiveStoreCount)),
  );

  if (breadth > 0) {
    factors.push({ label: "Sensitive stores it reaches", points: breadth });
  }

  return factors;
}

// The identity's risk score, from 0 to 100: its factors' points added up.
export function getIdentityRiskScore(reach: DataSecurityIdentityReach): number {
  const total: number = getIdentityRiskFactors(reach).reduce(
    (sum: number, factor: IdentityRiskFactor): number => {
      return sum + factor.points;
    },
    0,
  );

  return Math.max(0, Math.min(100, total));
}

const LEVEL_RANK: Readonly<Record<DataStoreAccessLevel, number>> = {
  [DataStoreAccessLevel.Admin]: 3,
  [DataStoreAccessLevel.Write]: 2,
  [DataStoreAccessLevel.Read]: 1,
};

// The higher of two access levels; undefined reads as nothing.
export function higherAccessLevel(
  a: DataStoreAccessLevel | string | undefined,
  b: DataStoreAccessLevel | string | undefined,
): DataStoreAccessLevel | undefined {
  const rankOf: (level: string | undefined) => number = (
    level: string | undefined,
  ): number => {
    return level && level in LEVEL_RANK
      ? LEVEL_RANK[level as DataStoreAccessLevel]
      : 0;
  };

  if (rankOf(a) === 0 && rankOf(b) === 0) {
    return undefined;
  }

  return (rankOf(a) >= rankOf(b) ? a : b) as DataStoreAccessLevel;
}

// Whether a level changes data: Write or Admin.
export function isChangingAccessLevel(
  level: DataStoreAccessLevel | string | undefined,
): boolean {
  return (
    level === DataStoreAccessLevel.Write || level === DataStoreAccessLevel.Admin
  );
}

// Whether a sensitivity is Confidential or above: data an identity's reach counts.
export function isSensitiveForAccess(
  sensitivity: DataSensitivity | string | undefined,
): boolean {
  return (
    isDataSensitivity(sensitivity) &&
    DATA_SENSITIVITY_RANK[sensitivity] >=
      DATA_SENSITIVITY_RANK[DataSensitivity.Confidential]
  );
}

/*
 * One identity's key within its project: its principal as its cloud
 * writes it, trimmed and bounded. Two stores' grants to one principal are
 * one identity; the case of an ARN or an email is kept, as the clouds keep
 * it.
 */
export function getDataSecurityIdentityKey(principal: string): string {
  return (principal || "").trim().slice(0, 500);
}

// The principal types an identity can be, in the order lists filter them.
export const DATA_SECURITY_IDENTITY_TYPES: ReadonlyArray<DataStorePrincipalType> =
  [
    DataStorePrincipalType.Public,
    DataStorePrincipalType.Account,
    DataStorePrincipalType.Role,
    DataStorePrincipalType.User,
    DataStorePrincipalType.Group,
    DataStorePrincipalType.ServicePrincipal,
    DataStorePrincipalType.ServiceAccount,
    DataStorePrincipalType.Service,
  ];

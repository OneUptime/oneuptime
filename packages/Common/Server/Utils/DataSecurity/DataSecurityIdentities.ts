import DataSecurityIdentity from "../../../Models/DatabaseModels/DataSecurityIdentity";
import DataSecurityIdentityService from "../../Services/DataSecurityIdentityService";
import logger from "../Logger";
import {
  DataSecurityIdentityReach,
  getDataSecurityIdentityKey,
  getIdentityRiskScore,
  higherAccessLevel,
  isChangingAccessLevel,
  isSensitiveForAccess,
} from "../../../Types/DataSecurity/DataSecurityIdentity";
import DataSensitivity, {
  isDataSensitivity,
  moreSensitive,
} from "../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreAccessLevel,
  isAccessUnused,
} from "../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreProvider } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * EVERY IDENTITY THAT REACHES THE PROJECT'S DATA, WORKED OUT FROM ITS
 * GRANTS.
 *
 * After a project's stores are evaluated, each principal of their grants
 * (DataStoreAccess) - and of the services seen using them in traces - is
 * one DataSecurityIdentity: the stores it reaches, how sensitive the most
 * sensitive one is now, the data types in its sensitive stores, the most
 * it may do and whether it can change sensitive data, whether it is
 * outside the connected accounts or anyone at all, when it was last used,
 * and its risk score (Types/DataSecurity/DataSecurityIdentity). Archived
 * stores are not read, so what they let in no longer counts.
 *
 * An identity is unused when some grant says so and none shows it used
 * lately: two clouds can know one principal, and either one's recent use
 * is use.
 *
 * Rows are written only when what they hold changed, and an identity that
 * reaches nothing any more is removed with the evaluation that found it so.
 */

// The most identities one project keeps: the riskiest are written first.
export const MAX_IDENTITIES_PER_PROJECT: number = 20000;

// The most data types one identity lists.
const MAX_IDENTITY_DATA_TYPES: number = 50;

// The most records an identity counts: what its column, an integer, holds.
export const MAX_IDENTITY_RECORDS: number = 2_000_000_000;

// One grant of one store, as the evaluator read it.
export interface IdentityGrant {
  dataStoreId: string;
  principal: string;
  principalName?: string | undefined;
  principalType?: string | undefined;
  accessLevel?: string | undefined;
  isExternal: boolean;
  isPublic: boolean;
  isSeenInTraces: boolean;
  isUnused: boolean;
  lastUsedAt?: Date | undefined;
}

// What the evaluator knows of one store, after it evaluated it.
export interface IdentityStoreFacts {
  sensitivity: DataSensitivity;
  dataTypeIds: ReadonlyArray<string>;
  estimatedRecords?: number | null | undefined;
  provider?: string | undefined;
}

export interface IdentityDraft extends DataSecurityIdentityReach {
  identityKey: string;
  principal: string;
  principalName?: string | undefined;
  principalType?: string | undefined;
  provider?: string | undefined;
  isSeenInTraces: boolean;
  storeCount: number;
  restrictedStoreCount: number;
  highestAccessLevel?: DataStoreAccessLevel | undefined;
  dataTypeIds: Array<string>;
  estimatedRecords?: number | undefined;
  riskScore: number;
  lastUsedAt?: Date | undefined;
}

/*
 * The identities of a project's grants: one per principal, from every
 * store it reaches that the evaluation read. Riskiest first.
 */
export function buildIdentityDrafts(
  grants: ReadonlyArray<IdentityGrant>,
  stores: ReadonlyMap<string, IdentityStoreFacts>,
  now: Date,
): Array<IdentityDraft> {
  const byKey: Map<string, Array<IdentityGrant>> = new Map();

  for (const grant of grants) {
    const key: string = getDataSecurityIdentityKey(grant.principal);

    if (!key || !stores.has(grant.dataStoreId)) {
      continue;
    }

    const list: Array<IdentityGrant> = byKey.get(key) || [];
    list.push(grant);
    byKey.set(key, list);
  }

  const drafts: Array<IdentityDraft> = [];

  for (const [identityKey, list] of byKey) {
    const storeIds: Set<string> = new Set();
    const sensitiveIds: Set<string> = new Set();
    const restrictedIds: Set<string> = new Set();
    const dataTypeIds: Set<string> = new Set();
    let highestSensitivity: DataSensitivity = DataSensitivity.Public;
    let highestAccessLevel: DataStoreAccessLevel | undefined = undefined;
    let canChangeSensitiveData: boolean = false;
    let lastUsedAt: Date | undefined = undefined;
    let records: number = 0;
    let hasRecords: boolean = false;
    const named: IdentityGrant | undefined =
      list.find((grant: IdentityGrant): boolean => {
        return Boolean(grant.principalName);
      }) || list[0];
    const provider: string | undefined = list.some(
      (grant: IdentityGrant): boolean => {
        return grant.isSeenInTraces;
      },
    )
      ? DataStoreProvider.OneUptime
      : stores.get(list[0]!.dataStoreId)?.provider;

    for (const grant of list) {
      const store: IdentityStoreFacts = stores.get(grant.dataStoreId)!;
      const sensitivity: DataSensitivity = isDataSensitivity(store.sensitivity)
        ? store.sensitivity
        : DataSensitivity.Public;

      highestAccessLevel = higherAccessLevel(
        highestAccessLevel,
        grant.accessLevel,
      );

      if (grant.lastUsedAt) {
        const used: Date = new Date(grant.lastUsedAt);

        if (!lastUsedAt || used.getTime() > lastUsedAt.getTime()) {
          lastUsedAt = used;
        }
      }

      if (storeIds.has(grant.dataStoreId)) {
        // A second grant on a store it already reaches: its level may be higher.
        if (
          isSensitiveForAccess(sensitivity) &&
          isChangingAccessLevel(grant.accessLevel)
        ) {
          canChangeSensitiveData = true;
        }

        continue;
      }

      storeIds.add(grant.dataStoreId);
      highestSensitivity = moreSensitive(highestSensitivity, sensitivity);

      if (sensitivity === DataSensitivity.Restricted) {
        restrictedIds.add(grant.dataStoreId);
      }

      if (isSensitiveForAccess(sensitivity)) {
        sensitiveIds.add(grant.dataStoreId);

        if (isChangingAccessLevel(grant.accessLevel)) {
          canChangeSensitiveData = true;
        }

        for (const dataTypeId of store.dataTypeIds) {
          dataTypeIds.add(dataTypeId);
        }

        if (
          typeof store.estimatedRecords === "number" &&
          Number.isFinite(store.estimatedRecords) &&
          store.estimatedRecords > 0
        ) {
          records += store.estimatedRecords;
          hasRecords = true;
        }
      }
    }

    const usedLately: boolean = Boolean(
      lastUsedAt && !isAccessUnused({ lastUsedAt, now }),
    );
    const reach: DataSecurityIdentityReach = {
      highestSensitivity,
      canChangeSensitiveData,
      isPublic: list.some((grant: IdentityGrant): boolean => {
        return grant.isPublic;
      }),
      isExternal: list.some((grant: IdentityGrant): boolean => {
        return grant.isExternal;
      }),
      isUnused:
        !usedLately &&
        list.some((grant: IdentityGrant): boolean => {
          return grant.isUnused;
        }),
      sensitiveStoreCount: sensitiveIds.size,
    };

    drafts.push({
      ...reach,
      identityKey,
      principal: identityKey,
      principalName: named?.principalName,
      principalType: named?.principalType,
      provider,
      isSeenInTraces: list.some((grant: IdentityGrant): boolean => {
        return grant.isSeenInTraces;
      }),
      storeCount: storeIds.size,
      restrictedStoreCount: restrictedIds.size,
      highestAccessLevel,
      dataTypeIds: Array.from(dataTypeIds)
        .sort()
        .slice(0, MAX_IDENTITY_DATA_TYPES),
      estimatedRecords: hasRecords
        ? Math.min(Math.round(records), MAX_IDENTITY_RECORDS)
        : undefined,
      riskScore: getIdentityRiskScore(reach),
      lastUsedAt,
    });
  }

  return drafts.sort((a: IdentityDraft, b: IdentityDraft): number => {
    return b.riskScore !== a.riskScore
      ? b.riskScore - a.riskScore
      : a.identityKey.localeCompare(b.identityKey);
  });
}

// The columns a draft writes, as stored values: what is compared and saved.
export function identityColumns(draft: IdentityDraft): JSONObject {
  return {
    principal: draft.principal,
    principalName: draft.principalName || null,
    principalType: draft.principalType || null,
    provider: draft.provider || null,
    isExternal: draft.isExternal,
    isPublic: draft.isPublic,
    isUnused: draft.isUnused,
    isSeenInTraces: draft.isSeenInTraces,
    storeCount: draft.storeCount,
    sensitiveStoreCount: draft.sensitiveStoreCount,
    restrictedStoreCount: draft.restrictedStoreCount,
    highestSensitivity: draft.highestSensitivity,
    highestAccessLevel: draft.highestAccessLevel || null,
    canChangeSensitiveData: draft.canChangeSensitiveData,
    dataTypeIds: draft.dataTypeIds,
    estimatedRecords:
      draft.estimatedRecords === undefined ? null : draft.estimatedRecords,
    riskScore: draft.riskScore,
    lastUsedAt: draft.lastUsedAt ? draft.lastUsedAt.toISOString() : null,
  };
}

// A stored row's values, as identityColumns writes them, to tell a change.
function storedColumns(row: DataSecurityIdentity): JSONObject {
  return {
    principal: row.principal || "",
    principalName: row.principalName || null,
    principalType: row.principalType || null,
    provider: row.provider || null,
    isExternal: Boolean(row.isExternal),
    isPublic: Boolean(row.isPublic),
    isUnused: Boolean(row.isUnused),
    isSeenInTraces: Boolean(row.isSeenInTraces),
    storeCount: row.storeCount || 0,
    sensitiveStoreCount: row.sensitiveStoreCount || 0,
    restrictedStoreCount: row.restrictedStoreCount || 0,
    highestSensitivity: row.highestSensitivity || DataSensitivity.Public,
    highestAccessLevel: row.highestAccessLevel || null,
    canChangeSensitiveData: Boolean(row.canChangeSensitiveData),
    dataTypeIds: row.dataTypeIds || [],
    estimatedRecords:
      row.estimatedRecords === undefined || row.estimatedRecords === null
        ? null
        : row.estimatedRecords,
    riskScore: row.riskScore || 0,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
  };
}

export default class DataSecurityIdentities {
  /*
   * Writes the project's identities: new ones made, changed ones saved,
   * ones that reach nothing any more removed. A write that fails is
   * logged; the next evaluation writes it again.
   */
  public static async write(data: {
    projectId: ObjectID;
    drafts: ReadonlyArray<IdentityDraft>;
    now: Date;
  }): Promise<void> {
    const existing: Array<DataSecurityIdentity> = [];

    for (
      let skip: number = 0;
      skip < MAX_IDENTITIES_PER_PROJECT;
      skip += 1000
    ) {
      const page: Array<DataSecurityIdentity> =
        await DataSecurityIdentityService.findBy({
          query: { projectId: data.projectId },
          select: {
            _id: true,
            identityKey: true,
            principal: true,
            principalName: true,
            principalType: true,
            provider: true,
            isExternal: true,
            isPublic: true,
            isUnused: true,
            isSeenInTraces: true,
            storeCount: true,
            sensitiveStoreCount: true,
            restrictedStoreCount: true,
            highestSensitivity: true,
            highestAccessLevel: true,
            canChangeSensitiveData: true,
            dataTypeIds: true,
            estimatedRecords: true,
            riskScore: true,
            lastUsedAt: true,
          },
          skip,
          limit: 1000,
          props: { isRoot: true },
        });

      existing.push(...page);

      if (page.length < 1000) {
        break;
      }
    }

    const byKey: Map<string, DataSecurityIdentity> = new Map();

    for (const row of existing) {
      if (row.identityKey) {
        byKey.set(row.identityKey, row);
      }
    }

    const wanted: Set<string> = new Set();

    for (const draft of data.drafts.slice(0, MAX_IDENTITIES_PER_PROJECT)) {
      wanted.add(draft.identityKey);

      const columns: JSONObject = identityColumns(draft);
      const row: DataSecurityIdentity | undefined = byKey.get(
        draft.identityKey,
      );

      try {
        if (row?.id) {
          if (JSON.stringify(storedColumns(row)) === JSON.stringify(columns)) {
            continue;
          }

          await DataSecurityIdentityService.updateColumnsByIdWithoutHooks({
            id: row.id,
            data: {
              ...columns,
              lastUsedAt: draft.lastUsedAt || null,
              lastSeenAt: data.now,
            } as never,
          });
          continue;
        }

        const identity: DataSecurityIdentity = new DataSecurityIdentity();
        identity.projectId = data.projectId;
        identity.identityKey = draft.identityKey;
        identity.firstSeenAt = data.now;
        identity.lastSeenAt = data.now;

        for (const [column, value] of Object.entries(columns)) {
          // The last use goes in as a date, below.
          if (value !== null && column !== "lastUsedAt") {
            identity.setColumnValue(column, value);
          }
        }

        if (draft.lastUsedAt) {
          identity.lastUsedAt = draft.lastUsedAt;
        }

        await DataSecurityIdentityService.create({
          data: identity,
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `DataSecurity: could not write the identity ${draft.identityKey} of project ${data.projectId.toString()}:`,
        );
        logger.error(error);
      }
    }

    for (const row of existing) {
      if (row.id && !wanted.has(row.identityKey || "")) {
        try {
          await DataSecurityIdentityService.deleteOneById({
            id: row.id,
            props: { isRoot: true },
          });
        } catch (error) {
          logger.error(
            `DataSecurity: could not remove the identity ${row.identityKey || ""}:`,
          );
          logger.error(error);
        }
      }
    }
  }
}

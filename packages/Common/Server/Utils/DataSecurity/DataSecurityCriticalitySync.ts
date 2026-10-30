import DataStore from "../../../Models/DatabaseModels/DataStore";
import SecurityEntityCriticalityEntry from "../../../Models/DatabaseModels/SecurityEntityCriticality";
import DataStoreService from "../../Services/DataStoreService";
import SecurityEntityCriticalityService from "../../Services/SecurityEntityCriticalityService";
import logger from "../Logger";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
  isDataSensitivity,
} from "../../../Types/DataSecurity/DataSensitivity";
import {
  SecurityEntityType,
  getDataStoreEntityValue,
  isDataStoreEntityValue,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_ENTITY_CRITICALITY_VALUE_MAX_LENGTH,
  SecurityEntityCriticality,
} from "../../../Types/SecurityCase/SecurityEntityRisk";
import { PROTECTED_ENTITY_WILDCARD } from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";

/*
 * HOW MUCH A DATA STORE MATTERS, FROM WHAT IT HOLDS.
 *
 * Security Operations weighs an entity's risk by its criticality (Entity
 * Criticality, SecurityEntityCriticality), and Data Security already knows
 * which stores matter: a store of personal data (Confidential) counts High,
 * one of card numbers, health records or secrets (Restricted) Extreme. So
 * after each evaluation, the project's list gets an entry for every
 * sensitive store, named as the store's entity is ("data-store:" and its
 * key), and loses the entries of stores no longer sensitive, archived or
 * gone.
 *
 * Data Security's entries are told from people's by what they say: the
 * description names the sensitivity it was set from
 * (DATA_SECURITY_CRITICALITY_DESCRIPTION), the criticality is the one that
 * sensitivity sets, and nobody created it. A person who changes the
 * criticality or the description makes the entry theirs, and a person's
 * entry for a store - for it alone, or for any kind - is the store's
 * criticality: Data Security never writes over it, and steps aside (its own
 * entry for that store goes). A person's pattern ("data-store:*test*") is
 * less specific than a store's own entry, so the store's entry counts, as
 * the list always picks the most specific. An entry a person removes comes
 * back while the store stays sensitive: to make a store count less, set its
 * entry to Low.
 *
 * Every write goes through the list's own service, so an entry is checked
 * as one a person adds is, and each change weighs the project's risk anew
 * (the service queues it, one recompute a project however many change).
 */

// What every entry Data Security keeps says it is, before the sensitivity.
export const DATA_SECURITY_CRITICALITY_DESCRIPTION: string =
  "Set by Data Security from the store's sensitivity";

// The criticality each sensitivity sets: Internal and Public set none.
export const DATA_SECURITY_CRITICALITY_BY_SENSITIVITY: Readonly<
  Partial<Record<DataSensitivity, SecurityEntityCriticality>>
> = {
  [DataSensitivity.Restricted]: SecurityEntityCriticality.Extreme,
  [DataSensitivity.Confidential]: SecurityEntityCriticality.High,
};

// "Set by Data Security from the store's sensitivity: Restricted."
export function getDataSecurityCriticalityDescription(
  sensitivity: DataSensitivity,
): string {
  return `${DATA_SECURITY_CRITICALITY_DESCRIPTION}: ${sensitivity}.`;
}

// A store's sensitivity as the evaluation left it: a person's override wins.
export function getEffectiveStoreSensitivity(
  store: Pick<DataStore, "sensitivity" | "sensitivityOverride">,
): DataSensitivity {
  if (isDataSensitivity(store.sensitivityOverride)) {
    return store.sensitivityOverride;
  }

  return isDataSensitivity(store.sensitivity)
    ? store.sensitivity
    : DataSensitivity.Public;
}

// An entry of the list, as the sync reads it.
export interface CriticalityEntryReading {
  value?: string | undefined;
  entityType?: SecurityEntityType | string | null | undefined;
  criticality?: SecurityEntityCriticality | string | undefined;
  description?: string | null | undefined;
  createdByUserId?: ObjectID | null | undefined;
}

/*
 * The sensitivity an entry of Data Security's own was set from, or null for
 * an entry a person created or changed since.
 */
export function readDataSecurityCriticalityEntry(
  entry: CriticalityEntryReading,
): DataSensitivity | null {
  if (
    entry.createdByUserId ||
    entry.entityType !== SecurityEntityType.DataStore ||
    !isDataStoreEntityValue(entry.value)
  ) {
    return null;
  }

  const description: string = (entry.description || "").trim();

  for (const sensitivity of [
    DataSensitivity.Restricted,
    DataSensitivity.Confidential,
  ]) {
    if (
      description === getDataSecurityCriticalityDescription(sensitivity) &&
      entry.criticality ===
        DATA_SECURITY_CRITICALITY_BY_SENSITIVITY[sensitivity]
    ) {
      return sensitivity;
    }
  }

  return null;
}

// The entry a sensitive store should have, by its folded value.
interface WantedEntry {
  value: string;
  sensitivity: DataSensitivity;
  criticality: SecurityEntityCriticality;
}

/*
 * The entries the project's sensitive stores call for, by their value as
 * the list compares values: case folded. A store whose name is longer than
 * an entry holds, or has a `*` in it (which the list reads as a pattern
 * of other stores), gets none.
 */
export function getWantedCriticalityEntries(
  stores: Array<
    Pick<DataStore, "storeKey" | "sensitivity" | "sensitivityOverride">
  >,
): Map<string, WantedEntry> {
  const wanted: Map<string, WantedEntry> = new Map();

  for (const store of stores) {
    const sensitivity: DataSensitivity = getEffectiveStoreSensitivity(store);
    const criticality: SecurityEntityCriticality | undefined =
      DATA_SECURITY_CRITICALITY_BY_SENSITIVITY[sensitivity];

    if (!criticality || !(store.storeKey || "").trim()) {
      continue;
    }

    const value: string = getDataStoreEntityValue(store.storeKey || "");

    if (
      value.length > SECURITY_ENTITY_CRITICALITY_VALUE_MAX_LENGTH ||
      value.includes(PROTECTED_ENTITY_WILDCARD)
    ) {
      continue;
    }

    const key: string = value.toLowerCase();
    const existing: WantedEntry | undefined = wanted.get(key);

    // Two stores the list cannot tell apart: the more sensitive counts.
    if (
      existing &&
      DATA_SENSITIVITY_RANK[existing.sensitivity] >=
        DATA_SENSITIVITY_RANK[sensitivity]
    ) {
      continue;
    }

    wanted.set(key, { value, sensitivity, criticality });
  }

  return wanted;
}

export interface DataSecurityCriticalitySyncResult {
  created: number;
  updated: number;
  removed: number;
  // Sensitive stores a person's entry already weighs, left as they are.
  leftToPeople: number;
  // Writes the list refused or that failed, each logged.
  failed: number;
}

const ROOT: { isRoot: true } = { isRoot: true };

/*
 * Brings the project's Entity Criticality list in line with its stores'
 * sensitivity, as the comment at the top says. Never throws: a write the
 * list refuses is logged and counted, and the rest go on - the next
 * evaluation tries again.
 */
export async function syncProjectCriticality(
  projectId: ObjectID,
): Promise<DataSecurityCriticalitySyncResult> {
  const result: DataSecurityCriticalitySyncResult = {
    created: 0,
    updated: 0,
    removed: 0,
    leftToPeople: 0,
    failed: 0,
  };

  let stores: Array<DataStore>;
  let entries: Array<SecurityEntityCriticalityEntry>;

  try {
    stores = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        storeKey: true,
        sensitivity: true,
        sensitivityOverride: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: ROOT,
    });

    entries = await SecurityEntityCriticalityService.findBy({
      query: { projectId },
      select: {
        _id: true,
        value: true,
        entityType: true,
        criticality: true,
        description: true,
        createdByUserId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: ROOT,
    });
  } catch (error) {
    logger.error(
      `DataSecurity: could not read project ${projectId.toString()}'s stores and entity criticality:`,
    );
    logger.error(error);
    result.failed++;
    return result;
  }

  const wanted: Map<string, WantedEntry> = getWantedCriticalityEntries(stores);
  const own: Array<{
    entry: SecurityEntityCriticalityEntry;
    key: string;
  }> = [];
  // Values a person's entry weighs: one for a data store, or for any kind.
  const peopleValues: Set<string> = new Set();

  for (const entry of entries) {
    const key: string = (entry.value || "").trim().toLowerCase();

    if (!key) {
      continue;
    }

    if (readDataSecurityCriticalityEntry(entry)) {
      own.push({ entry, key });
      continue;
    }

    if (
      !entry.entityType ||
      entry.entityType === SecurityEntityType.DataStore
    ) {
      peopleValues.add(key);
    }
  }

  const kept: Set<string> = new Set();

  for (const { entry, key } of own) {
    const want: WantedEntry | undefined = wanted.get(key);

    try {
      if (!want || peopleValues.has(key) || kept.has(key)) {
        await SecurityEntityCriticalityService.deleteOneById({
          id: entry.id!,
          props: ROOT,
        });
        result.removed++;
        continue;
      }

      kept.add(key);

      const description: string = getDataSecurityCriticalityDescription(
        want.sensitivity,
      );

      if (
        entry.criticality !== want.criticality ||
        (entry.description || "").trim() !== description
      ) {
        await SecurityEntityCriticalityService.updateOneById({
          id: entry.id!,
          data: { criticality: want.criticality, description },
          props: ROOT,
        });
        result.updated++;
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not change the entity criticality of ${entry.value || ""} in project ${projectId.toString()}:`,
      );
      logger.error(error);
      result.failed++;
    }
  }

  for (const [key, want] of wanted.entries()) {
    if (kept.has(key)) {
      continue;
    }

    if (peopleValues.has(key)) {
      result.leftToPeople++;
      continue;
    }

    try {
      const entry: SecurityEntityCriticalityEntry =
        new SecurityEntityCriticalityEntry();
      entry.projectId = projectId;
      entry.value = want.value;
      entry.entityType = SecurityEntityType.DataStore;
      entry.criticality = want.criticality;
      entry.description = getDataSecurityCriticalityDescription(
        want.sensitivity,
      );

      await SecurityEntityCriticalityService.create({
        data: entry,
        props: ROOT,
      });
      result.created++;
    } catch (error) {
      logger.error(
        `DataSecurity: could not add the entity criticality of ${want.value} in project ${projectId.toString()}:`,
      );
      logger.error(error);
      result.failed++;
    }
  }

  return result;
}

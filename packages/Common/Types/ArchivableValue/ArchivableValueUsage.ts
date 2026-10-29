import { JSONArray, JSONObject } from "../JSON";

/*
 * What the server answers about a value's uses (ArchivableValueUsage, the
 * `<value route>/:id/usage` endpoint, and `<value route>/usage` for several
 * values at once), and what the dashboard reads to say what archiving keeps
 * and what deleting would change.
 */

// What deleting the value does to these records.
export enum ArchivableValueDeleteEffect {
  // A foreign key with NO ACTION: the delete is refused while they exist.
  Refused = "Refused",
  // ON DELETE CASCADE: the records are deleted with it (history rows, rules).
  Deleted = "Deleted",
  // ON DELETE SET NULL: the field is cleared on them.
  Cleared = "Cleared",
  // A join row: the value comes out of their list.
  RemovedFromList = "RemovedFromList",
  // An id in JSON with no key behind it: it is left naming nothing.
  LeftDangling = "LeftDangling",
}

/*
 * What kind of thing uses the value:
 *
 *   - Records have it (incidents, monitors, state history): archiving
 *     changes nothing for them.
 *   - Settings are the project's own set-up that sets the value or matches
 *     on it (rules, templates, monitor criteria, workflows): they keep using
 *     an archived value until someone changes them.
 *   - Personal settings are a person's own (the on-call rules each person
 *     has for a severity, their notification settings): counted by person,
 *     since nobody thinks of them as the project's rules. They stay as they
 *     are when the value is archived, and keep working for the records that
 *     keep it.
 */
export enum ArchivableValueUsageKind {
  Records = "Records",
  Settings = "Settings",
  Personal = "Personal",
}

export interface ArchivableValueUsageItem {
  // The records' table: "Incident".
  tableName: string;
  // How they are named: the model's plural name, "Incidents".
  title: string;
  // And one of them: "Incident".
  singularTitle: string;
  /*
   * How many use it this way: records, each once however many of their
   * fields or lists name it - or, for a person's own settings (Personal),
   * people, each once however many of their rows name it.
   */
  count: number;
  // The count stopped at the cap: there are more.
  isCountCapped: boolean;
  /*
   * How many of the table's records (or people) of this kind use it in any
   * way, every effect together: the same records can reach it more than one
   * way (a monitor's criteria name a status it also suppresses alerts on),
   * and the Archive dialog lists the table once. Left out, it is the count.
   */
  totalCount?: number | undefined;
  isTotalCountCapped?: boolean | undefined;
  effect: ArchivableValueDeleteEffect;
  kind: ArchivableValueUsageKind;
}

/*
 * What a bulk Archive's or Delete's dialog asks about the values it was
 * opened on (POST <value route>/usage).
 */
export enum ArchivableValuesUsagePurpose {
  // Every use of any of them: what keeps using them once they are archived.
  Archive = "Archive",
  /*
   * Which of them records still have - a delete of those is refused, and
   * they are left as they are - and what deleting the others changes.
   */
  Delete = "Delete",
}

/*
 * The answer for several values: each record or person counted once,
 * however many of the values it has.
 */
export interface ArchivableValuesUsage {
  /*
   * An Archive: every use of any of the values. A Delete: what deleting the
   * ones that can be deleted changes.
   */
  usage: Array<ArchivableValueUsageItem>;
  // A Delete: the values records still have, which a delete refuses.
  refusedValueIds: Array<string>;
  // And what has them: the uses that refuse the delete.
  refusedUsage: Array<ArchivableValueUsageItem>;
}

const EFFECTS: Array<string> = Object.values(ArchivableValueDeleteEffect);
const KINDS: Array<string> = Object.values(ArchivableValueUsageKind);

const readCount: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? count : null;
};

export default class ArchivableValueUsage {
  public static toJSONArray(items: Array<ArchivableValueUsageItem>): JSONArray {
    return items.map((item: ArchivableValueUsageItem): JSONObject => {
      const json: JSONObject = {
        tableName: item.tableName,
        title: item.title,
        singularTitle: item.singularTitle,
        count: item.count,
        isCountCapped: item.isCountCapped,
        effect: item.effect,
        kind: item.kind,
      };

      if (item.totalCount !== undefined) {
        json["totalCount"] = item.totalCount;
        json["isTotalCountCapped"] = Boolean(item.isTotalCountCapped);
      }

      return json;
    });
  }

  // What came back from the server, keeping only well-formed items.
  public static fromJSONArray(value: unknown): Array<ArchivableValueUsageItem> {
    if (!Array.isArray(value)) {
      return [];
    }

    const items: Array<ArchivableValueUsageItem> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const record: Record<string, unknown> = entry as Record<string, unknown>;
      const count: number | null = readCount(record["count"]);

      if (
        typeof record["tableName"] !== "string" ||
        typeof record["title"] !== "string" ||
        count === null ||
        !EFFECTS.includes(record["effect"] as string) ||
        !KINDS.includes(record["kind"] as string)
      ) {
        continue;
      }

      const item: ArchivableValueUsageItem = {
        tableName: record["tableName"] as string,
        title: record["title"] as string,
        singularTitle:
          typeof record["singularTitle"] === "string" && record["singularTitle"]
            ? (record["singularTitle"] as string)
            : (record["title"] as string),
        count: count,
        isCountCapped: record["isCountCapped"] === true,
        effect: record["effect"] as ArchivableValueDeleteEffect,
        kind: record["kind"] as ArchivableValueUsageKind,
      };

      // A total is never below the count it includes.
      const totalCount: number | null = readCount(record["totalCount"]);

      if (totalCount !== null && totalCount >= count) {
        item.totalCount = totalCount;
        item.isTotalCountCapped = record["isTotalCountCapped"] === true;
      }

      items.push(item);
    }

    return items;
  }

  public static valuesUsageToJSON(usage: ArchivableValuesUsage): JSONObject {
    return {
      usage: ArchivableValueUsage.toJSONArray(usage.usage),
      refusedValueIds: [...usage.refusedValueIds],
      refusedUsage: ArchivableValueUsage.toJSONArray(usage.refusedUsage),
    };
  }

  // What came back for several values, keeping only what is well formed.
  public static valuesUsageFromJSON(value: unknown): ArchivableValuesUsage {
    const record: Record<string, unknown> =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};

    const refusedValueIds: Array<string> = Array.isArray(
      record["refusedValueIds"],
    )
      ? (record["refusedValueIds"] as Array<unknown>).filter(
          (id: unknown): id is string => {
            return typeof id === "string" && id.length > 0;
          },
        )
      : [];

    return {
      usage: ArchivableValueUsage.fromJSONArray(record["usage"]),
      refusedValueIds: refusedValueIds,
      refusedUsage: ArchivableValueUsage.fromJSONArray(record["refusedUsage"]),
    };
  }

  // Whether something still has the value, so a delete is refused.
  public static isDeleteRefused(
    items: Array<ArchivableValueUsageItem>,
  ): boolean {
    return items.some((item: ArchivableValueUsageItem): boolean => {
      return item.effect === ArchivableValueDeleteEffect.Refused;
    });
  }

  // The settings and automations that keep using an archived value.
  public static getSettings(
    items: Array<ArchivableValueUsageItem>,
  ): Array<ArchivableValueUsageItem> {
    return items.filter((item: ArchivableValueUsageItem): boolean => {
      return item.kind === ArchivableValueUsageKind.Settings;
    });
  }

  // People's own settings that name it, which stay as they are.
  public static getPersonal(
    items: Array<ArchivableValueUsageItem>,
  ): Array<ArchivableValueUsageItem> {
    return items.filter((item: ArchivableValueUsageItem): boolean => {
      return item.kind === ArchivableValueUsageKind.Personal;
    });
  }

  // The number to show for the table's line: every effect together.
  public static getTotalCount(item: ArchivableValueUsageItem): {
    count: number;
    isCountCapped: boolean;
  } {
    if (item.totalCount !== undefined && item.totalCount >= item.count) {
      return {
        count: item.totalCount,
        isCountCapped: Boolean(item.isTotalCountCapped),
      };
    }

    return { count: item.count, isCountCapped: item.isCountCapped };
  }
}

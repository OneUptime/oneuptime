import { JSONArray, JSONObject } from "../JSON";

/*
 * What the server answers about a value's uses (ArchivableValueUsage, the
 * `<value route>/:id/usage` endpoint), and what the dashboard reads to say
 * what archiving keeps and what deleting would change.
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
 * Records that have the value (incidents, monitors, state history), or
 * settings that use it to set or match it (rules, templates, criteria,
 * workflows) - which keep using an archived value until they are changed.
 */
export enum ArchivableValueUsageKind {
  Records = "Records",
  Settings = "Settings",
}

export interface ArchivableValueUsageItem {
  // The records' table: "Incident".
  tableName: string;
  // How they are named: the model's plural name, "Incidents".
  title: string;
  // And one of them: "Incident".
  singularTitle: string;
  count: number;
  // The count stopped at the cap: there are more.
  isCountCapped: boolean;
  effect: ArchivableValueDeleteEffect;
  kind: ArchivableValueUsageKind;
}

const EFFECTS: Array<string> = Object.values(ArchivableValueDeleteEffect);
const KINDS: Array<string> = Object.values(ArchivableValueUsageKind);

export default class ArchivableValueUsage {
  public static toJSONArray(items: Array<ArchivableValueUsageItem>): JSONArray {
    return items.map((item: ArchivableValueUsageItem): JSONObject => {
      return {
        tableName: item.tableName,
        title: item.title,
        singularTitle: item.singularTitle,
        count: item.count,
        isCountCapped: item.isCountCapped,
        effect: item.effect,
        kind: item.kind,
      };
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
      const count: number = Number(record["count"]);

      if (
        typeof record["tableName"] !== "string" ||
        typeof record["title"] !== "string" ||
        !Number.isFinite(count) ||
        count <= 0 ||
        !EFFECTS.includes(record["effect"] as string) ||
        !KINDS.includes(record["kind"] as string)
      ) {
        continue;
      }

      items.push({
        tableName: record["tableName"] as string,
        title: record["title"] as string,
        singularTitle:
          typeof record["singularTitle"] === "string" &&
          record["singularTitle"]
            ? (record["singularTitle"] as string)
            : (record["title"] as string),
        count: count,
        isCountCapped: record["isCountCapped"] === true,
        effect: record["effect"] as ArchivableValueDeleteEffect,
        kind: record["kind"] as ArchivableValueUsageKind,
      });
    }

    return items;
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
}

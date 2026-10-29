import { DELETE_EFFECT_LABELS, DELETED_WITH_THEM } from "./ArchivableValueCopy";
import ArchivableValueUsage, {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "Common/Types/ArchivableValue/ArchivableValueUsage";

/*
 * What the Archive and Delete dialogs list about a value's uses
 * (ArchivableValueUsage, from the server), worked out without React so the
 * dialogs and their tests read the same answers.
 *
 *   - The Archive dialog lists the settings and automations that still use
 *     the value - monitors' criteria, rules, templates, workflows - which
 *     keep using it until they are changed. Records that have it are not
 *     listed: archiving changes nothing for them, and the dialog says so.
 *     People's own settings that name it - their on-call rules for a
 *     severity - are not the project's settings and need no change: the
 *     dialog says, apart, how many people have them and that they stay.
 *   - The Delete dialog says what a delete would do. When something still
 *     has the value under a key that refuses the delete, the delete cannot
 *     go through, and those are listed. Otherwise every use it changes is
 *     listed, grouped by what happens to it: removed from a list, deleted
 *     with it, cleared, or left naming nothing.
 */

// One group of the Delete dialog's list: what happens, and to what.
export interface UsageGroup {
  effect: ArchivableValueDeleteEffect;
  // English, looked up when drawn: "Removed from".
  label: string;
  items: Array<ArchivableValueUsageItem>;
}

// The order the groups are listed in: the gravest first.
const EFFECT_ORDER: Array<ArchivableValueDeleteEffect> = [
  ArchivableValueDeleteEffect.Refused,
  ArchivableValueDeleteEffect.Deleted,
  ArchivableValueDeleteEffect.RemovedFromList,
  ArchivableValueDeleteEffect.Cleared,
  ArchivableValueDeleteEffect.LeftDangling,
];

const byCountThenTitle: (
  a: ArchivableValueUsageItem,
  b: ArchivableValueUsageItem,
) => number = (
  a: ArchivableValueUsageItem,
  b: ArchivableValueUsageItem,
): number => {
  if (a.count !== b.count) {
    return b.count - a.count;
  }

  return a.title.localeCompare(b.title);
};

/*
 * One line per table, for the Archive dialog: a table reached in more than
 * one way (a monitor's criteria and its alert suppression) is one line,
 * counted with every way together - the server's total - and the most
 * first.
 */
const mergeByTable: (
  items: Array<ArchivableValueUsageItem>,
) => Array<ArchivableValueUsageItem> = (
  items: Array<ArchivableValueUsageItem>,
): Array<ArchivableValueUsageItem> => {
  const merged: Array<ArchivableValueUsageItem> = [];

  for (const item of items) {
    const total: { count: number; isCountCapped: boolean } =
      ArchivableValueUsage.getTotalCount(item);

    const existing: ArchivableValueUsageItem | undefined = merged.find(
      (candidate: ArchivableValueUsageItem): boolean => {
        return candidate.tableName === item.tableName;
      },
    );

    if (!existing) {
      merged.push({
        ...item,
        count: total.count,
        isCountCapped: total.isCountCapped,
      });
      continue;
    }

    // Without a total from the server, the larger count is the most it can say.
    if (total.count > existing.count) {
      existing.count = total.count;
    }

    existing.isCountCapped = existing.isCountCapped || total.isCountCapped;
  }

  return merged.sort(byCountThenTitle);
};

/*
 * What the Archive dialog lists: the settings that keep using the value,
 * the most first. One line per kind of record: a rule that names the value
 * twice is one rule.
 */
export const getArchiveDialogItems: (
  usage: Array<ArchivableValueUsageItem>,
) => Array<ArchivableValueUsageItem> = (
  usage: Array<ArchivableValueUsageItem>,
): Array<ArchivableValueUsageItem> => {
  return mergeByTable(ArchivableValueUsage.getSettings(usage));
};

/*
 * What the Archive dialog says apart: people's own settings that name the
 * value - their on-call rules for a severity - one line per table, counted
 * by person. They stay as they are.
 */
export const getArchiveDialogPeople: (
  usage: Array<ArchivableValueUsageItem>,
) => Array<ArchivableValueUsageItem> = (
  usage: Array<ArchivableValueUsageItem>,
): Array<ArchivableValueUsageItem> => {
  return mergeByTable(ArchivableValueUsage.getPersonal(usage));
};

/*
 * Everything the Archive dialog shows about a value's uses: the settings
 * that keep using it, and the people whose own settings name it.
 */
export interface ArchiveDialogUsage {
  settings: Array<ArchivableValueUsageItem>;
  people: Array<ArchivableValueUsageItem>;
}

export const getArchiveDialogUsage: (
  usage: Array<ArchivableValueUsageItem>,
) => ArchiveDialogUsage = (
  usage: Array<ArchivableValueUsageItem>,
): ArchiveDialogUsage => {
  return {
    settings: getArchiveDialogItems(usage),
    people: getArchiveDialogPeople(usage),
  };
};

// Whether the delete would be refused: something still has the value.
export const isDeleteRefused: (
  usage: Array<ArchivableValueUsageItem>,
) => boolean = (usage: Array<ArchivableValueUsageItem>): boolean => {
  return ArchivableValueUsage.isDeleteRefused(usage);
};

/*
 * What the Delete dialog lists. A refused delete lists only what refuses it
 * - nothing else happens - and any other delete lists every use it changes,
 * grouped by what happens to it. Empty when nothing uses the value.
 * `valueCount` is how many values the delete takes - a bulk Delete's are
 * several, and what goes is "Deleted with them".
 */
export const getDeleteDialogGroups: (
  usage: Array<ArchivableValueUsageItem>,
  valueCount?: number,
) => Array<UsageGroup> = (
  usage: Array<ArchivableValueUsageItem>,
  valueCount: number = 1,
): Array<UsageGroup> => {
  const refused: boolean = isDeleteRefused(usage);

  const groups: Array<UsageGroup> = [];

  for (const effect of EFFECT_ORDER) {
    if (refused && effect !== ArchivableValueDeleteEffect.Refused) {
      continue;
    }

    const items: Array<ArchivableValueUsageItem> = usage
      .filter((item: ArchivableValueUsageItem): boolean => {
        return item.effect === effect;
      })
      .sort(byCountThenTitle);

    if (items.length > 0) {
      groups.push({
        effect: effect,
        label:
          effect === ArchivableValueDeleteEffect.Deleted && valueCount > 1
            ? DELETED_WITH_THEM
            : DELETE_EFFECT_LABELS[effect],
        items: items,
      });
    }
  }

  return groups;
};

// Whether any record (not a setting) has the value: used by the Archive dialog.
export const hasRecords: (usage: Array<ArchivableValueUsageItem>) => boolean = (
  usage: Array<ArchivableValueUsageItem>,
): boolean => {
  return usage.some((item: ArchivableValueUsageItem): boolean => {
    return item.kind === ArchivableValueUsageKind.Records;
  });
};

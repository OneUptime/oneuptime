import SortOrder from "../Types/BaseDatabase/SortOrder";
import {
  compareCodePoints,
  compareNaturally,
  sortByNaturalName,
  sortNaturally,
} from "./NaturalOrder";

/*
 * THE ORDER LABELS ARE LISTED IN, WHEREVER THEY ARE.
 *
 * A record's labels in a table's row, on its detail card and in its page's
 * header; the labels a picker offers; Project Settings > Labels; the labels
 * a feed entry, a Slack or Teams picker or a calendar feed names - all in
 * natural order by name (Utils/NaturalOrder): numbered labels first, in the
 * order of their numbers ("1. Category", "2. SubCategory", ...
 * "10. Owner"), then the others alphabetically, case and accents aside
 * (OneUptime issue #5183).
 *
 * Labels are a set - a monitor's labels have no order of their own - so
 * before this they came in whatever order the database joined them, which
 * was different from one row to the next.
 *
 * The browser sorts what it holds with sortLabels; the server stores each
 * label's sort key (Label.nameSortKey) and reads labels in that order
 * whenever it is asked for them by name, or in no order at all
 * (getLabelListSort, LabelService), so a list it pages through agrees with
 * the browser to the last label.
 */

// What a label is sorted by: its name, or its slug when no name was read.
export interface OrderableLabel {
  name?: string | null | undefined;
  slug?: string | null | undefined;
  _id?: string | null | undefined;
}

// The column the server keeps each label's sort key in (Label.nameSortKey).
export const LABEL_NAME_SORT_KEY_COLUMN: string = "nameSortKey";

// The column a caller sorts labels by when they mean "by name".
export const LABEL_NAME_COLUMN: string = "name";

// The words a label is listed by, as LabelElement draws them.
export const getLabelDisplayName: (label: OrderableLabel) => string = (
  label: OrderableLabel,
): string => {
  return label.name || label.slug || "";
};

/**
 * Two labels in natural order by name; two labels of the same name (two
 * projects' "Production") by id, so the order never changes between reads.
 */
export const compareLabels: (
  first: OrderableLabel,
  second: OrderableLabel,
) => number = (first: OrderableLabel, second: OrderableLabel): number => {
  return (
    compareNaturally(getLabelDisplayName(first), getLabelDisplayName(second)) ||
    compareCodePoints(String(first._id || ""), String(second._id || ""))
  );
};

/**
 * Labels in natural order by name, as a new array: the one given is left as
 * it is, and a missing entry (a label deleted under a relation) is left out.
 */
export const sortLabels: <T extends OrderableLabel>(
  labels: ReadonlyArray<T | null | undefined> | null | undefined,
) => Array<T> = <T extends OrderableLabel>(
  labels: ReadonlyArray<T | null | undefined> | null | undefined,
): Array<T> => {
  const present: Array<T> = (labels || []).filter(
    (label: T | null | undefined): label is T => {
      return Boolean(label);
    },
  );

  // By id first, so labels of the same name keep one order between them.
  const byId: Array<T> = [...present].sort((first: T, second: T): number => {
    return compareCodePoints(String(first._id || ""), String(second._id || ""));
  });

  return sortByNaturalName<T>(byId, getLabelDisplayName);
};

/**
 * Label names in natural order, as a new array, empty names left out: what
 * a feed entry, an email or a calendar feed lists a record's labels by.
 */
export const sortLabelNames: (
  names: ReadonlyArray<string | null | undefined> | null | undefined,
) => Array<string> = (
  names: ReadonlyArray<string | null | undefined> | null | undefined,
): Array<string> => {
  return sortNaturally(
    (names || []).filter((name: string | null | undefined): name is string => {
      return typeof name === "string" && name.trim().length > 0;
    }),
  );
};

/*
 * The order the server reads labels in (LabelService):
 *
 *   - no order asked for: by name, in natural order - not newest first, as
 *     other records are, since a list of labels is read by name (Project
 *     Settings > Labels, every picker that asks for no order);
 *   - by name, either way: by the stored sort key that way, so "by name"
 *     means natural order wherever it is asked for - a picker's search, the
 *     Name column of Project Settings > Labels, Slack and Teams, the API;
 *   - anything else: as asked.
 *
 * The name itself follows the key, the same way, for a label whose key has
 * not been written yet (the data migration that writes the keys of labels
 * made before them runs once, after deploy).
 */
export const getLabelListSort: (
  sort: Record<string, SortOrder | undefined> | null | undefined,
) => Record<string, SortOrder> = (
  sort: Record<string, SortOrder | undefined> | null | undefined,
): Record<string, SortOrder> => {
  const entries: Array<[string, SortOrder]> = Object.entries(sort || {}).filter(
    (entry: [string, SortOrder | undefined]): entry is [string, SortOrder] => {
      return Boolean(entry[1]);
    },
  );

  if (entries.length === 0) {
    return {
      [LABEL_NAME_SORT_KEY_COLUMN]: SortOrder.Ascending,
      [LABEL_NAME_COLUMN]: SortOrder.Ascending,
    };
  }

  const readSort: Record<string, SortOrder> = {};

  for (const [column, order] of entries) {
    if (column === LABEL_NAME_COLUMN) {
      readSort[LABEL_NAME_SORT_KEY_COLUMN] =
        readSort[LABEL_NAME_SORT_KEY_COLUMN] || order;
      readSort[LABEL_NAME_COLUMN] = order;
      continue;
    }

    if (readSort[column] === undefined) {
      readSort[column] = order;
    }
  }

  return readSort;
};

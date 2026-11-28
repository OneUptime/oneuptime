import LabelAccess from "../../Types/LabelAccess/LabelAccess";
import { OwnedKindModel } from "../../Types/Database/AccessControl/KindsWithOwners";
import { formatNameList } from "./NameList";
import PermissionGate, {
  ColumnKeptToLabelsOnClient,
  ColumnPermissionCheckableModel,
  LabelledGateModel,
} from "./PermissionGate";
import {
  composedValue,
  translatableTerm,
  translationKey,
  Translator,
} from "./TranslateTemplate";

/*
 * A COLUMN A LIST IS NOT SORTED BY FOR THIS READER, AND WHY (#11437).
 *
 * A column only those who may change a record read - a monitor's secret
 * keys, a runner's key - is left out of the records the reader's grant to
 * read it does not reach: the ones outside the labels it is limited to
 * (AccessControlPermission.getColumnsKeptToLabels, #11259), or that neither
 * they nor their teams own, for a grant scoped to Owned
 * (OwnedScopePermission.getColumnsKeptToOwners). An order by such a column
 * would say where the others fall in it, one guess at a time, so the server
 * refuses it ("Your access lets you read the Secret Key only of the
 * Monitors carrying some labels, so you cannot sort Monitors by it."). The
 * list's header offered it anyway, and pressing it showed the refusal.
 *
 * So a list does not offer such a column's header as sortable, nor puts it
 * back as the sort a saved view or a link asked for, and the header's (i)
 * says why: "You can read this only on monitors labelled Production, so the
 * list cannot be sorted by it." Worked out by the server's own rule from the
 * permission snapshot (PermissionGate.getColumnKeptToLabels,
 * isColumnKeptToOwners).
 */

export const COLUMN_SORT_LOCK_REASONS: Readonly<{
  // {{items}}: the kind's plural; {{labels}}: the labels the column is read on.
  labels: string;
  labelsUnnamed: string;
  owned: string;
}> = {
  labels: translationKey(
    "You can read this only on {{items}} labelled {{labels}}, so the list cannot be sorted by it.",
  ),
  labelsUnnamed: translationKey(
    "You can read this only on {{items}} with certain labels, so the list cannot be sorted by it.",
  ),
  owned: translationKey(
    "You can read this only on {{items}} you or your teams own, so the list cannot be sorted by it.",
  ),
};

export interface ColumnSortLock {
  column: string;
  // Kept to labels: the labels it is read on. Kept to owners: none.
  labelIds: Array<string>;
  isKeptToOwners: boolean;
}

export type SortLockModel = ColumnPermissionCheckableModel &
  LabelledGateModel &
  OwnedKindModel;

/*
 * Why the reader may not sort `model`'s records by `column`, or null when
 * they may: a column kept to labels or to owners. A relation's columns are
 * its own model's to weigh, so only a column of the model's own is asked.
 */
export function getColumnSortLock(
  model: SortLockModel,
  column: string | null | undefined,
): ColumnSortLock | null {
  /*
   * A database model's: an analytics model's columns are not withheld by
   * labels or owners, and it names no labels column.
   */
  if (
    !column ||
    column.includes(".") ||
    typeof model.getAccessControlColumn !== "function"
  ) {
    return null;
  }

  const keptToLabels: ColumnKeptToLabelsOnClient | null =
    PermissionGate.getColumnKeptToLabels(model, column);

  if (keptToLabels) {
    return {
      column: column,
      labelIds: keptToLabels.labelIds,
      isKeptToOwners: false,
    };
  }

  if (PermissionGate.isColumnKeptToOwners(model, column)) {
    return { column: column, labelIds: [], isKeptToOwners: true };
  }

  return null;
}

// The sentence a locked sort's header says, in the reader's language.
export function getColumnSortLockSentence(data: {
  lock: ColumnSortLock;
  // The kind's plural, as a list names it: "Monitors".
  pluralName: string;
  labelNames: ReadonlyMap<string, string>;
  translator: Translator;
}): string {
  const items: ReturnType<typeof translatableTerm> = translatableTerm(
    data.pluralName || "items",
    { inSentence: true },
  );

  if (data.lock.isKeptToOwners) {
    return data.translator.translateTemplate(COLUMN_SORT_LOCK_REASONS.owned, {
      items: items,
    });
  }

  const names: Array<string> = data.lock.labelIds
    .map((labelId: string): string => {
      return data.labelNames.get(LabelAccess.readId(labelId)) || "";
    })
    .filter((name: string): boolean => {
      return name.trim().length > 0;
    });

  if (names.length === 0) {
    return data.translator.translateTemplate(
      COLUMN_SORT_LOCK_REASONS.labelsUnnamed,
      { items: items },
    );
  }

  return data.translator.translateTemplate(COLUMN_SORT_LOCK_REASONS.labels, {
    items: items,
    labels: composedValue((sentence: Translator): string => {
      return formatNameList(names, "or", sentence);
    }),
  });
}

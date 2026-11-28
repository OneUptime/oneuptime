import Label from "../../Models/DatabaseModels/Label";
import LabelAccess, {
  LabelRefusal,
  LabelVerdict,
} from "../../Types/LabelAccess/LabelAccess";
import { formatNameList } from "./NameList";
import PermissionGate, {
  LabelledGateModel,
  LabelLockAction,
  ModelAction,
  ModelLabelLock,
  ModelPartLock,
  ModelRecordLock,
  PartGateModel,
  PartLockAction,
  RecordOwnershipFacts,
} from "./PermissionGate";
import {
  RecordAccessScope,
  RecordGateAccess,
  RecordGateModel,
  RecordGateOperation,
} from "./RecordAccessScope";
import {
  getRecordOwnershipFacts,
  RecordOwnershipState,
} from "./RecordOwnershipRead";
import RecordsById from "./RecordsById";
import {
  composedValue,
  translatableTerm,
  translationKey,
  Translator,
} from "./TranslateTemplate";
import React from "react";

/*
 * A RECORD'S CHANGES LOCKED BY ITS OWN LABELS, WITH WHY (#11259).
 *
 * The reader's own permissions say what they may do somewhere in the
 * project; a grant limited to labels reaches only the records carrying one
 * of them, and a team's block on some labels takes the records carrying
 * those away. The server has always refused a change outside that reach -
 * "You do not have permission to delete Monitor without any labels." -
 * after the confirmation; the Dashboard offered it. Every lock of a
 * record's Edit and Delete now weighs the record's labels by the rule the
 * server refuses by (PermissionGate.getLabelLock, Types/LabelAccess) and
 * says why after the lock's first sentence: "You do not have permission to
 * delete this monitor. Your permission is limited to monitors labelled
 * Payments."
 *
 * A record's page (ModelPage) hands its gates the answer for the record it
 * is open on (getRecordLabelAccessScope, through RecordAccessScope, which
 * every gate on the page reads); a list (ModelTable) locks each row by the
 * labels it was read with (getRecordLabelRefusal).
 */

export const RECORD_LABEL_LOCK_REASONS: Readonly<{
  // {{items}}: the kind's plural; {{labels}}: the labels the grant reaches.
  labels: string;
  // The same, while the labels' names are read, or when they cannot be.
  labelsUnnamed: string;
  // {{labels}}: the record's labels a team's block takes the change away on.
  blockedLabels: string;
  blockedLabelsUnnamed: string;
  // {{itemName}}: the record is outside the reader's read itself.
  notReadable: string;
  // Every grant is scoped to Owned, and neither the reader nor their teams own it (#11436).
  owned: string;
  // Grants limited to labels beside grants scoped to Owned, and it is neither (#11436).
  labelsOrOwned: string;
  labelsOrOwnedUnnamed: string;
}> = {
  labels: translationKey(
    "Your permission is limited to {{items}} labelled {{labels}}.",
  ),
  labelsUnnamed: translationKey(
    "Your permission is limited to {{items}} with certain labels.",
  ),
  blockedLabels: translationKey(
    "A team you are on blocks this on {{items}} labelled {{labels}}.",
  ),
  blockedLabelsUnnamed: translationKey(
    "A team you are on blocks this on {{items}} with certain labels.",
  ),
  notReadable: translationKey(
    "Your permissions do not reach this {{itemName}}.",
  ),
  owned: translationKey(
    "Your permission is limited to {{items}} you or your teams own.",
  ),
  labelsOrOwned: translationKey(
    "Your permission is limited to {{items}} labelled {{labels}} and to {{items}} you or your teams own.",
  ),
  labelsOrOwnedUnnamed: translationKey(
    "Your permission is limited to {{items}} with certain labels and to {{items}} you or your teams own.",
  ),
};

// The kind's names, as a lock's sentences say them.
export interface RecordLabelLockNouns {
  // "Monitor"
  singularName: string;
  // "Monitors"
  pluralName: string;
}

/*
 * Why a record's labels refuse an operation, in the reader's language - the
 * sentence after the lock's first. Labels are named as the project wrote
 * them; while no name is known yet, or none can be read, the sentence names
 * none.
 */
export function getLabelRefusalSentence(data: {
  verdict: LabelVerdict;
  nouns: RecordLabelLockNouns;
  labelNames: ReadonlyMap<string, string>;
  translator: Translator;
  /*
   * A record's part (#11435): a read it is not one the reader may read says
   * why, by the record's labels or owners - "Your permission is limited to
   * monitors labelled Production." - since the record itself is on screen.
   */
  saysWhyNotReadable?: boolean | undefined;
}): string {
  const translator: Translator = data.translator;
  const items: ReturnType<typeof translatableTerm> = translatableTerm(
    data.nouns.pluralName || "items",
    { inSentence: true },
  );

  const names: Array<string> = data.verdict.labelIds
    .map((labelId: unknown): string => {
      return data.labelNames.get(LabelAccess.readId(labelId)) || "";
    })
    .filter((name: string): boolean => {
      return name.trim().length > 0;
    });

  /*
   * The labels named are those whose names were read: a label deleted since
   * has none, and no record carries it any more.
   */
  const named: (template: string, unnamed: string) => string = (
    template: string,
    unnamed: string,
  ): string => {
    if (names.length === 0) {
      return translator.translateTemplate(unnamed, { items: items });
    }

    return translator.translateTemplate(template, {
      items: items,
      labels: composedValue((sentence: Translator): string => {
        return formatNameList(names, "or", sentence);
      }),
    });
  };

  const refusal: LabelRefusal | null =
    data.verdict.refusal === LabelRefusal.NotReadable &&
    data.saysWhyNotReadable &&
    data.verdict.cause
      ? data.verdict.cause
      : data.verdict.refusal;

  switch (refusal) {
    case LabelRefusal.BlockedLabels:
      return named(
        RECORD_LABEL_LOCK_REASONS.blockedLabels,
        RECORD_LABEL_LOCK_REASONS.blockedLabelsUnnamed,
      );
    case LabelRefusal.NotReadable:
      return translator.translateTemplate(
        RECORD_LABEL_LOCK_REASONS.notReadable,
        {
          itemName: translatableTerm(data.nouns.singularName || "item", {
            inSentence: true,
          }),
        },
      );
    case LabelRefusal.Owned:
      return translator.translateTemplate(RECORD_LABEL_LOCK_REASONS.owned, {
        items: items,
      });
    case LabelRefusal.LabelsOrOwned:
      return named(
        RECORD_LABEL_LOCK_REASONS.labelsOrOwned,
        RECORD_LABEL_LOCK_REASONS.labelsOrOwnedUnnamed,
      );
    case LabelRefusal.Labels:
    default:
      return named(
        RECORD_LABEL_LOCK_REASONS.labels,
        RECORD_LABEL_LOCK_REASONS.labelsUnnamed,
      );
  }
}

/*
 * The ids of the labels a record was read with, or null when it was read
 * without them: a select that did not name them, or a reader the server
 * leaves them out for - nothing can then be said of its labels, and
 * nothing is locked by them.
 */
export function getRecordLabelIds(
  record: unknown,
  labelsColumn: string,
): Array<string> | null {
  if (!record || typeof record !== "object") {
    return null;
  }

  const labels: unknown = (record as Record<string, unknown>)[labelsColumn];

  if (!Array.isArray(labels)) {
    return null;
  }

  const ids: Array<string> = [];

  for (const label of labels) {
    const id: string = LabelAccess.readId(
      label && typeof label === "object"
        ? (label as { _id?: unknown; id?: unknown })._id ||
            (label as { _id?: unknown; id?: unknown }).id
        : label,
    );

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * Why the labels of one record - and who owns it, when that is known
 * (#11436) - lock `action`, in the reader's language, or null when they do
 * not: the labels allow it, leave it to owners not known yet, or were not
 * read with the record.
 */
export function getRecordLabelRefusal(data: {
  lock: ModelLabelLock | ModelRecordLock | null;
  action: LabelLockAction;
  recordLabelIds: ReadonlyArray<unknown> | null;
  nouns: RecordLabelLockNouns;
  labelNames: ReadonlyMap<string, string>;
  translator: Translator;
  ownership?: RecordOwnershipFacts | null | undefined;
}): string | null {
  if (!data.lock || !data.recordLabelIds) {
    return null;
  }

  const verdict: LabelVerdict = (data.lock as ModelRecordLock).weigh(
    data.action,
    data.recordLabelIds,
    data.ownership || null,
  );

  if (verdict.isAllowed) {
    return null;
  }

  return getLabelRefusalSentence({
    verdict: verdict,
    nouns: data.nouns,
    labelNames: data.labelNames,
    translator: data.translator,
  });
}

/*
 * WHAT A RECORD'S LABELS - AND WHO OWNS IT - LOCK ON ITS PAGE (ModelPage),
 * for every gate there that asks about the record's own model
 * (RecordAccessScope, read by usePrivateRecordGateOptions): its update and
 * delete, each with why. Null when nothing can be locked, or the record was
 * read without its labels.
 *
 * Given the record's model, the scope answers its PARTS' gates too when
 * they ask (#11435, RecordAccessScope.getPartAccess): a monitor's owners'
 * Add and Remove, its probes' - what the record's labels and owners leave
 * the reader of the part's rows (PermissionGate.getPartLock).
 *
 * Given who owns the record (#11436, the server's answer: RecordOwnership),
 * a change a grant scoped to Owned does not reach is refused with why; while
 * the page is still reading it, what the owners decide is held back - not
 * offered, nothing said - and with no answer it is left to the server.
 */
export function getRecordLabelAccessScope(data: {
  tableName: string | null | undefined;
  // The record the page is open on.
  recordId: string;
  lock: ModelLabelLock | ModelRecordLock | null;
  recordLabelIds: ReadonlyArray<unknown> | null;
  nouns: RecordLabelLockNouns;
  labelNames: ReadonlyMap<string, string>;
  translator: Translator;
  // The record's model, whose parts' gates the scope answers too (#11435).
  recordModel?: LabelledGateModel | undefined;
  // Who owns the record, as the server answered it (#11436).
  ownership?: RecordOwnershipState | undefined;
}): RecordAccessScope | null {
  if (
    !data.tableName ||
    !data.recordLabelIds ||
    (!data.lock && !data.recordModel)
  ) {
    return null;
  }

  const tableName: string = data.tableName;
  const recordLabelIds: ReadonlyArray<unknown> = data.recordLabelIds;
  const recordId: string = data.recordId.toLowerCase();
  const facts: RecordOwnershipFacts | null = getRecordOwnershipFacts(
    data.ownership?.result || null,
    recordId,
  );
  const isOwnershipPending: boolean = Boolean(
    data.ownership && !data.ownership.isRead,
  );

  // What a lock's verdicts leave of each operation, for the page's gates.
  const getAccess: (
    weigh: (action: PartLockAction) => LabelVerdict,
    operations: Array<[PartLockAction, RecordGateOperation]>,
    isPart: boolean,
  ) => RecordGateAccess = (
    weigh: (action: PartLockAction) => LabelVerdict,
    operations: Array<[PartLockAction, RecordGateOperation]>,
    isPart: boolean,
  ): RecordGateAccess => {
    const refusals: Partial<Record<RecordGateOperation, string>> = {};
    const heldBack: Array<RecordGateOperation> = [];

    for (const [action, operation] of operations) {
      const verdict: LabelVerdict = weigh(action);

      if (!verdict.isAllowed) {
        refusals[operation] = getLabelRefusalSentence({
          verdict: verdict,
          nouns: data.nouns,
          labelNames: data.labelNames,
          translator: data.translator,
          saysWhyNotReadable: isPart,
        });
        continue;
      }

      if (verdict.isDecidedByOwners && isOwnershipPending) {
        heldBack.push(operation);
      }
    }

    return {
      isHeldBack: false,
      refusals: refusals,
      ...(heldBack.length > 0 ? { heldBackOperations: heldBack } : {}),
    };
  };

  const tables: Record<string, RecordGateAccess> = {};
  const tableNames: Array<string> = [];

  if (data.lock) {
    const lock: ModelRecordLock = data.lock as ModelRecordLock;

    tables[tableName] = getAccess(
      (action: PartLockAction): LabelVerdict => {
        return lock.weigh(action as LabelLockAction, recordLabelIds, facts);
      },
      [
        [ModelAction.Update, "update"],
        [ModelAction.Delete, "delete"],
      ],
      false,
    );
    tableNames.push(tableName);
  }

  const scope: RecordAccessScope = {
    tables: tables,
    tableNames: tableNames,
    isHeldBack: false,
    recordTableName: tableName,
    recordId: recordId,
  };

  const recordModel: LabelledGateModel | undefined = data.recordModel;

  if (recordModel) {
    // Each part's answer, worked out once for the page.
    const parts: Map<string, RecordGateAccess | null> = new Map<
      string,
      RecordGateAccess | null
    >();

    scope.getPartAccess = (
      model: RecordGateModel,
    ): RecordGateAccess | undefined => {
      const partTableName: string = model.tableName || "";

      if (!partTableName || partTableName === tableName) {
        return undefined;
      }

      if (!parts.has(partTableName)) {
        const lock: ModelPartLock | null = isPartGateModel(model)
          ? PermissionGate.getPartLock(model, recordModel)
          : null;

        parts.set(
          partTableName,
          lock
            ? getAccess(
                (action: PartLockAction): LabelVerdict => {
                  return lock.weigh(action, recordLabelIds, facts);
                },
                [
                  [ModelAction.Create, "create"],
                  [ModelAction.Update, "update"],
                  [ModelAction.Delete, "delete"],
                ],
                true,
              )
            : null,
        );
      }

      return parts.get(partTableName) || undefined;
    };
  }

  return scope;
}

/*
 * Whether a model a gate asks about can be weighed as a part: a database
 * model, with its permissions and what it is read through.
 */
function isPartGateModel(model: RecordGateModel): model is PartGateModel {
  const candidate: Partial<PartGateModel> = model as Partial<PartGateModel>;

  return (
    typeof candidate.getCreatePermissions === "function" &&
    typeof candidate.getReadPermissions === "function" &&
    typeof candidate.getUpdatePermissions === "function" &&
    typeof candidate.getDeletePermissions === "function" &&
    typeof candidate.getTableColumnMetadata === "function"
  );
}

/*
 * The scope a record's page hands its gates: what the server answered for
 * the record (an incident's, RecordAccessScopeProvider) and what its labels
 * lock - the server's answer for each table it answers, since it weighs the
 * labels too, and the labels' for the others. Either alone as it is.
 */
export function mergeRecordAccessScopes(
  outer: RecordAccessScope | null,
  own: RecordAccessScope | null,
): RecordAccessScope | null {
  if (!outer) {
    return own;
  }

  if (!own) {
    return outer;
  }

  const tableNames: Array<string> = [...outer.tableNames];

  for (const tableName of own.tableNames) {
    if (!tableNames.includes(tableName)) {
      tableNames.push(tableName);
    }
  }

  return {
    tables: { ...own.tables, ...outer.tables },
    tableNames: tableNames,
    isHeldBack: outer.isHeldBack,
    recordTableName: outer.recordTableName || own.recordTableName,
    recordId: outer.recordId || own.recordId,
    // The parts the server's answer names are its; the labels' answer the rest.
    ...(own.getPartAccess || outer.getPartAccess
      ? { getPartAccess: own.getPartAccess || outer.getPartAccess }
      : {}),
  };
}

/*
 * THE NAMES OF LABELS, BY ID, read once for the page and kept for the rest
 * of it: a lock names the labels a permission is limited to, which the
 * record locked rarely carries. Every member of a project may read its
 * labels. A label that cannot be read - deleted since - has no name, and
 * its lock says the sentence that names none.
 */
const labelNames: Map<string, string> = new Map<string, string>();
const labelNamesRead: Map<string, Promise<void>> = new Map<
  string,
  Promise<void>
>();

export function getKnownLabelNames(
  labelIds: ReadonlyArray<string>,
): Map<string, string> {
  const known: Map<string, string> = new Map<string, string>();

  for (const labelId of labelIds) {
    const id: string = LabelAccess.readId(labelId);
    const name: string | undefined = labelNames.get(id);

    if (name) {
      known.set(id, name);
    }
  }

  return known;
}

// Reads the names of the labels not read yet; each label is asked for once.
export async function readLabelNames(
  labelIds: ReadonlyArray<string>,
): Promise<void> {
  const ids: Array<string> = labelIds
    .map((labelId: string): string => {
      return LabelAccess.readId(labelId);
    })
    .filter((id: string): boolean => {
      return Boolean(id) && !labelNames.has(id) && !labelNamesRead.has(id);
    });

  const waiting: Array<Promise<void>> = labelIds
    .map((labelId: string): Promise<void> | undefined => {
      return labelNamesRead.get(LabelAccess.readId(labelId));
    })
    .filter((read: Promise<void> | undefined): read is Promise<void> => {
      return Boolean(read);
    });

  if (ids.length > 0) {
    const read: Promise<void> = (async (): Promise<void> => {
      try {
        const labels: Array<Label> = await RecordsById.read<Label>({
          modelType: Label,
          ids: ids,
          select: { name: true },
        });

        for (const label of labels) {
          labelNames.set(
            LabelAccess.readId(label._id || label.id),
            label.name || "",
          );
        }
      } finally {
        for (const id of ids) {
          if (!labelNames.has(id)) {
            labelNames.set(id, "");
          }

          labelNamesRead.delete(id);
        }
      }
    })();

    for (const id of ids) {
      labelNamesRead.set(id, read);
    }

    waiting.push(read);
  }

  await Promise.all(waiting);
}

/*
 * The names of `labelIds` known on this page, read once as it draws: the
 * component draws again when they land. Unnamed until then.
 */
export function useLabelNames(
  labelIds: ReadonlyArray<string>,
): ReadonlyMap<string, string> {
  const key: string = [...labelIds]
    .map((labelId: string): string => {
      return LabelAccess.readId(labelId);
    })
    .sort()
    .join(",");

  const [names, setNames] = React.useState<Map<string, string>>(() => {
    return getKnownLabelNames(labelIds);
  });

  React.useEffect(() => {
    const ids: Array<string> = key ? key.split(",") : [];

    setNames(getKnownLabelNames(ids));

    if (ids.length === 0) {
      return undefined;
    }

    let isCurrent: boolean = true;

    readLabelNames(ids)
      .then(() => {
        if (isCurrent) {
          setNames(getKnownLabelNames(ids));
        }
      })
      .catch(() => {
        // The lock says the sentence that names no label.
      });

    return () => {
      isCurrent = false;
    };
  }, [key]);

  return names;
}

// Test seam: the names are kept for the life of the page.
export function clearLabelNames(): void {
  labelNames.clear();
  labelNamesRead.clear();
}

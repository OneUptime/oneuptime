import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ActionMenuGroup } from "Common/UI/Components/ActionButton/ActionMenuGroup";
import {
  BULK_ACTION_CONCURRENCY,
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ExceptionTriageAction,
  getExceptionTriageActions,
} from "../../Utils/ExceptionDetailPresentation";

/*
 * Resolve or Reopen, and Archive or Unarchive, in each exception's ⋯ menu
 * on the exceptions list - the two triage actions the exception's own page
 * offers in its header (ExceptionTriageActions), with the same words, the
 * same one click (both are undone from the same menu) and the same lock
 * for someone who may not update exceptions. Only the switch is sent: the
 * server records who turned it, and when. The list reads its rows again
 * afterwards, where a resolved exception leaves the Unresolved tab.
 *
 * The same four act on the rows a person ticks, from the list's Bulk
 * Actions (getExceptionBulkActions).
 */

const TRIAGE_ICONS: Record<ExceptionTriageAction["id"], IconProp> = {
  resolve: IconProp.Check,
  unresolve: IconProp.Refresh,
  archive: IconProp.Archive,
  unarchive: IconProp.Unarchive,
};

// Which of the four a row is offered: the two its state leads to.
export const isExceptionTriageActionOffered: (
  exception: TelemetryException,
  id: ExceptionTriageAction["id"],
) => boolean = (
  exception: TelemetryException,
  id: ExceptionTriageAction["id"],
): boolean => {
  return getExceptionTriageActions({
    isResolved: Boolean(exception.isResolved),
    isArchived: Boolean(exception.isArchived),
  }).some((action: ExceptionTriageAction): boolean => {
    return action.id === id;
  });
};

// What a triage action writes: the one switch it turns.
export const getExceptionTriageWrite: (
  id: ExceptionTriageAction["id"],
) => { isResolved: boolean } | { isArchived: boolean } = (
  id: ExceptionTriageAction["id"],
): { isResolved: boolean } | { isArchived: boolean } => {
  switch (id) {
    case "resolve":
      return { isResolved: true };
    case "unresolve":
      return { isResolved: false };
    case "archive":
      return { isArchived: true };
    case "unarchive":
      return { isArchived: false };
  }
};

export const EXCEPTION_ROW_TRIAGE_ORDER: Array<ExceptionTriageAction["id"]> = [
  "resolve",
  "unresolve",
  "archive",
  "unarchive",
];

// The words of each action, as the exception's page says them.
const TRIAGE_LABELS: Record<ExceptionTriageAction["id"], string> = {
  resolve: "Resolve",
  unresolve: "Reopen",
  archive: "Archive",
  unarchive: "Unarchive",
};

// An exception's id, as a row or a read carries it.
export const getExceptionId: (exception: TelemetryException) => string = (
  exception: TelemetryException,
): string => {
  return (exception._id || exception.id)?.toString() || "";
};

// The most of an exception's message a name holds.
export const EXCEPTION_NAME_MAX_LENGTH: number = 200;

/*
 * How a selected exception is named - its box's label, and the result's
 * lists of what changed and what did not: its type and its message's first
 * line, as the row shows them ("TypeError: x is undefined"). One without
 * either goes by its fingerprint.
 */
export const getExceptionName: (exception: TelemetryException) => string = (
  exception: TelemetryException,
): string => {
  const type: string = exception.exceptionType?.trim() || "";
  const firstLine: string =
    (exception.message || "").split("\n")[0]?.trim() || "";
  const name: string =
    type && firstLine
      ? `${type}: ${firstLine}`
      : type ||
        firstLine ||
        exception.fingerprint?.toString() ||
        getExceptionId(exception);

  return name.length > EXCEPTION_NAME_MAX_LENGTH
    ? `${name.slice(0, EXCEPTION_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;
};

/*
 * Why a selected exception was left alone by a bulk action, as the result
 * lists it: it is there already. The two switches are apart - resolved or
 * not, archived or not - so a row a move cannot take is one the move would
 * not change.
 */
export const EXCEPTION_ALREADY_THERE: Record<
  ExceptionTriageAction["id"],
  string
> = {
  resolve: translationKey("Already resolved."),
  unresolve: translationKey("Not resolved."),
  archive: translationKey("Already archived."),
  unarchive: translationKey("Not archived."),
};

/*
 * The result's words for what happened to each selected exception - "2
 * Exceptions resolved", "1 Exception not archived" - where "succeeded"
 * says nothing of what was done. Resolve's are an incident list's Resolve's
 * own words, so they share its translations.
 */
export const EXCEPTION_RESULT_LABELS: Record<
  ExceptionTriageAction["id"],
  { succeeded: PluralTemplate; failed: PluralTemplate }
> = {
  resolve: {
    succeeded: {
      one: "{{count}} {{itemName}} resolved",
      other: "{{count}} {{itemsName}} resolved",
    },
    failed: {
      one: "{{count}} {{itemName}} not resolved",
      other: "{{count}} {{itemsName}} not resolved",
    },
  },
  unresolve: {
    succeeded: {
      one: "{{count}} {{itemName}} reopened",
      other: "{{count}} {{itemsName}} reopened",
    },
    failed: {
      one: "{{count}} {{itemName}} not reopened",
      other: "{{count}} {{itemsName}} not reopened",
    },
  },
  archive: {
    succeeded: {
      one: "{{count}} {{itemName}} archived",
      other: "{{count}} {{itemsName}} archived",
    },
    failed: {
      one: "{{count}} {{itemName}} not archived",
      other: "{{count}} {{itemsName}} not archived",
    },
  },
  unarchive: {
    succeeded: {
      one: "{{count}} {{itemName}} unarchived",
      other: "{{count}} {{itemsName}} unarchived",
    },
    failed: {
      one: "{{count}} {{itemName}} not unarchived",
      other: "{{count}} {{itemsName}} not unarchived",
    },
  },
};

/*
 * Why someone who may not update exceptions finds the four locked in Bulk
 * Actions: about the exceptions selected, not "this Exception".
 */
export const EXCEPTION_BULK_LOCK_SENTENCE: string = translationKey(
  "You do not have permission to update these exceptions.",
);

/*
 * Resolve, Reopen, Archive and Unarchive on a selection - Bulk Actions on
 * the exceptions list (TelemetryViewer's `bulk`), whose rows had a ⋯ each
 * and no selection (#5248). Each is offered while one of the selected
 * exceptions can take it, in the row's order and with the row's icons, and
 * locked, saying why, for someone who may not update exceptions. Every
 * exception is written as its row's action writes it - the one switch, one
 * request each (runBulkAction) - and one there already is left alone,
 * saying so. A refusal fails only its own exception, in the server's words.
 */
export const getExceptionBulkActions: () => Array<
  BulkActionButtonSchema<TelemetryException>
> = (): Array<BulkActionButtonSchema<TelemetryException>> => {
  const gate: PermissionGateResult = PermissionGate.check(
    new TelemetryException(),
    ModelAction.Update,
    { sentence: EXCEPTION_BULK_LOCK_SENTENCE },
  );

  return EXCEPTION_ROW_TRIAGE_ORDER.map(
    (
      id: ExceptionTriageAction["id"],
    ): BulkActionButtonSchema<TelemetryException> => {
      return {
        title: TRIAGE_LABELS[id],
        icon: TRIAGE_ICONS[id],
        buttonStyleType: ButtonStyleType.NORMAL,
        // The exception's own state, as an incident's moves are grouped.
        menuGroup: ActionMenuGroup.Change,
        resultLabels: EXCEPTION_RESULT_LABELS[id],
        isVisible: (exceptions: Array<TelemetryException>): boolean => {
          return (
            exceptions.length === 0 ||
            exceptions.some((exception: TelemetryException): boolean => {
              return isExceptionTriageActionOffered(exception, id);
            })
          );
        },
        ...(!gate.isAllowed && gate.disabledReason
          ? { disabled: true, tooltip: gate.disabledReason }
          : {}),
        onClick: async (
          actionProps: BulkActionOnClickProps<TelemetryException>,
        ): Promise<void> => {
          await runBulkAction<TelemetryException>({
            actionProps: actionProps,
            // Each exception's switch is its own: several at once.
            concurrency: BULK_ACTION_CONCURRENCY,
            step: async (
              exception: TelemetryException,
            ): Promise<BulkItemOutcome> => {
              if (!isExceptionTriageActionOffered(exception, id)) {
                return bulkItemUnchanged(
                  getGlobalTranslator().translateText(
                    EXCEPTION_ALREADY_THERE[id],
                  ) || EXCEPTION_ALREADY_THERE[id],
                );
              }

              const exceptionId: string = getExceptionId(exception);

              if (!exceptionId) {
                throw new Error("Exception not found");
              }

              await ModelAPI.updateById<TelemetryException>({
                id: new ObjectID(exceptionId),
                modelType: TelemetryException,
                data: getExceptionTriageWrite(id),
              });

              return BULK_ITEM_CHANGED;
            },
          });
        },
      };
    },
  );
};

export const getExceptionRowActions: (data: {
  // Told once an exception changed: the list reads its rows again.
  onChanged: () => void;
}) => Array<ActionButtonSchema<TelemetryException>> = (data: {
  onChanged: () => void;
}): Array<ActionButtonSchema<TelemetryException>> => {
  const gate: PermissionGateResult = PermissionGate.check(
    new TelemetryException(),
    ModelAction.Update,
  );

  return EXCEPTION_ROW_TRIAGE_ORDER.map(
    (
      id: ExceptionTriageAction["id"],
    ): ActionButtonSchema<TelemetryException> => {
      return {
        title: TRIAGE_LABELS[id],
        icon: TRIAGE_ICONS[id],
        buttonStyleType: ButtonStyleType.OUTLINE,
        // The row itself opens the exception; these sit in its ⋯ menu.
        placement: ActionButtonPlacement.MoreMenu,
        isVisible: (exception: TelemetryException): boolean => {
          return isExceptionTriageActionOffered(exception, id);
        },
        ...(!gate.isAllowed && gate.disabledReason
          ? { disabled: true, tooltip: gate.disabledReason }
          : {}),
        onClick: async (
          exception: TelemetryException,
          onCompleteAction: VoidFunction,
          onError: ErrorFunction,
        ): Promise<void> => {
          try {
            const exceptionId: string = getExceptionId(exception);

            if (!exceptionId) {
              throw new Error("Exception not found");
            }

            await ModelAPI.updateById<TelemetryException>({
              id: new ObjectID(exceptionId),
              modelType: TelemetryException,
              data: getExceptionTriageWrite(id),
            });

            data.onChanged();
            onCompleteAction();
          } catch (err) {
            onError(new Error(API.getFriendlyMessage(err)));
          }
        },
      };
    },
  );
};

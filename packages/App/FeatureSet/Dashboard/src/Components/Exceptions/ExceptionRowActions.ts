import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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
            const exceptionId: string =
              (exception._id || exception.id)?.toString() || "";

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

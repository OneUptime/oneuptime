import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ExceptionTriageAction,
  ExceptionTriageState,
  getExceptionTriageActions,
} from "../../Utils/ExceptionDetailPresentation";
import {
  EVENT_HEADER_BUTTON_CLASS_NAME,
  EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME,
  EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME,
  EVENT_HEADER_NEUTRAL_BUTTON_HOVER_CLASS_NAME,
  EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME,
  EVENT_HEADER_PRIMARY_BUTTON_HOVER_CLASS_NAME,
} from "../EventView/EventHeaderLayout";

export type ExceptionTriageActionId = ExceptionTriageAction["id"];

export interface ComponentProps extends ExceptionTriageState {
  // The action whose request is in flight, if any.
  pendingActionId?: ExceptionTriageActionId | undefined;
  onAction: (action: ExceptionTriageAction) => void;
}

export const EXCEPTION_TRIAGE_ACTION_ICONS: Record<
  ExceptionTriageActionId,
  IconProp
> = {
  resolve: IconProp.Check,
  "resolve-next-release": IconProp.CheckCircle,
  unresolve: IconProp.Refresh,
  archive: IconProp.Archive,
  unarchive: IconProp.Unarchive,
};

/*
 * A header button, drawn as an incident's and a security case's are
 * (EventHeaderLayout): Resolve is the main move, in indigo; the others are
 * white. Locked, it fades with the not-allowed cursor; busy, it shows a
 * spinner in its icon's place and answers no hover until it is done.
 */
export function getExceptionTriageButtonClassName(data: {
  isPrimary: boolean;
  isLocked: boolean;
  isBusy: boolean;
}): string {
  return `${EVENT_HEADER_BUTTON_CLASS_NAME} ${
    data.isPrimary
      ? EVENT_HEADER_PRIMARY_BUTTON_CLASS_NAME
      : EVENT_HEADER_NEUTRAL_BUTTON_CLASS_NAME
  } ${getHandDrawnButtonStateClassName({
    isLocked: data.isLocked,
    isBusy: data.isBusy,
    hoverClassName: data.isPrimary
      ? EVENT_HEADER_PRIMARY_BUTTON_HOVER_CLASS_NAME
      : EVENT_HEADER_NEUTRAL_BUTTON_HOVER_CLASS_NAME,
  })}`;
}

/*
 * The header's two buttons: Resolve (or Reopen) and Archive (or Unarchive),
 * one click each, and each undone from the same place. Resolve in next
 * release waits in the header's ⋯ (ExceptionMoreActions): most people
 * resolve, and the rarer choice is a menu away rather than a third control.
 *
 * A viewer without update permission still sees them, locked, with the
 * missing permission as the tooltip. While one is saving it shows the work
 * and the other waits.
 */
const ExceptionTriageActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);

  const actions: Array<ExceptionTriageAction> = getExceptionTriageActions({
    isResolved: props.isResolved,
    isArchived: props.isArchived,
  });

  const lockReason: string | undefined = updateGate.isAllowed
    ? undefined
    : updateGate.disabledReason;

  return (
    <>
      {actions.map((action: ExceptionTriageAction): ReactElement => {
        const isPrimary: boolean = action.id === "resolve";
        // Resolve in next release, from the ⋯, is Resolve at work too.
        const isBusy: boolean =
          props.pendingActionId === action.id ||
          (isPrimary && props.pendingActionId === "resolve-next-release");
        const isLocked: boolean =
          !updateGate.isAllowed || (Boolean(props.pendingActionId) && !isBusy);
        const label: string =
          translator.translateText(action.label) || action.label;
        const reason: string | undefined = lockReason
          ? translator.translateText(lockReason) || lockReason
          : undefined;

        const button: ReactElement = (
          <button
            key={action.id}
            type="button"
            title={reason ? undefined : label}
            disabled={isLocked || isBusy}
            aria-disabled={isLocked || isBusy}
            aria-busy={isBusy ? true : undefined}
            data-testid={`exception-triage-${action.id}`}
            onClick={() => {
              if (!isLocked && !isBusy) {
                props.onAction(action);
              }
            }}
            className={`${getExceptionTriageButtonClassName({
              isPrimary,
              isLocked,
              isBusy,
            })}${reason ? " pointer-events-none w-full" : ""}`}
          >
            <Icon
              icon={
                isBusy
                  ? IconProp.Spinner
                  : EXCEPTION_TRIAGE_ACTION_ICONS[action.id]
              }
              className={`h-4 w-4 shrink-0${isBusy ? " animate-spin" : ""}`}
            />
            <span className="truncate">{label}</span>
          </button>
        );

        if (!reason) {
          return button;
        }

        /*
         * A disabled button takes no pointer and no focus, so a locked one
         * says why from a wrapper that can take both.
         */
        return (
          <Tooltip key={action.id} text={reason}>
            <span
              className={EVENT_HEADER_LOCKED_WRAPPER_CLASS_NAME}
              tabIndex={0}
              data-testid={`exception-triage-${action.id}-disabled-wrapper`}
            >
              {button}
            </span>
          </Tooltip>
        );
      })}
    </>
  );
};

export default ExceptionTriageActions;

import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ExceptionTriageAction,
  ExceptionTriageState,
  getExceptionTriageActions,
} from "../../Utils/ExceptionDetailPresentation";

export type ExceptionTriageActionId = ExceptionTriageAction["id"];

export interface ComponentProps extends ExceptionTriageState {
  // The action whose request is in flight, if any.
  pendingActionId?: ExceptionTriageActionId | undefined;
  onAction: (action: ExceptionTriageAction) => void;
}

const ACTION_ICONS: Record<ExceptionTriageActionId, IconProp> = {
  resolve: IconProp.Check,
  unresolve: IconProp.Refresh,
  archive: IconProp.Archive,
  unarchive: IconProp.Unarchive,
};

/*
 * Resolve / reopen and archive / unarchive, one click each — both are
 * reversible from the same buttons. A viewer without update permission
 * still sees them, locked, with the missing permission as the tooltip.
 */
const ExceptionTriageActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);

  const actions: Array<ExceptionTriageAction> = getExceptionTriageActions({
    isResolved: props.isResolved,
    isArchived: props.isArchived,
  });

  return (
    <>
      {actions.map((action: ExceptionTriageAction): ReactElement => {
        const isPrimary: boolean = action.id === "resolve";

        return (
          <Button
            key={action.id}
            title={action.label}
            icon={ACTION_ICONS[action.id]}
            buttonSize={ButtonSize.Small}
            buttonStyle={
              isPrimary ? ButtonStyleType.SUCCESS_OUTLINE : ButtonStyleType.NORMAL
            }
            dataTestId={`exception-triage-${action.id}`}
            isLoading={props.pendingActionId === action.id}
            disabled={
              !updateGate.isAllowed ||
              (Boolean(props.pendingActionId) &&
                props.pendingActionId !== action.id)
            }
            tooltip={updateGate.isAllowed ? undefined : updateGate.disabledReason}
            onClick={() => {
              props.onAction(action);
            }}
          />
        );
      })}
    </>
  );
};

export default ExceptionTriageActions;

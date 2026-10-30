import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import PeoplePicker from "Common/UI/Components/PeoplePicker/PeoplePicker";
import {
  PeoplePickerKind,
  PeoplePickerValue,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  ExceptionAssignmentWrite,
  getExceptionAssigneeValue,
  getExceptionAssignmentWrite,
  isSameAssignment,
} from "../../Utils/ExceptionAssignment";

/*
 * Who owns the exception, in its header: one person or one team, picked in
 * one step, unassigned by removing the pick. Saved as soon as it is picked;
 * someone who may not update exceptions sees it locked, saying why.
 */

export const ASSIGNEE_KINDS: Array<PeoplePickerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

export interface ComponentProps {
  exception: Pick<TelemetryException, "assignToUserId" | "assignToTeamId">;
  isSaving?: boolean | undefined;
  onAssign: (write: ExceptionAssignmentWrite) => void;
}

const ExceptionAssignee: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const updateGate: PermissionGateResult = useMemo(() => {
    return PermissionGate.check(new TelemetryException(), ModelAction.Update);
  }, []);

  const picker: ReactElement = (
    <div data-testid="exception-assignee">
      <PeoplePicker
        kinds={ASSIGNEE_KINDS}
        value={getExceptionAssigneeValue(props.exception)}
        isSinglePick={true}
        addButtonText="Assign"
        searchPlaceholder="Search people and teams"
        whenNobodyPicked={{ text: "Unassigned", icon: IconProp.User }}
        disabled={!updateGate.isAllowed || Boolean(props.isSaving)}
        dataTestId="exception-assignee-picker"
        onChange={(value: PeoplePickerValue) => {
          const write: ExceptionAssignmentWrite =
            getExceptionAssignmentWrite(value);

          if (!isSameAssignment(props.exception, write)) {
            props.onAssign(write);
          }
        }}
      />
    </div>
  );

  if (updateGate.isAllowed || !updateGate.disabledReason) {
    return picker;
  }

  return <Tooltip text={updateGate.disabledReason}>{picker}</Tooltip>;
};

export default ExceptionAssignee;

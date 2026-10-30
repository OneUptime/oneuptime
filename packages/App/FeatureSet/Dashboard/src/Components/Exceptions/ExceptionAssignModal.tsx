import IconProp from "Common/Types/Icon/IconProp";
import Modal from "Common/UI/Components/Modal/Modal";
import PeoplePicker from "Common/UI/Components/PeoplePicker/PeoplePicker";
import { PeoplePickerValue } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  ExceptionAssignmentWrite,
  getExceptionAssignmentWrite,
} from "../../Utils/ExceptionAssignment";
import { ASSIGNEE_KINDS } from "./ExceptionAssignee";

/*
 * Assign to…, from the exceptions list's Bulk Actions: one person or one
 * team for every exception selected, or nobody, which unassigns them. The
 * run itself - one write per exception, what changed and what did not - is
 * the list's (getExceptionAssignBulkStep).
 */

export interface ComponentProps {
  count: number;
  onClose: () => void;
  onSubmit: (write: ExceptionAssignmentWrite) => void;
}

const ExceptionAssignModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [value, setValue] = useState<PeoplePickerValue>({});
  const write: ExceptionAssignmentWrite = getExceptionAssignmentWrite(value);
  const isUnassigning: boolean = !write.assignToUserId && !write.assignToTeamId;

  return (
    <Modal
      title={
        translator.translatePlural(
          {
            one: "Assign {{count}} exception",
            other: "Assign {{count}} exceptions",
          },
          props.count,
        ) as string
      }
      description="Pick one person or one team. Pick nobody to unassign them."
      submitButtonText={isUnassigning ? "Unassign" : "Assign"}
      onClose={props.onClose}
      onSubmit={() => {
        props.onSubmit(write);
      }}
    >
      <div data-testid="exception-assign-modal">
        <PeoplePicker
          kinds={ASSIGNEE_KINDS}
          value={value}
          isSinglePick={true}
          addButtonText={translationKey("Pick someone")}
          searchPlaceholder="Search people and teams"
          whenNobodyPicked={{ text: "Unassigned", icon: IconProp.User }}
          dataTestId="exception-assign-modal-picker"
          onChange={(next: PeoplePickerValue) => {
            setValue(next);
          }}
        />
      </div>
    </Modal>
  );
};

export default ExceptionAssignModal;

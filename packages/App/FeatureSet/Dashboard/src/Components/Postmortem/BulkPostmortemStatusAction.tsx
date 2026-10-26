import Incident from "Common/Models/DatabaseModels/Incident";
import BadDataException from "Common/Types/Exception/BadDataException";
import Color from "Common/Types/Color";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import {
  BULK_ACTION_CONCURRENCY,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement, useState } from "react";
import {
  PostmortemStatusChoice,
  getPickablePostmortemStatusChoices,
} from "./PostmortemStatusChoices";

export const CHANGE_POSTMORTEM_STATUS: string = translationKey(
  "Change Postmortem Status",
);
export const CHANGE_POSTMORTEM_STATUS_DESCRIPTION: string = translationKey(
  "Move the postmortems of the selected incidents to one status, such as Not Needed for incidents that need none.",
);
export const POSTMORTEM_STATUS_FIELD_TITLE: string =
  translationKey("Postmortem Status");

// The dialog's one field.
const STATUS_FIELD_KEY: string = "postmortemStatusId";

export interface BulkPostmortemStatusActionResult {
  bulkAction: BulkActionButtonSchema<Incident>;
  modal: ReactElement;
}

/*
 * The Postmortems list's bulk action: move the postmortems of the selected
 * incidents to one status - "Not Needed" for a week of low-severity
 * incidents, "Completed" after a review meeting went through them. One
 * update per incident, as every bulk action of an incidents list makes, so
 * each is checked and recorded like a move made on its own page. Archived
 * statuses are never offered.
 */
export default function useBulkPostmortemStatusAction(data: {
  choices: Array<PostmortemStatusChoice>;
  // Told once every selected incident is done, so the list and counts reload.
  onDone?: (() => void) | undefined;
}): BulkPostmortemStatusActionResult {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Incident> | null>(null);

  const pickable: Array<PostmortemStatusChoice> =
    getPickablePostmortemStatusChoices(data.choices);

  const applyStatus: (statusId: string) => Promise<void> = async (
    statusId: string,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    // Close the form first so the progress dialog is visible.
    setShowModal(false);

    /*
     * Each incident its own update, several at once (runBulkAction): what a
     * postmortem status changes - the incident's feed entry - is its own.
     */
    await runBulkAction<Incident>({
      actionProps: bulkActionProps,
      concurrency: BULK_ACTION_CONCURRENCY,
      step: async (incident: Incident): Promise<void> => {
        if (!incident.id) {
          throw new BadDataException("Incident ID not found");
        }

        await ModelAPI.updateById<Incident>({
          modelType: Incident,
          id: incident.id,
          data: {
            postmortemStatusId: new ObjectID(statusId),
          },
        });
      },
    });

    setBulkActionProps(null);
    data.onDone?.();
  };

  /*
   * Bulk actions reach the table's action bar, which never looks at
   * permissions: moving a postmortem is an update of its incident, gated
   * as one.
   */
  const gate: PermissionGateResult = PermissionGate.check(
    new Incident(),
    ModelAction.Update,
  );

  const bulkAction: BulkActionButtonSchema<Incident> = {
    title: CHANGE_POSTMORTEM_STATUS,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.ClipboardDocumentCheck,
    disabled:
      pickable.length === 0 ||
      (!gate.isAllowed && Boolean(gate.disabledReason)),
    tooltip: gate.isAllowed ? undefined : gate.disabledReason,
    onClick: async (
      actionProps: BulkActionOnClickProps<Incident>,
    ): Promise<void> => {
      setBulkActionProps(actionProps);
      setShowModal(true);
    },
  };

  const modal: ReactElement = showModal ? (
    <BasicFormModal<JSONObject>
      title={CHANGE_POSTMORTEM_STATUS}
      description={CHANGE_POSTMORTEM_STATUS_DESCRIPTION}
      submitButtonText={CHANGE_POSTMORTEM_STATUS}
      onClose={() => {
        setShowModal(false);
        setBulkActionProps(null);
      }}
      onSubmit={async (formData: JSONObject) => {
        const statusId: string = (formData[STATUS_FIELD_KEY] || "").toString();

        if (statusId) {
          await applyStatus(statusId);
        }
      }}
      formProps={{
        initialValues: {},
        fields: [
          {
            field: {
              [STATUS_FIELD_KEY]: true,
            },
            title: POSTMORTEM_STATUS_FIELD_TITLE,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select a status",
            dropdownOptions: pickable.map(
              (choice: PostmortemStatusChoice): DropdownOption => {
                return {
                  label: choice.name,
                  value: choice.id,
                  color: new Color(choice.color),
                };
              },
            ),
          },
        ],
      }}
    />
  ) : (
    <></>
  );

  return { bulkAction, modal };
}

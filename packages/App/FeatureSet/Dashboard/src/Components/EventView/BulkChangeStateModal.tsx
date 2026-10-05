import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { PermissionCheckableModel } from "Common/UI/Utils/PermissionGate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
  getBulkStateChangeNoteFieldKey,
} from "../../Utils/BulkStateChange";
import {
  STATE_CHANGE_NOTIFY_FIELD_KEY,
  getStateChangeFormFields,
} from "./StateChangeFormFields";

export interface BulkChangeStateSubmitData {
  stateId: ObjectID;
  note?: string | undefined;
  shouldStatusPageSubscribersBeNotified?: boolean | undefined;
}

export interface ComponentProps {
  title: string;
  description: string;
  submitButtonText?: string | undefined;
  /** The state timeline column the picked state is submitted under. */
  stateFieldKey: string;
  stateOptions: Array<DropdownOption>;
  noteType: BulkStateChangeNoteType;
  noteTitle: string;
  noteDescription: string;
  noteTemplates: Array<BulkStateChangeNoteTemplate>;
  showNotifyStatusPageSubscribers?: boolean | undefined;
  /*
   * The note the change posts, as an empty model of its kind: someone who
   * may not create it is not offered it (StateChangeFormFields). Left out,
   * it is offered.
   */
  noteModel?: PermissionCheckableModel | undefined;
  onClose: () => void;
  onSubmit: (data: BulkChangeStateSubmitData) => Promise<void>;
}

export const NOTIFY_SUBSCRIBERS_FIELD_KEY: string =
  STATE_CHANGE_NOTIFY_FIELD_KEY;

/*
 * The fields of the bulk dialog, on one page: the state, whether status
 * page subscribers hear about the change (incidents and scheduled
 * maintenance), then the optional note folded under "Add a public note" /
 * "Add a private note" - the same body as the single-event dialogs
 * (StateChangeFormFields). It used to walk two steps, State then Note, once
 * the project had note templates; with the note folded it is three rows.
 */
export const getBulkChangeStateFormFields: (data: {
  stateFieldKey: string;
  stateOptions: Array<DropdownOption>;
  noteType: BulkStateChangeNoteType;
  noteTitle: string;
  noteDescription: string;
  noteTemplates: Array<BulkStateChangeNoteTemplate>;
  showNotifyStatusPageSubscribers?: boolean | undefined;
  noteModel?: PermissionCheckableModel | undefined;
}) => Fields<JSONObject> = (data: {
  stateFieldKey: string;
  stateOptions: Array<DropdownOption>;
  noteType: BulkStateChangeNoteType;
  noteTitle: string;
  noteDescription: string;
  noteTemplates: Array<BulkStateChangeNoteTemplate>;
  showNotifyStatusPageSubscribers?: boolean | undefined;
  noteModel?: PermissionCheckableModel | undefined;
}): Fields<JSONObject> => {
  return [
    {
      field: {
        [data.stateFieldKey]: true,
      } as SelectFormFields<JSONObject>,
      title: "Select State",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: data.stateOptions,
    },
    /*
     * A bulk change does not look at each event's own settings: the box
     * starts on, as it always has here.
     */
    ...getStateChangeFormFields<JSONObject>({
      noteType: data.noteType,
      noteTitle: data.noteTitle,
      noteDescription: data.noteDescription,
      noteTemplates: data.noteTemplates,
      notifySubscribers: data.showNotifyStatusPageSubscribers
        ? { byDefault: true }
        : undefined,
      noteModel: data.noteModel,
    }),
  ];
};

/**
 * The "Change State" modal behind a table's bulk action. It carries the same
 * optional note (and template shortcut) as the single-event change-state modal
 * on the event overview page, so a bulk change is just as traceable as a
 * one-off one.
 */
const BulkChangeStateModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const noteFieldKey: string = getBulkStateChangeNoteFieldKey(props.noteType);

  return (
    <BasicFormModal<JSONObject>
      title={props.title}
      description={props.description}
      onClose={props.onClose}
      submitButtonText={props.submitButtonText || "Change State"}
      onSubmit={async (formData: JSONObject) => {
        const selectedStateId: string = String(
          formData[props.stateFieldKey] || "",
        );

        if (!selectedStateId) {
          return;
        }

        const note: unknown = formData[noteFieldKey];

        await props.onSubmit({
          stateId: new ObjectID(selectedStateId),
          note: typeof note === "string" ? note : undefined,
          ...(props.showNotifyStatusPageSubscribers
            ? {
                shouldStatusPageSubscribersBeNotified: Boolean(
                  formData[NOTIFY_SUBSCRIBERS_FIELD_KEY],
                ),
              }
            : {}),
        });
      }}
      formProps={{
        fields: getBulkChangeStateFormFields({
          stateFieldKey: props.stateFieldKey,
          stateOptions: props.stateOptions,
          noteType: props.noteType,
          noteTitle: props.noteTitle,
          noteDescription: props.noteDescription,
          noteTemplates: props.noteTemplates,
          showNotifyStatusPageSubscribers:
            props.showNotifyStatusPageSubscribers,
          noteModel: props.noteModel,
        }),
      }}
    />
  );
};

export default BulkChangeStateModal;

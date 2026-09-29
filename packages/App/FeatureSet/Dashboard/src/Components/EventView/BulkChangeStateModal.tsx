import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import React, { FunctionComponent, ReactElement } from "react";
import {
  BulkStateChangeNoteTemplate,
  BulkStateChangeNoteType,
  getBulkStateChangeNoteFieldKey,
  getBulkStateChangeNoteTemplateFieldKey,
  getNoteFromTemplate,
} from "../../Utils/BulkStateChange";

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
  onClose: () => void;
  onSubmit: (data: BulkChangeStateSubmitData) => Promise<void>;
}

export const NOTIFY_SUBSCRIBERS_FIELD_KEY: string =
  "shouldStatusPageSubscribersBeNotified";

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
  const noteTemplateFieldKey: string = getBulkStateChangeNoteTemplateFieldKey(
    props.noteType,
  );

  const fields: Fields<JSONObject> = [
    {
      field: {
        [props.stateFieldKey]: true,
      } as SelectFormFields<JSONObject>,
      title: "Select State",
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: props.stateOptions,
    },
  ];

  if (props.noteTemplates.length > 0) {
    const templateField: Field<JSONObject> = {
      field: {
        [noteTemplateFieldKey]: true,
      } as SelectFormFields<JSONObject>,
      onChange: (
        value: string,
        currentValues: FormValues<JSONObject>,
        setNewFormValues: (currentFormValues: FormValues<JSONObject>) => void,
      ) => {
        const note: string = getNoteFromTemplate(props.noteTemplates, value);

        if (note) {
          setNewFormValues({
            ...currentValues,
            [noteFieldKey]: note,
          });
        }
      },
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: props.noteTemplates.map(
        (template: BulkStateChangeNoteTemplate): DropdownOption => {
          return {
            value: template.id,
            label: template.templateName,
          };
        },
      ),
      description:
        "If you have a template for this state change, select it here.",
      title: "Select Note Template",
      required: false,
      overrideFieldKey: noteTemplateFieldKey,
    };

    fields.push(templateField);
  }

  fields.push({
    field: {
      [noteFieldKey]: true,
    } as SelectFormFields<JSONObject>,
    fieldType: FormFieldSchemaType.Markdown,
    description: props.noteDescription,
    title: props.noteTitle,
    required: false,
    overrideFieldKey: noteFieldKey,
  });

  if (props.showNotifyStatusPageSubscribers) {
    fields.push({
      field: {
        [NOTIFY_SUBSCRIBERS_FIELD_KEY]: true,
      } as SelectFormFields<JSONObject>,
      fieldType: FormFieldSchemaType.Checkbox,
      description: "Notify subscribers of this state change.",
      title: "Notify Status Page Subscribers",
      required: false,
      defaultValue: true,
    });
  }

  return (
    <BasicFormModal<JSONObject>
      title={props.title}
      description={props.description}
      modalWidth={ModalWidth.Large}
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
        fields: fields,
      }}
    />
  );
};

export default BulkChangeStateModal;

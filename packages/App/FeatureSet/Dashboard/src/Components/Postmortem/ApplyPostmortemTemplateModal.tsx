import { JSONObject } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, { FunctionComponent, ReactElement } from "react";
import {
  findPostmortemTemplate,
  getPostmortemTemplatePickerInitialValues,
  POSTMORTEM_TEMPLATE_PICKER_FIELD,
  PostmortemTemplateOption,
} from "./PostmortemTemplates";

export interface ComponentProps {
  templates: Array<PostmortemTemplateOption>;
  // Names the dialog in the form analytics.
  name: string;
  onPick: (template: PostmortemTemplateOption) => void;
  onClose: () => void;
}

/*
 * Apply Template's dialog on a Postmortem page: which of the project's
 * templates to start from. Opened only when there is one to pick (the page
 * offers the button only then), and with a single template it is picked
 * already. The pick opens the postmortem's editor on it, where it is read
 * and changed before anything is saved.
 */
const ApplyPostmortemTemplateModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <BasicFormModal<JSONObject>
      title="Apply Postmortem Template"
      name={props.name}
      submitButtonText="Apply Template"
      onClose={props.onClose}
      onSubmit={(data: JSONObject) => {
        const template: PostmortemTemplateOption | null =
          findPostmortemTemplate(
            props.templates,
            data[POSTMORTEM_TEMPLATE_PICKER_FIELD],
          );

        if (template) {
          props.onPick(template);
        }
      }}
      formProps={{
        initialValues: getPostmortemTemplatePickerInitialValues(
          props.templates,
        ),
        fields: [
          {
            field: {
              [POSTMORTEM_TEMPLATE_PICKER_FIELD]: true,
            },
            title: "Select Template",
            description: "Choose a postmortem template to populate the note.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: props.templates.map(
              (template: PostmortemTemplateOption): DropdownOption => {
                return {
                  label: template.name || template.id,
                  value: template.id,
                };
              },
            ),
            required: true,
            placeholder: "Select Template",
          },
        ],
      }}
    />
  );
};

export default ApplyPostmortemTemplateModal;

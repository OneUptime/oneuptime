import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import { PublicFormTemplate } from "../../../Types/Form/FormPublic";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * The template picker over a form's questions: what the public page anyone
 * with the form's link opens draws (Accounts, Pages/Form) when the form has
 * templates, and what the dashboard's preview draws - one component, so the
 * preview is the page.
 *
 * Choosing a template fills the form in with its answers, and clearing the
 * choice starts the form over from nothing; the page does the filling in.
 * The words come from the host, already in the reader's language: the
 * public page and the dashboard translate differently.
 */

export interface ComponentProps {
  templates: Array<PublicFormTemplate>;
  // The template the form was filled in from; null for none.
  selectedTemplateId: string | null;
  label: string;
  description: string;
  // What the picker says while no template is chosen.
  emptyLabel: string;
  onChange: (templateId: string | null) => void;
  dataTestId?: string | undefined;
}

const PublicFormTemplatePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const id: string = useId();

  const options: Array<DropdownOption> = props.templates.map(
    (template: PublicFormTemplate): DropdownOption => {
      return { value: template.id, label: template.name };
    },
  );

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === props.selectedTemplateId;
    },
  );

  return (
    <div
      className="mb-6 border-b border-gray-100 pb-6"
      data-testid={props.dataTestId || "form-template-picker"}
    >
      <label
        id={`${id}-label`}
        className="block text-sm font-medium text-gray-700"
      >
        {props.label}
      </label>
      <p id={`${id}-description`} className="mt-0.5 text-sm text-gray-500">
        {props.description}
      </p>
      <div className="mt-2">
        <Dropdown
          options={options}
          value={selected}
          placeholder={props.emptyLabel}
          ariaLabelledby={`${id}-label`}
          dataTestId={`${props.dataTestId || "form-template-picker"}-input`}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            const templateId: string | null =
              typeof value === "string" && value ? value : null;

            if (templateId !== props.selectedTemplateId) {
              props.onChange(templateId);
            }
          }}
        />
      </div>
    </div>
  );
};

export default PublicFormTemplatePicker;

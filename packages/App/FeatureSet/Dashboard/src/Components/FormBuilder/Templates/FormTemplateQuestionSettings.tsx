import FormsCopy from "../FormsCopy";
import {
  FORM_DEFAULT_CHOICE,
  FormTemplateEditorQuestion,
  FormTemplateSettingChoice,
  getFormTemplateSettingChoices,
  setFormTemplateSetting,
} from "./FormTemplatesState";
import {
  FormTemplateFieldSetting,
  FormTemplateFieldSettings,
  getFormTemplateFieldSetting,
} from "Common/Types/Form/FormTemplate";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * The Questions part of a template's editor: one row per question of the
 * form, saying how the template asks it - Form default, which names the
 * form's own setting ("Form default (Hidden)") and keeps following it when
 * the form changes, or Required, Optional or Hidden for this template only.
 *
 * A question the form's target cannot be created without (a maintenance
 * event's start and end) is always asked, and required: its row says so,
 * and cannot be changed.
 *
 * The rows reach the edges of their frame; on a narrow screen each row's
 * picker drops under its question.
 */

export interface ComponentProps {
  questions: Array<FormTemplateEditorQuestion>;
  // The template's settings, as the editor holds them.
  value: unknown;
  onChange: (settings: FormTemplateFieldSettings) => void;
}

const FormTemplateQuestionSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const id: string = useId();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const settings: FormTemplateFieldSettings | undefined =
    props.value &&
    typeof props.value === "object" &&
    !Array.isArray(props.value)
      ? (props.value as FormTemplateFieldSettings)
      : undefined;

  return (
    <div
      role="group"
      aria-label={tx(FormsCopy.builderTitle)}
      className="divide-y divide-gray-100 rounded-lg border border-gray-200"
      data-testid="form-template-settings"
    >
      {props.questions.map(
        (question: FormTemplateEditorQuestion, index: number): ReactElement => {
          const fieldId: string = question.field.id;
          const labelId: string = `${id}-question-${index}`;

          const chosen: string = question.isLocked
            ? FormTemplateFieldSetting.Required
            : getFormTemplateFieldSetting(
                { fieldSettings: settings },
                fieldId,
              ) || FORM_DEFAULT_CHOICE;

          // English: the dropdown looks each label up itself.
          const options: Array<DropdownOption> = getFormTemplateSettingChoices(
            question,
          ).map((choice: FormTemplateSettingChoice): DropdownOption => {
            return { value: choice.value, label: choice.label };
          });

          return (
            <div
              key={fieldId}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              data-testid={`form-template-setting-row-${fieldId}`}
              data-setting={chosen}
            >
              <div className="min-w-0">
                <p
                  id={labelId}
                  className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
                >
                  {question.field.label.trim() ||
                    tx(FormsCopy.newQuestionLabel)}
                </p>
                {question.isLocked ? (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {tx(FormsCopy.requiredLocked)}
                  </p>
                ) : (
                  <></>
                )}
              </div>
              <div className="w-full shrink-0 sm:w-64">
                <Dropdown
                  className="relative w-full overflow-visible rounded-md"
                  options={options}
                  value={options.find((option: DropdownOption): boolean => {
                    return option.value === chosen;
                  })}
                  isClearable={false}
                  ariaLabelledby={labelId}
                  disabled={question.isLocked}
                  dataTestId={`form-template-setting-${fieldId}`}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ): void => {
                    if (typeof value !== "string" || value === chosen) {
                      return;
                    }

                    props.onChange(
                      setFormTemplateSetting({
                        settings: settings,
                        fieldId: fieldId,
                        choice: value,
                      }),
                    );
                  }}
                />
              </div>
            </div>
          );
        },
      )}
    </div>
  );
};

export default FormTemplateQuestionSettings;

import FormsCopy from "../FormsCopy";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The input a question shows on its card in the builder: a quiet, inert
 * picture of what the submitter will fill in - a line for a short answer, a
 * box for a paragraph, a dropdown with its first options - so the canvas
 * reads like the public form while it is being built. The real inputs are
 * in the preview (FormPreviewModal), drawn by the public page's own builder.
 */

// The icon for each way a question is answered, in the palette and on cards.
export const FORM_ANSWER_TYPE_ICONS: Record<
  CustomFieldType | "Email",
  IconProp
> = {
  [CustomFieldType.Text]: IconProp.Text,
  [CustomFieldType.LongText]: IconProp.ListBullet,
  [CustomFieldType.Markdown]: IconProp.DocumentText,
  [CustomFieldType.Number]: IconProp.Hashtag,
  [CustomFieldType.Dropdown]: IconProp.ChevronDown,
  [CustomFieldType.MultiSelectDropdown]: IconProp.List,
  [CustomFieldType.Boolean]: IconProp.CheckCircle,
  [CustomFieldType.Date]: IconProp.Calendar,
  [CustomFieldType.DateTime]: IconProp.Clock,
  Email: IconProp.Email,
};

export interface ComponentProps {
  answerType: CustomFieldType | "Email";
  // A choice's options, to show the first few of.
  options?: Array<string> | undefined;
}

// The most options a dropdown's picture lists.
const MAX_SHOWN_OPTIONS: number = 3;

const BOX_CLASS_NAME: string =
  "mt-2 flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-400";

const QuestionInputPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  switch (props.answerType) {
    case CustomFieldType.LongText:
      return (
        <div
          className={`${BOX_CLASS_NAME} h-16 items-start py-2`}
          aria-hidden="true"
        >
          {tx(FormsCopy.inputPlaceholderText)}
        </div>
      );

    case CustomFieldType.Markdown:
      return (
        <div
          className={`${BOX_CLASS_NAME} h-16 items-start py-2`}
          aria-hidden="true"
        >
          {tx(FormsCopy.inputPlaceholderRichText)}
        </div>
      );

    case CustomFieldType.Boolean:
      return (
        <div
          className="mt-2 flex items-center gap-2 text-sm text-gray-500"
          aria-hidden="true"
        >
          <span className="inline-block h-4 w-4 rounded border border-gray-300 bg-white" />
          {tx(FormsCopy.inputCheckbox)}
        </div>
      );

    case CustomFieldType.Dropdown:
    case CustomFieldType.MultiSelectDropdown: {
      const options: Array<string> = (props.options || []).filter(
        (option: string): boolean => {
          return option.trim().length > 0;
        },
      );

      return (
        <div aria-hidden="true">
          <div className={`${BOX_CLASS_NAME} h-9`}>
            <span>
              {tx(
                props.answerType === CustomFieldType.Dropdown
                  ? FormsCopy.inputPlaceholderChoose
                  : FormsCopy.inputPlaceholderChooseMany,
              )}
            </span>
            <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
          </div>
          {options.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {options.slice(0, MAX_SHOWN_OPTIONS).map(
                (option: string, index: number): ReactElement => {
                  return (
                    <span
                      key={`${index}-${option}`}
                      className="inline-flex max-w-full items-center truncate rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {option}
                    </span>
                  );
                },
              )}
              {options.length > MAX_SHOWN_OPTIONS ? (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  +{options.length - MAX_SHOWN_OPTIONS}
                </span>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      );
    }

    case CustomFieldType.Date:
    case CustomFieldType.DateTime:
      return (
        <div className={`${BOX_CLASS_NAME} h-9`} aria-hidden="true">
          <span>
            {tx(
              props.answerType === CustomFieldType.Date
                ? FormsCopy.inputPlaceholderDate
                : FormsCopy.inputPlaceholderDateTime,
            )}
          </span>
          <Icon icon={IconProp.Calendar} className="h-4 w-4" />
        </div>
      );

    case CustomFieldType.Number:
      return (
        <div className={`${BOX_CLASS_NAME} h-9`} aria-hidden="true">
          {tx(FormsCopy.inputPlaceholderNumber)}
        </div>
      );

    case "Email":
      return (
        <div className={`${BOX_CLASS_NAME} h-9`} aria-hidden="true">
          {tx(FormsCopy.inputPlaceholderEmail)}
        </div>
      );

    default:
      return (
        <div className={`${BOX_CLASS_NAME} h-9`} aria-hidden="true">
          {tx(FormsCopy.inputPlaceholderText)}
        </div>
      );
  }
};

export default QuestionInputPreview;

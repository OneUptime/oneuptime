import {
  FormFieldIssue,
  findCustomFieldDefinition,
  getFormFieldAnswerType,
  getFormFieldIssues,
  getQuestionOptions,
  isFormFieldLocked,
} from "../FormBuilderState";
import FormsCopy, { FORM_QUESTION_TYPE_TEXT } from "../FormsCopy";
import QuestionInputPreview from "./QuestionInputPreview";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  FORM_CHOICE_QUESTION_TYPES,
  FORM_FIELD_HELP_TEXT_MAX_LENGTH,
  FORM_FIELD_LABEL_MAX_LENGTH,
  FORM_QUESTION_TYPES,
  FORM_SUBMITTER_FIELD_DEFINITIONS,
  FormField,
  FormFieldSource,
} from "Common/Types/Form/FormField";
import {
  FormCustomFieldDefinition,
  FormRecordOption,
} from "Common/Types/Form/FormPublic";
import {
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
} from "Common/Types/Form/FormTargetCatalog";
import FormTargetType, {
  FORM_TARGET_TYPE_TEXT,
} from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import Color from "Common/Types/Color";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import TextArea from "Common/UI/Components/TextArea/TextArea";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useId } from "react";
import { DraggableProvidedDragHandleProps } from "react-beautiful-dnd";

/*
 * One question on the form builder's canvas. Unselected, it reads like the
 * public form: the question, its help text, a picture of its input, and a
 * badge for what it is linked to. Selected, the question's settings open
 * right under it - the label, help text, Required, Hidden, and what its kind
 * needs: a dropdown's options, the records a choice offers, a note on where
 * a linked answer goes. A hidden question carries a Hidden badge: the public
 * form does not ask it, and only templates answer it.
 *
 * Moving a question is the drag handle's job, with Move Up and Move Down
 * beside it for the keyboard (and for anyone who would rather click).
 */

export interface ComponentProps {
  field: FormField;
  index: number;
  count: number;
  targetType: FormTargetType;
  customFields: Array<FormCustomFieldDefinition>;
  recordOptions: Partial<
    Record<FormTargetOptionsSource, Array<FormRecordOption>>
  >;
  isSelected: boolean;
  isReadOnly: boolean;
  dragHandleProps?: DraggableProvidedDragHandleProps | null | undefined;
  onSelect: () => void;
  onDeselect: () => void;
  onChange: (changes: Partial<FormField>) => void;
  onMove: (offset: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const ISSUE_TEXT: Record<FormFieldIssue, string> = {
  [FormFieldIssue.CustomFieldDeleted]: FormsCopy.issueCustomFieldDeleted,
  [FormFieldIssue.NoAllowedOptions]: FormsCopy.issueNoAllowedOptions,
  [FormFieldIssue.NoOptions]: FormsCopy.issueNoOptions,
  [FormFieldIssue.NoLabel]: FormsCopy.issueNoLabel,
};

const ICON_BUTTON_CLASS_NAME: string =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40";

const QuestionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const editorId: string = useId();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const field: FormField = props.field;

  const targetDefinition: FormTargetFieldDefinition | undefined =
    field.source === FormFieldSource.TargetField
      ? getFormTargetField(props.targetType, field.targetField)
      : undefined;

  const customField: FormCustomFieldDefinition | undefined =
    field.source === FormFieldSource.TargetCustomField
      ? findCustomFieldDefinition(props.customFields, field.customFieldId)
      : undefined;

  const answerType: CustomFieldType | "Email" = getFormFieldAnswerType({
    field,
    targetType: props.targetType,
    customFields: props.customFields,
  });

  const isLocked: boolean = isFormFieldLocked({
    field,
    targetType: props.targetType,
  });

  const issues: Array<FormFieldIssue> = getFormFieldIssues({
    field,
    targetType: props.targetType,
    customFields: props.customFields,
  });

  // The options a choice shows on its card.
  const getPreviewOptions: () => Array<string> = (): Array<string> => {
    if (field.source === FormFieldSource.Question) {
      return getQuestionOptions(field);
    }

    if (customField && customField.dropdownOptions) {
      return getQuestionOptions({
        ...field,
        dropdownOptions: customField.dropdownOptions || undefined,
      });
    }

    if (targetDefinition && targetDefinition.optionsSource) {
      const records: Array<FormRecordOption> =
        props.recordOptions[targetDefinition.optionsSource] || [];
      const allowed: Array<string> = field.allowedOptionIds || [];

      return records
        .filter((record: FormRecordOption): boolean => {
          return allowed.length === 0
            ? !targetDefinition.mustChooseOptions
            : allowed.includes(record.id);
        })
        .map((record: FormRecordOption): string => {
          return record.name;
        });
    }

    return [];
  };

  // What the question is linked to, for its badge.
  const getBadge: () => { text: string; icon: IconProp } = (): {
    text: string;
    icon: IconProp;
  } => {
    switch (field.source) {
      case FormFieldSource.TargetField:
        return {
          text: `${tx(FORM_TARGET_TYPE_TEXT[props.targetType].title)} · ${tx(
            targetDefinition?.title || field.targetField || "",
          )}`,
          icon: IconProp.Link,
        };

      case FormFieldSource.TargetCustomField:
        return {
          text: `${tx(FormsCopy.badgeCustomField)} · ${
            customField?.name || tx(FormsCopy.deletedRecord)
          }`,
          icon: IconProp.Link,
        };

      case FormFieldSource.Submitter:
        return {
          text: `${tx(FormsCopy.badgeSubmitter)} · ${tx(
            FORM_SUBMITTER_FIELD_DEFINITIONS[field.submitterField!]?.title ||
              "",
          )}`,
          icon: IconProp.User,
        };

      default:
        return {
          text: tx(
            FORM_QUESTION_TYPE_TEXT[field.type || CustomFieldType.Text]
              ?.title || "",
          ),
          icon: IconProp.ChatBubbleLeft,
        };
    }
  };

  const badge: { text: string; icon: IconProp } = getBadge();

  const renderLinkNote: () => ReactElement = (): ReactElement => {
    let note: string = FormsCopy.questionNote;

    if (field.source === FormFieldSource.TargetField) {
      note = FormsCopy.linkedTargetFieldNote;
    } else if (field.source === FormFieldSource.TargetCustomField) {
      note = FormsCopy.linkedCustomFieldNote;
    } else if (field.source === FormFieldSource.Submitter) {
      note = FormsCopy.submitterNote;
    }

    return (
      <p
        className="flex items-start gap-1.5 text-xs text-gray-500"
        data-testid="form-question-link-note"
      >
        <Icon icon={IconProp.Info} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{tx(note)}</span>
      </p>
    );
  };

  const renderChoicesOffered: () => ReactElement = (): ReactElement => {
    if (!targetDefinition || !targetDefinition.optionsSource) {
      return <></>;
    }

    const records: Array<FormRecordOption> | undefined =
      props.recordOptions[targetDefinition.optionsSource];

    const label: string = tx(FormsCopy.choicesOffered);
    const hint: string = tx(
      targetDefinition.mustChooseOptions
        ? FormsCopy.choicesOfferedMustChoose
        : FormsCopy.choicesOfferedSeverity,
    );

    if (!records) {
      return <ComponentLoader />;
    }

    const options: Array<DropdownOption> = records.map(
      (record: FormRecordOption): DropdownOption => {
        const option: DropdownOption = {
          value: record.id,
          label: record.name,
        };

        if (record.color) {
          try {
            option.color = new Color(record.color);
          } catch {
            // A color that cannot be drawn is not drawn.
          }
        }

        return option;
      },
    );

    const allowed: Array<string> = field.allowedOptionIds || [];

    return (
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          id={`${editorId}-choices`}
        >
          {label}
        </label>
        <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
        <div className="mt-1.5">
          <Dropdown
            isMultiSelect={true}
            options={options}
            ariaLabelledby={`${editorId}-choices`}
            placeholder={tx(FormsCopy.choicesOfferedPlaceholder)}
            dataTestId={`form-question-choices-${field.id}`}
            value={options.filter((option: DropdownOption): boolean => {
              return allowed.includes(option.value.toString());
            })}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              const ids: Array<string> = (
                Array.isArray(value) ? value : value ? [value] : []
              ).map((entry: DropdownValue): string => {
                return entry.toString().toLowerCase();
              });

              props.onChange({ allowedOptionIds: ids });
            }}
          />
        </div>
      </div>
    );
  };

  const renderEditor: () => ReactElement = (): ReactElement => {
    return (
      <div
        className="mt-4 space-y-4 border-t border-gray-100 pt-4"
        id={`${editorId}-editor`}
        data-testid={`form-question-editor-${field.id}`}
      >
        <div>
          <label
            className="block text-sm font-medium text-gray-700"
            htmlFor={`${editorId}-label`}
          >
            {tx(FormsCopy.questionLabel)}
          </label>
          <Input
            id={`${editorId}-label`}
            value={field.label}
            placeholder={tx(FormsCopy.questionLabelPlaceholder)}
            dataTestId={`form-question-label-${field.id}`}
            onChange={(value: string) => {
              props.onChange({
                label: value.slice(0, FORM_FIELD_LABEL_MAX_LENGTH),
              });
            }}
          />
        </div>

        <div>
          <label
            className="block text-sm font-medium text-gray-700"
            htmlFor={`${editorId}-help`}
          >
            {tx(FormsCopy.helpText)}
          </label>
          <TextArea
            id={`${editorId}-help`}
            rows={2}
            autoGrow={true}
            maxRows={6}
            value={field.helpText || ""}
            placeholder={tx(FormsCopy.helpTextPlaceholder)}
            dataTestId={`form-question-help-${field.id}`}
            onChange={(value: string) => {
              props.onChange({
                helpText: value.slice(0, FORM_FIELD_HELP_TEXT_MAX_LENGTH),
              });
            }}
          />
        </div>

        {field.source === FormFieldSource.Question ? (
          <div>
            <label
              className="block text-sm font-medium text-gray-700"
              id={`${editorId}-type`}
            >
              {tx(FormsCopy.answerType)}
            </label>
            <div className="mt-1.5">
              <Dropdown
                isClearable={false}
                ariaLabelledby={`${editorId}-type`}
                dataTestId={`form-question-type-${field.id}`}
                options={FORM_QUESTION_TYPES.map(
                  (type: CustomFieldType): DropdownOption => {
                    return {
                      value: type,
                      label: tx(FORM_QUESTION_TYPE_TEXT[type].title),
                    };
                  },
                )}
                value={
                  field.type
                    ? {
                        value: field.type,
                        label: tx(FORM_QUESTION_TYPE_TEXT[field.type].title),
                      }
                    : undefined
                }
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  if (typeof value === "string") {
                    props.onChange({ type: value as CustomFieldType });
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}

        {field.source === FormFieldSource.Question &&
        field.type &&
        FORM_CHOICE_QUESTION_TYPES.includes(field.type) ? (
          <div>
            <p className="block text-sm font-medium text-gray-700">
              {tx(FormsCopy.options)}
            </p>
            <div
              className="mt-1.5"
              data-testid={`form-question-options-${field.id}`}
            >
              {/*
               * The custom fields' own options editor, so a question's
               * options work like a dropdown custom field's - colors too.
               * Keyed by the question: it keeps its rows itself.
               */}
              <DropdownOptionsInput
                key={field.id}
                initialValue={field.dropdownOptions}
                onChange={(value: string) => {
                  props.onChange({ dropdownOptions: value });
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}

        {renderChoicesOffered()}

        <Toggle
          title={FormsCopy.required}
          description={
            isLocked
              ? FormsCopy.requiredLocked
              : field.isHidden
                ? FormsCopy.requiredHidden
                : FormsCopy.requiredDescription
          }
          value={isLocked ? true : field.isRequired && !field.isHidden}
          disabled={isLocked || field.isHidden === true}
          dataTestId={`form-question-required-${field.id}`}
          onChange={(value: boolean) => {
            props.onChange({ isRequired: value });
          }}
        />

        <Toggle
          title="Hidden"
          description={
            isLocked ? FormsCopy.requiredLocked : FormsCopy.hiddenDescription
          }
          value={!isLocked && field.isHidden === true}
          disabled={isLocked}
          dataTestId={`form-question-hidden-${field.id}`}
          onChange={(value: boolean) => {
            props.onChange({ isHidden: value });
          }}
        />

        {renderLinkNote()}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {field.source === FormFieldSource.Question ? (
              <Button
                title={FormsCopy.duplicate}
                icon={IconProp.DocumentDuplicate}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                className="!ml-0"
                dataTestId={`form-question-duplicate-${field.id}`}
                onClick={props.onDuplicate}
              />
            ) : (
              <></>
            )}
            <Button
              title={FormsCopy.deleteQuestion}
              icon={IconProp.Trash}
              buttonStyle={ButtonStyleType.DANGER_OUTLINE}
              buttonSize={ButtonSize.Small}
              className="!ml-0"
              disabled={isLocked}
              tooltip={isLocked ? FormsCopy.requiredLocked : undefined}
              dataTestId={`form-question-delete-${field.id}`}
              onClick={props.onDelete}
            />
          </div>
          <Button
            title={FormsCopy.done}
            icon={IconProp.Check}
            buttonStyle={ButtonStyleType.PRIMARY}
            buttonSize={ButtonSize.Small}
            dataTestId={`form-question-done-${field.id}`}
            onClick={props.onDeselect}
          />
        </div>
      </div>
    );
  };

  const label: string = field.label.trim() || tx(FormsCopy.newQuestionLabel);

  return (
    <div
      className={`group relative rounded-lg border bg-white p-4 transition-shadow ${
        props.isSelected
          ? "border-indigo-500 shadow-sm ring-2 ring-indigo-100"
          : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
      }`}
      data-testid={`form-question-${field.id}`}
      data-selected={props.isSelected ? "true" : "false"}
    >
      <div className="flex items-start gap-2">
        {props.isReadOnly ? (
          <></>
        ) : (
          <div
            {...(props.dragHandleProps || {})}
            className="-ml-1 mt-0.5 flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-gray-300 hover:text-gray-500 active:cursor-grabbing"
            aria-label={tx(FormsCopy.dragToReorder)}
            title={tx(FormsCopy.dragToReorder)}
            data-testid={`form-question-drag-${field.id}`}
          >
            <Icon icon={IconProp.GripVertical} className="h-4 w-4" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="block w-full rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-expanded={props.isSelected}
            aria-controls={props.isSelected ? `${editorId}-editor` : undefined}
            disabled={props.isReadOnly}
            data-testid={`form-question-select-${field.id}`}
            onClick={() => {
              if (props.isSelected) {
                props.onDeselect();
              } else {
                props.onSelect();
              }
            }}
          >
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`text-sm font-medium [overflow-wrap:anywhere] ${
                  field.label.trim() ? "text-gray-900" : "italic text-gray-400"
                }`}
              >
                {label}
                {field.isRequired || isLocked ? (
                  <span className="ml-0.5 text-red-500" aria-hidden="true">
                    *
                  </span>
                ) : (
                  <></>
                )}
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
                data-testid={`form-question-badge-${field.id}`}
              >
                {badge.text}
              </span>
              {field.isHidden ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
                  data-testid={`form-question-hidden-badge-${field.id}`}
                >
                  <Icon icon={IconProp.EyeSlash} className="h-3 w-3" />
                  {tx("Hidden")}
                </span>
              ) : (
                <></>
              )}
            </span>
            {field.helpText ? (
              <span className="mt-0.5 block text-xs text-gray-500 [overflow-wrap:anywhere]">
                {field.helpText}
              </span>
            ) : (
              <></>
            )}
          </button>

          <QuestionInputPreview
            answerType={answerType}
            options={getPreviewOptions()}
          />

          {customField?.isCopiedFromMonitor ? (
            <p
              className="mt-2 flex items-start gap-1.5 text-xs text-gray-500"
              data-testid={`form-question-copied-from-monitor-${field.id}`}
            >
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>{tx(FormsCopy.copiedFromMonitor)}</span>
            </p>
          ) : (
            <></>
          )}

          {issues.length > 0 ? (
            <ul className="mt-2 space-y-1" data-testid="form-question-issues">
              {issues.map((issue: FormFieldIssue): ReactElement => {
                return (
                  <li
                    key={issue}
                    className="flex items-start gap-1.5 text-xs font-medium text-amber-700"
                  >
                    <Icon
                      icon={IconProp.Alert}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <span>{tx(ISSUE_TEXT[issue])}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <></>
          )}
        </div>

        {props.isReadOnly ? (
          <></>
        ) : (
          <div
            className={`flex shrink-0 items-center ${
              props.isSelected
                ? "opacity-100"
                : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            }`}
          >
            <button
              type="button"
              className={ICON_BUTTON_CLASS_NAME}
              aria-label={`${tx(FormsCopy.moveUp)}: ${label}`}
              title={tx(FormsCopy.moveUp)}
              disabled={props.index === 0}
              data-testid={`form-question-move-up-${field.id}`}
              onClick={() => {
                props.onMove(-1);
              }}
            >
              <Icon icon={IconProp.ChevronUp} className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={ICON_BUTTON_CLASS_NAME}
              aria-label={`${tx(FormsCopy.moveDown)}: ${label}`}
              title={tx(FormsCopy.moveDown)}
              disabled={props.index === props.count - 1}
              data-testid={`form-question-move-down-${field.id}`}
              onClick={() => {
                props.onMove(1);
              }}
            >
              <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {props.isSelected && !props.isReadOnly ? renderEditor() : <></>}
    </div>
  );
};

export default QuestionCard;

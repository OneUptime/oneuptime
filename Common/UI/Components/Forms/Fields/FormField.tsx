import Dictionary from "../../../../Types/Dictionary";
import { GetReactElementFunction } from "../../../Types/FunctionTypes";
import CardSelect from "../../CardSelect/CardSelect";
import CategoryCheckbox from "../../CategoryCheckbox/Index";
import CheckboxElement, {
  CategoryCheckboxValue,
} from "../../Checkbox/Checkbox";
import CodeEditor from "../../CodeEditor/CodeEditor";
import DictionaryForm, { ValueType } from "../../Dictionary/Dictionary";
import Dropdown, { DropdownValue } from "../../Dropdown/Dropdown";
import FilePicker from "../../FilePicker/FilePicker";
import Input, { InputType } from "../../Input/Input";
import TimePicker from "../../TimePicker/Index";
import Link from "../../Link/Link";
import Modal from "../../Modal/Modal";
import IDGenerator from "../../ObjectID/IDGenerator";
import RadioButtons from "../../RadioButtons/GroupRadioButtons";
import TextArea from "../../TextArea/TextArea";
import Toggle from "../../Toggle/Toggle";
import ColorPicker from "../Fields/ColorPicker";
import FieldLabelElement from "../Fields/FieldLabel";
import Field, { FormFieldStyleType } from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";
import FormValues from "../Types/FormValues";
import FileModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import CodeType from "../../../../Types/Code/CodeType";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import MimeType from "../../../../Types/File/MimeType";
import GenericObject from "../../../../Types/GenericObject";
import { JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Typeof from "../../../../Types/Typeof";
import React, { ReactElement, useEffect } from "react";
import Radio, { RadioValue } from "../../Radio/Radio";
import { BasicRadioButtonOption } from "../../RadioButtons/BasicRadioButtons";
import HorizontalRule from "../../HorizontalRule/HorizontalRule";
import MarkdownEditor from "../../Markdown.tsx/MarkdownEditor";

export interface ComponentProps<T extends GenericObject> {
  field: Field<T>;
  fieldName: string;
  index: number;
  isDisabled: boolean;
  error: string;
  touched: boolean;
  currentValues: FormValues<T>;
  setFieldTouched: (fieldName: string, value: boolean) => void;
  setFieldValue: (fieldName: string, value: JSONValue) => void;
  disableAutofocus?: boolean;
  submitForm?: (() => void) | undefined;
  setFormValues?: ((values: FormValues<T>) => void) | undefined;
}

const FormField: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  type onChangeFunction = (value: JSONValue) => void;

  const onChange: onChangeFunction = (value: JSONValue): void => {
    if (props.field.onChange) {
      props.field.onChange(
        value,
        props.currentValues,
        (newFormValues: FormValues<T>) => {
          props.setFormValues?.(newFormValues);
        },
      );
    }
  };

  type GetFieldTypeFunction = (fieldType: FormFieldSchemaType) => string;

  const getFieldType: GetFieldTypeFunction = (
    fieldType: FormFieldSchemaType,
  ): string => {
    switch (fieldType) {
      case FormFieldSchemaType.Email:
        return "email";
      case FormFieldSchemaType.Password:
        return "password";
      case FormFieldSchemaType.EncryptedText:
        return "password";
      case FormFieldSchemaType.Number:
        return "number";
      case FormFieldSchemaType.Date:
        return "date";
      case FormFieldSchemaType.DateTime:
        return "datetime-local";
      case FormFieldSchemaType.Time:
        return "time";
      case FormFieldSchemaType.LongText:
        return "textarea";
      case FormFieldSchemaType.Color:
        return "color";
      case FormFieldSchemaType.URL:
        return "url";
      case FormFieldSchemaType.PositiveNumber:
        return "number";
      default:
        return "text";
    }
  };

  const getFormField: GetReactElementFunction = (): ReactElement => {
    const [
      showMultiSelectCheckboxCategoryModal,
      setShowMultiSelectCheckboxCategoryModal,
    ] = React.useState<boolean>(false);
    const [checkboxCategoryValues, setCheckboxCategoryValues] = React.useState<
      Array<CategoryCheckboxValue>
    >(
      props.currentValues && (props.currentValues as any)[props.fieldName]
        ? (props.currentValues as any)[props.fieldName]
        : [],
    );

    useEffect(() => {
      setCheckboxCategoryValues(
        props.currentValues && (props.currentValues as any)[props.fieldName]
          ? (props.currentValues as any)[props.fieldName]
          : [],
      );
    }, [props.currentValues]);

    const getMultiSelectCheckboxCategoryModal: GetReactElementFunction =
      (): ReactElement => {
        return (
          <Modal
            title={`${props.field.title}`}
            description={`${props.field.description}`}
            onSubmit={() => {
              setShowMultiSelectCheckboxCategoryModal(false);

              onChange(checkboxCategoryValues);
              props.setFieldValue(props.fieldName, checkboxCategoryValues);
            }}
            onClose={() => {
              setShowMultiSelectCheckboxCategoryModal(false);
            }}
          >
            <div className="max-h-96 overflow-y-auto">
              <CategoryCheckbox
                categories={
                  props.field.selectByAccessControlProps?.categoryCheckboxProps
                    .categories || []
                }
                options={
                  props.field.selectByAccessControlProps?.categoryCheckboxProps
                    .options || []
                }
                onChange={(value: Array<CategoryCheckboxValue>) => {
                  setCheckboxCategoryValues(value);
                }}
                initialValue={checkboxCategoryValues}
              />
            </div>
          </Modal>
        );
      };

    const index: number = props.index + 1;

    const fieldType: string = props.field.fieldType
      ? getFieldType(props.field.fieldType)
      : "text";

    const isFileField: boolean =
      props.field.fieldType === FormFieldSchemaType.File ||
      props.field.fieldType === FormFieldSchemaType.ImageFile ||
      props.field.fieldType === FormFieldSchemaType.MultipleFiles;

    const isMultiFileField: boolean =
      props.field.fieldType === FormFieldSchemaType.MultipleFiles;

    if (Object.keys(props.field.field || {}).length === 0) {
      throw new BadDataException("Object cannot be without Field");
    }

    if (props.field.showIf && !props.field.showIf(props.currentValues)) {
      return <></>;
    }

    let required: boolean = false;

    if (
      props.field.required &&
      typeof props.field.required === Typeof.Boolean
    ) {
      required = true;
    } else if (
      props.field.required &&
      typeof props.field.required === "function" &&
      props.field.required(props.currentValues)
    ) {
      required = true;
    }

    let codeType: CodeType = CodeType.HTML;

    if (props.field.fieldType === FormFieldSchemaType.CSS) {
      codeType = CodeType.CSS;
    }

    if (props.field.fieldType === FormFieldSchemaType.JavaScript) {
      codeType = CodeType.JavaScript;
    }

    let fieldDescription: string | ReactElement | undefined =
      props.field.description;

    if (
      props.field.fieldType === FormFieldSchemaType.DateTime ||
      props.field.fieldType === FormFieldSchemaType.Time
    ) {
      if (!fieldDescription) {
        fieldDescription = "";
      }

      fieldDescription +=
        " This is in your local timezone - " +
        OneUptimeDate.getCurrentTimezoneString();
    }

    type GetFieldDescriptionFunction = () => ReactElement | string;

    const getFieldDescription: GetFieldDescriptionFunction = ():
      | ReactElement
      | string => {
      if (
        props.field.fieldType === FormFieldSchemaType.MultiSelectDropdown &&
        props.field.selectByAccessControlProps
      ) {
        return (
          <span>
            {fieldDescription}
            <Link
              onClick={() => {
                setShowMultiSelectCheckboxCategoryModal(true);
              }}
              className="ml-1 underline text-blue-500 cursor-pointer"
            >
              <span>
                Select items by{" "}
                {props.field.selectByAccessControlProps
                  .accessControlColumnTitle || ""}
              </span>
            </Link>
          </span>
        );
      }

      if (fieldDescription) {
        return fieldDescription;
      }

      return <></>;
    };

    let booleanValue: boolean = false;

    //toggle
    if (props.field.fieldType === FormFieldSchemaType.Toggle) {
      booleanValue =
        (props.currentValues &&
        ((props.currentValues as any)[props.fieldName] === true ||
          (props.currentValues as any)[props.fieldName] === false)
          ? (props.currentValues as any)[props.fieldName]
          : (props.field.defaultValue as boolean)) || false;
    }

    return (
      <div className="sm:col-span-4 mt-0 mb-2" key={props.fieldName}>
        {/*** Do not display label on checkbox because checkbox can display its own label */}

        {props.field.showHorizontalRuleAbove && <HorizontalRule />}

        {props.field.fieldType !== FormFieldSchemaType.Checkbox && (
          <FieldLabelElement
            title={props.field.title || ""}
            description={getFieldDescription()}
            sideLink={props.field.sideLink}
            required={required}
            hideOptionalLabel={props.field.hideOptionalLabel}
            isHeading={props.field.styleType === FormFieldStyleType.Heading}
          />
        )}

        <div className="mt-2">
          {/* Time Picker */}
          {props.field.fieldType === FormFieldSchemaType.Time && (
            <TimePicker
              autoFocus={!props.disableAutofocus && index === 1}
              tabIndex={index}
              disabled={props.isDisabled || props.field.disabled}
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              onChange={async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              value={
                (props.currentValues &&
                  (props.currentValues as any)[props.fieldName]) ||
                (props.field.defaultValue as any) ||
                undefined
              }
              placeholder={props.field.placeholder || undefined}
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.Color && (
            <ColorPicker
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              onChange={async (value: Color | null) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
                props.setFieldTouched(props.fieldName, true);
              }}
              tabIndex={index}
              placeholder={props.field.placeholder || ""}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
            />
          )}

          {(props.field.fieldType === FormFieldSchemaType.Dropdown ||
            props.field.fieldType ===
              FormFieldSchemaType.MultiSelectDropdown) && (
            <Dropdown
              error={props.touched && props.error ? props.error : undefined}
              id={props.field.id}
              tabIndex={index}
              dataTestId={props.field.dataTestId}
              onChange={async (
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              isMultiSelect={
                props.field.fieldType ===
                FormFieldSchemaType.MultiSelectDropdown
              }
              options={props.field.dropdownOptions || []}
              placeholder={props.field.placeholder || ""}
              value={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.CardSelect && (
            <CardSelect
              error={props.touched && props.error ? props.error : undefined}
              tabIndex={index}
              dataTestId={props.field.dataTestId}
              onChange={(value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              options={props.field.cardSelectOptions || []}
              value={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.ObjectID && (
            <IDGenerator
              tabIndex={index}
              dataTestId={props.field.dataTestId}
              disabled={props.isDisabled || props.field.disabled}
              error={props.touched && props.error ? props.error : undefined}
              onChange={(value: ObjectID) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onEnterPress={() => {
                props.submitForm?.();
              }}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : props.field.defaultValue || null
              }
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.Dictionary && (
            <DictionaryForm
              keys={props.field.jsonKeysForDictionary}
              addButtonSuffix={props.field.title}
              keyPlaceholder={"Key"}
              valuePlaceholder={"Value"}
              valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : props.field.defaultValue || {}
              }
              onChange={(value: Dictionary<string | number | boolean>) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
            />
          )}

          {props.field.fieldType ===
            FormFieldSchemaType.OptionChooserButton && (
            <RadioButtons
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              onChange={async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              options={props.field.radioButtonOptions || []}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.RadioButton && (
            <Radio
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              onChange={async (value: RadioValue | null) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              options={
                props.field.radioButtonOptions?.map(
                  (option: BasicRadioButtonOption) => {
                    return {
                      label: option.title,
                      value: option.value,
                    };
                  },
                ) || []
              }
              value={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.LongText && (
            <TextArea
              autoFocus={!props.disableAutofocus && index === 1}
              error={props.touched && props.error ? props.error : undefined}
              tabIndex={index}
              dataTestId={props.field.dataTestId}
              disableSpellCheck={props.field.disableSpellCheck}
              onChange={async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
              placeholder={props.field.placeholder || ""}
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.JSON && (
            <CodeEditor
              error={props.touched && props.error ? props.error : undefined}
              type={CodeType.JSON}
              tabIndex={index}
              dataTestId={props.field.dataTestId}
              onChange={async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
              value={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
              placeholder={props.field.placeholder || ""}
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.Markdown && (
            <MarkdownEditor
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              tabIndex={index}
              disableSpellCheck={props.field.disableSpellCheck}
              onChange={async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
              placeholder={props.field.placeholder || ""}
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.CustomComponent &&
            props.field.getCustomElement &&
            props.field.getCustomElement(props.currentValues, {
              error: props.touched && props.error ? props.error : undefined,
              tabIndex: index,
              onChange: async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              },
              onBlur: async () => {
                props.setFieldTouched(props.fieldName, true);
              },

              initialValue:
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : "",

              placeholder: props.field.placeholder || "",
            })}

          {(props.field.fieldType === FormFieldSchemaType.HTML ||
            props.field.fieldType === FormFieldSchemaType.CSS ||
            props.field.fieldType === FormFieldSchemaType.JavaScript) && (
            <CodeEditor
              error={props.touched && props.error ? props.error : undefined}
              tabIndex={index}
              onChange={async (value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              dataTestId={props.field.dataTestId}
              type={codeType}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : ""
              }
              placeholder={props.field.placeholder || ""}
            />
          )}

          {isFileField && (
            <FilePicker
              error={props.touched && props.error ? props.error : undefined}
              tabIndex={index}
              onChange={async (files: Array<FileModel>) => {
                const strippedFiles: Array<FileModel> = files.map(
                  (i: FileModel) => {
                    const strippedModel: FileModel = new FileModel();
                    strippedModel._id = i._id!;
                    if (i.name) {
                      strippedModel.name = i.name;
                    }
                    if (i.fileType) {
                      strippedModel.fileType = i.fileType;
                    }
                    return strippedModel;
                  },
                );

                let fileResult: FileModel | Array<FileModel> | null =
                  strippedFiles;

                if (!isMultiFileField) {
                  if (strippedFiles.length > 0) {
                    fileResult = strippedFiles[0] as FileModel;
                  } else {
                    fileResult = null;
                  }
                }

                onChange(fileResult as any);
                props.setFieldValue(props.fieldName, fileResult);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              mimeTypes={
                props.field.fileTypes
                  ? props.field.fileTypes
                  : props.field.fieldType === FormFieldSchemaType.ImageFile
                    ? [MimeType.png, MimeType.jpeg, MimeType.jpg, MimeType.svg]
                    : []
              }
              isMultiFilePicker={isMultiFileField}
              dataTestId={props.field.dataTestId}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : isMultiFileField
                    ? []
                    : undefined
              }
              placeholder={props.field.placeholder || ""}
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.Toggle && (
            <Toggle
              error={props.touched && props.error ? props.error : undefined}
              onChange={async (value: boolean) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              dataTestId={props.field.dataTestId}
              value={booleanValue}
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.Checkbox && (
            <CheckboxElement
              error={props.touched && props.error ? props.error : undefined}
              title={props.field.title || ""}
              description={props.field.description || ""}
              onChange={async (value: boolean) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              dataTestId={props.field.dataTestId}
              onBlur={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              onFocus={async () => {
                props.setFieldTouched(props.fieldName, true);
              }}
              initialValue={
                props.currentValues &&
                ((props.currentValues as any)[props.fieldName] === true ||
                  (props.currentValues as any)[props.fieldName] === false)
                  ? (props.currentValues as any)[props.fieldName]
                  : (props.field.defaultValue as boolean) || false
              }
            />
          )}

          {props.field.fieldType === FormFieldSchemaType.CategoryCheckbox && (
            <CategoryCheckbox
              categories={props.field.categoryCheckboxProps?.categories || []}
              options={props.field.categoryCheckboxProps?.options || []}
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              onChange={async (value: Array<CategoryCheckboxValue>) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : []
              }
            />
          )}

          {/* Default Field */}
          {(props.field.fieldType === FormFieldSchemaType.Name ||
            props.field.fieldType === FormFieldSchemaType.Email ||
            props.field.fieldType === FormFieldSchemaType.Hostname ||
            props.field.fieldType === FormFieldSchemaType.URL ||
            props.field.fieldType === FormFieldSchemaType.Route ||
            props.field.fieldType === FormFieldSchemaType.Text ||
            props.field.fieldType === FormFieldSchemaType.Number ||
            props.field.fieldType === FormFieldSchemaType.Password ||
            props.field.fieldType === FormFieldSchemaType.EncryptedText ||
            props.field.fieldType === FormFieldSchemaType.Date ||
            props.field.fieldType === FormFieldSchemaType.DateTime ||
            props.field.fieldType === FormFieldSchemaType.Port ||
            props.field.fieldType === FormFieldSchemaType.Phone ||
            props.field.fieldType === FormFieldSchemaType.Domain ||
            props.field.fieldType === FormFieldSchemaType.PositiveNumber) && (
            <Input
              autoFocus={!props.disableAutofocus && index === 1}
              tabIndex={index}
              disabled={props.isDisabled || props.field.disabled}
              error={props.touched && props.error ? props.error : undefined}
              dataTestId={props.field.dataTestId}
              type={fieldType as InputType}
              onChange={(value: string) => {
                onChange(value);
                props.setFieldValue(props.fieldName, value);
              }}
              onEnterPress={() => {
                props.submitForm?.();
              }}
              onBlur={() => {
                props.setFieldTouched(props.fieldName, true);
              }}
              initialValue={
                props.currentValues &&
                (props.currentValues as any)[props.fieldName]
                  ? (props.currentValues as any)[props.fieldName]
                  : props.field.defaultValue || ""
              }
              placeholder={props.field.placeholder || ""}
            />
          )}
        </div>

        {showMultiSelectCheckboxCategoryModal &&
          getMultiSelectCheckboxCategoryModal()}

        {props.field.showHorizontalRuleBelow && <HorizontalRule />}
      </div>
    );
  };

  return <>{getFormField()}</>;
};

export default FormField;

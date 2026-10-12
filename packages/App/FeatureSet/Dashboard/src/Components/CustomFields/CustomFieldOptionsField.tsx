import { fetchCustomFieldOptionUsage } from "./CustomFieldOptionUsage";
import {
  CustomFieldFormCopy,
  getCustomFieldRecordName,
} from "./CustomFieldSettingsCopy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CustomFieldOptionRename,
  CustomFieldOptionUsage,
  CustomFieldRecordName,
  RENAMED_DROPDOWN_OPTIONS_KEY,
} from "Common/Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import {
  getDropdownOptionText,
  getDuplicateDropdownOptionTexts,
} from "Common/UI/Components/CustomFields/DropdownOptionsEditState";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import { parseCustomFieldDropdownOptions } from "Common/Types/CustomField/CustomFieldDropdownOption";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The "Dropdown Options" field of every custom field settings form - the
 * eight resources' pages (CustomFieldsPageBase) and the team members' page -
 * on Create and on Edit (#4564).
 *
 * Editing a saved field, it opens the option editor with how many records
 * hold each value, and sends the renames the edit makes with the save
 * (RENAMED_DROPDOWN_OPTIONS_KEY in the request's misc data), so the server
 * moves the records' values with their options. Creating one, it is the plain
 * list: no record holds a value yet.
 *
 * Two things the Edit form cannot tell on its own, so the table's Edit
 * button tells it (onBeforeEdit):
 *
 *   - the field's type. Nobody may change a type once a field exists, so
 *     the form neither shows nor reads it, and could not otherwise know the
 *     field is a dropdown - the options used to be missing from the Edit
 *     form for that reason alone;
 *   - that a new edit has begun, so renames from an earlier one are not sent
 *     with this one.
 */

export const CUSTOM_FIELD_DUPLICATE_OPTION_MESSAGE: string =
  'Each option needs its own name: "{{option}}" is listed more than once.';

type IsDropdownTypeFunction = (value: unknown) => boolean;

export const isDropdownCustomFieldType: IsDropdownTypeFunction = (
  value: unknown,
): boolean => {
  return (
    value === CustomFieldType.Dropdown ||
    value === CustomFieldType.MultiSelectDropdown
  );
};

type GetDuplicateOptionProblemFunction = (value: unknown) => string | null;

/**
 * The form's error for an option list that names one option twice - which
 * one is meant would be anyone's guess, for the records that hold it most of
 * all - or null.
 */
export const getDuplicateOptionProblem: GetDuplicateOptionProblemFunction = (
  value: unknown,
): string | null => {
  const duplicates: Set<string> = getDuplicateDropdownOptionTexts(
    parseCustomFieldDropdownOptions(value).map(
      (option: { value: string }): { value: string } => {
        return { value: getDropdownOptionText(option) };
      },
    ),
  );

  const first: string | undefined = duplicates.values().next().value;

  return first === undefined
    ? null
    : translateValidationMessage(CUSTOM_FIELD_DUPLICATE_OPTION_MESSAGE, {
        option: first,
      });
};

export interface CustomFieldOptionsEditorProps {
  // The custom field definition model: IncidentCustomField, ...
  modelType: { new (): BaseModel };
  fieldId: ObjectID;
  recordName?: CustomFieldRecordName | undefined;
  initialValue: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
  onRenamesChange: (renames: Array<CustomFieldOptionRename>) => void;
}

/*
 * The option editor of a saved field, with the counts. The counts are extra:
 * while they load, or if they cannot be read, the options can still be
 * edited - renames are still sent, the editor only says less about them.
 */
export const CustomFieldOptionsEditor: FunctionComponent<
  CustomFieldOptionsEditorProps
> = (props: CustomFieldOptionsEditorProps): ReactElement => {
  const [usage, setUsage] = useState<CustomFieldOptionUsage | null>(null);

  useEffect(() => {
    let isCancelled: boolean = false;

    fetchCustomFieldOptionUsage({
      modelType: props.modelType,
      fieldId: props.fieldId,
    })
      .then((answer: CustomFieldOptionUsage) => {
        if (!isCancelled) {
          setUsage(answer);
        }
      })
      .catch(() => {
        // Without counts the editor still edits; it says less.
      });

    return () => {
      isCancelled = true;
    };
  }, [props.fieldId.toString()]);

  return (
    <DropdownOptionsInput
      initialValue={props.initialValue}
      error={props.error}
      usage={usage}
      recordName={props.recordName}
      onChange={props.onChange}
      onBlur={props.onBlur}
      onRenamesChange={props.onRenamesChange}
    />
  );
};

/*
 * What the Dropdown Options field is built from
 * (getCustomFieldOptionsFormField).
 */
export interface CustomFieldOptionsFormFieldInput<TModel extends BaseModel> {
  // The custom field definition model: IncidentCustomField, ...
  modelType: { new (): TModel };
  // The field's type: what the form holds, or, on Edit, what the row said.
  getFieldType: (values: FormValues<TModel>) => unknown;
  // The renames the open edit has made so far.
  onRenamesChange: (renames: Array<CustomFieldOptionRename>) => void;
}

export interface CustomFieldOptionsFormField<TModel extends BaseModel> {
  /*
   * What the page builds its Dropdown Options field from, for Create and
   * Edit: getCustomFieldOptionsFormField(formFieldInput), written in the
   * page's own field list, where the form guards read it.
   */
  formFieldInput: CustomFieldOptionsFormFieldInput<TModel>;
  // The table's Edit button: what the form cannot read for itself.
  onBeforeEdit: (item: TModel) => Promise<TModel>;
  // The Edit form's save: the renames go with it.
  onBeforeUpdate: (
    item: TModel,
    miscDataProps: JSONObject,
    formValues: JSONObject,
  ) => Promise<TModel>;
}

type ReadIdFunction = (values: unknown) => string | undefined;

const readId: ReadIdFunction = (values: unknown): string | undefined => {
  const id: unknown = (values as Record<string, unknown> | undefined)?.["_id"];

  if (id instanceof ObjectID) {
    return id.toString();
  }

  return typeof id === "string" && id ? id : undefined;
};

/**
 * The Dropdown Options field of a custom field settings form, from what
 * useCustomFieldOptionsFormField keeps for the page. Creating a field, it is
 * the plain option list; editing a saved one, the option editor with how
 * many records hold each value.
 */
export const getCustomFieldOptionsFormField: <TModel extends BaseModel>(
  input: CustomFieldOptionsFormFieldInput<TModel>,
) => ModelField<TModel> = <TModel extends BaseModel>(
  input: CustomFieldOptionsFormFieldInput<TModel>,
): ModelField<TModel> => {
  const recordName: CustomFieldRecordName | undefined =
    getCustomFieldRecordName(new input.modelType().tableName || undefined);

  return {
    field: {
      dropdownOptions: true,
    } as ModelField<TModel>["field"],
    title: "Dropdown Options",
    description: CustomFieldFormCopy.dropdownOptionsDescription,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: (values: FormValues<TModel>) => {
      return isDropdownCustomFieldType(input.getFieldType(values));
    },
    showIf: (values: FormValues<TModel>) => {
      return isDropdownCustomFieldType(input.getFieldType(values));
    },
    customValidation: (values: FormValues<TModel>): string | null => {
      if (!isDropdownCustomFieldType(input.getFieldType(values))) {
        return null;
      }

      return getDuplicateOptionProblem(
        (values as Record<string, unknown>)["dropdownOptions"],
      );
    },
    getCustomElement: (
      values: FormValues<TModel>,
      customElementProps: CustomElementProps,
    ): ReactElement => {
      const initialValue: string =
        typeof customElementProps.initialValue === "string"
          ? customElementProps.initialValue
          : "";

      const onChange: (value: string) => void = (value: string): void => {
        if (customElementProps.onChange) {
          customElementProps.onChange(value);
        }
      };

      const onBlur: () => void = (): void => {
        if (customElementProps.onBlur) {
          customElementProps.onBlur();
        }
      };

      const id: string | undefined = readId(values);

      if (!id) {
        return (
          <DropdownOptionsInput
            initialValue={initialValue}
            error={customElementProps.error}
            onChange={onChange}
            onBlur={onBlur}
          />
        );
      }

      return (
        <CustomFieldOptionsEditor
          key={id}
          modelType={input.modelType}
          fieldId={new ObjectID(id)}
          recordName={recordName}
          initialValue={initialValue}
          error={customElementProps.error}
          onChange={onChange}
          onBlur={onBlur}
          onRenamesChange={input.onRenamesChange}
        />
      );
    },
  };
};

/**
 * What the options field of a custom field settings form is built from
 * (getCustomFieldOptionsFormField), and the two table hooks it needs on
 * Edit. A hook: the field's type, by id, and the renames of the open edit
 * are kept for the page's life.
 */
export const useCustomFieldOptionsFormField: <TModel extends BaseModel>(data: {
  modelType: { new (): TModel };
}) => CustomFieldOptionsFormField<TModel> = <TModel extends BaseModel>(data: {
  modelType: { new (): TModel };
}): CustomFieldOptionsFormField<TModel> => {
  const typesByIdRef: MutableRefObject<Record<string, unknown>> = useRef<
    Record<string, unknown>
  >({});
  const renamesRef: MutableRefObject<Array<CustomFieldOptionRename>> = useRef<
    Array<CustomFieldOptionRename>
  >([]);

  type GetFieldTypeFunction = (values: FormValues<TModel>) => unknown;

  // What the form holds, or, on Edit, what the row said.
  const getFieldType: GetFieldTypeFunction = (
    values: FormValues<TModel>,
  ): unknown => {
    const own: unknown = (values as Record<string, unknown>)["customFieldType"];

    if (own) {
      return own;
    }

    const id: string | undefined = readId(values);

    return id ? typesByIdRef.current[id] : undefined;
  };

  return {
    formFieldInput: {
      modelType: data.modelType,
      getFieldType: getFieldType,
      onRenamesChange: (renames: Array<CustomFieldOptionRename>): void => {
        renamesRef.current = renames;
      },
    },
    onBeforeEdit: async (item: TModel): Promise<TModel> => {
      const id: string | undefined = readId(item);

      if (id) {
        typesByIdRef.current[id] = (item as unknown as Record<string, unknown>)[
          "customFieldType"
        ];
      }

      renamesRef.current = [];

      return item;
    },
    onBeforeUpdate: async (
      item: TModel,
      miscDataProps: JSONObject,
    ): Promise<TModel> => {
      if (renamesRef.current.length > 0) {
        miscDataProps[RENAMED_DROPDOWN_OPTIONS_KEY] = renamesRef.current.map(
          (rename: CustomFieldOptionRename): JSONObject => {
            return { from: rename.from, to: rename.to };
          },
        ) as JSONArray;
      }

      return item;
    },
  };
};

import SelectFormFields from "../../Types/SelectEntityField";
import API from "../../Utils/API/API";
import ModelAPI, {
  ListResult,
  ModelAPIHttpResponse,
  RequestOptions,
} from "../../Utils/ModelAPI/ModelAPI";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import User from "../../Utils/User";
import { ButtonStyleType } from "../Button/Button";
import {
  CategoryCheckboxOption,
  CheckboxCategory,
} from "../CategoryCheckbox/CategoryCheckboxTypes";
import type { DropdownOption } from "../Dropdown/Dropdown";
import Loader, { LoaderType } from "../Loader/Loader";
import Pill, { PillSize } from "../Pill/Pill";
import {
  addRuleCriteriaToSelect,
  applyRuleCriteriaLegacySafetyShadow,
  replaceLegacyRuleCriteriaFields,
} from "../RuleCriteria/RuleCriteriaModelForm";
import { FormErrors, FormProps, FormSummaryConfig } from "./BasicForm";
import BasicModelForm from "./BasicModelForm";
import Field from "./Types/Field";
import Fields from "./Types/Fields";
import { FormStep } from "./Types/FormStep";
import FormFieldSchemaType from "./Types/FormFieldSchemaType";
import FormValues from "./Types/FormValues";
import FormAnalyticsName from "./Utils/FormAnalyticsName";
import {
  CreateFormColumnDefault,
  getColorsInUse,
  getCreateFormColorDefault,
  getCreateFormColumnDefault,
} from "./Utils/CreateFormDefaults";
import {
  getPeoplePickerValueKeys,
  PeoplePickerFormValue,
  toPeoplePickerFormValue,
} from "../PeoplePicker/PeoplePickerTypes";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AccessControlModel from "../../../Models/DatabaseModels/DatabaseBaseModel/AccessControlModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FileModel from "../../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import Label from "../../../Models/DatabaseModels/Label";
import URL from "../../../Types/API/URL";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { Black, VeryLightGray } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Typeof from "../../../Types/Typeof";
import React, { MutableRefObject, ReactElement, useRef, useState } from "react";
import {
  composedValue,
  translatableTerm,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import useAsyncEffect from "use-async-effect";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";

/*
 * Whether a dropdown's list request was refused because the person may not
 * read that model (the server answers NotAuthorizedException with 422).
 */
export const isListRefusedForLackOfPermission: (err: unknown) => boolean = (
  err: unknown,
): boolean => {
  return err instanceof HTTPErrorResponse && err.statusCode === 422;
};

export enum FormType {
  Create,
  Update,
}

/*
 * Runs on a Create form just before the request goes out, with the model built
 * from the form's model columns and the misc data the request will carry (the
 * same object: what the hook adds or removes there is what is sent).
 *
 * `formValues` is every value the form holds, exactly as submitted - the
 * inputs that are not model columns included. Read those values from here
 * rather than from `miscDataProps`, which keeps only the truthy ones: a
 * number input holding 0 or a switch left off would otherwise vanish.
 */
export type ModelFormOnBeforeCreate<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> = (
  item: TBaseModel,
  miscDataProps: JSONObject,
  formValues: JSONObject,
) => Promise<TBaseModel>;

/*
 * The same, on an Update form: the model that is about to be saved (its _id
 * set), the misc data the request carries and every value the form holds.
 * What it returns is what is saved - an escalation rule's edit dialog names a
 * rule whose name was cleared after its level here.
 */
export type ModelFormOnBeforeUpdate<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> = ModelFormOnBeforeCreate<TBaseModel>;

export interface ModelField<TBaseModel extends BaseModel | AnalyticsBaseModel>
  extends Field<TBaseModel> {
  overrideField?:
    | {
        // This is used to override the field type in the form.
        [field: string]: true;
      }
    | undefined;
}

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  id: string;
  onValidate?:
    | undefined
    | ((values: FormValues<TBaseModel>) => FormErrors<FormValues<TBaseModel>>);
  fields: Array<ModelField<TBaseModel>>;
  onFormStepChange?: undefined | ((stepId: string) => void);
  steps?: undefined | Array<FormStep<TBaseModel>>;
  submitButtonText?: undefined | string;
  requestHeaders?: undefined | Dictionary<string>;
  title?: undefined | string;
  description?: undefined | string;
  showAsColumns?: undefined | number;
  disableAutofocus?: undefined | boolean;
  footer?: ReactElement | undefined;
  onCancel?: undefined | (() => void);
  name?: string | undefined;
  onChange?:
    | undefined
    | ((
        values: FormValues<TBaseModel>,
        setNewFormValues: (newValues: FormValues<TBaseModel>) => void,
      ) => void);
  onSuccess?: undefined | ((data: TBaseModel, miscData?: JSONObject) => void);
  cancelButtonText?: undefined | string;
  maxPrimaryButtonWidth?: undefined | boolean;
  createOrUpdateApiUrl?: undefined | URL;
  fetchItemApiUrl?: undefined | URL;
  formType: FormType;
  hideSubmitButton?: undefined | boolean;
  submitButtonStyleType?: ButtonStyleType | undefined;
  formRef?: undefined | MutableRefObject<FormProps<FormValues<TBaseModel>>>;
  // Whether the step on screen is the last one (see BasicForm).
  onIsLastFormStep?: undefined | ((isLastFormStep: boolean) => void);
  onLoadingChange?: undefined | ((isLoading: boolean) => void);
  initialValues?: FormValues<TBaseModel> | undefined;
  modelIdToEdit?: ObjectID | undefined;
  onError?: ((error: string) => void) | undefined;
  onBeforeCreate?: ModelFormOnBeforeCreate<TBaseModel> | undefined;
  onBeforeUpdate?: ModelFormOnBeforeUpdate<TBaseModel> | undefined;
  saveRequestOptions?: RequestOptions | undefined;
  doNotFetchExistingModel?: boolean | undefined;
  /*
   * An Update form that opens on a draft of some of its fields - a
   * postmortem template, or a postmortem AI wrote - rather than on the
   * record alone. The form still fetches the record, and these values are
   * laid over it: every field the draft leaves out starts from what is
   * stored. (doNotFetchExistingModel with initialValues starts those fields
   * empty instead, and BasicForm sends an untouched switch as off, so saving
   * a draft quietly turned the postmortem's status page switch off.)
   */
  draftValues?: FormValues<TBaseModel> | undefined;
  modelAPI?: typeof ModelAPI | undefined;
  summary?: FormSummaryConfig | undefined;
  values?: FormValues<TBaseModel> | undefined;
  // Any step can be opened from the step list (see BasicForm).
  allowAnyStepNavigation?: boolean | undefined;
  /*
   * Records of this model listed beside a Create form - the rows of the
   * table it was opened from (ModelTable hands them over). A colour the form
   * picks for a new record is one none of them uses yet
   * (Utils/CreateFormDefaults, getCreateFormColorDefault).
   */
  existingItems?: Array<TBaseModel> | undefined;
}

const ModelForm: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [fields, setFields] = useState<Fields<TBaseModel>>([]);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [isFetchingDropdownOptions, setIsFetchingDropdownOptions] =
    useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [itemToEdit, setItemToEdit] = useState<TBaseModel | null>(null);
  const model: TBaseModel = new props.modelType();
  const translator: Translator = useTranslator();

  /*
   * Almost every caller writes its `fields` as an inline array literal in JSX,
   * so the array is a brand new identity on every render of the page holding
   * the form - which makes the effect below re-run whenever ANY unrelated
   * state on that page changes, including while the user is typing into this
   * form. Two guards keep that from being destructive:
   *
   *  - `dropdownOptionsCache` remembers the options already fetched for a
   *    given dropdown, so a re-run does not fire the same list request again.
   *    Without it the invite-user form issued a Team list request per
   *    keystroke.
   *  - `fieldsRunGeneration` discards a slower earlier run, so an in-flight
   *    request that resolves after a newer one cannot put stale fields back
   *    or clear a loading flag the newer run still owns.
   */
  type DropdownOptionsCacheEntry = {
    dropdownOptions: Array<DropdownOption>;
    selectByAccessControlProps: Field<TBaseModel>["selectByAccessControlProps"];
  };

  /*
   * Keyed on the model CONSTRUCTOR rather than on its name, so two models can
   * never share an entry however they are named - a model with neither a
   * tableName nor a singularName would otherwise key as the empty string.
   */
  const dropdownOptionsCache: MutableRefObject<
    Map<unknown, Dictionary<DropdownOptionsCacheEntry>>
  > = useRef<Map<unknown, Dictionary<DropdownOptionsCacheEntry>>>(new Map());

  const fieldsRunGeneration: MutableRefObject<number> = useRef<number>(0);

  /*
   * The colour a Create form picked for each colour field, by form key. The
   * fields are worked out again on every render of the page around the form,
   * and the rows beside it can be fetched again while it is open: the pick is
   * made once, so the colour the form shows - and that a folded section
   * compares with - never changes under the user. One pick per record: a
   * form never resets itself after a save, and every Create opens a form of
   * its own (a table's dialog is unmounted when it closes).
   */
  const pickedColorDefaults: MutableRefObject<Dictionary<string>> = useRef<
    Dictionary<string>
  >({});

  const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

  /*
   * A people picker writes a form value per kind of pick - owners are
   * ownerUsers and ownerTeams - and names itself with a key of its own that
   * is no column ("owners"). The values that are columns of this model (an
   * owner rule's) are selected and saved as columns; any other (a template's
   * owners) goes in the misc data, as the dropdowns it replaces did.
   */
  type PeoplePickerFieldFunction<TResult> = (
    field: Field<TBaseModel>,
  ) => TResult;

  const isPeoplePickerField: PeoplePickerFieldFunction<boolean> = (
    field: Field<TBaseModel>,
  ): boolean => {
    return (
      field.fieldType === FormFieldSchemaType.PeoplePicker &&
      Boolean(field.peoplePicker)
    );
  };

  const getPeoplePickerColumnKeys: PeoplePickerFieldFunction<Array<string>> = (
    field: Field<TBaseModel>,
  ): Array<string> => {
    if (!field.peoplePicker) {
      return [];
    }

    return getPeoplePickerValueKeys(field.peoplePicker).filter(
      (key: string): boolean => {
        return model.hasColumn(key);
      },
    );
  };

  const getPermittedPeoplePickerColumnKeys: PeoplePickerFieldFunction<
    Array<string>
  > = (field: Field<TBaseModel>): Array<string> => {
    return getPeoplePickerColumnKeys(field).filter((key: string): boolean => {
      return (
        Boolean(field.showEvenIfPermissionDoesNotExist) ||
        hasPermissionOnField(key)
      );
    });
  };

  /*
   * Shown when its picks can be saved: one of its columns may be written,
   * or it has no columns at all - its picks are misc data, which the server
   * checks for itself.
   */
  const isPeoplePickerFieldPermitted: PeoplePickerFieldFunction<boolean> = (
    field: Field<TBaseModel>,
  ): boolean => {
    if (getPeoplePickerColumnKeys(field).length === 0) {
      return true;
    }

    return getPermittedPeoplePickerColumnKeys(field).length > 0;
  };

  type GetSelectFieldsFunction = () => Select<TBaseModel>;

  const getSelectFields: GetSelectFieldsFunction = (): Select<TBaseModel> => {
    const select: Select<TBaseModel> = {};
    for (const field of props.fields) {
      if (isPeoplePickerField(field)) {
        for (const key of getPermittedPeoplePickerColumnKeys(field)) {
          (select as Dictionary<boolean>)[key] = true;
        }

        continue;
      }

      const key: string | null = field.field
        ? (Object.keys(field.field)[0] as string)
        : null;

      if (
        key &&
        (hasPermissionOnField(key) || field.showEvenIfPermissionDoesNotExist)
      ) {
        (select as Dictionary<boolean>)[key] = true;
      }
    }

    return addRuleCriteriaToSelect({
      model: model,
      fields: props.fields,
      select: select as Record<string, unknown>,
    }) as Select<TBaseModel>;
  };

  const getRelationSelect: () => Select<TBaseModel> =
    (): Select<TBaseModel> => {
      const relationSelect: Select<TBaseModel> = {};

      for (const field of props.fields) {
        if (isPeoplePickerField(field)) {
          for (const key of getPeoplePickerColumnKeys(field)) {
            if (model.isEntityColumn(key)) {
              (relationSelect as JSONObject)[key] = true;
            }
          }

          continue;
        }

        const key: string | null = field.field
          ? (Object.keys(field.field)[0] as string)
          : null;

        if (key && model.isFileColumn(key)) {
          (relationSelect as JSONObject)[key] = {
            file: true,
            _id: true,
            fileType: true,
            name: true,
          };
        } else if (key && model.isEntityColumn(key)) {
          (relationSelect as JSONObject)[key] = (field.field as any)[key];
        }
      }

      return relationSelect;
    };

  // What the user holds, read once per draw: every field is weighed against it.
  const heldPermissions: HeldPermissions = PermissionGate.getHeldPermissions();

  const hasPermissionOnField: (fieldName: string) => boolean = (
    fieldName: string,
  ): boolean => {
    if (User.isMasterAdmin()) {
      return true; // master admin can do anything.
    }

    /*
     * The column's create (or update) permissions, read the way the server's
     * column check reads them (PermissionGate.holdsColumnPermission): one of
     * them held - Public by everyone, so a public form shows its fields to a
     * visitor - and no team block on any of them.
     */
    return PermissionGate.holdsColumnPermission(
      model,
      fieldName,
      FormType.Create === props.formType ? "create" : "update",
      { held: heldPermissions },
    );
  };

  /*
   * A field this edit writes that the user may not read back - a provider's
   * API key, for a member who may change the provider but not see its
   * secrets. One column in a select the caller may not read refuses the
   * whole request (SelectPermission), so such a field is left out of the
   * fetch (getFetchSelect), starts empty, and is sent only when it is filled
   * in (isBlankWriteOnlyValue): leaving it blank keeps what is stored. Asked
   * the way every select asks (PermissionGate.canReadColumn). A form that
   * loads through a route of its own (fetchItemApiUrl) leaves that route to
   * decide what it returns.
   */
  const isWriteOnlyField: (fieldName: string) => boolean = (
    fieldName: string,
  ): boolean => {
    if (props.formType !== FormType.Update || props.fetchItemApiUrl) {
      return false;
    }

    if (!model.hasColumn(fieldName)) {
      return false;
    }

    return !PermissionGate.canReadColumn(model, fieldName, {
      held: heldPermissions,
    });
  };

  // What an edit loads: the fields it shows, less those it may not read.
  const getFetchSelect: () => Select<TBaseModel> = (): Select<TBaseModel> => {
    const select: Dictionary<unknown> = {
      ...getSelectFields(),
      ...getRelationSelect(),
    } as Dictionary<unknown>;

    for (const key of Object.keys(select)) {
      if (isWriteOnlyField(key)) {
        delete select[key];
      }
    }

    return select as Select<TBaseModel>;
  };

  /*
   * Whether a write-only field was left as it started: nothing typed, or
   * only spaces, or nothing picked. Such a value is not sent, so the stored
   * one stays.
   */
  const isBlankWriteOnlyValue: (value: unknown) => boolean = (
    value: unknown,
  ): boolean => {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value === Typeof.String) {
      return (value as string).trim().length === 0;
    }

    return Array.isArray(value) && value.length === 0;
  };

  /*
   * How a write-only field is drawn on an edit: never required and never
   * filled with a default, since blank keeps the stored value, and saying
   * so under it. Its own help is looked up first, so the sentence reads in
   * one language whether or not the reader's words it.
   */
  const getWriteOnlyFieldProps: (
    field: Field<TBaseModel>,
  ) => Partial<Field<TBaseModel>> = (
    field: Field<TBaseModel>,
  ): Partial<Field<TBaseModel>> => {
    const ownDescription: string | undefined =
      typeof field.description === "string" ? field.description : undefined;

    return {
      required: false,
      defaultValue: undefined,
      getDefaultValue: undefined,
      placeholder: "Unchanged",
      description:
        field.description !== undefined && ownDescription === undefined
          ? field.description
          : translator
              .translateTemplate(
                "{{description}} Leave blank to keep the stored value.",
                {
                  description: composedValue((sentence: Translator): string => {
                    return (
                      (ownDescription &&
                        sentence.translateText(ownDescription)) ||
                      ""
                    );
                  }),
                },
              )
              .trim(),
    };
  };

  const getFieldPermissions: (fieldName: string) => Array<Permission> = (
    fieldName: string,
  ): Array<Permission> => {
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    let fieldPermissions: Array<Permission> = [];

    if (FormType.Create === props.formType) {
      fieldPermissions = accessControl[fieldName]?.create || [];
    } else {
      fieldPermissions = accessControl[fieldName]?.update || [];
    }

    return fieldPermissions;
  };

  type HasInitialValueFunction = (key: string) => boolean;

  /*
   * Whether the form starts with a value of its own for this key - empty
   * included, as BasicForm reads it: it fills in a default only where the
   * value is undefined.
   */
  const hasInitialValue: HasInitialValueFunction = (key: string): boolean => {
    return (
      (props.initialValues as Record<string, unknown> | undefined)?.[key] !==
      undefined
    );
  };

  const setFormFields: PromiseVoidFunction = async (): Promise<void> => {
    fieldsRunGeneration.current = fieldsRunGeneration.current + 1;
    const generation: number = fieldsRunGeneration.current;

    let fieldsToSet: Fields<TBaseModel> = [];

    for (const field of props.fields) {
      const fieldObj:
        | {
            [field: string]: true;
          }
        | SelectFormFields<TBaseModel>
        | undefined = field.field || field.overrideField;

      if (!fieldObj) {
        continue;
      }

      const keys: Array<string> = Object.keys(fieldObj);

      if (keys.length > 0) {
        const key: string = keys[0] as string;

        /*
         * Two fields may point at the same model column but represent
         * different form inputs via overrideFieldKey (e.g. the invite form
         * collects both "name" and "email" against the `user` column), so
         * dedupe on the effective form key, not the column key alone.
         */
        const effectiveFieldKey: string = field.overrideFieldKey || key;

        const hasPermission: boolean = isPeoplePickerField(field)
          ? isPeoplePickerFieldPermitted(field)
          : hasPermissionOnField(key);

        if (
          (field.showEvenIfPermissionDoesNotExist || hasPermission) &&
          fieldsToSet.filter((i: ModelField<TBaseModel>) => {
            const fieldObj:
              | {
                  [field: string]: true;
                }
              | SelectFormFields<TBaseModel>
              | undefined = i.field || i.overrideField;

            if (!fieldObj) {
              return false;
            }
            // check if field already exists. If it does, don't add it.
            const iKeys: Array<string> = Object.keys(fieldObj);
            const iFieldKey: string =
              i.overrideFieldKey || (iKeys[0] as string);
            return iFieldKey === effectiveFieldKey;
          }).length === 0
        ) {
          // check if has maxLength
          if (
            !field.validation?.maxLength &&
            model.getTableColumnMetadata(key)?.type
          ) {
            field.validation = {
              ...field.validation,
              maxLength: getMaxLengthFromTableColumnType(
                model.getTableColumnMetadata(key).type,
              ),
            };
          }

          /*
           * A Create form starts from the model's own column defaults - what
           * the server stores for a field left out - unless the field or the
           * form's initial values say otherwise (Utils/CreateFormDefaults).
           * Without this a switch whose column defaults to on was drawn off
           * and saved off. An Edit form shows the record as it is, but its
           * folded sections still compare with the column's default, so a
           * switch on because its column starts on is not shown as set.
           */
          const columnDefault: CreateFormColumnDefault | undefined =
            getCreateFormColumnDefault(model, field);

          /*
           * A colour the record cannot be saved without, and whose column
           * has no default, starts picked: one the records beside the form
           * do not use yet. Not over a colour the form already starts with.
           */
          if (
            props.formType === FormType.Create &&
            columnDefault === undefined &&
            pickedColorDefaults.current[effectiveFieldKey] === undefined &&
            !hasInitialValue(effectiveFieldKey)
          ) {
            const colorDefault: string | undefined = getCreateFormColorDefault(
              model,
              field,
              getColorsInUse(field, props.existingItems),
            );

            if (colorDefault) {
              pickedColorDefaults.current[effectiveFieldKey] = colorDefault;
            }
          }

          const createDefault: CreateFormColumnDefault | undefined =
            props.formType === FormType.Create
              ? columnDefault ?? pickedColorDefaults.current[effectiveFieldKey]
              : undefined;

          fieldsToSet.push({
            ...field,
            ...(createDefault !== undefined
              ? { defaultValue: createDefault }
              : {}),
            ...(columnDefault !== undefined
              ? { columnDefaultValue: columnDefault }
              : {}),
            /*
             * Required of a new record only: an Edit form leaves it optional
             * (Field.doNotRequireWhenEditing).
             */
            ...(field.doNotRequireWhenEditing &&
            props.formType !== FormType.Create
              ? { required: false }
              : {}),
            ...(isWriteOnlyField(key) ? getWriteOnlyFieldProps(field) : {}),
            field: {
              [key]: true,
            } as SelectFormFields<TBaseModel>,
          });
        }
      }
    }

    fieldsToSet = await fetchDropdownOptions(fieldsToSet, generation);

    if (generation !== fieldsRunGeneration.current) {
      // A newer run started while this one was fetching. It owns the state now.
      return;
    }

    fieldsToSet = replaceLegacyRuleCriteriaFields(model, fieldsToSet);

    // if there are no fields to set, then show permission error. This is useful when there are no fields to show.
    if (fieldsToSet.length === 0 && props.fields.length > 0) {
      const field: ModelField<TBaseModel> | undefined = props.fields[0];

      if (field) {
        const fieldName: string | undefined = Object.keys(field.field || {})[0];

        if (fieldName) {
          const fieldPermissions: Array<Permission> =
            getFieldPermissions(fieldName);

          const columnMetadata: TableColumnMetadata =
            model.getTableColumnMetadata(fieldName);

          setError(
            translator.translateTemplate(
              props.formType === FormType.Create
                ? "You don't have enough permissions to create {{columnName}} on {{itemName}}. You need one of the following permissions: {{permissions}}"
                : "You don't have enough permissions to edit {{columnName}} on {{itemName}}. You need one of the following permissions: {{permissions}}",
              {
                columnName: translatableTerm(columnMetadata.title || fieldName),
                itemName: translatableTerm(model.singularName || ""),
                permissions: fieldPermissions.join(", "),
              },
            ),
          );
        }
      }
    }

    setFields(fieldsToSet);
  };

  useAsyncEffect(async () => {
    // set fields.
    await setFormFields();
  }, [props.fields]);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    if (!props.modelIdToEdit || props.formType !== FormType.Update) {
      throw new BadDataException("Model ID to update not found.");
    }

    let item: BaseModel | null = await modelAPI.getItem({
      modelType: props.modelType,
      id: props.modelIdToEdit,
      select: getFetchSelect(),
      requestOptions: {
        overrideRequestUrl: props.fetchItemApiUrl,
      },
    });

    if (!(item instanceof BaseModel) && item) {
      item = BaseModel.fromJSON(
        item as JSONObject,
        props.modelType,
      ) as BaseModel;
    }

    if (!item) {
      setError(
        `Cannot edit ${(
          model.singularName || "item"
        ).toLowerCase()}. It could be because you don't have enough permissions to read or edit this ${(
          model.singularName || "item"
        ).toLowerCase()}.`,
      );
    }

    const relationSelect: Select<TBaseModel> = getRelationSelect();

    for (const key in relationSelect) {
      if (!item) {
        continue;
      }

      const isFileColumn: boolean = model.isFileColumn(key);

      if (Array.isArray((item as any)[key])) {
        if (isFileColumn) {
          (item as any)[key] = ((item as any)[key] as Array<JSONObject>).map(
            (file: JSONObject) => {
              return BaseModel.fromJSON(file, FileModel) as FileModel;
            },
          );
          continue;
        }

        const idArray: Array<string> = [];
        let isModelArray: boolean = false;

        for (const itemInArray of (item as any)[key] as Array<JSONObject>) {
          if (typeof itemInArray === "object" && itemInArray) {
            const id: string | undefined = itemInArray["_id"] as
              | string
              | undefined;
            if (id) {
              isModelArray = true;
              idArray.push(id);
            }
          }
        }

        if (isModelArray) {
          (item as any)[key] = idArray;
        }
      } else if ((item as any)[key] && typeof (item as any)[key] === "object") {
        if (isFileColumn) {
          (item as any)[key] = BaseModel.fromJSON(
            (item as any)[key] as JSONObject,
            FileModel,
          );
          continue;
        }

        if (!((item as any)[key] instanceof FileModel)) {
          const id: string | undefined = ((item as any)[key] as JSONObject)[
            "_id"
          ] as string | undefined;

          if (id) {
            (item as any)[key] = id;
          }
        }
      }
    }

    setItemToEdit(item as TBaseModel);
  };

  type FetchDropdownOptionsFunction = (
    fields: Fields<TBaseModel>,
    generation: number,
  ) => Promise<Fields<TBaseModel>>;

  /*
   * What a dropdown's options depend on, and nothing else: the model, the
   * two columns read off it, the order it is listed in and the query that
   * narrows it. The request below takes no closure state, so two fields with
   * the same five always get the same list back - which is what makes
   * caching them safe.
   */
  type GetCachedDropdownOptionsFunction = (
    dropdownModal: NonNullable<Field<TBaseModel>["dropdownModal"]>,
  ) => DropdownOptionsCacheEntry | undefined;

  type SetCachedDropdownOptionsFunction = (
    dropdownModal: NonNullable<Field<TBaseModel>["dropdownModal"]>,
    entry: DropdownOptionsCacheEntry,
  ) => void;

  const getDropdownColumnsKey: (
    dropdownModal: NonNullable<Field<TBaseModel>["dropdownModal"]>,
  ) => string = (
    dropdownModal: NonNullable<Field<TBaseModel>["dropdownModal"]>,
  ): string => {
    const sortKey: string = Object.entries(dropdownModal.sort || {})
      .map((entry: [string, string]): string => {
        return `${entry[0]}:${entry[1]}`;
      })
      .join(",");

    const queryKey: string = JSON.stringify(dropdownModal.query || {});

    return `${dropdownModal.labelField}|${dropdownModal.valueField}|${sortKey}|${queryKey}`;
  };

  const getCachedDropdownOptions: GetCachedDropdownOptionsFunction = (
    dropdownModal: NonNullable<Field<TBaseModel>["dropdownModal"]>,
  ): DropdownOptionsCacheEntry | undefined => {
    return dropdownOptionsCache.current.get(dropdownModal.type)?.[
      getDropdownColumnsKey(dropdownModal)
    ];
  };

  const setCachedDropdownOptions: SetCachedDropdownOptionsFunction = (
    dropdownModal: NonNullable<Field<TBaseModel>["dropdownModal"]>,
    entry: DropdownOptionsCacheEntry,
  ): void => {
    const byColumns: Dictionary<DropdownOptionsCacheEntry> =
      dropdownOptionsCache.current.get(dropdownModal.type) || {};

    byColumns[getDropdownColumnsKey(dropdownModal)] = entry;

    dropdownOptionsCache.current.set(dropdownModal.type, byColumns);
  };

  const fetchDropdownOptions: FetchDropdownOptionsFunction = async (
    fields: Fields<TBaseModel>,
    generation: number,
  ): Promise<Fields<TBaseModel>> => {
    /*
     * Serve everything already fetched from the cache first, then work out
     * whether anything is actually left to request. Flipping the loading flag
     * for a run that has nothing to fetch used to blank the whole form (see
     * the comment on the render guard below), so only flip it when a real
     * request is about to go out.
     */
    const fieldsToFetch: Fields<TBaseModel> = [];

    for (const field of fields) {
      if (!field.dropdownModal || !field.dropdownModal.type) {
        continue;
      }

      const cached: DropdownOptionsCacheEntry | undefined =
        getCachedDropdownOptions(field.dropdownModal);

      if (cached) {
        field.dropdownOptions = cached.dropdownOptions;

        if (cached.selectByAccessControlProps) {
          field.selectByAccessControlProps = cached.selectByAccessControlProps;
        }

        continue;
      }

      fieldsToFetch.push(field);
    }

    if (fieldsToFetch.length === 0) {
      /*
       * Nothing to wait for. Clearing rather than just returning keeps the flag
       * from being left on by an older run that lost the race and therefore
       * declined to clear it - React bails out when it is already false.
       */
      if (generation === fieldsRunGeneration.current) {
        setIsFetchingDropdownOptions(false);
      }

      return fields;
    }

    setIsFetchingDropdownOptions(true);

    /*
     * Each dropdown is fetched on its own, so one that fails still leaves the
     * others their options. The first failure is shown once they are done,
     * except a list the person may not read at all: that dropdown is simply
     * left empty (and remembered as empty), as EntityDropdown does for its
     * own requests. Reading the related model is a separate permission from
     * editing this one, so someone may edit a field whose options they cannot
     * list - an incident member and the status pages an incident is limited
     * to - and a form-wide error on every step would say the form is broken
     * when it is not. The dropdown then just has nothing to pick.
     */
    let firstFetchError: unknown = null;

    for (const field of fieldsToFetch) {
      try {
        if (field.dropdownModal && field.dropdownModal.type) {
          const tempModel: BaseModel = new field.dropdownModal.type();
          const select: any = {
            [field.dropdownModal.labelField]: true,
            [field.dropdownModal.valueField]: true,
          } as any;

          let colorColumnName: string | null = null;
          let shouldSelectColorColumn: boolean = false;

          colorColumnName = tempModel.getFirstColorColumn();

          if (colorColumnName) {
            select[colorColumnName] = true;
            shouldSelectColorColumn = true;
          }

          /*
           * A sorted column is selected too: with the labels relation below
           * the list goes down TypeORM's paginated path, which orders by a
           * column only if it was selected - leaving it out fails the request.
           */
          for (const sortColumnName of Object.keys(
            field.dropdownModal.sort || {},
          )) {
            select[sortColumnName] = true;
          }

          const accessControlColumnName: string | null =
            tempModel.getAccessControlColumn();

          // also select labels, so they can select resources by labels. This is useful for resources like monitors, etc.
          if (accessControlColumnName) {
            select[accessControlColumnName] = {
              _id: true,
              name: true,
              color: true,
            } as any;
          }

          const listResult: ListResult<BaseModel> =
            await modelAPI.getList<BaseModel>({
              modelType: field.dropdownModal.type,
              query: {
                ...(field.dropdownModal.query || {}),
              } as Query<BaseModel>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: select,
              sort: (field.dropdownModal.sort || {}) as Sort<BaseModel>,
            });

          if (listResult.data && listResult.data.length > 0) {
            const dropdownOptions: Array<DropdownOption> = listResult.data.map(
              (item: BaseModel) => {
                if (!field.dropdownModal) {
                  throw new BadDataException("Dropdown Modal value mot found");
                }

                const option: DropdownOption = {
                  label: (item as any)[
                    field.dropdownModal?.labelField
                  ].toString(),
                  value: (item as any)[
                    field.dropdownModal?.valueField
                  ].toString(),
                };

                if (colorColumnName && shouldSelectColorColumn) {
                  const color: Color = item.getColumnValue(
                    colorColumnName,
                  ) as Color;
                  if (color) {
                    option.color = color;
                  }
                }

                if (accessControlColumnName) {
                  const labelsForItem: Array<AccessControlModel> = (
                    ((item as any)[
                      accessControlColumnName
                    ] as Array<AccessControlModel>) || []
                  ).filter((label: AccessControlModel | null) => {
                    return Boolean(label);
                  }) as Array<AccessControlModel>;

                  if (labelsForItem.length > 0) {
                    option.labels = labelsForItem as Array<Label>;
                  }
                }

                return option;
              },
            );

            field.dropdownOptions = dropdownOptions;

            if (accessControlColumnName) {
              const categories: Array<CheckboxCategory> = [];

              // populate categories.

              let localLabels: Array<AccessControlModel> = [];

              for (const item of listResult.data) {
                const accessControlColumn: string = accessControlColumnName;
                const labels: Array<AccessControlModel> =
                  ((item as any)[
                    accessControlColumn
                  ] as Array<AccessControlModel>) || [];

                for (const label of labels) {
                  if (label && label._id && label.getColumnValue("name")) {
                    // check if this category already exists.

                    const existingLabel: AccessControlModel | undefined =
                      localLabels.find((i: AccessControlModel) => {
                        return i._id?.toString() === label._id?.toString();
                      });

                    if (!existingLabel) {
                      localLabels.push(label);
                    }
                  }
                }
              }

              // sort category by name.

              localLabels = localLabels.sort(
                (a: AccessControlModel, b: AccessControlModel) => {
                  return a
                    .getColumnValue("name")!
                    .toString()
                    .localeCompare(b.getColumnValue("name")?.toString() || "");
                },
              );

              // for each of these labels add category.

              for (const label of localLabels) {
                categories.push({
                  id: label._id?.toString() || "",
                  title: (
                    <span className="mb-1">
                      <Pill
                        size={PillSize.Small}
                        color={
                          (label.getColumnValue("color") as Color) || Black
                        }
                        text={(label.getColumnValue("name") as string) || ""}
                      />
                    </span>
                  ),
                });
              }

              // now populate options.
              const options: Array<CategoryCheckboxOption> = [];

              for (const item of listResult.data) {
                const accessControlColumn: string = accessControlColumnName;
                const labels: Array<AccessControlModel> =
                  ((item as any)[
                    accessControlColumn
                  ] as Array<AccessControlModel>) || [];

                if (labels.length > 0) {
                  for (const label of labels) {
                    options.push({
                      value: item.getColumnValue(
                        field.dropdownModal.valueField,
                      ) as string,
                      label: item.getColumnValue(
                        field.dropdownModal.labelField,
                      ) as string,
                      categoryId: label._id?.toString() || "",
                    });
                  }
                } else {
                  options.push({
                    value: item.getColumnValue(
                      field.dropdownModal.valueField,
                    ) as string,
                    label: item.getColumnValue(
                      field.dropdownModal.labelField,
                    ) as string,
                    categoryId: "",
                  });
                }
              }

              field.selectByAccessControlProps = {
                categoryCheckboxProps: {
                  categories: categories,
                  options: options,
                },
                accessControlColumnTitle:
                  tempModel.getTableColumnMetadata(accessControlColumnName)
                    .title || "",
              };
            }
          } else {
            field.dropdownOptions = [];
          }

          setCachedDropdownOptions(field.dropdownModal, {
            dropdownOptions: (field.dropdownOptions ||
              []) as Array<DropdownOption>,
            selectByAccessControlProps: field.selectByAccessControlProps,
          });
        }
      } catch (err) {
        if (isListRefusedForLackOfPermission(err) && field.dropdownModal) {
          field.dropdownOptions = [];

          setCachedDropdownOptions(field.dropdownModal, {
            dropdownOptions: [],
            selectByAccessControlProps: undefined,
          });

          continue;
        }

        if (firstFetchError === null) {
          firstFetchError = err;
        }
      }
    }

    if (firstFetchError !== null) {
      setError(API.getFriendlyMessage(firstFetchError));
    }

    if (generation === fieldsRunGeneration.current) {
      setIsFetchingDropdownOptions(false);
    }

    return fields;
  };

  /*
   * Keyed on the id (as a string - ObjectID identity changes every render)
   * so a form that mounts before its id is known still fetches once it
   * arrives. It used to run only on mount, which left an Update form showing
   * blank defaults: submitting that silently wrote empty values - and false
   * for every Toggle, since BasicForm sends an untouched toggle as false -
   * over the real record. (A Create form starts from the column defaults
   * instead; an Update form only ever from the record it fetched.)
   */
  useAsyncEffect(async () => {
    if (props.formType !== FormType.Update || props.doNotFetchExistingModel) {
      return;
    }

    if (!props.modelIdToEdit) {
      /*
       * Without an id there is nothing to prefill and nothing to update, so
       * say so rather than rendering an empty form that looks editable.
       *
       * Deliberately not props.onError: ModelFormModal unmounts the form on
       * that, and this state is recoverable - the effect re-runs and clears
       * the message as soon as the id arrives.
       */
      setError(
        `Cannot edit this ${(
          model.singularName || "item"
        ).toLowerCase()} yet because it is still loading. Please try again in a moment.`,
      );
      return;
    }

    // get item.
    setLoading(true);
    setIsFetching(true);
    setError("");
    try {
      await fetchItem();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      props.onError?.(API.getFriendlyMessage(err));
    }

    setLoading(false);
    setIsFetching(false);
  }, [props.modelIdToEdit?.toString()]);

  type GetMiscDataPropsFunction = (
    values: FormValues<JSONObject>,
  ) => JSONObject;

  const getMiscDataProps: GetMiscDataPropsFunction = (
    values: FormValues<JSONObject>,
  ): JSONObject => {
    const result: JSONObject = {};

    for (const field of fields) {
      /*
       * A people picker's values that are not columns of the model - a
       * template's ownerUsers and ownerTeams - are sent as misc data, as
       * plain ids (one id, for a picker that takes a single pick). Its
       * columns are saved with the model.
       */
      if (isPeoplePickerField(field) && field.peoplePicker) {
        for (const key of getPeoplePickerValueKeys(field.peoplePicker)) {
          if (model.hasColumn(key)) {
            continue;
          }

          if (values[key] === undefined || values[key] === null) {
            continue;
          }

          const formValue: PeoplePickerFormValue = toPeoplePickerFormValue(
            field.peoplePicker,
            values[key],
          );

          if (formValue !== null) {
            result[key] = formValue;
          }
        }

        continue;
      }

      // A form-only field drives the form; nothing of it is sent.
      if (field.formOnly) {
        continue;
      }

      if (field.overrideFieldKey && values[field.overrideFieldKey]) {
        result[field.overrideFieldKey] =
          (values[field.overrideFieldKey] as JSONObject) || null;
      }
    }

    return result;
  };

  const onSubmit: (
    values: FormValues<JSONObject>,
    onSubmitSuccessful: () => void,
  ) => Promise<void> = async (
    values: FormValues<JSONObject>,
    onSubmitSuccessful: () => void,
  ): Promise<void> => {
    // Ping an API here.

    setError("");
    setLoading(true);
    if (props.onLoadingChange) {
      props.onLoadingChange(true);
    }

    let result: ModelAPIHttpResponse<TBaseModel>;

    try {
      // strip data.
      const valuesToSend: JSONObject = {};

      for (const key in getSelectFields()) {
        // A write-only field left blank keeps what is stored (isWriteOnlyField).
        if (isWriteOnlyField(key) && isBlankWriteOnlyValue(values[key])) {
          continue;
        }

        (valuesToSend as any)[key] = values[key];
      }

      applyRuleCriteriaLegacySafetyShadow({
        model: model,
        fields: props.fields,
        values: valuesToSend,
      });

      if (props.formType === FormType.Update && props.modelIdToEdit) {
        (valuesToSend as any)["_id"] = props.modelIdToEdit.toString();
      }

      const miscDataProps: JSONObject = getMiscDataProps(values);

      // remove those props from valuesToSend
      for (const key in miscDataProps) {
        delete valuesToSend[key];
      }

      for (const key of model.getTableColumns().columns) {
        const tableColumnMetadata: TableColumnMetadata =
          model.getTableColumnMetadata(key);

        if (
          tableColumnMetadata &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.Entity &&
          valuesToSend[key] &&
          typeof valuesToSend[key] === Typeof.String
        ) {
          const baseModel: BaseModel = new tableColumnMetadata.modelType();
          baseModel._id = valuesToSend[key] as string;
          valuesToSend[key] = baseModel;
        }

        if (
          tableColumnMetadata &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.EntityArray &&
          Array.isArray(valuesToSend[key]) &&
          (valuesToSend[key] as Array<any>).length > 0 &&
          typeof (valuesToSend[key] as Array<any>)[0] === Typeof.Object &&
          typeof (valuesToSend[key] as Array<any>)[0].value === Typeof.String
        ) {
          const arr: Array<string> = [];
          for (const id of valuesToSend[key] as Array<GenericObject>) {
            arr.push((id as any).value as string);
          }
          valuesToSend[key] = arr;
        }

        if (
          tableColumnMetadata &&
          tableColumnMetadata.modelType &&
          tableColumnMetadata.type === TableColumnType.EntityArray &&
          Array.isArray(valuesToSend[key]) &&
          (valuesToSend[key] as Array<any>).length > 0 &&
          typeof (valuesToSend[key] as Array<any>)[0] === Typeof.String
        ) {
          const arr: Array<BaseModel> = [];
          for (const id of valuesToSend[key] as Array<string>) {
            const baseModel: BaseModel = new tableColumnMetadata.modelType();
            baseModel._id = id as string;
            arr.push(baseModel);
          }
          valuesToSend[key] = arr;
        }

        /*
         * A colour a Create form picked for a new record is held as text
         * ("#6366f1"), where the picker holds a Color: it is sent as the
         * Color it stands for, the same as one picked by hand.
         */
        if (
          tableColumnMetadata &&
          tableColumnMetadata.type === TableColumnType.Color &&
          typeof valuesToSend[key] === Typeof.String &&
          (valuesToSend[key] as string).trim()
        ) {
          valuesToSend[key] = new Color((valuesToSend[key] as string).trim());
        }
      }

      /*
       * A JSON field is EDITED as text - CodeEditor hands the form a string -
       * but a JSON COLUMN holds real JSON, and nothing converted the one into
       * the other when saving an existing record.
       *
       * TelemetryIngestionKeys converts in onBeforeCreate, and ModelForm only
       * runs that hook on Create (see below). So editing a browser key's
       * allowed origins from its detail page sent the string
       * '["https://app.example.com"]' to a column that holds a list, and
       * TelemetryIngestionKeyService refused it - "Allowed origins must be a
       * list of origins". Every JSON column edited through a JSON field had
       * the same gap on update: the session replay origin, mask and block
       * selector lists, the LLM provider and data source configs, the
       * auto-remediation command allowlist.
       *
       * Both halves of the condition are load-bearing. Not every JSON editor
       * is backed by a JSON column: a VeryLongText column can hold JSON as
       * the text it was given (SecurityEventConnection.secrets does, as the
       * retired Google SecOps connection's pasted service account key did),
       * and parsing that would hand the server an object where it expects
       * the string it parses and encrypts itself. And not every JSON column
       * is edited as text.
       *
       * Only a string is converted, and only when it parses. An untouched
       * field still holds whatever the fetch loaded (already parsed), and
       * text that is not JSON cannot reach here because
       * Validation.validateJSONSyntax blocks the submit.
       */
      const jsonEditorFieldNames: Set<string> = new Set<string>(
        props.fields
          .filter((field: Field<TBaseModel>) => {
            return field.fieldType === FormFieldSchemaType.JSON;
          })
          .map((field: Field<TBaseModel>) => {
            return field.overrideFieldKey || Object.keys(field.field || {})[0];
          })
          .filter((name: string | undefined): name is string => {
            return Boolean(name);
          }),
      );

      for (const key of jsonEditorFieldNames) {
        if (typeof valuesToSend[key] !== Typeof.String) {
          continue;
        }

        const columnMetadata: TableColumnMetadata =
          model.getTableColumnMetadata(key);

        if (!columnMetadata || columnMetadata.type !== TableColumnType.JSON) {
          continue;
        }

        try {
          valuesToSend[key] = JSON.parse(
            valuesToSend[key] as string,
          ) as JSONObject;
        } catch {
          // Not JSON; leave it exactly as the user typed it.
        }
      }

      let tBaseModel: TBaseModel = BaseModel.fromJSON(
        valuesToSend,
        props.modelType,
      ) as TBaseModel;

      if (props.onBeforeCreate && props.formType === FormType.Create) {
        tBaseModel = await props.onBeforeCreate(
          tBaseModel,
          miscDataProps,
          values as JSONObject,
        );
      }

      if (props.onBeforeUpdate && props.formType === FormType.Update) {
        tBaseModel = await props.onBeforeUpdate(
          tBaseModel,
          miscDataProps,
          values as JSONObject,
        );
      }

      result = await modelAPI.createOrUpdate<TBaseModel>({
        model: tBaseModel as TBaseModel,
        modelType: props.modelType,
        formType: props.formType,
        miscDataProps: miscDataProps,
        requestOptions: {
          ...props.saveRequestOptions,
          requestHeaders: props.requestHeaders,
          overrideRequestUrl: props.createOrUpdateApiUrl,
        },
      });

      const miscData: JSONObject | undefined = result.miscData;

      if (props.onSuccess) {
        // we do props.formType === FormType.Create ? result.data: tBaseModel because update API does not return the updated model.
        props.onSuccess(
          BaseModel.fromJSONObject(
            props.formType === FormType.Create ? result.data : tBaseModel,
            props.modelType,
          ),
          miscData,
        );
      }

      onSubmitSuccessful();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setLoading(false);

    if (props.onLoadingChange) {
      props.onLoadingChange(false);
    }
  };

  /*
   * Only ever swap the form out for a loader while there is no form to show.
   * Returning the loader over a form the user is already filling in unmounts
   * BasicModelForm and everything under it, and a form's values live in that
   * subtree - in BasicForm's refs and in each Input's own state, since Input
   * is DOM-uncontrolled. So the remount silently threw the user's input away.
   *
   * That is what made inviting a user impossible: the invite form's Email field
   * calls back into the page on every keystroke to check whether the address
   * already has an account, the page re-renders with a fresh `fields` array
   * literal, the effect above re-runs, and the form the user was typing into
   * was destroyed and rebuilt empty.
   *
   * Once fields exist, options refresh in the background instead. The cache in
   * fetchDropdownOptions means the usual re-run does not even reach the
   * network, so in practice nothing about the form flickers at all.
   */
  const hasFieldsToRender: boolean = fields.length > 0;

  if (isFetching || (isFetchingDropdownOptions && !hasFieldsToRender)) {
    return (
      <div className="row flex justify-center mt-20 mb-20">
        <Loader loaderType={LoaderType.Bar} color={VeryLightGray} size={200} />
      </div>
    );
  }

  /*
   * A create form for a model the viewer cannot create is worse than no form:
   * the per-field access control above strips every column, so the wizard
   * renders empty steps that all read as complete, and the submit fails with
   * whatever the server happens to validate first - which is how creating a
   * monitor as a Viewer produced "Monitor type required to create monitor"
   * with not a word about permissions (issue #3306). Say the real reason.
   *
   * Deliberately narrow, because a false positive here blanks a page:
   *
   *  - create only. An update form is reached through an Edit button that is
   *    gated already, and gating the form as well only risks a dead end.
   *  - only when the form posts to the model's own CRUD endpoint. Sign-in,
   *    sign-up, password reset and status page subscribe are all ModelForms
   *    with formType Create that submit somewhere else entirely; the model's
   *    create permission has nothing to do with whether the visitor may use
   *    them, and a signed-in user opening a status page in the same browser
   *    would otherwise be locked out of its login form by an unrelated
   *    project permission.
   *  - never for a model Public may create, which is the marker for "anybody
   *    may do this".
   */
  const isModelCrudCreate: boolean =
    props.formType === FormType.Create && !props.createOrUpdateApiUrl;

  const isPublicCreate: boolean = PermissionGate.getModelPermissions(
    model,
    ModelAction.Create,
  ).includes(Permission.Public);

  if (isModelCrudCreate && !isPublicCreate) {
    const createGate: PermissionGateResult = PermissionGate.check(
      model,
      ModelAction.Create,
    );

    if (!createGate.isAllowed && createGate.disabledReason) {
      return <ErrorMessage message={createGate.disabledReason} />;
    }
  }

  return (
    <div>
      <BasicModelForm<TBaseModel>
        values={props.values}
        title={props.title}
        description={props.description}
        disableAutofocus={props.disableAutofocus}
        model={model}
        id={props.id}
        name={FormAnalyticsName.resolve(
          props.name,
          props.title,
          model.singularName
            ? `${
                props.formType === FormType.Create ? "Create" : "Update"
              } ${model.singularName}`
            : undefined,
        )}
        onFormStepChange={props.onFormStepChange}
        onIsLastFormStep={props.onIsLastFormStep}
        fields={fields}
        steps={props.steps}
        onChange={(
          values: FormValues<TBaseModel>,
          setNewFormValues: (newValues: FormValues<TBaseModel>) => void,
        ) => {
          if (!isLoading) {
            props.onChange?.(values, setNewFormValues);
          }
        }}
        showAsColumns={props.showAsColumns}
        footer={props.footer}
        isLoading={isLoading}
        submitButtonText={props.submitButtonText}
        cancelButtonText={props.cancelButtonText}
        onSubmit={onSubmit}
        submitButtonStyleType={props.submitButtonStyleType}
        onValidate={props.onValidate}
        onCancel={props.onCancel}
        maxPrimaryButtonWidth={props.maxPrimaryButtonWidth}
        error={error}
        hideSubmitButton={props.hideSubmitButton}
        formRef={props.formRef}
        initialValues={
          (itemToEdit && props.draftValues
            ? { ...itemToEdit, ...props.draftValues }
            : itemToEdit || props.initialValues) as
            | FormValues<TBaseModel>
            | undefined
        }
        summary={props.summary}
        allowAnyStepNavigation={props.allowAnyStepNavigation}
      ></BasicModelForm>
    </div>
  );
};

export default ModelForm;

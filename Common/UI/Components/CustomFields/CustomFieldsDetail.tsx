import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Detail from "../Detail/Detail";
import { DropdownOption } from "../Dropdown/Dropdown";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicFormModal from "../FormModal/BasicFormModal";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

const parseDropdownOptions: (value: unknown) => Array<DropdownOption> = (
  value: unknown,
): Array<DropdownOption> => {
  return parseCustomFieldDropdownOptions(value).map(
    (option: CustomFieldDropdownOption): DropdownOption => {
      const dropdownOption: DropdownOption = {
        label: option.value,
        value: option.value,
      };

      if (option.color) {
        dropdownOption.color = Color.fromString(option.color);
      }

      return dropdownOption;
    },
  );
};

export interface ComponentProps {
  title: string;
  description: string;
  modelId: ObjectID;
  modelType: DatabaseBaseModelType;
  customFieldType: DatabaseBaseModelType;
  projectId: ObjectID;
  name: string;
  isEditable?: boolean | undefined;
  /*
   * For call sites that mount this card unconditionally - the resource
   * overview pages - where most projects have never defined a custom field.
   *
   * With this set the card renders NOTHING until it knows the project has at
   * least one field of this type: no loader flash and no "no custom fields
   * have been added" placeholder occupying a slot on a page the operator
   * opened to look at something else.
   *
   * It also hides on a load failure, because reading the schema is gated on
   * both a permission and a billing plan. Without that, every incident a
   * project below the custom-fields plan opens would carry an error card it
   * can do nothing about. The dedicated Custom Fields page mounts this same
   * component WITHOUT the flag, so anyone who goes looking still sees the
   * real reason.
   */
  hideIfEmpty?: boolean | undefined;
}

const CustomFieldsDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [schemaList, setSchemaList] = useState<Array<BaseModel>>([]);
  /*
   * Read failures and write failures are kept apart because hideIfEmpty
   * treats them oppositely. Failing to READ the schema is something an
   * overview page swallows - the project may simply not be on a plan that
   * includes custom fields, and there is nothing the operator can do about it
   * on an incident page. Failing to WRITE is the operator's own edit coming
   * back rejected, and must be reported wherever it happens. Sharing one slot
   * meant a rejected save made the whole card disappear.
   */
  const [loadError, setLoadError] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [model, setModel] = useState<BaseModel | null>(null);
  const [showModelForm, setShowModelForm] = useState<boolean>(false);

  const onLoad: PromiseVoidFunction = async (): Promise<void> => {
    try {
      // load schema.
      setIsLoading(true);
      setLoadError("");

      const schemaList: ListResult<BaseModel> =
        await ModelAPI.getList<BaseModel>({
          modelType: props.customFieldType,
          query: {
            projectId: props.projectId,
          } as any,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
            customFieldType: true,
            description: true,
            dropdownOptions: true,
          } as any,
          sort: {},
        });

      const item: BaseModel | null = await ModelAPI.getItem<BaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: {
          customFields: true,
        } as any,
      });

      setSchemaList(schemaList.data);
      setModel(item);

      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setLoadError(API.getFriendlyMessage(err));
    }
  };

  type OnSaveFunction = (data: JSONObject) => Promise<void>;

  const onSave: OnSaveFunction = async (data: JSONObject): Promise<void> => {
    try {
      // load schema.
      setIsLoading(true);
      setSaveError("");
      setShowModelForm(false);

      await ModelAPI.updateById({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          customFields: data,
        },
      });

      await onLoad();
    } catch (err) {
      setIsLoading(false);
      setSaveError(API.getFriendlyMessage(err));
    }
  };

  useAsyncEffect(async () => {
    await onLoad();
  }, []);

  const isEditable: boolean = props.isEditable !== false;

  /*
   * schemaList is empty both before the first load finishes and when the
   * project genuinely has no fields of this type, which is exactly when an
   * overview page should show nothing - so one check covers both.
   *
   * `!model` covers the record itself coming back empty. On a page that is
   * plainly displaying that record, a card announcing "Item not found" is a
   * contradiction; showing nothing is the honest version.
   *
   * Deliberately NOT saveError: a rejected save has to stay on screen, and it
   * leaves schemaList and model intact, so the card keeps rendering.
   */
  if (
    props.hideIfEmpty &&
    (Boolean(loadError) || schemaList.length === 0 || !model)
  ) {
    return <></>;
  }

  /*
   * There has to be something to edit before the button is worth offering:
   * the modal reads its initial values off the record and its inputs off the
   * schema, so opening it mid-load threw on a null record, and opening it
   * with no fields defined produced a form with nothing in it.
   *
   * A failed LOAD needs no term of its own - it leaves schemaList empty and
   * model null, which the checks below already cover. A failed SAVE must not
   * take the button away, or the error message is telling the operator to
   * retry something they can no longer reach.
   */
  const canEdit: boolean =
    isEditable && !isLoading && schemaList.length > 0 && Boolean(model);

  /*
   * Custom field values live on the record itself, so editing them is an
   * update of that record. Without the permission the button stays put and
   * explains itself instead of disappearing.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new props.modelType(),
    ModelAction.Update,
  );

  const showEditButton: boolean =
    canEdit && (updateGate.isAllowed || Boolean(updateGate.disabledReason));

  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={
        showEditButton
          ? [
              {
                title: "Edit Fields",
                buttonStyle: ButtonStyleType.NORMAL,
                disabled: !updateGate.isAllowed,
                tooltip: updateGate.disabledReason,
                onClick: () => {
                  if (!updateGate.isAllowed) {
                    return;
                  }

                  setShowModelForm(true);
                },
                icon: IconProp.Edit,
              },
            ]
          : []
      }
    >
      <div className="border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2">
        {isLoading && !loadError && <ComponentLoader />}
        {!isLoading && !loadError && schemaList.length === 0 && (
          <ErrorMessage message="No custom fields have been added for this resource. You may add custom fields in Project Settings." />
        )}
        {loadError && <ErrorMessage message={loadError} />}
        {/*
         * Above the values, which are still the ones on the record: the save
         * did not happen, so what is on screen below is what is stored.
         */}
        {saveError && <ErrorMessage message={saveError} />}
        {/*
         * Only once the fetch has settled: model is null on the very first
         * render too, and announcing "Item not found" while the request is
         * still in flight reads as a broken record rather than a pending one.
         */}
        {!isLoading && !loadError && schemaList.length > 0 && !model && (
          <ErrorMessage message={"Item not found"} />
        )}

        {!isLoading && !loadError && schemaList.length > 0 && model && (
          <Detail
            id={props.name}
            item={(model as any)["customFields"] || {}}
            fields={schemaList.map((schemaItem: BaseModel) => {
              const isDropdown: boolean =
                (schemaItem as any).customFieldType ===
                  CustomFieldType.Dropdown ||
                (schemaItem as any).customFieldType ===
                  CustomFieldType.MultiSelectDropdown;
              return {
                key: (schemaItem as any).name,
                title: (schemaItem as any).name,
                description: (schemaItem as any).description,
                fieldType: (schemaItem as any).customFieldType,
                placeholder: "No data entered",
                dropdownOptions: isDropdown
                  ? parseDropdownOptions((schemaItem as any).dropdownOptions)
                  : undefined,
              };
            })}
            showDetailsInNumberOfColumns={1}
          />
        )}

        {showModelForm && (
          <BasicFormModal
            title={"Edit " + new props.modelType().singularName}
            onClose={() => {
              return setShowModelForm(false);
            }}
            onSubmit={async (data: JSONObject) => {
              await onSave(data).catch();
            }}
            formProps={{
              initialValues: (model as any)?.["customFields"] || {},
              fields: schemaList.map((schemaItem: BaseModel) => {
                const isDropdown: boolean =
                  (schemaItem as any).customFieldType ===
                    CustomFieldType.Dropdown ||
                  (schemaItem as any).customFieldType ===
                    CustomFieldType.MultiSelectDropdown;
                return {
                  field: {
                    [(schemaItem as any).name]: true,
                  },
                  title: (schemaItem as any).name,
                  description: (schemaItem as any).description,
                  fieldType: (schemaItem as any).customFieldType,
                  required: false,
                  placeholder: "",
                  dropdownOptions: isDropdown
                    ? parseDropdownOptions((schemaItem as any).dropdownOptions)
                    : undefined,
                };
              }),
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default CustomFieldsDetail;

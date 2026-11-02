import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
  PermissionGateOptions,
} from "../../Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "../../Utils/PrivateRecordScope";
import Button, { ButtonStyleType } from "../Button/Button";
import Card, { CardButtonSchema, CardHeaderLayout } from "../Card/Card";
import { useIsCardSection } from "../Card/CardSurface";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Detail from "../Detail/Detail";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import BasicFormModal from "../FormModal/BasicFormModal";
import IsolatedText from "../IsolatedText/IsolatedText";
import {
  CARD_MODEL_DETAIL_BODY_CLASS_NAME,
  CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME,
} from "../ModelDetail/CardModelDetail";
import {
  TABLE_RETRY_BUTTON_TEST_ID,
  TRY_AGAIN,
} from "../Table/TableEmptyStateBuilders";
import {
  buildCustomFieldFormFields,
  CustomFieldFormDefinition,
  fromCustomFieldFileFormValue,
  getCustomFieldDetailContentClassName,
  getCustomFieldDisplayValue,
  getCustomFieldDropdownOptions,
  sortCustomFieldDefinitions,
  toCustomFieldFileFormValue,
  toCustomFieldFormDefinition,
} from "./CustomFieldFormFields";
import CustomFieldFileList from "./CustomFieldFileList";
import { APP_API_URL } from "../../Config";
import Navigation from "../../Utils/Navigation";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import {
  CustomFieldFile,
  isCustomFieldFileType,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import { getCustomFieldFileDownloadPath } from "../../../Types/CustomField/CustomFieldRecordKinds";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingRelationSelect,
  getCustomFieldMappingSources,
  hasCustomFieldMappingSource,
} from "../../../Types/CustomField/CustomFieldMappingCatalog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import {
  translateNamedAction,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

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
  /*
   * Card buttons that belong beside "Edit Fields" rather than on a card of
   * their own — the Monitor Template's "Sync Custom Fields to Linked Monitors"
   * being the one that exists. They render after the edit button and are not
   * touched by the gating above: whether a push to other records is offered is
   * the caller's decision, not this card's.
   */
  additionalButtons?: Array<CardButtonSchema> | undefined;
  /*
   * The record's stored bag, handed back after every load — including the
   * reload that follows a save — so a caller whose extra button acts on those
   * values can enable and word it from what is actually stored, rather than
   * re-reading the record behind this card's back and going stale the moment
   * somebody edits it here.
   */
  onValuesLoaded?: ((customFields: JSONObject) => void) | undefined;
  // Handed to the Card; "stacked" suits a narrow column.
  headerLayout?: CardHeaderLayout | undefined;
  /*
   * While the project has no fields of this kind, what the card says, and
   * where they are added - the product's own Settings > Custom Fields - for
   * an Add Custom Fields button under it. Without them the card says, as it
   * always has, that none have been added.
   */
  emptyMessage?: string | undefined;
  addFieldsRoute?: Route | undefined;
}

export const NO_CUSTOM_FIELDS_MESSAGE: string = translationKey(
  "No custom fields have been added for this resource. You may add custom fields in Project Settings.",
);

export const ADD_CUSTOM_FIELDS_BUTTON_TITLE: string =
  translationKey("Add Custom Fields");

/*
 * The fields' box: a detail card's (CardModelDetail's), so a record's
 * Custom Fields card and the detail card above it on an Overview draw their
 * rule and line their fields up alike - a rule across the card under its
 * header, and the fields padded as the card is, their left edge the title's
 * at every width. In a section of a card, no rule and no box of its own.
 *
 * It used to pull itself out by 24px on every side whatever the card's
 * padding, and pad its fields 16px: on a phone, where a card is padded
 * 20px, the rule ran 4px past the card's edges and the fields sat 8px left
 * of the title (seen on a security case's Overview, #5577).
 */
export const getCustomFieldsDetailBodyClassName: (
  isCardSection: boolean,
) => string = (isCardSection: boolean): string => {
  return isCardSection
    ? CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME
    : CARD_MODEL_DETAIL_BODY_CLASS_NAME;
};

const CustomFieldsDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isCardSection: boolean = useIsCardSection();
  /*
   * On a private incident, alert or episode's page, what the reader holds
   * on it: its custom fields are changed only by a team of theirs that owns
   * it (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(new props.modelType());
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

  /*
   * Which related resources this resource's custom fields may inherit from.
   * Empty for most of them, in which case everything below behaves exactly as
   * it did before mapping existed.
   */
  const mappingSources: Array<CustomFieldMappingSourceInfo> =
    getCustomFieldMappingSources(new props.customFieldType().tableName!);

  /*
   * Only incident fields have an order today. The column is asked for only
   * where the definition model has it: this card issues one select for
   * whichever definition model it is handed, and a column missing from the
   * model would fail that read for every other resource.
   */
  const hasSortOrder: boolean = new props.customFieldType().hasColumn(
    "sortOrder",
  );

  /*
   * A mapped field is a derived value, so it is shown rather than edited — but
   * only on records that actually have a source to derive it from. On a record
   * with none, the mapping can never fill it in and there is no reason to take
   * the field away from the operator.
   */
  type IsMappedAndInheritedFunction = (schemaItem: BaseModel) => boolean;

  const isMappedAndInherited: IsMappedAndInheritedFunction = (
    schemaItem: BaseModel,
  ): boolean => {
    const resource: string | undefined = (schemaItem as any)
      .mapFromResourceType;
    const fieldName: string | undefined = (schemaItem as any)
      .mapFromCustomFieldName;

    if (!resource || !fieldName) {
      return false;
    }

    const source: CustomFieldMappingSourceInfo | undefined =
      mappingSources.find((candidate: CustomFieldMappingSourceInfo) => {
        return candidate.resource === resource;
      });

    if (!source) {
      return false;
    }

    return hasCustomFieldMappingSource({
      source: source,
      record: model as unknown as Record<string, unknown>,
    });
  };

  type GetMappedDescriptionFunction = (
    schemaItem: BaseModel,
  ) => string | undefined;

  const getMappedDescription: GetMappedDescriptionFunction = (
    schemaItem: BaseModel,
  ): string | undefined => {
    const description: string | undefined = (schemaItem as any).description;

    if (!isMappedAndInherited(schemaItem)) {
      return description;
    }

    const source: CustomFieldMappingSourceInfo | undefined =
      mappingSources.find((candidate: CustomFieldMappingSourceInfo) => {
        return candidate.resource === (schemaItem as any).mapFromResourceType;
      });

    const note: string = `Copied from the ${source?.title} custom field "${
      (schemaItem as any).mapFromCustomFieldName
    }".`;

    return description ? `${description} ${note}` : note;
  };

  /*
   * What a field's row says under its name. A description someone wrote is
   * read the way it is written (IsolatedText): an English one on a Persian
   * page put its full stop at its start. A copied field's line is the
   * card's own sentence around their words, and stays as it is.
   */
  const getFieldDescription: (
    schemaItem: BaseModel,
  ) => string | ReactElement = (
    schemaItem: BaseModel,
  ): string | ReactElement => {
    const description: string | undefined = getMappedDescription(schemaItem);

    // None: an empty line, which the row leaves out.
    if (!description) {
      return "";
    }

    if (isMappedAndInherited(schemaItem)) {
      return description;
    }

    return <IsolatedText text={description} />;
  };

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
            mapFromResourceType: true,
            mapFromCustomFieldName: true,
            ...(hasSortOrder ? { sortOrder: true } : {}),
          } as any,
          sort: (hasSortOrder ? { sortOrder: SortOrder.Ascending } : {}) as any,
        });

      /*
       * The relation a mapped field would inherit through is read alongside
       * the values, so the card can tell "this field is mapped and this record
       * has a monitor" (show it, read-only) from "this field is mapped but
       * this record has none" (leave it editable — an SLO or security-event
       * alert has no monitor and would otherwise be locked out of the field
       * entirely). Nothing extra is selected for the six resources that have
       * no mapping sources at all.
       */
      const itemSelect: JSONObject = {
        customFields: true,
      };

      for (const source of mappingSources) {
        Object.assign(itemSelect, getCustomFieldMappingRelationSelect(source));
      }

      const item: BaseModel | null = await ModelAPI.getItem<BaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: itemSelect as any,
      });

      /*
       * Sorted here as well as by the query: the order has to hold for fields
       * with no order too (last, in the order the server listed them).
       */
      setSchemaList(
        hasSortOrder
          ? sortCustomFieldDefinitions(
              schemaList.data as Array<
                BaseModel & { sortOrder?: number | null | undefined }
              >,
            )
          : schemaList.data,
      );
      setModel(item);

      if (props.onValuesLoaded) {
        props.onValuesLoaded(
          ((item as any)?.["customFields"] as JSONObject) || {},
        );
      }

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

      /*
       * A file field's picker holds File models; each file goes as the file
       * it names, and the server reads the rest from the file itself.
       */
      const customFields: JSONObject = { ...data };

      for (const schemaItem of schemaList) {
        const name: unknown = (schemaItem as any).name;
        const type: CustomFieldType | undefined = (schemaItem as any)
          .customFieldType;

        if (
          typeof name === "string" &&
          isCustomFieldFileType(type) &&
          Object.prototype.hasOwnProperty.call(customFields, name)
        ) {
          customFields[name] = fromCustomFieldFileFormValue({
            customFieldType: type,
            value: customFields[name],
          }) as JSONObject[string];
        }
      }

      await ModelAPI.updateById({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          customFields: customFields,
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
  /*
   * A field whose value is copied from a related resource is not one the
   * modal offers, so a card where EVERY field is mapped has nothing to edit
   * and the button would open an empty form.
   */
  const editableSchemaCount: number = schemaList.filter(
    (schemaItem: BaseModel) => {
      return !isMappedAndInherited(schemaItem);
    },
  ).length;

  const canEdit: boolean =
    isEditable && !isLoading && editableSchemaCount > 0 && Boolean(model);

  /*
   * Custom field values live on the record itself, so editing them is an
   * update of that record. Without the permission the button stays put and
   * explains itself instead of disappearing.
   */
  const updateGate: PermissionGateResult = PermissionGate.check(
    new props.modelType(),
    ModelAction.Update,
    privateRecordOptions,
  );

  const showEditButton: boolean =
    canEdit && (updateGate.isAllowed || Boolean(updateGate.disabledReason));

  const cardButtons: Array<CardButtonSchema> = [
    ...(showEditButton
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
          } as CardButtonSchema,
        ]
      : []),
    ...(props.additionalButtons || []),
  ];

  /*
   * The stored values as the card draws them and the edit form starts from
   * them: a text field's number or yes/no as text
   * (getCustomFieldDisplayValue). The Markdown viewer draws nothing for a
   * value that is not a string, and the Rich text editor fails on one, so a
   * field switched from Number to Rich text could be neither seen nor
   * edited. Every other value, and every key no field has, is as stored.
   */
  const getDisplayValues: () => JSONObject = (): JSONObject => {
    const stored: JSONObject = ((model as any)?.["customFields"] ||
      {}) as JSONObject;
    const displayed: JSONObject = { ...stored };

    for (const schemaItem of schemaList) {
      const name: unknown = (schemaItem as any).name;

      if (
        typeof name === "string" &&
        Object.prototype.hasOwnProperty.call(stored, name)
      ) {
        displayed[name] = (
          isCustomFieldFileType((schemaItem as any).customFieldType)
            ? toCustomFieldFileFormValue({
                customFieldType: (schemaItem as any).customFieldType,
                value: stored[name],
              })
            : getCustomFieldDisplayValue({
                customFieldType: (schemaItem as any).customFieldType,
                value: stored[name],
              })
        ) as JSONObject[string];
      }
    }

    return displayed;
  };

  /*
   * Where one of the record's files downloads from: the route that serves it
   * to people who may read the record, as a download.
   */
  const getFileDownloadUrl: (file: CustomFieldFile) => string | null = (
    file: CustomFieldFile,
  ): string | null => {
    const path: string | null = getCustomFieldFileDownloadPath({
      recordTableName: new props.modelType().tableName,
      projectId: props.projectId,
      recordId: props.modelId,
      fileId: file.fileId,
    });

    return path ? URL.fromURL(APP_API_URL).addRoute(path).toString() : null;
  };

  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={cardButtons}
      headerLayout={props.headerLayout}
    >
      <div
        className={getCustomFieldsDetailBodyClassName(isCardSection)}
        data-testid="custom-fields-detail-body"
      >
        {isLoading && !loadError && <ComponentLoader />}
        {!isLoading && !loadError && schemaList.length === 0 && (
          <ErrorMessage
            message={props.emptyMessage || NO_CUSTOM_FIELDS_MESSAGE}
            action={
              props.addFieldsRoute ? (
                <Button
                  title={ADD_CUSTOM_FIELDS_BUTTON_TITLE}
                  buttonStyle={ButtonStyleType.NORMAL}
                  icon={IconProp.Add}
                  dataTestId="custom-fields-add-fields"
                  onClick={() => {
                    if (props.addFieldsRoute) {
                      Navigation.navigate(props.addFieldsRoute);
                    }
                  }}
                />
              ) : undefined
            }
          />
        )}
        {/*
         * A read that failed may work again: Try again reads the fields and
         * the record again, as a list's failed read offers it.
         */}
        {loadError && (
          <ErrorMessage
            message={loadError}
            action={
              <Button
                title={TRY_AGAIN}
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.Refresh}
                dataTestId={TABLE_RETRY_BUTTON_TEST_ID}
                onClick={() => {
                  void onLoad();
                }}
              />
            }
          />
        )}
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
            /*
             * The values of the record's custom fields, keyed by the names
             * people gave them: one called "createdAt" is theirs to read as
             * that, not the record's own creation time for the ID line.
             */
            showRecordLine={false}
            item={getDisplayValues()}
            fields={schemaList.map((schemaItem: BaseModel) => {
              const isDropdown: boolean =
                (schemaItem as any).customFieldType ===
                  CustomFieldType.Dropdown ||
                (schemaItem as any).customFieldType ===
                  CustomFieldType.MultiSelectDropdown;
              const isFile: boolean = isCustomFieldFileType(
                (schemaItem as any).customFieldType,
              );

              return {
                key: (schemaItem as any).name,
                title: (schemaItem as any).name,
                description: getFieldDescription(schemaItem),
                fieldType: (schemaItem as any).customFieldType,
                /*
                 * A file field shows its files, each a download for whoever
                 * may read the record.
                 */
                getElement: isFile
                  ? (): ReactElement => {
                      return (
                        <CustomFieldFileList
                          files={readCustomFieldFiles(
                            (
                              ((model as any)?.["customFields"] ||
                                {}) as JSONObject
                            )[(schemaItem as any).name],
                          )}
                          getDownloadUrl={getFileDownloadUrl}
                          emptyText="No data entered"
                          dataTestId={`custom-field-files-${(schemaItem as any).name}`}
                        />
                      );
                    }
                  : undefined,
                contentClassName: getCustomFieldDetailContentClassName(
                  (schemaItem as any).customFieldType,
                ),
                placeholder: "No data entered",
                /*
                 * The record's own value too, should the field no longer
                 * offer it: shown as itself, marked, not as empty.
                 */
                dropdownOptions: isDropdown
                  ? getCustomFieldDropdownOptions(
                      (schemaItem as any).dropdownOptions,
                      (((model as any)?.["customFields"] || {}) as JSONObject)[
                        (schemaItem as any).name
                      ],
                    )
                  : undefined,
              };
            })}
            showDetailsInNumberOfColumns={1}
          />
        )}

        {showModelForm && (
          <BasicFormModal
            title={translateNamedAction(translator, {
              template: "Edit {{itemName}}",
              itemName: new props.modelType().singularName || "",
            })}
            onClose={() => {
              return setShowModelForm(false);
            }}
            onSubmit={async (data: JSONObject) => {
              await onSave(data).catch();
            }}
            formProps={{
              initialValues: getDisplayValues(),
              /*
               * Mapped fields are left OUT of the form rather than rendered
               * disabled: `Field.disabled` is honoured by only three of the
               * form's input branches, so a disabled Dropdown, multi-select or
               * toggle stays fully editable and the value would silently snap
               * back on the next sync. Their stored values still survive the
               * save — this form submits its whole values object, which starts
               * from the record's existing bag — and the server re-applies the
               * mapping on update either way.
               */
              /*
               * Every field optional, "Required on create" included: that
               * applies when an incident is declared, and fixing one field on
               * an incident a monitor opened mid-outage must not demand all
               * the others first.
               */
              fields: buildCustomFieldFormFields({
                definitions: schemaList
                  .filter((schemaItem: BaseModel) => {
                    return !isMappedAndInherited(schemaItem);
                  })
                  .map((schemaItem: BaseModel) => {
                    return toCustomFieldFormDefinition(schemaItem);
                  })
                  .filter(
                    (
                      definition: CustomFieldFormDefinition | null,
                    ): definition is CustomFieldFormDefinition => {
                      return definition !== null;
                    },
                  ),
                enforceRequiredOnCreate: false,
                /*
                 * A value the field no longer offers stays chosen, and is
                 * saved back as it is unless someone picks another.
                 */
                values: getDisplayValues(),
              }),
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default CustomFieldsDetail;

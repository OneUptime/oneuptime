import PageComponentProps from "../../PageComponentProps";
import {
  CustomFieldDefinitionModel,
  getCustomFieldDefinitionColumns,
  getCustomFieldDefinitionFilters,
} from "../../../Components/CustomFields/CustomFieldDefinitionTable";
import {
  CUSTOM_FIELDS_DESCRIPTION,
  CUSTOM_FIELDS_REORDER_DESCRIPTION,
  CustomFieldFormCopy,
  CustomFieldTypeOption,
  getCustomFieldTypeOptions,
  IncidentCustomFieldSettingsCopy,
} from "../../../Components/CustomFields/CustomFieldSettingsCopy";
import CustomFieldTemplateVariable from "../../../Components/CustomFields/CustomFieldTemplateVariable";
import CreateMappedCustomFieldModal from "../../../Components/CustomFields/CreateMappedCustomFieldModal";
import {
  getMappedCustomFieldMenuTitle,
  getMappedCustomFieldSourceCopy,
  getMappingSourceDefinitionModel,
} from "../../../Components/CustomFields/MappedCustomField";
import { ListOrderSettings } from "Common/Types/Database/ListOrderColumn";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingSource,
  getCustomFieldMappingSources,
} from "Common/Types/CustomField/CustomFieldMappingCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import MapFromCustomFieldInput from "Common/UI/Components/CustomFields/MapFromCustomFieldInput";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { Fragment, ReactElement, useState } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const isDropdownType: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value === CustomFieldType.Dropdown ||
    value === CustomFieldType.MultiSelectDropdown
  );
};

// The nine custom field definition models, one per resource.
export type CustomFieldsBaseModels = CustomFieldDefinitionModel;

const MAP_FROM_NONE_VALUE: string = "";

/*
 * The form value the template variable line is drawn under. It holds
 * nothing: the line reads the key itself (CustomFieldTemplateVariable), and
 * the field is form-only, so nothing of it is ever sent.
 */
export const TEMPLATE_VARIABLE_FORM_KEY: string = "templateVariable";

/*
 * The rules are deliberately conservative, and none of them are guessable from
 * the form — particularly "clearing the source does not clear the copies",
 * which is the price of never destroying a value an operator typed in.
 */
type BuildMappingHelpFunction = (
  sources: Array<CustomFieldMappingSourceInfo>,
) => string;

const buildMappingHelp: BuildMappingHelpFunction = (
  sources: Array<CustomFieldMappingSourceInfo>,
): string => {
  const sourceNames: string = sources
    .map((source: CustomFieldMappingSourceInfo) => {
      return source.title;
    })
    .join(", ");

  const hasManySources: boolean = sources.some(
    (source: CustomFieldMappingSourceInfo) => {
      return source.isManySources;
    },
  );

  return `## Copying a value from a related resource

Instead of typing the same value on every record, a custom field can copy it
from the matching field on a related resource — today that is: ${sourceNames}.

**Creating one**

Choose **${CustomFieldFormCopy.createMappedFieldTitle}** in the card's More (…)
menu, and pick the field to copy. The new field takes that field's type and,
for a dropdown, its options. A field you create with **Create** is typed in by
hand; its **Edit** form can map it later, under **More fields**.

**When it is copied**

- When a record is created.
- Whenever the value on the source changes.
- When a record is pointed at a different source.
- When you first configure the mapping, existing records are filled in too.

**What it never does**

Copying only ever *writes a value that exists on the source*. It has no way to
clear a field. So:

- A record with no ${sourceNames.toLowerCase()} keeps whatever was typed on it,
  and stays editable.
- If the source has no value for the field, the record keeps what it already
  has. **Clearing the source does not clear the copies.**
- Turning a mapping off leaves the values that were already copied in place,
  and makes the field editable again.

**Which field you can copy from**

Only a field of the same type, and — for dropdowns — only one whose options are
all offered here too. Otherwise a copied value could not be selected or
filtered for on this resource.
${
  hasManySources
    ? `
**When several sources are attached**

A record can be attached to more than one source. If they all hold the same
value, that value is copied. If they disagree, a single-value field is left
alone rather than picking one arbitrarily; a multi-select field gets all of
their values.
`
    : ""
}`;
};

export interface ComponentProps<CustomFieldsBaseModels>
  extends PageComponentProps {
  title: string;
  modelType: { new (): CustomFieldsBaseModels };
}

const CustomFieldsPageBase: (
  props: ComponentProps<CustomFieldsBaseModels>,
) => ReactElement = (
  props: ComponentProps<CustomFieldsBaseModels>,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const definitionModel: CustomFieldsBaseModels = new props.modelType();

  const definitionTableName: string = definitionModel.tableName!;

  // The source a new mapped field is being created from, while its dialog is open.
  const [mappedFieldSource, setMappedFieldSource] =
    useState<CustomFieldMappingSourceInfo | null>(null);

  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  /*
   * What a field is - its name, its description and its type - is all the
   * Create form asks. The rest of what a field can have is folded under one
   * Advanced section, built once so every field in it is the same section:
   * closed on Create and on Edit alike, saying "Configured" on its header
   * when something in it is set.
   */
  const advancedSection: FormFieldCollapsibleSection<CustomFieldsBaseModels> =
    getAdvancedFormSection<CustomFieldsBaseModels>();

  /*
   * Empty for the six resources with nothing to inherit from — Team, Status
   * Page and the rest have no relation carrying custom fields — and the
   * mapping is simply not offered for them. The COLUMNS exist on all nine
   * definition tables regardless, in lockstep with their siblings, because
   * CustomFieldsDetail issues one shared select for whatever definition
   * model it is handed and a column missing from one model would fail that
   * select for every resource.
   */
  const mappingSources: Array<CustomFieldMappingSourceInfo> =
    getCustomFieldMappingSources(definitionTableName).filter(
      (source: CustomFieldMappingSourceInfo) => {
        return Boolean(getMappingSourceDefinitionModel(source));
      },
    );

  const canMapValues: boolean = mappingSources.length > 0;

  /*
   * Where a field's values come from, on its Edit form only. "When I create
   * a new custom field By default, it should be 'Enter values by hand' ...
   * you shouldn't even show that dropdown": a new field is typed in, and a
   * field that copies its value is made from the card's More menu
   * (CreateMappedCustomFieldModal). An existing field can still be mapped,
   * re-pointed or turned back into one typed by hand here, under Advanced.
   */
  const mappingFormFields: Array<ModelField<CustomFieldsBaseModels>> =
    canMapValues
      ? [
          {
            field: {
              mapFromResourceType: true,
            },
            title: CustomFieldFormCopy.mapValueFromTitle,
            description: CustomFieldFormCopy.mapValueFromDescription,
            fieldType: FormFieldSchemaType.Dropdown,
            required: false,
            doNotShowWhenCreating: true,
            collapsibleSection: advancedSection,
            placeholder: CustomFieldFormCopy.mapValueByHand,
            dropdownOptions: [
              {
                label: CustomFieldFormCopy.mapValueByHand,
                value: MAP_FROM_NONE_VALUE,
              },
              ...mappingSources.map((source: CustomFieldMappingSourceInfo) => {
                return {
                  label:
                    getMappedCustomFieldSourceCopy(source).mapValueFromOption,
                  value: source.resource as string,
                };
              }),
            ],
          },
          {
            field: {
              mapFromCustomFieldName: true,
            },
            title: CustomFieldFormCopy.fieldToCopyFromTitle,
            description: CustomFieldFormCopy.fieldToCopyFromDescription,
            fieldType: FormFieldSchemaType.CustomComponent,
            doNotShowWhenCreating: true,
            collapsibleSection: advancedSection,
            required: (item: FormValues<CustomFieldsBaseModels>) => {
              return Boolean((item as any).mapFromResourceType);
            },
            showIf: (item: FormValues<CustomFieldsBaseModels>) => {
              return Boolean((item as any).mapFromResourceType);
            },
            getCustomElement: (
              values: FormValues<CustomFieldsBaseModels>,
              customElementProps: CustomElementProps,
            ) => {
              const source: CustomFieldMappingSourceInfo | undefined =
                getCustomFieldMappingSource({
                  definitionTableName: definitionTableName,
                  resource: (values as any).mapFromResourceType,
                });

              const sourceDefinitionModelType:
                | DatabaseBaseModelType
                | undefined = source
                ? getMappingSourceDefinitionModel(source)
                : undefined;

              if (!source || !sourceDefinitionModelType) {
                return <></>;
              }

              return (
                <MapFromCustomFieldInput
                  projectId={ProjectUtil.getCurrentProjectId()!}
                  sourceDefinitionModelType={sourceDefinitionModelType}
                  sourceTitle={source.title}
                  targetFieldType={
                    (values as any).customFieldType as
                      | CustomFieldType
                      | undefined
                  }
                  initialValue={
                    typeof customElementProps.initialValue === "string"
                      ? customElementProps.initialValue
                      : ""
                  }
                  error={customElementProps.error}
                  tabIndex={customElementProps.tabIndex}
                  ariaLabelledby={customElementProps.ariaLabelledby}
                  onChange={(value: string) => {
                    if (customElementProps.onChange) {
                      customElementProps.onChange(value);
                    }
                  }}
                  onBlur={() => {
                    if (customElementProps.onBlur) {
                      customElementProps.onBlur();
                    }
                  }}
                />
              );
            },
          },
        ]
      : [];

  /*
   * Where a field sits among the others is not typed in: the rows are
   * dragged into order, and a new field goes to the end (the model's
   * @ListOrderColumn keeps the numbers). Only a definition model whose order
   * means something has one - today IncidentCustomField, whose order is the
   * order the incident page, the Details step of declaring an incident and
   * subscriber messages list its fields in.
   */
  const listOrder: ListOrderSettings | null = definitionModel.getListOrder();

  /*
   * The settings only incident fields have: whether a field is asked for
   * (and required) when an incident is declared, and whether it goes out in
   * subscriber emails. Offered for any definition model that has the
   * columns - today only IncidentCustomField - rather than by name, because
   * the form would fail for a model without them. Under Advanced: "options
   * like 'Show on create' and stuff ... should be hidden in the advanced
   * section".
   */
  const hasIncidentFieldSettings: boolean =
    definitionModel.hasColumn("showOnCreate") &&
    definitionModel.hasColumn("isRequiredOnCreate") &&
    definitionModel.hasColumn("includeInSubscriberNotifications");

  const incidentSettingsFormFields: Array<ModelField<CustomFieldsBaseModels>> =
    hasIncidentFieldSettings
      ? [
          {
            field: {
              showOnCreate: true,
            } as any,
            title: IncidentCustomFieldSettingsCopy.showOnCreateTitle,
            description:
              IncidentCustomFieldSettingsCopy.showOnCreateDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: advancedSection,
          },
          {
            field: {
              isRequiredOnCreate: true,
            } as any,
            title: IncidentCustomFieldSettingsCopy.isRequiredOnCreateTitle,
            description:
              IncidentCustomFieldSettingsCopy.isRequiredOnCreateDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: advancedSection,
            /*
             * Required only means something for a field that is asked for.
             * Hidden rather than cleared: turning Show on Create back on
             * brings the setting back as it was.
             */
            showIf: (item: FormValues<CustomFieldsBaseModels>) => {
              return Boolean((item as any).showOnCreate);
            },
          },
          {
            field: {
              includeInSubscriberNotifications: true,
            } as any,
            title:
              IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsTitle,
            description:
              IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            collapsibleSection: advancedSection,
          },
        ]
      : [];

  /*
   * An incident field's template variable, read only, at the bottom of
   * Advanced on Edit: the settings table no longer has a column for it. A
   * form-only field checked against the variableKey column, which nobody may
   * write - so nothing of it is selected, held or sent.
   */
  const templateVariableFormFields: Array<ModelField<CustomFieldsBaseModels>> =
    definitionModel.hasColumn("variableKey")
      ? [
          {
            overrideField: {
              variableKey: true,
            },
            overrideFieldKey: TEMPLATE_VARIABLE_FORM_KEY,
            formOnly: true,
            showEvenIfPermissionDoesNotExist: true,
            doNotShowWhenCreating: true,
            title: CustomFieldFormCopy.templateVariableTitle,
            description: CustomFieldFormCopy.templateVariableDescription,
            fieldType: FormFieldSchemaType.CustomComponent,
            required: false,
            hideOptionalLabel: true,
            collapsibleSection: advancedSection,
            getCustomElement: (
              values: FormValues<CustomFieldsBaseModels>,
            ): ReactElement => {
              return (
                <CustomFieldTemplateVariable
                  modelType={props.modelType}
                  modelId={(values as any)._id}
                />
              );
            },
          },
        ]
      : [];

  /*
   * "In the more options, there should be an option to create a mapped
   * custom field." One item per resource the fields can copy from - today
   * the monitor - in the card's More menu, not beside Create: an outline
   * button, never NORMAL or PRIMARY, because the table picks its main button
   * by style (as Create OAuth 2.0 Variable does on the workflow variables
   * card). Locked, with the reason, for someone who may not create fields.
   */
  const mappedFieldButtons: Array<CardButtonSchema> = mappingSources
    .map((source: CustomFieldMappingSourceInfo): CardButtonSchema | null => {
      const title: string = getMappedCustomFieldMenuTitle({
        source: source,
        sourceCount: mappingSources.length,
      });

      const tooltip: string =
        getMappedCustomFieldSourceCopy(source).menuTooltip;

      return PermissionGate.gateCardButton(
        {
          // The More menu shows a card button's text as it is given.
          title: translateString(title) ?? title,
          tooltip: translateString(tooltip) ?? tooltip,
          buttonStyle: ButtonStyleType.OUTLINE,
          buttonSize: ButtonSize.Small,
          icon: IconProp.Link,
          onClick: () => {
            setMappedFieldSource(source);
          },
        },
        definitionModel,
        ModelAction.Create,
      );
    })
    .filter((button: CardButtonSchema | null): button is CardButtonSchema => {
      return Boolean(button);
    });

  const formFields: Array<ModelField<CustomFieldsBaseModels>> = [
    {
      field: {
        name: true,
      },
      title: "Field Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "internal-service",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        description: true,
      },
      title: "Field Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "This label is for all the internal services.",
    },
    {
      field: {
        customFieldType: true,
      },
      title: "Field Type",
      description: CustomFieldFormCopy.fieldTypeDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      placeholder: "Please select field type.",
      dropdownOptions: getCustomFieldTypeOptions().map(
        (option: CustomFieldTypeOption) => {
          return {
            label: option.label,
            value: option.value,
          };
        },
      ),
    },
    {
      field: {
        dropdownOptions: true,
      },
      title: "Dropdown Options",
      description: CustomFieldFormCopy.dropdownOptionsDescription,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: (item: FormValues<CustomFieldsBaseModels>) => {
        return isDropdownType((item as any).customFieldType);
      },
      showIf: (item: FormValues<CustomFieldsBaseModels>) => {
        return isDropdownType((item as any).customFieldType);
      },
      getCustomElement: (
        _values: FormValues<CustomFieldsBaseModels>,
        customElementProps: CustomElementProps,
      ) => {
        return (
          <DropdownOptionsInput
            initialValue={
              typeof customElementProps.initialValue === "string"
                ? customElementProps.initialValue
                : ""
            }
            error={customElementProps.error}
            onChange={(value: string) => {
              if (customElementProps.onChange) {
                customElementProps.onChange(value);
              }
            }}
            onBlur={() => {
              if (customElementProps.onBlur) {
                customElementProps.onBlur();
              }
            }}
          />
        );
      },
    },
    // Advanced, in this order: where the value comes from, then the rest.
    ...mappingFormFields,
    ...incidentSettingsFormFields,
    ...templateVariableFormFields,
  ];

  return (
    <Fragment>
      <ModelTable<CustomFieldsBaseModels>
        modelType={props.modelType}
        {...(listOrder
          ? {
              // Listed, and dragged, in the order the fields appear.
              enableDragAndDrop: true,
              dragDropIndexField: listOrder.column as any,
              sortBy: listOrder.column as any,
              sortOrder: listOrder.sortOrder,
            }
          : {})}
        userPreferencesKey="custom-fields-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        id="custom-fields-table"
        name={"Settings > " + props.title}
        saveFilterProps={{
          tableId: "settings-custom-fields-" + props.modelType.name + "-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        refreshToggle={refreshToggle.toString()}
        cardProps={{
          title: props.title,
          description: listOrder
            ? CUSTOM_FIELDS_REORDER_DESCRIPTION
            : CUSTOM_FIELDS_DESCRIPTION,
          buttons: mappedFieldButtons,
        }}
        noItemsMessage={"No custom fields found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        {...(canMapValues
          ? {
              helpContent: {
                title: "Copying custom field values from a related resource",
                description:
                  "When and how a field's value is copied, and what copying will never do.",
                markdown: buildMappingHelp(mappingSources),
              },
            }
          : {})}
        /*
         * One page, no steps: the name, the description and the type - and
         * a dropdown's options, under a dropdown type - with the rest folded
         * under Advanced. Tests/UI/Components/Forms/LongFormStepsGuard lists
         * the form, with why it is not stepped.
         */
        formFields={formFields}
        showRefreshButton={true}
        /*
         * A field's name and type, and that is all: the rest is on the
         * field's form (CustomFieldDefinitionTable says where everything
         * that used to be a column went).
         */
        filters={getCustomFieldDefinitionFilters()}
        columns={getCustomFieldDefinitionColumns()}
      />

      {mappedFieldSource && (
        <CreateMappedCustomFieldModal
          modelType={props.modelType}
          source={mappedFieldSource}
          onClose={() => {
            setMappedFieldSource(null);
          }}
          onSuccess={() => {
            setMappedFieldSource(null);
            setRefreshToggle((toggle: boolean) => {
              return !toggle;
            });
          }}
        />
      )}
    </Fragment>
  );
};

export default CustomFieldsPageBase;

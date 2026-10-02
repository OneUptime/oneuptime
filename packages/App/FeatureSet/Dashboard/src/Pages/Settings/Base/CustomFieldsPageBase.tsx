import PageComponentProps from "../../PageComponentProps";
import {
  CustomFieldDefinitionModel,
  getCustomFieldDefinitionColumns,
  getCustomFieldDefinitionFilters,
} from "../../../Components/CustomFields/CustomFieldDefinitionTable";
import {
  CUSTOM_FIELDS_DESCRIPTION,
  CUSTOM_FIELDS_REORDER_DESCRIPTION,
  CustomFieldTypeOption,
  getCustomFieldTypeOptions,
  IncidentCustomFieldSettingsCopy,
} from "../../../Components/CustomFields/CustomFieldSettingsCopy";
import { ListOrderSettings } from "Common/Types/Database/ListOrderColumn";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingSource,
  getCustomFieldMappingSources,
} from "Common/Types/CustomField/CustomFieldMappingCatalog";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import MapFromCustomFieldInput from "Common/UI/Components/CustomFields/MapFromCustomFieldInput";
import Field, {
  CustomElementProps,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Navigation from "Common/UI/Utils/Navigation";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import React, { Fragment, ReactElement } from "react";
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

/*
 * The definition table a mapping source's fields are listed in, resolved from
 * the catalog's table NAME to the model class the picker needs to query. The
 * catalog lives in Types (no React, no model imports) so both the server and
 * this page can read it; this is the one place that has to bridge back.
 */
const SOURCE_DEFINITION_MODELS: Record<string, DatabaseBaseModelType> = {
  MonitorCustomField: MonitorCustomField,
};

const MAP_FROM_NONE_VALUE: string = "";

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
  const definitionTableName: string = new props.modelType().tableName!;

  /*
   * Empty for the six resources with nothing to inherit from — Team, Status
   * Page and the rest have no relation carrying custom fields — and the
   * mapping form fields are simply not rendered for them. The COLUMNS exist
   * on all nine definition tables regardless, in lockstep with their
   * siblings, because CustomFieldsDetail issues one shared select for
   * whatever definition model it is handed and a column missing from one
   * model would fail that select for every resource.
   */
  const mappingSources: Array<CustomFieldMappingSourceInfo> =
    getCustomFieldMappingSources(definitionTableName);

  const canMapValues: boolean = mappingSources.length > 0;

  const mappingFormFields: Array<Field<CustomFieldsBaseModels>> = canMapValues
    ? [
        {
          field: {
            mapFromResourceType: true,
          } as any,
          title: "Map Value From",
          stepId: "value-source",
          description:
            "Copy this field's value from a related resource instead of typing it in on every record. The value is filled in when a record is created and refreshed whenever the source changes.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: false,
          placeholder: "Enter values by hand",
          dropdownOptions: [
            {
              label: "Enter values by hand",
              value: MAP_FROM_NONE_VALUE,
            },
            ...mappingSources.map((source: CustomFieldMappingSourceInfo) => {
              return {
                label: `Copy from the ${source.title}`,
                value: source.resource as string,
              };
            }),
          ],
        },
        {
          field: {
            mapFromCustomFieldName: true,
          } as any,
          title: "Field To Copy From",
          stepId: "value-source",
          description:
            "Only fields of the same type can be copied. Clearing the source does not clear values that were already copied.",
          fieldType: FormFieldSchemaType.CustomComponent,
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

            const sourceDefinitionModelType: DatabaseBaseModelType | undefined =
              source
                ? SOURCE_DEFINITION_MODELS[source.sourceDefinitionTableName]
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
                  (values as any).customFieldType as CustomFieldType | undefined
                }
                initialValue={
                  typeof customElementProps.initialValue === "string"
                    ? customElementProps.initialValue
                    : ""
                }
                error={customElementProps.error}
                tabIndex={customElementProps.tabIndex}
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
   * The settings only incident fields have: whether a field is asked for
   * (and required) when an incident is declared, and whether it goes out in
   * subscriber emails. Offered for any definition model that has the
   * columns - today only IncidentCustomField - rather than by name, because
   * the form would fail for a model without them.
   */
  const definitionModel: CustomFieldsBaseModels = new props.modelType();

  /*
   * Where a field sits among the others is not typed in: the rows are
   * dragged into order, and a new field goes to the end (the model's
   * @ListOrderColumn keeps the numbers). Only a definition model whose order
   * means something has one - today IncidentCustomField, whose order is the
   * order the incident page, the Details step of declaring an incident and
   * subscriber messages list its fields in.
   */
  const listOrder: ListOrderSettings | null = definitionModel.getListOrder();

  const hasIncidentFieldSettings: boolean =
    definitionModel.hasColumn("showOnCreate") &&
    definitionModel.hasColumn("isRequiredOnCreate") &&
    definitionModel.hasColumn("includeInSubscriberNotifications");

  const incidentSettingsFormFields: Array<Field<CustomFieldsBaseModels>> =
    hasIncidentFieldSettings
      ? [
          {
            field: {
              showOnCreate: true,
            } as any,
            title: IncidentCustomFieldSettingsCopy.showOnCreateTitle,
            stepId: "incident-settings",
            description:
              IncidentCustomFieldSettingsCopy.showOnCreateDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              isRequiredOnCreate: true,
            } as any,
            title: IncidentCustomFieldSettingsCopy.isRequiredOnCreateTitle,
            stepId: "incident-settings",
            description:
              IncidentCustomFieldSettingsCopy.isRequiredOnCreateDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
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
            stepId: "incident-settings",
            description:
              IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]
      : [];

  /*
   * What the field is, then what kind of value it holds, then - where the
   * resource has them - where its values come from and how incidents use it.
   * The last two steps exist only on the definitions that have their fields,
   * so a team or status page field is a two-step form.
   */
  const formSteps: Array<FormStep<CustomFieldsBaseModels>> = [
    { title: "Basic Info", id: "basic-info" },
    { title: "Field Type", id: "field-type" },
    ...(mappingFormFields.length > 0
      ? [{ title: "Value Source", id: "value-source" }]
      : []),
    ...(incidentSettingsFormFields.length > 0
      ? [{ title: "Incident Settings", id: "incident-settings" }]
      : []),
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
        cardProps={{
          title: props.title,
          description: listOrder
            ? CUSTOM_FIELDS_REORDER_DESCRIPTION
            : CUSTOM_FIELDS_DESCRIPTION,
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
        formSteps={formSteps}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Field Name",
            stepId: "basic-info",
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
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "This label is for all the internal services.",
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            stepId: "field-type",
            description:
              "Choose how data is entered for this field. Dropdown types also need a list of options below.",
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
            stepId: "field-type",
            description:
              "Add the options that should appear in the dropdown and optionally choose a color for each value.",
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
          ...mappingFormFields,
          ...incidentSettingsFormFields,
        ]}
        showRefreshButton={true}
        /*
         * A field's name and type, and that is all: the rest is on the
         * field's form (CustomFieldDefinitionTable says where everything
         * that used to be a column went).
         */
        filters={getCustomFieldDefinitionFilters()}
        columns={getCustomFieldDefinitionColumns()}
      />
    </Fragment>
  );
};

export default CustomFieldsPageBase;

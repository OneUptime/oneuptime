import PageComponentProps from "../../PageComponentProps";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingSource,
  getCustomFieldMappingSources,
} from "Common/Types/CustomField/CustomFieldMappingCatalog";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import MapFromCustomFieldInput from "Common/UI/Components/CustomFields/MapFromCustomFieldInput";
import {
  CustomElementProps,
  Field,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, { Fragment, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * Typed as a total Record so adding a member to CustomFieldType fails the
 * compile here rather than shipping a picker entry labelled with its own raw
 * enum key.
 */
const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  [CustomFieldType.Text]: "Text",
  [CustomFieldType.Number]: "Number",
  [CustomFieldType.Boolean]: "Boolean",
  [CustomFieldType.Dropdown]: "Dropdown (single select)",
  [CustomFieldType.MultiSelectDropdown]: "Dropdown (multi-select)",
  [CustomFieldType.Date]: "Date",
  [CustomFieldType.DateTime]: "Date and time",
};

const isDropdownType: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value === CustomFieldType.Dropdown ||
    value === CustomFieldType.MultiSelectDropdown
  );
};

export type CustomFieldsBaseModels =
  | AlertCustomField
  | MonitorCustomField
  | StatusPageCustomField
  | IncidentCustomField
  | InventoryItemCustomField
  | ScheduledMaintenanceCustomField
  | OnCallDutyPolicyCustomField
  | TeamCustomField
  | TeamMemberCustomField;

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
   * mapping form fields and column are simply not rendered for them. The
   * COLUMNS exist on all nine definition tables regardless, in lockstep with
   * their siblings, because CustomFieldsDetail issues one shared select for
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
   * A field whose value is copied from somewhere else is not editable on the
   * record, so the settings table is the only place that says where it comes
   * from. Without this column a renamed or deleted source field is invisible
   * until someone notices the values have stopped moving.
   */
  const mappingColumns: Columns<CustomFieldsBaseModels> = canMapValues
    ? [
        {
          field: {
            mapFromCustomFieldName: true,
          } as any,
          selectMoreFields: {
            mapFromResourceType: true,
          } as any,
          title: "Mapped From",
          type: FieldType.Element,
          noValueMessage: "-",
          getElement: (item: CustomFieldsBaseModels): ReactElement => {
            const resource: string | undefined = (item as any)
              .mapFromResourceType;
            const fieldName: string | undefined = (item as any)
              .mapFromCustomFieldName;

            if (!resource || !fieldName) {
              return <span className="text-gray-400">Entered by hand</span>;
            }

            const source: CustomFieldMappingSourceInfo | undefined =
              getCustomFieldMappingSource({
                definitionTableName: definitionTableName,
                resource: resource,
              });

            return <span>{`${source?.title || resource} › ${fieldName}`}</span>;
          },
        },
      ]
    : [];

  return (
    <Fragment>
      <ModelTable<CustomFieldsBaseModels>
        modelType={props.modelType}
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
          description:
            "Custom fields help you add new fields to your resources in OneUptime.",
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
        formFields={[
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
            description:
              "Choose how data is entered for this field. Dropdown types also need a list of options below.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Please select field type.",
            dropdownOptions: (
              Object.keys(CustomFieldType) as Array<CustomFieldType>
            ).map((item: CustomFieldType) => {
              return {
                label: FIELD_TYPE_LABELS[item] || item,
                value: item,
              };
            }),
          },
          {
            field: {
              dropdownOptions: true,
            },
            title: "Dropdown Options",
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
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Field Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Field Description",
            type: FieldType.Text,
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Field Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Field Description",
            type: FieldType.Text,
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            type: FieldType.Text,
          },
          ...mappingColumns,
        ]}
      />
    </Fragment>
  );
};

export default CustomFieldsPageBase;

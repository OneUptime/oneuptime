import {
  CustomFieldTypeOption,
  getCustomFieldTypeLabelForValue,
  getCustomFieldTypeOptions,
} from "./CustomFieldSettingsCopy";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "Common/Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What every custom field settings table lists: each field's name and its
 * type, and nothing else. The maintainer, looking at the incident one, which
 * had grown to nine columns (description, where the value is copied from,
 * show on create, subscriber notifications, template variable...): "Too many
 * columns on the table. I think we just need to show field name and field
 * type here, and that's basically it."
 *
 * Nothing that left the table is gone:
 *
 *   - a field's description, dropdown options, the resource its value is
 *     copied from and an incident field's settings are all on the field's
 *     own form, opened with Edit;
 *   - an incident field's template variable is listed, by the field's name,
 *     under "Template variables" in the note template and subscriber
 *     notification template editors - where it is put to use;
 *   - a value copied from a monitor says so on the record it was copied
 *     onto (CustomFieldsDetail).
 *
 * The type reads as the "Field Type" picker names it - "Dropdown
 * (multi-select)", not the stored "MultiSelectDropdown" - and the type
 * filter picks from the same names, so what is filtered for is what is on
 * screen.
 *
 * All nine settings tables use these: the eight that go through
 * CustomFieldsPageBase, and the team member one, which has its own form.
 * App/Tests/Dashboard/CustomFieldTablesTwoColumns keeps every one of them
 * on them, a tenth included.
 */

export type CustomFieldDefinitionModel =
  | AlertCustomField
  | IncidentCustomField
  | InventoryItemCustomField
  | MonitorCustomField
  | OnCallDutyPolicyCustomField
  | ScheduledMaintenanceCustomField
  | StatusPageCustomField
  | TeamCustomField
  | TeamMemberCustomField;

export const CUSTOM_FIELD_NAME_COLUMN_TITLE: string = "Field Name";
export const CUSTOM_FIELD_TYPE_COLUMN_TITLE: string = "Field Type";

export interface CustomFieldTypeTextProps {
  // The definition's stored customFieldType.
  value: unknown;
}

/*
 * A field's type, named and translated as the picker names it. A hook can
 * only run inside a component, so the table cell renders this rather than
 * translating in its getElement.
 */
export const CustomFieldTypeText: FunctionComponent<
  CustomFieldTypeTextProps
> = (props: CustomFieldTypeTextProps): ReactElement => {
  const { translateString } = useTranslateValue();

  const label: string | undefined = getCustomFieldTypeLabelForValue(
    props.value,
  );

  if (!label) {
    return <span data-testid="custom-field-type">-</span>;
  }

  return (
    <span data-testid="custom-field-type">
      {translateString(label) || label}
    </span>
  );
};

export const getCustomFieldDefinitionColumns: () => Columns<CustomFieldDefinitionModel> =
  (): Columns<CustomFieldDefinitionModel> => {
    return [
      {
        field: {
          name: true,
        },
        title: CUSTOM_FIELD_NAME_COLUMN_TITLE,
        type: FieldType.Text,
      },
      {
        field: {
          customFieldType: true,
        },
        title: CUSTOM_FIELD_TYPE_COLUMN_TITLE,
        type: FieldType.Element,
        getElement: (item: CustomFieldDefinitionModel): ReactElement => {
          return <CustomFieldTypeText value={item.customFieldType} />;
        },
        // The CSV says what the screen says, not the stored enum value.
        getExportValue: (item: CustomFieldDefinitionModel): string => {
          return getCustomFieldTypeLabelForValue(item.customFieldType) || "";
        },
      },
    ];
  };

export const getCustomFieldDefinitionFilters: () => Array<
  Filter<CustomFieldDefinitionModel>
> = (): Array<Filter<CustomFieldDefinitionModel>> => {
  return [
    {
      field: {
        name: true,
      },
      title: CUSTOM_FIELD_NAME_COLUMN_TITLE,
      type: FieldType.Text,
    },
    {
      field: {
        customFieldType: true,
      },
      title: CUSTOM_FIELD_TYPE_COLUMN_TITLE,
      type: FieldType.Dropdown,
      filterDropdownOptions: getCustomFieldTypeOptions().map(
        (option: CustomFieldTypeOption) => {
          return {
            label: option.label,
            value: option.value,
          };
        },
      ),
    },
  ];
};

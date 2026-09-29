import Label from "Common/Models/DatabaseModels/Label";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

export default function getSloMonitorRuleFormFields(): Fields<ServiceLevelObjectiveMonitorRule> {
  return [
    {
      field: { name: true },
      title: "Name",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Every production API monitor",
      validation: { minLength: 2 },
    },
    {
      field: { description: true },
      title: "Description",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Why these monitors belong to this SLO.",
    },
    {
      field: { isEnabled: true },
      title: "Enabled",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      description:
        "Turning a rule off detaches the monitors only this rule attached. Monitors you attached by hand, or that another enabled rule matches, are left alone.",
    },
    {
      field: { monitorLabels: true },
      title: "Monitor Labels",
      stepId: "match-criteria",
      sectionTitle: "Match by Attributes",
      sectionDescription:
        "Match monitors carrying at least one of these labels. Leave empty to skip the label filter.",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      required: false,
      placeholder: "Select Monitor Labels (optional)",
    },
    {
      field: { monitorType: true },
      title: "Monitor Type",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: Object.values(MonitorType).map(
        (monitorType: MonitorType): DropdownOption => {
          return { label: monitorType, value: monitorType };
        },
      ),
      required: false,
      placeholder: "Select Monitor Type",
    },
    {
      field: { monitorNamePattern: true },
      title: "Monitor Name",
      stepId: "match-criteria",
      sectionTitle: "Match by Name or Description",
      sectionDescription:
        "Choose a text operator. Matches pattern and Does not match pattern accept a case-insensitive regex (^api-.*) or a * wildcard (*checkout*).",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Monitor name or pattern",
    },
    {
      field: { monitorDescriptionPattern: true },
      title: "Monitor Description",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Monitor description or pattern",
    },
  ];
}

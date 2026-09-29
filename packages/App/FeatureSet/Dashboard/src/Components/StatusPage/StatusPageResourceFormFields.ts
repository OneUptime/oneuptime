import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import DropdownUtil from "Common/UI/Utils/Dropdown";

/**
 * Options that apply to a status page resource no matter how it was created -
 * one at a time from the resource form, or in bulk from the "Add Multiple
 * Monitors" modal. Both surfaces render these fields from here so they never
 * drift apart.
 */
export const getStatusPageResourceAdvancedFields: () => Array<
  ModelField<StatusPageResource>
> = (): Array<ModelField<StatusPageResource>> => {
  return [
    {
      field: {
        displayTooltip: true,
      },
      title: "Tooltip ",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      description:
        "This will show up as tooltip beside the resource on your status page.",
      placeholder: "Tooltip",
      stepId: "advanced",
    },
    {
      field: {
        showCurrentStatus: true,
      },
      title: "Show Current Resource Status",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
      description:
        "Current Resource Status will be shown beside this resource on your status page.",
      stepId: "advanced",
    },
    {
      field: {
        showUptimePercent: true,
      },
      title: "Show Uptime %",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
      description:
        "Show uptime percentage beside this resource on your status page. The number of days is configured in Status Page Settings.",
      stepId: "advanced",
    },
    {
      field: {
        uptimePercentPrecision: true,
      },
      stepId: "advanced",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
      showIf: (item: FormValues<StatusPageResource>): boolean => {
        return Boolean(item.showUptimePercent);
      },
      title: "Select Uptime Precision",
      defaultValue: UptimePrecision.ONE_DECIMAL,
      required: true,
    },
    {
      field: {
        showStatusHistoryChart: true,
      },
      title: "Show Status History Chart",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description:
        "Show resource status history chart. The number of days is configured in Status Page Settings.",
      defaultValue: true,
      stepId: "advanced",
    },
  ];
};

export default getStatusPageResourceAdvancedFields;

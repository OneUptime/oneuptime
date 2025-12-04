import DashboardBaseComponent from "./DashboardBaseComponent";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

export enum ComponentInputType {
  Text = "Text",
  Date = "Date",
  DateTime = "Date Time",
  Boolean = "True or False",
  Number = "Number",
  Decimal = "Decimal",
  MetricsQueryConfig = "MetricsQueryConfig",
  LongText = "Long Text",
  Dropdown = "Dropdown",
}

export interface ComponentArgument<T extends DashboardBaseComponent> {
  name: string;
  description: string;
  required: boolean;
  type: ComponentInputType;
  id: keyof T["arguments"];
  isAdvanced?: boolean | undefined;
  placeholder?: string | undefined;
  dropdownOptions?: Array<DropdownOption> | undefined;
}

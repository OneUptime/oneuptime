import { DropdownOption } from "../../Dropdown/Dropdown";
import FieldType from "../../Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";

export default interface Filter<T extends GenericObject> {
  title: string;
  filterDropdownOptions?: Array<DropdownOption> | undefined;
  key: keyof T;
  type: FieldType;
  jsonKeys?: Array<string> | undefined;
  jsonValueSuggestions?: Record<string, Array<string>> | undefined;
  onJsonKeySelected?: ((key: string) => void) | undefined;
  isLoadingJsonKeys?: boolean | undefined;
  loadingJsonValueKeys?: Array<string> | undefined;
  jsonEnableOperators?: boolean | undefined;
  isAdvancedFilter?: boolean | undefined;
}

import { DropdownOption } from "../../Dropdown/Dropdown";
import FieldType from "../../Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI from "../../../Utils/ModelAPI/ModelAPI";

/*
 * AN ENTITY FILTER WHOSE CHOICES ARE A MODEL'S RECORDS, SEARCHED ON THE
 * SERVER AS THEY ARE TYPED (#10646).
 *
 * A list's "Filter by …" read the first 10,000 records of the filter's
 * model, unsorted - so the newest were kept - and offered those: an older
 * one could not be picked, a filter restored from a link that named one
 * showed blank, and the Admin Dashboard's Project filter listed every
 * project on the instance. With this set, the filter's picker searches the
 * server (EntityDropdown), 50 by name; what the filter holds is named by
 * its ids (filterDropdownOptions), and one no record answers to any more
 * reads `notFoundLabel`, to take out.
 */
export interface EntityFilterSearch {
  modelType: { new (): BaseModel };
  // The column the picker names a record by, and the one it filters by.
  labelField: string;
  valueField: string;
  // Only the records that match this: the filter's own query.
  query?: Record<string, unknown> | undefined;
  // The API the searches go through: the list's own.
  modelAPI?: typeof ModelAPI | undefined;
  // What a held value no record answers to any more reads as: a key.
  notFoundLabel?: string | undefined;
}

export default interface Filter<T extends GenericObject> {
  title: string;
  /*
   * The filter's choices. For a filter that searches the server
   * (entitySearch), only the records the filter holds, named.
   */
  filterDropdownOptions?: Array<DropdownOption> | undefined;
  entitySearch?: EntityFilterSearch | undefined;
  key: keyof T;
  type: FieldType;
  jsonKeys?: Array<string> | undefined;
  jsonValueSuggestions?: Record<string, Array<string>> | undefined;
  onJsonKeySelected?: ((key: string) => void) | undefined;
  isLoadingJsonKeys?: boolean | undefined;
  loadingJsonValueKeys?: Array<string> | undefined;
  onJsonValueSearch?: ((key: string, searchText: string) => void) | undefined;
  jsonEnableOperators?: boolean | undefined;
  isAdvancedFilter?: boolean | undefined;
}

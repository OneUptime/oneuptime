import SelectEntityField from "../../Types/SelectEntityField";
import Query from "../../../Types/BaseDatabase/Query";
import { DropdownOption } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export default interface Filter<
  TEntity extends BaseModel | AnalyticsBaseModel,
> {
  title: string;
  type: FieldType;
  field: SelectEntityField<TEntity>;
  filterEntityType?: DatabaseBaseModelType | AnalyticsBaseModelType | undefined;
  filterQuery?: Query<TEntity> | undefined;
  filterDropdownField?:
    | {
        label: string;
        value: string;
      }
    | undefined;
  /*
   * The filter's choices. For a filter whose choices are records of the
   * project's database (filterEntityType), searched on the server: the
   * choices offered beside the records the search finds, always - a value
   * no record holds, such as the "Unknown Service" telemetry that named no
   * service is filed under - each named by itself when the filter holds
   * it, never read by its id (#10764).
   */
  filterDropdownOptions?: Array<DropdownOption> | undefined;
  /*
   * Whether a record of filterEntityType that is archived is marked
   * Archived where the filter offers or holds it: a model whose records can
   * be archived though they are no values - a service, hidden from its list
   * while the rows this list shows still name it (#10764). A value that can
   * be archived always is (ArchivedValuePicker).
   */
  marksArchivedRecords?: boolean | undefined;
  fetchFilterDropdownOptions?: () => Promise<Array<DropdownOption>> | undefined;
  jsonKeys?: Array<string> | undefined;
  isAdvancedFilter?: boolean | undefined;
}

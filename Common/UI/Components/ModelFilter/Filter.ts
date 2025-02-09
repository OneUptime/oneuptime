import SelectEntityField from "../../Types/SelectEntityField";
import Query from "../../../Types/BaseDatabase/Query";
import { DropdownOption } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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
  filterDropdownOptions?: Array<DropdownOption> | undefined;
  fetchFilterDropdownOptions?: () => Promise<Array<DropdownOption>> | undefined;
  jsonKeys?: Array<string> | undefined;
}

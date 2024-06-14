import SelectEntityField from "../../Types/SelectEntityField";
import Query from "../../Utils/BaseDatabase/Query";
import { DropdownOption } from "../Dropdown/Dropdown";
import FieldType from "../Types/FieldType";
import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "Common/AnalyticsModels/BaseModel";
import BaseModel, { BaseModelType } from "Common/Models/BaseModel";

export default interface Filter<
  TEntity extends BaseModel | AnalyticsBaseModel,
> {
  title: string;
  type: FieldType;
  field: SelectEntityField<TEntity>;
  filterEntityType?: BaseModelType | AnalyticsBaseModelType | undefined;
  filterQuery?: Query<TEntity> | undefined;
  filterDropdownField?:
    | {
        label: string;
        value: string;
      }
    | undefined;
  filterDropdownOptions?: Array<DropdownOption> | undefined;
  fetchFilterDropdownOptions?: () => Promise<Array<DropdownOption>> | undefined;
}

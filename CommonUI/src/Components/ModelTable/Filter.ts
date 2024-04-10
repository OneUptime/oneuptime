import AnalyticsBaseModel, { AnalyticsBaseModelType } from "Common/AnalyticsModels/BaseModel";
import BaseModel, { BaseModelType } from "Common/Models/BaseModel";
import Query from "../../Utils/BaseDatabase/Query";
import { DropdownOption } from "../Dropdown/Dropdown";
import SelectEntityField from "../../Types/SelectEntityField";

export default interface Filter<
    TEntity extends BaseModel | AnalyticsBaseModel
> {
    field: SelectEntityField<TEntity>
    filterEntityType?: BaseModelType | AnalyticsBaseModelType | undefined;
    filterQuery?: Query<TEntity> | undefined;
    filterDropdownField?:
    | {
        label: string;
        value: string;
    }
    | undefined;
    filterDropdownOptions?: Array<DropdownOption> | undefined;
}
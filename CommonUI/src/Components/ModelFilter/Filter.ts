import AnalyticsBaseModel, {
    AnalyticsBaseModelType,
} from 'Common/AnalyticsModels/BaseModel';
import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import Query from '../../Utils/BaseDatabase/Query';
import { DropdownOption } from '../Dropdown/Dropdown';
import SelectEntityField from '../../Types/SelectEntityField';
import FieldType from '../Types/FieldType';

export default interface Filter<
    TEntity extends BaseModel | AnalyticsBaseModel
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
    fetchFilterDropdownOptions?: () =>
        | Promise<Array<DropdownOption>>
        | undefined;
}

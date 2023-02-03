import type BaseModel from 'Common/Models/BaseModel';
import type Select from '../../Utils/ModelAPI/Select';
import type DetailField from '../Detail/Field';

export default interface Field<TBaseModel extends BaseModel>
    extends DetailField {
    field?: Select<TBaseModel> | undefined;
}

import BaseModel from 'Common/Models/BaseModel';
import Select from '../../Utils/ModelAPI/Select';
import { FieldBase } from '../Detail/Field';

export default interface Field<TBaseModel extends BaseModel> extends FieldBase {
    field?: Select<TBaseModel> | undefined;
}

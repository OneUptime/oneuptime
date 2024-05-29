import Select from '../../Utils/BaseDatabase/Select';
import { FieldBase } from '../Detail/Field';
import BaseModel from 'Common/Models/BaseModel';

export default interface Field<TBaseModel extends BaseModel>
    extends FieldBase<TBaseModel> {
    field?: Select<TBaseModel> | undefined;
}

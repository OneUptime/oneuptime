import BaseModel from 'Common/Models/BaseModel';
import Select from '../../Utils/ModelAPI/Select';
import DetailField from "../Detail/Field"

export default interface Field<TBaseModel extends BaseModel> extends DetailField {
    field: Select<TBaseModel>;
}

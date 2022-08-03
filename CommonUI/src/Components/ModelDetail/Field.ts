import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import Select from '../../Utils/ModelAPI/Select';
import FieldType from './FieldType';

export default interface Field<TBaseModel extends BaseModel> {
    title?: string;
    description?: string;
    field: Select<TBaseModel>;
    fieldType?: FieldType;
    sideLink?: {
        text: string;
        url: Route | URL;
        openLinkInNewTab?: boolean;
    };
}

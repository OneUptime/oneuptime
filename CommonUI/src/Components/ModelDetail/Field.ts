
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import FormFieldType from "../../Types/EntityFieldType";
import Select from "../../Utils/ModelAPI/Select";

export default interface Field<TBaseModel extends BaseModel> {
    title?: string;
    description?: string;
    field: Select<TBaseModel>;
    fieldType?: FormFieldType;
    sideLink?: {
        text: string;
        url: Route | URL;
        openLinkInNewTab?: boolean;
    };
}

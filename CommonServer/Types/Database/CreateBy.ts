import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import type { JSONObject } from 'Common/Types/JSON';

export default interface CreateBy<TBaseModel extends BaseModel> {
    data: TBaseModel;
    miscDataProps?: JSONObject;
    props: DatabaseCommonInteractionProps;
}

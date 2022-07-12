import BaseModel from "Common/Models/BaseModel";
import ObjectID from "Common/Types/ObjectID";
import Query from "./Query";
import Select from "./Select";
import API from '../../Utils/API/API';
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { DASHBOARD_API_URL } from "../../Config";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";

export class ModelAPI {
    public static async getList<TBaseModel extends BaseModel>(type: { new(): TBaseModel }, query: Query, limit: 0, skip: 0, select: Select): Promise<Array<TBaseModel>> {
        const model = new type();

        let apiUrl: URL;

        const apiPath: Route | null = model.getCrudApiPath();
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support CRUD operations.'
            );
        }

        apiUrl = URL.fromURL(DASHBOARD_API_URL).addRoute(apiPath);


        if (!apiUrl) {
            throw new BadDataException(
                'This model does not support CRUD operations.'
            );
        }

        const result: HTTPResponse<
            Array<TBaseModel>
        > = await API.fetch<
            Array<TBaseModel>
        >(
            HTTPMethod.GET,
            apiUrl,
            {
                query: query.toJSON(),
                select: select.toJSON()
            },
            undefined,
            {
                limit: limit.toString(),
                skip: skip.toString(),
            }
        );

        return result.data as Array<TBaseModel>;
    }

    public static async getItem<TBaseModel extends BaseModel>(type: { new(): TBaseModel }, id: ObjectID, select: Select): Promise<TBaseModel | null> {
        return null;
    }
}
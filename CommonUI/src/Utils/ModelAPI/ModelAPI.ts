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
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { FormType } from "../../Components/Forms/ModelForm";

export class ModelAPI {


    public static async create<TBaseModel extends BaseModel>(model: TBaseModel, apiUrlOverride?: URL,): Promise<HTTPResponse<
        JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    >> {

        return await ModelAPI.createOrUpdate(model, FormType.Create, apiUrlOverride);
    }

    public static async update<TBaseModel extends BaseModel>(model: TBaseModel, apiUrlOverride?: URL,): Promise<HTTPResponse<
        JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    >> {

        return await ModelAPI.createOrUpdate(model, FormType.Update, apiUrlOverride);
    }

    public static async createOrUpdate<TBaseModel extends BaseModel>(model: TBaseModel, formType: FormType, apiUrlOverride?: URL,): Promise<HTTPResponse<
        JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    >> {
        let apiUrl: URL | null = apiUrlOverride || null;

        if (!apiUrl) {
            const apiPath: Route | null = model.getCrudApiPath();
            if (!apiPath) {
                throw new BadDataException(
                    'This model does not support CRUD operations.'
                );
            }

            apiUrl = URL.fromURL(DASHBOARD_API_URL).addRoute(apiPath);
        }

        const result: HTTPResponse<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        > = await API.fetch<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        >(
            formType === FormType.Create
                ? HTTPMethod.POST
                : HTTPMethod.PUT,
            apiUrl,
            { data: model.toJSON() }
        );

        if (result.isSuccess()) {
            return result;
        } else {
            throw result;
        }


    }
    public static async getList<TBaseModel extends BaseModel>(type: { new (): TBaseModel }, query: Query, limit: 0, skip: 0, select: Select): Promise<{
        data: Array<TBaseModel>;
        count: number;
        skip: number;
        limit: number;
    }> {

        let apiUrl: URL;

        const apiPath: Route | null = new type().getCrudApiPath();
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
        > | HTTPErrorResponse = await API.fetch<
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

        if (result.isSuccess()) {
            return {
                data: result.data as Array<TBaseModel>,
                count: result.count, 
                skip: result.skip,
                limit: result.limit
            };
        } else {
            throw result;
        }
    }

    public static async getItem<TBaseModel extends BaseModel>(model: TBaseModel, id: ObjectID, select: Select): Promise<TBaseModel | null> {
        return null;
    }
}
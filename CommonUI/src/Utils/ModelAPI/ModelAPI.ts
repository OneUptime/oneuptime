import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import Query from './Query';
import Select from './Select';
import API from '../../Utils/API/API';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { DASHBOARD_API_URL } from '../../Config';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { FormType } from '../../Components/Forms/ModelForm';
import Dictionary from 'Common/Types/Dictionary';
import ProjectUtil from '../Project';
import Sort from './Sort';
import Project from 'Model/Models/Project';
import User from '../User';
import Navigation from '../Navigation';

export interface ListResult<TBaseModel extends BaseModel> extends JSONObject {
    data: Array<TBaseModel>;
    count: number;
    skip: number;
    limit: number;
}

export interface RequestOptions {
    isMultiTenantRequest?: boolean | undefined;
    requestHeaders?: Dictionary<string> | undefined;
    overrideRequestUrl?: URL | undefined;
}

export default class ModelAPI {
    public static async create<TBaseModel extends BaseModel>(
        model: TBaseModel,
        modelType: { new (): TBaseModel },
        requestOptions?: RequestOptions | undefined
    ): Promise<
        HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
    > {
        return await ModelAPI.createOrUpdate(
            model,
            modelType,
            FormType.Create,
            {},
            requestOptions
        );
    }

    public static async update<TBaseModel extends BaseModel>(
        model: TBaseModel,
        modelType: { new (): TBaseModel }
    ): Promise<
        HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
    > {
        return await ModelAPI.createOrUpdate(model, modelType, FormType.Update);
    }

    public static async updateById<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        id: ObjectID,
        data: JSONObject,
        apiUrlOverride?: URL,
        requestOptions?: RequestOptions
    ): Promise<
        HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
    > {
        const model: BaseModel = new modelType();
        let apiUrl: URL | null = apiUrlOverride || null;

        if (!apiUrl) {
            const apiPath: Route | null = model.getCrudApiPath();
            if (!apiPath) {
                throw new BadDataException(
                    'This model does not support create or update operations.'
                );
            }

            apiUrl = URL.fromURL(DASHBOARD_API_URL).addRoute(apiPath);
        }

        apiUrl = apiUrl.addRoute(`/${id.toString()}`);

        const result: HTTPResponse<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        > = await API.fetch<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        >(
            HTTPMethod.PUT,
            apiUrl,
            {
                data: data,
            },
            this.getCommonHeaders(requestOptions)
        );

        if (result.isSuccess()) {
            return result;
        }

        this.checkStatusCode(result);

        throw result;
    }

    public static async createOrUpdate<TBaseModel extends BaseModel>(
        model: TBaseModel,
        modelType: { new (): TBaseModel },
        formType: FormType,
        miscDataProps?: JSONObject,
        requestOptions?: RequestOptions | undefined
    ): Promise<
        HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
    > {
        let apiUrl: URL | null = requestOptions?.overrideRequestUrl || null;

        if (!apiUrl) {
            const apiPath: Route | null = model.getCrudApiPath();
            if (!apiPath) {
                throw new BadDataException(
                    'This model does not support create or update operations.'
                );
            }

            apiUrl = URL.fromURL(DASHBOARD_API_URL).addRoute(apiPath);
        }

        const httpMethod: HTTPMethod =
            formType === FormType.Create ? HTTPMethod.POST : HTTPMethod.PUT;

        if (httpMethod === HTTPMethod.PUT) {
            apiUrl = apiUrl.addRoute(`/${model._id}`);
        }

        const result: HTTPResponse<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        > = await API.fetch<
            JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
        >(
            httpMethod,
            apiUrl,
            {
                data: JSONFunctions.serialize(
                    JSONFunctions.toJSON(model, modelType)
                ),
                miscDataProps: miscDataProps || {},
            },
            {
                ...this.getCommonHeaders(requestOptions),
                ...(requestOptions?.requestHeaders || {}),
            }
        );

        if (result.isSuccess()) {
            return result;
        }

        this.checkStatusCode(result);

        throw result;
    }

    public static async getList<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        limit: number,
        skip: number,
        select: Select<TBaseModel>,
        sort: Sort<TBaseModel>,
        requestOptions?: RequestOptions
    ): Promise<ListResult<TBaseModel>> {
        const model: TBaseModel = new modelType();
        const apiPath: Route | null = model.getCrudApiPath();
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support list operations.'
            );
        }

        let apiUrl: URL = URL.fromURL(DASHBOARD_API_URL)
            .addRoute(apiPath)
            .addRoute('/get-list');

        if (requestOptions?.overrideRequestUrl) {
            apiUrl = requestOptions.overrideRequestUrl;
        }

        if (!apiUrl) {
            throw new BadDataException(
                'This model does not support list operations.'
            );
        }

        const headers: Dictionary<string> =
            this.getCommonHeaders(requestOptions);
        if (requestOptions && requestOptions.isMultiTenantRequest) {
            headers['isMultiTenantRequest'] = 'true';
        }

        const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
            await API.fetch<JSONArray>(
                HTTPMethod.POST,
                apiUrl,
                {
                    query: JSONFunctions.serialize(query as JSONObject),
                    select: JSONFunctions.serialize(select as JSONObject),
                    sort: JSONFunctions.serialize(sort as JSONObject),
                },
                headers,
                {
                    limit: limit.toString(),
                    skip: skip.toString(),
                }
            );

        if (result.isSuccess()) {
            const list: Array<TBaseModel> = JSONFunctions.fromJSONArray(
                result.data as JSONArray,
                modelType
            );

            return {
                data: list,
                count: result.count,
                skip: result.skip,
                limit: result.limit,
            };
        }

        this.checkStatusCode(result);

        throw result;
    }

    public static async count<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        requestOptions?: RequestOptions | undefined
    ): Promise<number> {
        const model: TBaseModel = new modelType();
        const apiPath: Route | null = model.getCrudApiPath();
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support list operations.'
            );
        }

        let apiUrl: URL = URL.fromURL(DASHBOARD_API_URL)
            .addRoute(apiPath)
            .addRoute('/count');

        if (requestOptions?.overrideRequestUrl) {
            apiUrl = requestOptions.overrideRequestUrl;
        }

        if (!apiUrl) {
            throw new BadDataException(
                'This model does not support count operations.'
            );
        }

        const headers: Dictionary<string> =
            this.getCommonHeaders(requestOptions);
        if (requestOptions && requestOptions.isMultiTenantRequest) {
            headers['is-multi-tenant-query'] = 'true';
        }

        const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.fetch<JSONObject>(
                HTTPMethod.POST,
                apiUrl,
                {
                    query: JSONFunctions.serialize(query as JSONObject),
                },
                headers
            );

        if (result.isSuccess()) {
            const count: number = result.data['count'] as number;

            return count;
        }

        this.checkStatusCode(result);

        throw result;
    }

    public static getCommonHeaders(
        requestOptions?: RequestOptions
    ): Dictionary<string> {
        let headers: Dictionary<string> = {};

        if (!requestOptions || !requestOptions.isMultiTenantRequest) {
            const project: Project | null = ProjectUtil.getCurrentProject();

            if (project && project.id) {
                headers['tenantid'] = project.id.toString();
            }
        }

        // add SSO headers.

        headers = {
            ...headers,
            ...User.getAllSsoTokens(),
        };

        if (requestOptions && requestOptions.isMultiTenantRequest) {
            headers['is-multi-tenant-query'] = 'true';
        }

        return headers;
    }

    public static async getItem<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        id: ObjectID,
        select: Select<TBaseModel>,
        requestOptions?: RequestOptions | undefined
    ): Promise<TBaseModel | null> {
        const apiPath: Route | null = new modelType().getCrudApiPath();
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support get operations.'
            );
        }

        let apiUrl: URL = URL.fromURL(DASHBOARD_API_URL)
            .addRoute(apiPath)
            .addRoute('/' + id.toString())
            .addRoute('/get-item');

        if (requestOptions?.overrideRequestUrl) {
            apiUrl = requestOptions.overrideRequestUrl;
        }

        if (!apiUrl) {
            throw new BadDataException(
                'This model does not support get operations.'
            );
        }

        const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
            await API.fetch<TBaseModel>(
                HTTPMethod.POST,
                apiUrl,
                {
                    select: JSONFunctions.serialize(select as JSONObject),
                },
                this.getCommonHeaders(requestOptions)
            );

        if (result.isSuccess()) {
            return result.data as TBaseModel;
        }

        this.checkStatusCode(result);

        throw result;
    }

    public static async deleteItem<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        id: ObjectID,
        requestOptions?: RequestOptions | undefined
    ): Promise<void> {
        const apiPath: Route | null = new modelType().getCrudApiPath();
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support delete operations.'
            );
        }

        const apiUrl: URL = URL.fromURL(DASHBOARD_API_URL)
            .addRoute(apiPath)
            .addRoute('/' + id.toString());

        if (!apiUrl) {
            throw new BadDataException(
                'This model does not support delete operations.'
            );
        }

        const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
            await API.fetch<TBaseModel>(
                HTTPMethod.DELETE,
                apiUrl,
                undefined,
                this.getCommonHeaders(requestOptions)
            );

        if (result.isSuccess()) {
            return;
        }

        this.checkStatusCode(result);

        throw result;
    }

    private static checkStatusCode<TBaseModel extends BaseModel>(
        result:
            | HTTPResponse<
                  TBaseModel | JSONObject | JSONArray | Array<TBaseModel>
              >
            | HTTPErrorResponse
    ): void {
        if (result.statusCode === 406) {
            const project: Project | null = ProjectUtil.getCurrentProject();

            if (project && project.id) {
                Navigation.navigate(new Route(`/dashboard/${project._id}/sso`));
            }
        }
    }
}

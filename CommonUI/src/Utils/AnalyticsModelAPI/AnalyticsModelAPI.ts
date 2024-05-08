import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import Query from '../BaseDatabase/Query';
import Select from '../BaseDatabase/Select';
import API from '../API/API';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { APP_API_URL } from '../../Config';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { FormType } from '../../Components/Forms/ModelForm';
import Dictionary from 'Common/Types/Dictionary';
import ProjectUtil from '../Project';
import Sort from '../BaseDatabase/Sort';
import Project from 'Model/Models/Project';
import Navigation from '../Navigation';
import BaseListResult from '../BaseDatabase/ListResult';
import RequestOptions from '../BaseDatabase/RequestOptions';
import GroupBy from '../BaseDatabase/GroupBy';

export interface ListResult<TAnalyticsBaseModel extends AnalyticsBaseModel>
    extends BaseListResult<TAnalyticsBaseModel> {}

export default class ModelAPI {
    public static async create<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(data: {
        model: TAnalyticsBaseModel;
        modelType: { new (): TAnalyticsBaseModel };
        requestOptions?: RequestOptions | undefined;
    }): Promise<
        HTTPResponse<
            | JSONObject
            | JSONArray
            | TAnalyticsBaseModel
            | Array<TAnalyticsBaseModel>
        >
    > {
        const { model, modelType, requestOptions } = data;

        return await ModelAPI.createOrUpdate({
            model,
            modelType,
            formType: FormType.Create,
            miscDataProps: {},
            requestOptions,
        });
    }

    public static async update<TAnalyticsBaseModel extends AnalyticsBaseModel>(
        model: TAnalyticsBaseModel,
        modelType: { new (): TAnalyticsBaseModel }
    ): Promise<
        HTTPResponse<
            | JSONObject
            | JSONArray
            | TAnalyticsBaseModel
            | Array<TAnalyticsBaseModel>
        >
    > {
        return await ModelAPI.createOrUpdate({
            model,
            modelType,
            formType: FormType.Update,
        });
    }

    public static async updateById<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(args: {
        modelType: { new (): TAnalyticsBaseModel };
        id: ObjectID;
        data: JSONObject;
        apiUrlOverride?: URL;
        requestOptions?: RequestOptions;
    }): Promise<
        HTTPResponse<
            | JSONObject
            | JSONArray
            | TAnalyticsBaseModel
            | Array<TAnalyticsBaseModel>
        >
    > {
        const { modelType, id, data, apiUrlOverride, requestOptions } = args;

        const model: AnalyticsBaseModel = new modelType();
        let apiUrl: URL | null = apiUrlOverride || null;

        if (!apiUrl) {
            const apiPath: Route | null = model.crudApiPath;
            if (!apiPath) {
                throw new BadDataException(
                    'This model does not support create or update operations.'
                );
            }

            apiUrl = URL.fromURL(APP_API_URL).addRoute(apiPath);
        }

        apiUrl = apiUrl.addRoute(`/${id.toString()}`);

        const result: HTTPResponse<
            | JSONObject
            | JSONArray
            | TAnalyticsBaseModel
            | Array<TAnalyticsBaseModel>
        > = await API.fetch<
            | JSONObject
            | JSONArray
            | TAnalyticsBaseModel
            | Array<TAnalyticsBaseModel>
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

    public static async createOrUpdate<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(data: {
        model: TAnalyticsBaseModel;
        modelType: { new (): TAnalyticsBaseModel };
        formType: FormType;
        miscDataProps?: JSONObject;
        requestOptions?: RequestOptions | undefined;
    }): Promise<HTTPResponse<TAnalyticsBaseModel>> {
        const { model, modelType, formType, miscDataProps, requestOptions } =
            data;

        let apiUrl: URL | null = requestOptions?.overrideRequestUrl || null;

        if (!apiUrl) {
            const apiPath: Route | null = model.crudApiPath;
            if (!apiPath) {
                throw new BadDataException(
                    'This model does not support create or update operations.'
                );
            }

            apiUrl = URL.fromURL(APP_API_URL).addRoute(apiPath);
        }

        const httpMethod: HTTPMethod =
            formType === FormType.Create ? HTTPMethod.POST : HTTPMethod.PUT;

        if (httpMethod === HTTPMethod.PUT) {
            apiUrl = apiUrl.addRoute(`/${model._id}`);
        }

        const apiResult: HTTPErrorResponse | HTTPResponse<TAnalyticsBaseModel> =
            await API.fetch<TAnalyticsBaseModel>(
                httpMethod,
                apiUrl,
                {
                    data: JSONFunctions.serialize(
                        AnalyticsBaseModel.toJSON(model, modelType)
                    ),
                    miscDataProps: miscDataProps || {},
                },
                {
                    ...this.getCommonHeaders(requestOptions),
                    ...(requestOptions?.requestHeaders || {}),
                }
            );

        if (apiResult.isSuccess() && apiResult instanceof HTTPResponse) {
            const result: HTTPResponse<TAnalyticsBaseModel> =
                apiResult as HTTPResponse<TAnalyticsBaseModel>;

            result.data = AnalyticsBaseModel.fromJSON(
                result.data,
                modelType
            ) as TAnalyticsBaseModel;

            return result;
        }

        this.checkStatusCode(apiResult);

        throw apiResult;
    }

    public static async getList<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(data: {
        modelType: { new (): TAnalyticsBaseModel };
        query: Query<TAnalyticsBaseModel>;
        groupBy?: GroupBy<TAnalyticsBaseModel> | undefined;
        limit: number;
        skip: number;
        select: Select<TAnalyticsBaseModel>;
        sort: Sort<TAnalyticsBaseModel>;
        requestOptions?: RequestOptions | undefined;
    }): Promise<ListResult<TAnalyticsBaseModel>> {
        const {
            modelType,
            query,
            limit,
            skip,
            select,
            sort,
            requestOptions,
            groupBy,
        } = data;

        const model: TAnalyticsBaseModel = new modelType();
        const apiPath: Route | null = model.crudApiPath;
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support list operations.'
            );
        }

        let apiUrl: URL = URL.fromURL(APP_API_URL)
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

        const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
            await API.fetch<JSONArray>(
                HTTPMethod.POST,
                apiUrl,
                {
                    query: JSONFunctions.serialize(query as JSONObject),
                    select: JSONFunctions.serialize(select as JSONObject),
                    sort: JSONFunctions.serialize(sort as JSONObject),
                    groupBy: JSONFunctions.serialize(groupBy as JSONObject),
                },
                headers,
                {
                    limit: limit.toString(),
                    skip: skip.toString(),
                }
            );

        if (result.isSuccess()) {
            const list: Array<TAnalyticsBaseModel> =
                AnalyticsBaseModel.fromJSONArray(
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

    public static async count<TAnalyticsBaseModel extends AnalyticsBaseModel>(
        modelType: { new (): TAnalyticsBaseModel },
        query: Query<TAnalyticsBaseModel>,
        requestOptions?: RequestOptions | undefined
    ): Promise<number> {
        const model: TAnalyticsBaseModel = new modelType();
        const apiPath: Route | null = model.crudApiPath;
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support list operations.'
            );
        }

        let apiUrl: URL = URL.fromURL(APP_API_URL)
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

        if (!requestOptions || Object.keys(requestOptions).length === 0) {
            const project: Project | null = ProjectUtil.getCurrentProject();

            if (project && project.id) {
                headers['tenantid'] = project.id.toString();
            }
        }

        // add SSO headers.

        headers = {
            ...headers,
        };

        return headers;
    }

    public static async getItem<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(data: {
        modelType: { new (): TAnalyticsBaseModel };
        id: ObjectID;
        select: Select<TAnalyticsBaseModel>;
        requestOptions?: RequestOptions | undefined;
    }): Promise<TAnalyticsBaseModel | null> {
        const { modelType, id, select, requestOptions } = data;

        const apiPath: Route | null = new modelType().crudApiPath;
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support get operations.'
            );
        }

        let apiUrl: URL = URL.fromURL(APP_API_URL)
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

        return this.post<TAnalyticsBaseModel>(
            modelType,
            apiUrl,
            select,
            requestOptions
        );
    }

    public static async post<TAnalyticsBaseModel extends AnalyticsBaseModel>(
        modelType: { new (): TAnalyticsBaseModel },
        apiUrl: URL,
        select?: Select<TAnalyticsBaseModel> | undefined,
        requestOptions?: RequestOptions | undefined
    ): Promise<TAnalyticsBaseModel | null> {
        const result: HTTPResponse<TAnalyticsBaseModel> | HTTPErrorResponse =
            await API.fetch<TAnalyticsBaseModel>(
                HTTPMethod.POST,
                apiUrl,
                {
                    select: JSONFunctions.serialize(select as JSONObject) || {},
                },
                this.getCommonHeaders(requestOptions)
            );

        if (result.isSuccess()) {
            return AnalyticsBaseModel.fromJSON(
                result.data,
                modelType
            ) as TAnalyticsBaseModel;
        }

        this.checkStatusCode(result);

        throw result;
    }

    public static async deleteItem<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(data: {
        modelType: { new (): TAnalyticsBaseModel };
        id: ObjectID;
        requestOptions?: RequestOptions | undefined;
    }): Promise<void> {
        const { modelType, id, requestOptions } = data;

        const apiPath: Route | null = new modelType().crudApiPath;
        if (!apiPath) {
            throw new BadDataException(
                'This model does not support delete operations.'
            );
        }

        const apiUrl: URL = URL.fromURL(APP_API_URL)
            .addRoute(apiPath)
            .addRoute('/' + id.toString());

        if (!apiUrl) {
            throw new BadDataException(
                'This model does not support delete operations.'
            );
        }

        const result: HTTPResponse<TAnalyticsBaseModel> | HTTPErrorResponse =
            await API.fetch<TAnalyticsBaseModel>(
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

    private static checkStatusCode<
        TAnalyticsBaseModel extends AnalyticsBaseModel
    >(
        result:
            | HTTPResponse<
                  | TAnalyticsBaseModel
                  | JSONObject
                  | JSONArray
                  | Array<TAnalyticsBaseModel>
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

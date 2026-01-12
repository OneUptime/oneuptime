import { FormType } from "../../Components/Forms/ModelForm";
import { APP_API_URL } from "../../Config";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import BaseListResult from "../../../Types/BaseDatabase/ListResult";
import Select from "../../../Types/BaseDatabase/Select";
import Navigation from "../Navigation";
import ProjectUtil from "../Project";
import BaseRequestOptions from "../API/RequestOptions";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import Query from "../../../Types/BaseDatabase/Query";
import API from "../API/API";
import Sort from "../../../Types/BaseDatabase/Sort";

export class ModelAPIHttpResponse<
  TBaseModel extends BaseModel,
> extends HTTPResponse<TBaseModel> {
  public miscData?: JSONObject | undefined;
}

export type ListResult<TBaseModel extends BaseModel> =
  BaseListResult<TBaseModel>;

export interface RequestOptions extends BaseRequestOptions {
  isMultiTenantRequest?: boolean | undefined;
}

export default class ModelAPI {
  public static async create<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    modelType: { new (): TBaseModel };
    requestOptions?: RequestOptions | undefined;
  }): Promise<
    HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
  > {
    return await ModelAPI.createOrUpdate({
      model: data.model,
      modelType: data.modelType,
      formType: FormType.Create,
      miscDataProps: {},
      requestOptions: data.requestOptions,
    });
  }

  public static async update<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    modelType: { new (): TBaseModel };
  }): Promise<
    HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
  > {
    return await ModelAPI.createOrUpdate({
      model: data.model,
      modelType: data.modelType,
      formType: FormType.Update,
    });
  }

  public static async updateById<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    data: JSONObject;
    apiUrlOverride?: URL;
    requestOptions?: RequestOptions;
  }): Promise<
    HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
  > {
    const model: BaseModel = new data.modelType();
    let apiUrl: URL | null = data.apiUrlOverride || null;

    if (!apiUrl) {
      const apiPath: Route | null = model.getCrudApiPath();
      if (!apiPath) {
        throw new BadDataException(
          "This model does not support create or update operations.",
        );
      }

      apiUrl = URL.fromURL(APP_API_URL).addRoute(apiPath);
    }

    apiUrl = apiUrl.addRoute(`/${data.id.toString()}`);

    const result: HTTPResponse<
      JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    > = await API.fetch<
      JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    >({
      method: HTTPMethod.PUT,
      url: apiUrl,
      data: {
        data: data.data,
      },
      headers: this.getCommonHeaders(data.requestOptions),
      ...(data.requestOptions?.apiRequestOptions
        ? { options: data.requestOptions.apiRequestOptions }
        : {}),
    });

    if (result.isSuccess()) {
      return result;
    }

    this.checkStatusCode(result);

    throw result;
  }

  public static async createOrUpdate<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    modelType: { new (): TBaseModel };
    formType: FormType;
    miscDataProps?: JSONObject;
    requestOptions?: RequestOptions | undefined;
  }): Promise<ModelAPIHttpResponse<TBaseModel>> {
    let apiUrl: URL | null = data.requestOptions?.overrideRequestUrl || null;

    if (!apiUrl) {
      const apiPath: Route | null = data.model.getCrudApiPath();
      if (!apiPath) {
        throw new BadDataException(
          "This model does not support create or update operations.",
        );
      }

      apiUrl = URL.fromURL(APP_API_URL).addRoute(apiPath);
    }

    const httpMethod: HTTPMethod =
      data.formType === FormType.Create ? HTTPMethod.POST : HTTPMethod.PUT;

    if (
      httpMethod === HTTPMethod.PUT &&
      !data.requestOptions?.overrideRequestUrl
    ) {
      apiUrl = apiUrl.addRoute(`/${data.model._id}`);
    }

    const apiResult: HTTPErrorResponse | HTTPResponse<TBaseModel> =
      await API.fetch<TBaseModel>({
        method: httpMethod,
        url: apiUrl,
        data: {
          data: JSONFunctions.serialize(
            BaseModel.toJSON(data.model, data.modelType),
          ),
          miscDataProps: data.miscDataProps || {},
        },
        headers: {
          ...this.getCommonHeaders(data.requestOptions),
          ...(data.requestOptions?.requestHeaders || {}),
        },
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (apiResult.isSuccess() && apiResult instanceof HTTPResponse) {
      const result: ModelAPIHttpResponse<TBaseModel> =
        apiResult as ModelAPIHttpResponse<TBaseModel>;

      if ((result.data as any)["_miscData"]) {
        result.miscData = (result.data as any)["_miscData"] as JSONObject;
        delete (result.data as any)["_miscData"];
      }

      result.data = BaseModel.fromJSONObject(result.data, data.modelType);

      return result;
    }

    this.checkStatusCode(apiResult);

    throw apiResult;
  }

  public static async getList<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    groupBy?: GroupBy<TBaseModel> | undefined;
    limit: number;
    skip: number;
    select: Select<TBaseModel>;
    sort: Sort<TBaseModel>;
    requestOptions?: RequestOptions | undefined;
  }): Promise<ListResult<TBaseModel>> {
    const model: TBaseModel = new data.modelType();
    const apiPath: Route | null = model.getCrudApiPath();
    if (!apiPath) {
      throw new BadDataException(
        "This model does not support list operations.",
      );
    }

    let apiUrl: URL = URL.fromURL(APP_API_URL)
      .addRoute(apiPath)
      .addRoute("/get-list");

    if (data.requestOptions?.overrideRequestUrl) {
      apiUrl = data.requestOptions.overrideRequestUrl;
    }

    if (!apiUrl) {
      throw new BadDataException(
        "This model does not support list operations.",
      );
    }

    const headers: Dictionary<string> = this.getCommonHeaders(
      data.requestOptions,
    );
    if (data.requestOptions && data.requestOptions.isMultiTenantRequest) {
      headers["isMultiTenantRequest"] = "true";
    }

    const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
      await API.fetch<JSONArray>({
        method: HTTPMethod.POST,
        url: apiUrl,
        data: {
          query: JSONFunctions.serialize(data.query as JSONObject),
          select: JSONFunctions.serialize(data.select as JSONObject),
          sort: JSONFunctions.serialize(data.sort as JSONObject),
          groupBy: JSONFunctions.serialize(data.groupBy as JSONObject),
        },
        headers,
        params: {
          limit: data.limit.toString(),
          skip: data.skip.toString(),
        },
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (result.isSuccess()) {
      const list: Array<TBaseModel> = BaseModel.fromJSONArray(
        result.data as JSONArray,
        data.modelType,
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

  public static async count<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    requestOptions?: RequestOptions | undefined;
  }): Promise<number> {
    const model: TBaseModel = new data.modelType();
    const apiPath: Route | null = model.getCrudApiPath();
    if (!apiPath) {
      throw new BadDataException(
        "This model does not support list operations.",
      );
    }

    let apiUrl: URL = URL.fromURL(APP_API_URL)
      .addRoute(apiPath)
      .addRoute("/count");

    if (data.requestOptions?.overrideRequestUrl) {
      apiUrl = data.requestOptions.overrideRequestUrl;
    }

    if (!apiUrl) {
      throw new BadDataException(
        "This model does not support count operations.",
      );
    }

    const headers: Dictionary<string> = this.getCommonHeaders(
      data.requestOptions,
    );
    if (data.requestOptions && data.requestOptions.isMultiTenantRequest) {
      headers["is-multi-tenant-query"] = "true";
    }

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: apiUrl,
        data: {
          query: JSONFunctions.serialize(data.query as JSONObject),
        },
        headers,
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (result.isSuccess()) {
      const count: number = result.data["count"] as number;

      return count;
    }

    this.checkStatusCode(result);

    throw result;
  }

  public static getCommonHeaders(
    requestOptions?: RequestOptions,
  ): Dictionary<string> {
    let headers: Dictionary<string> = {};

    if (
      !requestOptions ||
      !requestOptions.isMultiTenantRequest ||
      Object.keys(requestOptions).length === 0
    ) {
      const project: Project | null = ProjectUtil.getCurrentProject();

      if (project && project.id) {
        headers["tenantid"] = project.id.toString();
      } else {
        /*
         * Fallback to getCurrentProjectId() when full project data is not yet loaded
         * This can happen after SSO login when the project ID is available in URL/SessionStorage
         * but the full project data hasn't been fetched yet
         */
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (projectId) {
          headers["tenantid"] = projectId.toString();
        }
      }
    }

    // add SSO headers.

    headers = {
      ...headers,
    };

    if (requestOptions && requestOptions.isMultiTenantRequest) {
      headers["is-multi-tenant-query"] = "true";
    }

    return headers;
  }

  public static async getItem<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    select: Select<TBaseModel>;
    requestOptions?: RequestOptions | undefined;
  }): Promise<TBaseModel | null> {
    const apiPath: Route | null = new data.modelType().getCrudApiPath();
    if (!apiPath) {
      throw new BadDataException("This model does not support get operations.");
    }

    let apiUrl: URL = URL.fromURL(APP_API_URL)
      .addRoute(apiPath)
      .addRoute("/" + data.id.toString())
      .addRoute("/get-item");

    if (data.requestOptions?.overrideRequestUrl) {
      apiUrl = data.requestOptions.overrideRequestUrl;
    }

    if (!apiUrl) {
      throw new BadDataException("This model does not support get operations.");
    }

    return this.post<TBaseModel>({
      modelType: data.modelType,
      apiUrl: apiUrl,
      select: data.select,
      requestOptions: data.requestOptions,
    });
  }

  public static async post<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    apiUrl: URL;
    select?: Select<TBaseModel> | undefined;
    requestOptions?: RequestOptions | undefined;
  }): Promise<TBaseModel | null> {
    const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
      await API.fetch<TBaseModel>({
        method: HTTPMethod.POST,
        url: data.apiUrl,
        data: {
          select: JSONFunctions.serialize(data.select as JSONObject) || {},
        },
        headers: this.getCommonHeaders(data.requestOptions),
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (result.isSuccess()) {
      const baseModel: TBaseModel = BaseModel.fromJSONObject(
        result.data as JSONObject,
        data.modelType,
      );

      return baseModel;
    }

    this.checkStatusCode(result);

    throw result;
  }

  public static async deleteItem<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    requestOptions?: RequestOptions | undefined;
  }): Promise<void> {
    const apiPath: Route | null = new data.modelType().getCrudApiPath();
    if (!apiPath) {
      throw new BadDataException(
        "This model does not support delete operations.",
      );
    }

    const apiUrl: URL = URL.fromURL(APP_API_URL)
      .addRoute(apiPath)
      .addRoute("/" + data.id.toString());

    if (!apiUrl) {
      throw new BadDataException(
        "This model does not support delete operations.",
      );
    }

    const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
      await API.fetch<TBaseModel>({
        method: HTTPMethod.DELETE,
        url: apiUrl,
        headers: this.getCommonHeaders(data.requestOptions),
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (result.isSuccess()) {
      return;
    }

    this.checkStatusCode(result);

    throw result;
  }

  private static checkStatusCode<TBaseModel extends BaseModel>(
    result:
      | HTTPResponse<TBaseModel | JSONObject | JSONArray | Array<TBaseModel>>
      | HTTPErrorResponse,
  ): void {
    if (result.statusCode === 406) {
      const project: Project | null = ProjectUtil.getCurrentProject();

      if (project && project.id) {
        Navigation.navigate(new Route(`/dashboard/${project._id}/sso`));
      }
    }
  }
}

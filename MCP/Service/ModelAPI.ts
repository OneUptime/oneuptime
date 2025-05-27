import GroupBy from "@oneuptime/common/Types/BaseDatabase/GroupBy";
import BaseListResult from "@oneuptime/common/Types/BaseDatabase/ListResult";
import Select from "@oneuptime/common/Types/BaseDatabase/Select";
import BaseModel from "@oneuptime/common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "@oneuptime/common/Types/API/HTTPErrorResponse";
import HTTPMethod from "@oneuptime/common/Types/API/HTTPMethod";
import HTTPResponse from "@oneuptime/common/Types/API/HTTPResponse";
import Route from "@oneuptime/common/Types/API/Route";
import URL from "@oneuptime/common/Types/API/URL";
import Dictionary from "@oneuptime/common/Types/Dictionary";
import BadDataException from "@oneuptime/common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "@oneuptime/common/Types/JSON";
import JSONFunctions from "@oneuptime/common/Types/JSONFunctions";
import ObjectID from "@oneuptime/common/Types/ObjectID";
import Query from "@oneuptime/common/Types/BaseDatabase/Query";
import Sort from "@oneuptime/common/Types/BaseDatabase/Sort";
import { ApiKey, OneUptimeUrl, ProjectID } from "../Utils/Config";
import API from "@oneuptime/common/Utils/API";

export class ModelAPIHttpResponse<
  TBaseModel extends BaseModel,
> extends HTTPResponse<TBaseModel> {
  public miscData?: JSONObject | undefined;
}

export interface ListResult<TBaseModel extends BaseModel>
  extends BaseListResult<TBaseModel> {}

export default interface RequestOptions {
  requestHeaders?: Dictionary<string> | undefined;
  overrideRequestUrl?: URL | undefined;
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
      isCreate: true,
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
      isCreate: false,
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
          "This model does not support create or update operations."
        );
      }

      apiUrl = URL.fromURL(OneUptimeUrl).addRoute(apiPath);
    }

    apiUrl = apiUrl.addRoute(`/${data.id.toString()}`);

    const result: HTTPResponse<
      JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    > = await API.fetch<
      JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    >(
      HTTPMethod.PUT,
      apiUrl,
      {
        data: data.data,
      },
      this.getCommonHeaders(data.requestOptions)
    );

    if (result.isSuccess()) {
      return result;
    }

    this.checkStatusCode(result);

    throw result;
  }

  public static async createOrUpdate<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    modelType: { new (): TBaseModel };
    isCreate: boolean;
    miscDataProps?: JSONObject;
    requestOptions?: RequestOptions | undefined;
  }): Promise<ModelAPIHttpResponse<TBaseModel>> {
    let apiUrl: URL | null = data.requestOptions?.overrideRequestUrl || null;

    if (!apiUrl) {
      const apiPath: Route | null = data.model.getCrudApiPath();
      if (!apiPath) {
        throw new BadDataException(
          "This model does not support create or update operations."
        );
      }

      apiUrl = URL.fromURL(OneUptimeUrl).addRoute(apiPath);
    }

    const httpMethod: HTTPMethod = data.isCreate
      ? HTTPMethod.POST
      : HTTPMethod.PUT;

    if (
      httpMethod === HTTPMethod.PUT &&
      !data.requestOptions?.overrideRequestUrl
    ) {
      apiUrl = apiUrl.addRoute(`/${data.model._id}`);
    }

    const apiResult: HTTPErrorResponse | HTTPResponse<TBaseModel> =
      await API.fetch<TBaseModel>(
        httpMethod,
        apiUrl,
        {
          data: JSONFunctions.serialize(
            BaseModel.toJSON(data.model, data.modelType)
          ),
          miscDataProps: data.miscDataProps || {},
        },
        {
          ...this.getCommonHeaders(data.requestOptions),
          ...(data.requestOptions?.requestHeaders || {}),
        }
      );

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
        "This model does not support list operations."
      );
    }

    let apiUrl: URL = URL.fromURL(OneUptimeUrl)
      .addRoute(apiPath)
      .addRoute("/get-list");

    if (data.requestOptions?.overrideRequestUrl) {
      apiUrl = data.requestOptions.overrideRequestUrl;
    }

    if (!apiUrl) {
      throw new BadDataException(
        "This model does not support list operations."
      );
    }

    const headers: Dictionary<string> = this.getCommonHeaders(
      data.requestOptions
    );

    const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
      await API.fetch<JSONArray>(
        HTTPMethod.POST,
        apiUrl,
        {
          query: JSONFunctions.serialize(data.query as JSONObject),
          select: JSONFunctions.serialize(data.select as JSONObject),
          sort: JSONFunctions.serialize(data.sort as JSONObject),
          groupBy: JSONFunctions.serialize(data.groupBy as JSONObject),
        },
        headers,
        {
          limit: data.limit.toString(),
          skip: data.skip.toString(),
        }
      );

    if (result.isSuccess()) {
      const list: Array<TBaseModel> = BaseModel.fromJSONArray(
        result.data as JSONArray,
        data.modelType
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
        "This model does not support list operations."
      );
    }

    let apiUrl: URL = URL.fromURL(OneUptimeUrl)
      .addRoute(apiPath)
      .addRoute("/count");

    if (data.requestOptions?.overrideRequestUrl) {
      apiUrl = data.requestOptions.overrideRequestUrl;
    }

    if (!apiUrl) {
      throw new BadDataException(
        "This model does not support count operations."
      );
    }

    const headers: Dictionary<string> = this.getCommonHeaders(
      data.requestOptions
    );

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.fetch<JSONObject>(
        HTTPMethod.POST,
        apiUrl,
        {
          query: JSONFunctions.serialize(data.query as JSONObject),
        },
        headers
      );

    if (result.isSuccess()) {
      const count: number = result.data["count"] as number;

      return count;
    }

    this.checkStatusCode(result);

    throw result;
  }

  public static getCommonHeaders(
    requestOptions?: RequestOptions
  ): Dictionary<string> {
    let headers: Dictionary<string> = {};

    headers["ProjectID"] = ProjectID.toString();
    headers["APIKey"] = ApiKey.toString();

    headers = {
      ...requestOptions?.requestHeaders,
      ...headers,
    };

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

    let apiUrl: URL = URL.fromURL(OneUptimeUrl)
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
      await API.fetch<TBaseModel>(
        HTTPMethod.POST,
        data.apiUrl,
        {
          select: JSONFunctions.serialize(data.select as JSONObject) || {},
        },
        this.getCommonHeaders(data.requestOptions)
      );

    if (result.isSuccess()) {
      const baseModel: TBaseModel = BaseModel.fromJSONObject(
        result.data as JSONObject,
        data.modelType
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
        "This model does not support delete operations."
      );
    }

    const apiUrl: URL = URL.fromURL(OneUptimeUrl)
      .addRoute(apiPath)
      .addRoute("/" + data.id.toString());

    if (!apiUrl) {
      throw new BadDataException(
        "This model does not support delete operations."
      );
    }

    const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
      await API.fetch<TBaseModel>(
        HTTPMethod.DELETE,
        apiUrl,
        undefined,
        this.getCommonHeaders(data.requestOptions)
      );

    if (result.isSuccess()) {
      return;
    }

    this.checkStatusCode(result);

    throw result;
  }

  private static checkStatusCode<TBaseModel extends BaseModel>(
    result:
      | HTTPResponse<TBaseModel | JSONObject | JSONArray | Array<TBaseModel>>
      | HTTPErrorResponse
  ): void {
    if (result.statusCode === 406) {
      throw new BadDataException(
        "The request was not acceptable. Please check the data you are sending."
      );
    }
  }
}

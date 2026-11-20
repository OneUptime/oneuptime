import { FormType } from "../../Components/Forms/ModelForm";
import { APP_API_URL } from "../../Config";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import BaseListResult from "../../../Types/BaseDatabase/ListResult";
import Select from "../../../Types/BaseDatabase/Select";
import Navigation from "../Navigation";
import ProjectUtil from "../Project";
import BaseRequestOptions from "../API/RequestOptions";
import RecordChanges, { RecordChangeKind } from "./RecordChanges";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import MoveInListUtil, {
  MoveInListResult,
  getMoveInListRoute,
} from "../../../Types/Database/MoveInList";
import BadDataException from "../../../Types/Exception/BadDataException";
import ListChangesUtil, {
  ListChanges,
} from "../../../Types/Database/ListChanges";
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
  /**
   * The API client used for model requests.
   *
   * Most applications use the authenticated dashboard client. Public-facing
   * applications can override this accessor so a model request cannot inherit
   * dashboard logout and redirect behavior merely because it reuses ModelAPI.
   */
  protected static getApiClient(): typeof API {
    return API;
  }

  /*
   * The client for ONE request: a client the caller routed this request
   * through (RequestOptions.apiClient) wins; otherwise this class's client.
   */
  protected static getApiClientForRequest(
    requestOptions?: RequestOptions | undefined,
  ): typeof API {
    return requestOptions?.apiClient || this.getApiClient();
  }

  public static async create<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    modelType: { new (): TBaseModel };
    /*
     * Extra values that are not columns on the model but that the service
     * reads off `createBy.miscDataProps` (for example the note a user writes
     * when they change an incident state).
     */
    miscDataProps?: JSONObject | undefined;
    requestOptions?: RequestOptions | undefined;
  }): Promise<
    HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
  > {
    return await this.createOrUpdate({
      model: data.model,
      modelType: data.modelType,
      formType: FormType.Create,
      miscDataProps: data.miscDataProps || {},
      requestOptions: data.requestOptions,
    });
  }

  public static async update<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    modelType: { new (): TBaseModel };
  }): Promise<
    HTTPResponse<JSONObject | JSONArray | TBaseModel | Array<TBaseModel>>
  > {
    return await this.createOrUpdate({
      model: data.model,
      modelType: data.modelType,
      formType: FormType.Update,
    });
  }

  public static async updateById<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    data: JSONObject;
    /*
     * What the service's update hooks read beside the columns - the revision
     * of the graph a workflow's save was made to, for one. Sent only when
     * given.
     */
    miscDataProps?: JSONObject | undefined;
    /*
     * Entries to add to the record's lists of related records and take off
     * them, by the list's field (Types/Database/ListChanges, #10135): only
     * those are written, so a label a rule adds at the same moment stays.
     * Sent only when given.
     */
    listChanges?: ListChanges | undefined;
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
    > = await this.getApiClientForRequest(data.requestOptions).fetch<
      JSONObject | JSONArray | TBaseModel | Array<TBaseModel>
    >({
      method: HTTPMethod.PUT,
      url: apiUrl,
      data: {
        data: data.data,
        ...(data.miscDataProps ? { miscDataProps: data.miscDataProps } : {}),
        ...(data.listChanges
          ? ListChangesUtil.toRequestBody(data.listChanges)
          : {}),
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

  /*
   * Moves a row of an ordered list - escalation rules, schedule layers and
   * their people, status page groups and resources, and every list people
   * drag into order (@ListOrderColumn: severities, states, rules,
   * pipelines...) - to the place another row of its list holds: the rows
   * between step one place towards where it was (POST <the list's
   * path>/:id/move, Types/Database/MoveInList). What a drag, or Move up and
   * Move down, sends. A write of the row's number (updateById) places that
   * row alone, as Terraform needs, and never moves the others. Throws what
   * the server answered when it refused.
   */
  public static async moveInList<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    placeOfId: ObjectID;
    requestOptions?: RequestOptions;
  }): Promise<MoveInListResult> {
    const model: TBaseModel = new data.modelType();
    const apiPath: Route | null = model.getCrudApiPath();
    const column: string | null = MoveInListUtil.getListColumn(model);

    if (!apiPath || !column) {
      throw new BadDataException("This list's rows cannot be moved.");
    }

    const apiUrl: URL = URL.fromURL(APP_API_URL)
      .addRoute(apiPath)
      .addRoute(getMoveInListRoute(data.id.toString()));

    const result: HTTPResponse<JSONObject | JSONArray> =
      await this.getApiClientForRequest(data.requestOptions).fetch<
        JSONObject | JSONArray
      >({
        method: HTTPMethod.POST,
        url: apiUrl,
        data: MoveInListUtil.requestToJSON({ placeOfId: data.placeOfId }),
        headers: this.getCommonHeaders(data.requestOptions),
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (result.isSuccess()) {
      return MoveInListUtil.resultFromJSON(result.data, column);
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

    const headers: Dictionary<string> = {
      ...this.getCommonHeaders(data.requestOptions),
      ...(data.requestOptions?.requestHeaders || {}),
    };

    const apiResult: HTTPErrorResponse | HTTPResponse<TBaseModel> =
      await this.getApiClientForRequest(data.requestOptions).fetch<TBaseModel>({
        method: httpMethod,
        url: apiUrl,
        data: {
          data: JSONFunctions.serialize(
            BaseModel.toJSON(data.model, data.modelType),
          ),
          miscDataProps: data.miscDataProps || {},
        },
        headers: headers,
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

      if (data.formType === FormType.Create) {
        this.announceCreated({
          model: data.model,
          created: result.data,
          tenantId: headers["tenantid"],
        });
      }

      return result;
    }

    this.checkStatusCode(apiResult);

    throw apiResult;
  }

  /*
   * Tells the page a record was created (RecordChanges): its table, and its
   * project - the one the server stored it in, else the one it was asked
   * in. Never throws: the create is done whatever a listener makes of it.
   */
  private static announceCreated(data: {
    model: BaseModel;
    created: BaseModel | null | undefined;
    tenantId: string | undefined;
  }): void {
    try {
      const tableName: string | null | undefined = data.model.tableName;

      if (!tableName) {
        return;
      }

      const storedProjectId: unknown =
        data.created && typeof data.created.getValue === "function"
          ? data.created.getValue<ObjectID>("projectId")
          : undefined;

      RecordChanges.announce({
        kind: RecordChangeKind.Created,
        tableName: tableName,
        projectId:
          (storedProjectId ? String(storedProjectId) : "") ||
          data.tenantId ||
          null,
      });
    } catch {
      // Nothing heard: the next page load reads what changed.
    }
  }

  /*
   * Tells the page a record was deleted (RecordChanges, #8204): its table,
   * and the project it was asked in. Never throws: the delete is done
   * whatever a listener makes of it.
   */
  private static announceDeleted<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    tenantId: string | undefined;
  }): void {
    try {
      const tableName: string | null | undefined = new data.modelType()
        .tableName;

      if (!tableName) {
        return;
      }

      RecordChanges.announce({
        kind: RecordChangeKind.Deleted,
        tableName: tableName,
        projectId: data.tenantId || null,
      });
    } catch {
      // Nothing heard: the next look at the products reads what changed.
    }
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
    /*
     * Count no further than this many records (or the end of the page, if
     * that is further): more match when the result's isCountCapped is set,
     * and its count is the cap. Unset, the count is exact.
     */
    countUpTo?: number | undefined;
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

    const headers: Dictionary<string> = {
      ...this.getCommonHeaders(data.requestOptions),
      ...(data.requestOptions?.requestHeaders || {}),
    };
    if (data.requestOptions && data.requestOptions.isMultiTenantRequest) {
      headers["isMultiTenantRequest"] = "true";
    }

    const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
      await this.getApiClientForRequest(data.requestOptions).fetch<JSONArray>({
        method: HTTPMethod.POST,
        url: apiUrl,
        data: {
          ...(data.requestOptions?.additionalRequestBody || {}),
          query: JSONFunctions.serialize(data.query as JSONObject),
          select: JSONFunctions.serialize(data.select as JSONObject),
          sort: JSONFunctions.serialize(data.sort as JSONObject),
          groupBy: JSONFunctions.serialize(data.groupBy as JSONObject),
          ...(data.countUpTo !== undefined
            ? { countUpTo: data.countUpTo }
            : {}),
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
        ...(result.isCountCapped ? { isCountCapped: true } : {}),
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
      await this.getApiClientForRequest(data.requestOptions).fetch<JSONObject>({
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

    /*
     * A request routed through another app's client (a public dashboard
     * widget's /public-dashboard-api read) is not scoped to the viewer's own
     * project: that client sends its own tenant header. The viewer's
     * last-opened dashboard project would override it, and a stale or
     * foreign one turns the public read into a 405 (tenant not found) that
     * the public page treats as a login event.
     */
    const isRoutedToAnotherClient: boolean = Boolean(requestOptions?.apiClient);

    if (
      !isRoutedToAnotherClient &&
      (!requestOptions ||
        !requestOptions.isMultiTenantRequest ||
        Object.keys(requestOptions).length === 0)
    ) {
      /*
       * Read the tenant id via getCurrentProjectId() first - a plain string
       * read off the URL/SessionStorage/LocalStorage id keys. This is what
       * makes requests work in the SSO-login window where the project ID is
       * already available in URL/SessionStorage but the full project data
       * hasn't been fetched yet, and it avoids hydrating the entire Project
       * model from LocalStorage on every single request just for the id.
       */
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (projectId) {
        headers["tenantid"] = projectId.toString();
      } else {
        /*
         * Fallback to the stored project. getCurrentProject() resolves its id
         * through getCurrentProjectId() too, so this only matters if that
         * resolution ever diverges - kept to preserve the historical fallback
         * chain.
         */
        const project: Project | null = ProjectUtil.getCurrentProject();

        if (project && project.id) {
          headers["tenantid"] = project.id.toString();
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

    try {
      return await this.post<TBaseModel>({
        modelType: data.modelType,
        apiUrl: apiUrl,
        select: data.select,
        requestOptions: data.requestOptions,
      });
    } catch (error) {
      /*
       * The API's get-item route answers 404 for a record that does not
       * exist or that the caller may not read: no record, which every
       * caller of getItem already handles as null. A route of the caller's
       * own (overrideRequestUrl) says what its 404 means itself - a route
       * that is not there answers 404 too - so its failures are raised.
       */
      if (
        !data.requestOptions?.overrideRequestUrl &&
        ModelAPI.isNotFound(error)
      ) {
        return null;
      }

      throw error;
    }
  }

  // Whether a request failed because the record is not one the caller can reach.
  public static isNotFound(error: unknown): boolean {
    return error instanceof HTTPErrorResponse && error.statusCode === 404;
  }

  public static async post<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    apiUrl: URL;
    select?: Select<TBaseModel> | undefined;
    requestOptions?: RequestOptions | undefined;
  }): Promise<TBaseModel | null> {
    const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
      await this.getApiClientForRequest(data.requestOptions).fetch<TBaseModel>({
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
    /*
     * Choices beside the id the delete's hooks read (the server's
     * DeleteOneBy.miscDataProps): what the workflows that run as a custom
     * role run as once it is deleted, for one. Sent in the request's body.
     */
    miscDataProps?: JSONObject | undefined;
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

    const headers: Dictionary<string> = this.getCommonHeaders(
      data.requestOptions,
    );

    const result: HTTPResponse<TBaseModel> | HTTPErrorResponse =
      await this.getApiClientForRequest(data.requestOptions).fetch<TBaseModel>({
        method: HTTPMethod.DELETE,
        url: apiUrl,
        headers: headers,
        ...(data.miscDataProps
          ? { data: { miscDataProps: data.miscDataProps } }
          : {}),
        ...(data.requestOptions?.apiRequestOptions
          ? { options: data.requestOptions.apiRequestOptions }
          : {}),
      });

    if (result.isSuccess()) {
      this.announceDeleted({
        modelType: data.modelType,
        tenantId: headers["tenantid"],
      });
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

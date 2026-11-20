import UserMiddleware from "../Middleware/UserAuthorization";
import DatabaseService from "../Services/DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import GroupBy from "../Types/Database/GroupBy";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import Sort from "../Types/Database/Sort";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CommonAPI from "./CommonAPI";
import ServerProducts from "../Utils/ServerProducts/ServerProducts";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import MoveInListUtil, {
  MOVE_IN_LIST_ROUTE,
  MoveInListRequest,
  MoveInListResult,
} from "../../Types/Database/MoveInList";
import { coerceNumericColumnsInJSON } from "../../Types/Database/NumericColumnValue";
import { coerceDateColumnsInJSON } from "../../Types/Database/DateColumnValue";
import { coerceBooleanColumnsInJSON } from "../../Types/Database/BooleanColumnValue";
import { coerceTextColumnsInJSON } from "../../Types/Database/TextColumnValue";
import ListChangesUtil, { ListChanges } from "../../Types/Database/ListChanges";
import FieldsLeftOut, {
  FIELDS_LEFT_OUT_HEADER,
} from "../../Types/API/FieldsLeftOut";
import ListEntries from "../Utils/Database/ListEntries";
import BadDataException from "../../Types/Exception/BadDataException";
import BadRequestException from "../../Types/Exception/BadRequestException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";

export default class BaseAPI<
  TBaseModel extends BaseModel,
  TBaseService extends DatabaseService<BaseModel>,
> {
  public entityType: { new (): TBaseModel };

  public router: ExpressRouter;
  public service: TBaseService;

  public constructor(type: { new (): TBaseModel }, service: TBaseService) {
    this.entityType = type;
    const router: ExpressRouter = Express.getRouter();
    // Create
    router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.createItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // List
    router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/get-list`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getList(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // List
    router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/get-list`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getList(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // count
    router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/count`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.count(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Get Item
    router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/get-item`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Get Item
    router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/get-item`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Update
    router.put(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.updateItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/update-item`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.updateItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Delete
    router.delete(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.deleteItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/delete-item`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.deleteItem(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Move, for a table whose rows make up ordered lists (issues #9573,
     * #9609): POST /<path>/:id/move { "placeOfId": "<id>" } moves the row
     * to the place of the row named, the rows between stepping aside
     * (Types/Database/MoveInList). A write of the list's number through the
     * routes above places the row alone - what Terraform needs, numbering a
     * whole list one write per row - so a move, what someone dragging a row
     * means, is its own request. A request with no session is answered 401,
     * so an idle tab refreshes it.
     */
    if (MoveInListUtil.getListColumn(new this.entityType())) {
      router.post(
        `${new this.entityType().getCrudApiPath()?.toString()}${MOVE_IN_LIST_ROUTE}`,
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
        async (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => {
          try {
            await this.moveItem(req, res);
          } catch (err) {
            next(err);
          }
        },
      );
    }

    this.router = router;
    this.service = service;
  }

  public getTenantId(req: ExpressRequest): ObjectID | null {
    if ((req as OneUptimeRequest).tenantId) {
      return (req as OneUptimeRequest).tenantId as ObjectID;
    }

    return null;
  }

  @CaptureSpan()
  public async getList(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeList(req, res);

    /*
     * Extract pagination parameters from query or body (for POST requests)
     * Support both 'skip' and 'offset' parameters (offset is alias for skip)
     */
    let skipValue: number = 0;
    let limitValue: number = DEFAULT_LIMIT;

    if (req.query["skip"]) {
      skipValue = parseInt(req.query["skip"] as string, 10) || 0;
    } else if (req.body && req.body["skip"] !== undefined) {
      skipValue = parseInt(req.body["skip"] as string, 10) || 0;
    }

    if (req.query["limit"]) {
      limitValue = parseInt(req.query["limit"] as string, 10) || DEFAULT_LIMIT;
    } else if (req.body && req.body["limit"] !== undefined) {
      limitValue = parseInt(req.body["limit"] as string, 10) || DEFAULT_LIMIT;
    }

    const skip: PositiveNumber = new PositiveNumber(skipValue);
    const limit: PositiveNumber = new PositiveNumber(limitValue);

    if (limit.toNumber() > LIMIT_PER_PROJECT) {
      throw new BadRequestException(
        "Limit should be less than " + LIMIT_PER_PROJECT,
      );
    }

    if (skip.toNumber() < 0) {
      throw new BadRequestException(
        "Skip should be greater than or equal to 0",
      );
    }

    if (limit.toNumber() <= 0) {
      throw new BadRequestException("Limit should be greater than 0");
    }

    /*
     * How far the list's count goes (countUpTo): a list that asks counts no
     * further than this many records, or than the end of the page it reads
     * if that is further, so the count costs that many records however many
     * match. More than that answers the cap with isCountCapped - "10,000+" -
     * and also says there are records after this page. A client that does
     * not ask (the API, older dashboards) gets the exact count, as before.
     */
    const countUpTo: number | undefined = BaseAPI.getCountUpTo(req);
    const countCap: number | undefined =
      countUpTo === undefined
        ? undefined
        : Math.max(countUpTo, skip.toNumber() + limit.toNumber());

    let query: Query<BaseModel> = {};
    let select: Select<BaseModel> = {};
    let sort: Sort<BaseModel> = {};
    let groupBy: GroupBy<BaseModel> | undefined;

    if (req.body) {
      query = JSONFunctions.deserialize(req.body["query"]) as Query<BaseModel>;

      select = JSONFunctions.deserialize(
        req.body["select"],
      ) as Select<BaseModel>;

      sort = JSONFunctions.deserialize(req.body["sort"]) as Sort<BaseModel>;

      groupBy = JSONFunctions.deserialize(
        req.body["groupBy"],
      ) as GroupBy<BaseModel>;
    }

    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    /*
     * findBy and countBy are independent reads, so run them in parallel to
     * cut list latency where the count is costly. The one thing that makes
     * the sequential order load-bearing is a service-level onBeforeFind
     * override that mutates the shared query/props objects in place (e.g.
     * ProjectService elevates props.isRoot and pins query._id for users with
     * no projects; the incident/alert privacy filters rewrite query keys):
     * countBy historically ran after findBy and inherited those mutations.
     * Services on the stock hook cannot mutate anything (and the permission
     * pipeline copies the query before touching it, ReadPermission.ts:33),
     * so only they run in parallel; hook-overriding services keep the
     * sequential order and its exact semantics.
     */
    const usesStockOnBeforeFindHook: boolean =
      (this.service as unknown as { onBeforeFind: unknown }).onBeforeFind ===
      (DatabaseService.prototype as unknown as { onBeforeFind: unknown })
        .onBeforeFind;

    let list: Array<BaseModel>;
    let count: PositiveNumber;

    if (usesStockOnBeforeFindHook) {
      const listPromise: Promise<Array<BaseModel>> = this.service.findBy({
        query,
        select,
        skip: skip,
        limit: limit,
        groupBy: groupBy,
        sort: sort,
        props: databaseProps,
      });

      /*
       * Shallow copies so a countBy override that rewrites top-level query
       * keys (the established privacy-filter pattern) can never race the
       * concurrent findBy's reads of the shared objects.
       */
      const countPromise: Promise<PositiveNumber> = this.service.countBy({
        query: { ...query },
        props: { ...databaseProps },
        ...(countCap !== undefined ? { upTo: countCap } : {}),
      });

      /*
       * allSettled instead of Promise.all: a findBy rejection must not leave
       * countPromise as an unhandled rejection, and findBy's error keeps
       * priority when both fail - the same failure the sequential code
       * surfaced.
       */
      const [listResult, countResult]: [
        PromiseSettledResult<Array<BaseModel>>,
        PromiseSettledResult<PositiveNumber>,
      ] = await Promise.allSettled([listPromise, countPromise]);

      if (listResult.status === "rejected") {
        throw listResult.reason;
      }

      if (countResult.status === "rejected") {
        throw countResult.reason;
      }

      list = listResult.value;
      count = countResult.value;
    } else {
      list = await this.service.findBy({
        query,
        select,
        skip: skip,
        limit: limit,
        groupBy: groupBy,
        sort: sort,
        props: databaseProps,
      });

      count = await this.service.countBy({
        query,
        props: databaseProps,
        ...(countCap !== undefined ? { upTo: countCap } : {}),
      });
    }

    await this.onBeforeSendRecords(list);

    // More matched than the cap: the count is the cap, and says so.
    if (countCap !== undefined && count.toNumber() > countCap) {
      return Response.sendEntityArrayResponse(
        req,
        res,
        list,
        new PositiveNumber(countCap),
        this.entityType,
        { isCountCapped: true },
      );
    }

    return Response.sendEntityArrayResponse(
      req,
      res,
      list,
      count,
      this.entityType,
    );
  }

  /*
   * The countUpTo a list read asks for, from its body or its query string
   * as skip and limit are read: a whole number of at least 1, or undefined
   * when it asks for none (an exact count).
   */
  public static getCountUpTo(req: ExpressRequest): number | undefined {
    let value: unknown = undefined;

    if (req.query && req.query["countUpTo"] !== undefined) {
      value = req.query["countUpTo"];
    } else if (req.body && req.body["countUpTo"] !== undefined) {
      value = req.body["countUpTo"];
    }

    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const countUpTo: number =
      typeof value === "number" ? value : Number(String(value).trim());

    if (!Number.isSafeInteger(countUpTo) || countUpTo < 1) {
      throw new BadRequestException(
        "The list's countUpTo must be a whole number of at least 1. Send one, such as 10000, or leave it out to count every record.",
      );
    }

    return countUpTo;
  }

  @CaptureSpan()
  public async count(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    let query: Query<BaseModel> = {};

    await this.onBeforeCount(req, res);

    if (req.body) {
      query = JSONFunctions.deserialize(req.body["query"]) as Query<BaseModel>;
    }

    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const count: PositiveNumber = await this.service.countBy({
      query,
      props: databaseProps,
    });

    return Response.sendJsonObjectResponse(req, res, {
      count: count.toNumber(),
    });
  }

  @CaptureSpan()
  public async getItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);
    const objectId: ObjectID = new ObjectID(idParam);
    await this.onBeforeGet(req, res);
    let select: Select<BaseModel> = {};

    if (req.body) {
      select = JSONFunctions.deserialize(
        req.body["select"],
      ) as Select<BaseModel>;
    }

    const item: BaseModel | null = await this.service.findOneById({
      id: objectId,
      select,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    });

    /*
     * A record that does not exist, is in another project or is one the
     * caller may not read is answered as missing (404) - the same answer
     * for each, and the same as a change or a delete of it gets
     * (getUnwrittenByIdError). It used to answer 200 with an empty body,
     * which a client could not tell from a record with nothing in it.
     */
    if (!item) {
      throw new NotFoundException(
        `${new this.entityType().singularName || "Record"} not found.`,
      );
    }

    await this.onBeforeSendRecords([item]);

    return Response.sendEntityResponse(req, res, item, this.entityType);
  }

  @CaptureSpan()
  public async deleteItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();
    await this.onBeforeDelete(req, res);
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);
    const objectId: ObjectID = new ObjectID(idParam);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    /*
     * Choices that ride along with the delete but are not columns, as an
     * update's do - what the workflows that run as a custom role run as
     * once it is gone, for one (#9767). Sent in the body of the DELETE (or
     * of POST /:id/delete-item); anything that is not a plain object is
     * ignored, and a delete with none is the delete it always was.
     */
    const body: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};
    const miscDataInBody: JSONValue | undefined = body["miscDataProps"];

    const numberOfDocsDeleted: number = await this.service.deleteOneById({
      id: objectId,
      ...(miscDataInBody &&
      typeof miscDataInBody === "object" &&
      !Array.isArray(miscDataInBody)
        ? {
            miscDataProps: JSONFunctions.deserialize(
              miscDataInBody as JSONObject,
            ),
          }
        : {}),
      props: props,
    });

    /*
     * A delete that removed nothing says so, as an update does: a record
     * the caller may not read is answered as missing (404), one they may
     * read but not delete is refused. See getUnwrittenByIdError.
     */
    if (numberOfDocsDeleted === 0) {
      throw await this.service.getUnwrittenByIdError({
        id: objectId,
        props: props,
        type: DatabaseRequestType.Delete,
      });
    }

    return Response.sendEmptySuccessResponse(req, res);
  }

  /*
   * POST /<path>/:id/move: moves the row to the place of the row named in
   * placeOfId (the service's moveInList) and answers the rows given another
   * number, each under the list's own number column. The project is the
   * request's tenant; a project API key is asked like a member, its
   * permissions deciding: the move is refused to whoever may not change the
   * row's number.
   */
  @CaptureSpan()
  public async moveItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const idParam: string = String(req.params["id"] || "");
    ObjectID.validateUUID(idParam);

    const request: MoveInListRequest = MoveInListUtil.parseRequest(req.body);

    const result: MoveInListResult = await this.service.moveInList({
      id: new ObjectID(idParam),
      placeOfId: request.placeOfId,
      props: props,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      MoveInListUtil.resultToJSON(
        result,
        MoveInListUtil.getListColumn(new this.entityType()) || undefined,
      ),
    );
  }

  @CaptureSpan()
  public async updateItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();
    await this.onBeforeUpdate(req, res);
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);
    const objectId: ObjectID = new ObjectID(idParam);
    const objectIdString: string = objectId.toString();
    const body: JSONObject = req.body;

    /*
     * Entries to add to the record's lists and take off them, beside or in
     * place of `data` (Types/Database/ListChanges, #10135): only those
     * entries are written, so an entry OneUptime or someone else adds at
     * the same moment stays.
     */
    const entityModel: TBaseModel = new this.entityType();
    const listChanges: ListChanges | null = ListChangesUtil.fromRequestBody({
      body: body,
      listColumns: ListEntries.getListColumns(entityModel),
      modelName: entityModel.singularName || this.entityType.name || "Record",
    });

    const dataInBody: JSONValue | undefined =
      body["data"] === undefined && listChanges ? {} : body["data"];

    /*
     * The update payload has to be wrapped as { "data": { ...columns... } }.
     * A flat body has no "data" key, and deserializing that undefined handed
     * back an empty object: the update then matched the row, wrote no columns
     * at all, and still answered 200. Callers were told the write succeeded
     * while their fields were dropped on the floor. An update that only adds
     * entries to lists and takes them off sends no `data`.
     */
    if (
      !dataInBody ||
      typeof dataInBody !== "object" ||
      Array.isArray(dataInBody)
    ) {
      throw new BadDataException(
        'Invalid request body. The update payload should be an object of the form { "data": { ...fields to update... } }.',
      );
    }

    /*
     * Coerced the same way createItem's BaseModel.fromJSON coerces, so a
     * PATCH and a POST agree on what a number column holds. The dashboard's
     * number fields are `<input type="number">`, whose value is a string,
     * and the save-time hooks read these values before Postgres would
     * coerce them — a sample percentage of "10" was rejected as "not a
     * number" on a form that had one filled in.
     * github.com/OneUptime/oneuptime/issues/3027
     *
     * Date columns have the same problem for the same reason: an
     * `<input type="date">` posts "2027-01-01", and a hook that reads the
     * column back gets a string where it expects a Date. See
     * Types/Database/DateColumnValue.
     *
     * And a switch sent as text - "true", "yes", 1 - is the boolean the
     * database stores for it, as on a create. DatabaseService turns them
     * for every write and refuses a value the database would refuse; this
     * keeps the PUT and the POST alike before the service sees either. See
     * Types/Database/BooleanColumnValue.
     *
     * And a name sent as the person's-name object - as the API's schema
     * asked for thirty-one names before they were text - is the text it
     * holds, as on a create. See Types/Database/TextColumnValue.
     */

    const item: PartialEntity<TBaseModel> = coerceTextColumnsInJSON(
      coerceBooleanColumnsInJSON(
        coerceDateColumnsInJSON(
          coerceNumericColumnsInJSON(
            JSONFunctions.deserialize(dataInBody as JSONObject),
            entityModel,
          ),
          entityModel,
        ),
        entityModel,
      ),
      entityModel,
    ) as PartialEntity<TBaseModel>;

    delete (item as any)["_id"];
    delete (item as any)["createdAt"];
    delete (item as any)["updatedAt"];

    /*
     * An update that carries no columns writes nothing. Saying 200 to that is
     * the same lie in a different shape, so ask for at least one field - or
     * an entry to add to a list or take off it.
     */
    if (Object.keys(item).length === 0 && !listChanges) {
      throw new BadDataException(
        'No fields to update. Please include at least one field to update in the "data" object of the request body.',
      );
    }

    /*
     * Choices that ride along with the edit but are not columns - whether to
     * tell status page subscribers about it, for one. createItem has always
     * passed these on; updates dropped them, so a form could offer such a
     * choice on create only. Anything that is not a plain object is ignored
     * rather than refused: the field is optional and older clients send {}.
     */
    const miscDataInBody: JSONValue | undefined = body["miscDataProps"];

    const miscDataProps: JSONObject =
      miscDataInBody &&
      typeof miscDataInBody === "object" &&
      !Array.isArray(miscDataInBody)
        ? JSONFunctions.deserialize(miscDataInBody as JSONObject)
        : {};

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const numberOfDocsAffected: number = await this.service.updateOneById({
      id: new ObjectID(objectIdString),
      data: item,
      miscDataProps: miscDataProps,
      ...(listChanges ? { listChanges: listChanges } : {}),
      props: props,
    });

    /*
     * The permission layer narrows the update query after we build it (tenant
     * scope, access-control labels, owned scope, and what the caller may
     * read), so it is possible to match no rows at all. Reporting 200 for
     * that told the client the edit was saved when nothing was written - the
     * change then "disappeared" on the next page load with no error
     * anywhere. A record the caller may not read is answered as missing
     * (404), one they may read but not change is refused. See
     * getUnwrittenByIdError.
     */
    if (numberOfDocsAffected === 0) {
      throw await this.service.getUnwrittenByIdError({
        id: objectId,
        props: props,
        type: DatabaseRequestType.Update,
      });
    }

    return Response.sendEmptySuccessResponse(req, res);
  }

  @CaptureSpan()
  public async createItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.assertProductIsOn();
    await this.onBeforeCreate(req, res);
    const body: JSONObject = req.body;

    const item: TBaseModel = BaseModel.fromJSON<TBaseModel>(
      body["data"] as JSONObject,
      this.entityType,
    ) as TBaseModel;

    /*
     * A create builds a brand-new row, so it must not carry the row's own
     * primary key. getRepository().save() treats an entity that already has an
     * id as an update of the existing row rather than an insert, so a stray
     * `_id` (or the `id` spelling, which BaseModel.fromJSON has already folded
     * into `_id`) would make a "create" modify an existing record instead.
     *
     * CLEARED, NOT DELETED, and that distinction is load-bearing: `item` is a
     * live model instance that the service then asks for its own column list
     * (DatabaseService.generateDefaultValues -> data.getTableColumns()), and
     * that lookup used to enumerate this very instance's own keys and cache
     * the result for the whole CLASS. Deleting `_id` here therefore taught the
     * process that this model has no `_id` column, and every later response
     * for it - to any caller, including reads - was serialized without one.
     * TableColumn.ts no longer reads the caller's instance, so this is now
     * defence in depth rather than the fix; the trap is removed all the same.
     * DatabaseService.sanitizeUpdateData skips these keys the same way instead
     * of deleting them off a model.
     *
     * `undefined` is what an unset column holds anyway, so nothing downstream
     * can tell it from an absent key: TypeORM reads primary keys through
     * ColumnMetadata.getEntityValue and treats undefined as "no id"
     * (EntityMetadata.getValueMap skips it, so the Subject gets no identifier
     * and must be INSERTed), the create path's own "an id cannot be supplied"
     * guard tests `data._id` for truthiness, ColumnPermissions skips data keys
     * whose value is undefined, and toJSONObject omits them from responses.
     *
     * Only the top-level primary key is cleared - nested `_id`s inside
     * relation objects/arrays reference existing related rows and are left
     * untouched. `id` needs no handling: it is a prototype accessor derived
     * from `_id` (never an own property), and its setter ignores falsy values.
     */
    (item as any)["_id"] = undefined;

    const miscDataProps: JSONObject = JSONFunctions.deserialize(
      body["miscDataProps"] as JSONObject,
    );

    const createBy: CreateBy<TBaseModel> = {
      data: item,
      miscDataProps: miscDataProps,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
      // Filled in by the create: what it left out because only OneUptime writes it.
      fieldsLeftOut: [],
    };

    const savedItem: BaseModel = await this.service.create(createBy);

    /*
     * The answer names the fields the create left out because only
     * OneUptime writes them (Types/API/FieldsLeftOut, #10136), beside the
     * record, so a caller that copied a record - the CLI, the MCP server, a
     * status page imported from JSON - can say so. None, no header.
     */
    if (createBy.fieldsLeftOut && createBy.fieldsLeftOut.length > 0) {
      res.setHeader(
        FIELDS_LEFT_OUT_HEADER,
        FieldsLeftOut.toHeaderValue(createBy.fieldsLeftOut),
      );
    }

    return Response.sendEntityResponse(req, res, savedItem, this.entityType);
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  /*
   * Refuses a create, change or delete of any record of a product while the
   * product is switched off on the server (#6815, #7479): its main record
   * and every record that hangs off it (Types/Product/ProductRecordTables),
   * with what happened and who can switch it on - before a hook runs. The
   * write itself is refused again where every caller's write is
   * (ProductWriteRefusal). Reads are never refused: products that are on
   * show records of others.
   */
  public async assertProductIsOn(): Promise<void> {
    await ServerProducts.assertRecordTableIsOn(new this.entityType().tableName);
  }

  public getEntityName(): string {
    return this.entityType.name;
  }

  protected async onBeforeList(
    _req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<any> {
    return Promise.resolve(true);
  }

  protected async onBeforeCreate(
    _req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<any> {
    return Promise.resolve(true);
  }

  protected async onBeforeGet(
    _req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<any> {
    return Promise.resolve(true);
  }

  protected async onBeforeUpdate(
    _req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<any> {
    return Promise.resolve(true);
  }

  protected async onBeforeDelete(
    _req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<any> {
    return Promise.resolve(true);
  }

  protected async onBeforeCount(
    _req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<any> {
    return Promise.resolve(true);
  }

  /*
   * What an API puts on the records a get-item or a get-list read found,
   * just before they are sent: nothing, unless it says otherwise. Here, on
   * the way out of the API, rather than in the service's read: a service
   * that changes what it found loses realtime's shortcut for the readers
   * who read every record of a project (readsEveryRecordInProject). The
   * monitor's API puts each monitor's latest heartbeat over the row's
   * (MonitorAPI, issue #8123).
   */
  protected async onBeforeSendRecords(
    _records: Array<BaseModel>,
  ): Promise<void> {
    return Promise.resolve();
  }
}

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
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import { coerceNumericColumnsInJSON } from "../../Types/Database/NumericColumnValue";
import BadDataException from "../../Types/Exception/BadDataException";
import BadRequestException from "../../Types/Exception/BadRequestException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import { UserPermission } from "../../Types/Permission";
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

    router.get(
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

    router.get(
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

    this.router = router;
    this.service = service;
  }

  @CaptureSpan()
  public async getPermissionsForTenant(
    req: ExpressRequest,
  ): Promise<Array<UserPermission>> {
    const permissions: Array<UserPermission> = [];

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (
      props &&
      props.userTenantAccessPermission &&
      props.userTenantAccessPermission[props.tenantId?.toString() || ""]
    ) {
      return (
        props.userTenantAccessPermission[props.tenantId?.toString() || ""]
          ?.permissions || []
      );
    }

    return permissions;
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

    const list: Array<BaseModel> = await this.service.findBy({
      query,
      select,
      skip: skip,
      limit: limit,
      groupBy: groupBy,
      sort: sort,
      props: databaseProps,
    });

    const count: PositiveNumber = await this.service.countBy({
      query,
      props: databaseProps,
    });

    return Response.sendEntityArrayResponse(
      req,
      res,
      list,
      count,
      this.entityType,
    );
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

    return Response.sendEntityResponse(req, res, item, this.entityType);
  }

  @CaptureSpan()
  public async deleteItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeDelete(req, res);
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);
    const objectId: ObjectID = new ObjectID(idParam);

    await this.service.deleteOneById({
      id: objectId,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    });

    return Response.sendEmptySuccessResponse(req, res);
  }

  @CaptureSpan()
  public async updateItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeUpdate(req, res);
    const idParam: string = req.params["id"] as string;
    ObjectID.validateUUID(idParam);
    const objectId: ObjectID = new ObjectID(idParam);
    const objectIdString: string = objectId.toString();
    const body: JSONObject = req.body;
    const dataInBody: JSONValue | undefined = body["data"];

    /*
     * The update payload has to be wrapped as { "data": { ...columns... } }.
     * A flat body has no "data" key, and deserializing that undefined handed
     * back an empty object: the update then matched the row, wrote no columns
     * at all, and still answered 200. Callers were told the write succeeded
     * while their fields were dropped on the floor.
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
     */
    const item: PartialEntity<TBaseModel> = coerceNumericColumnsInJSON(
      JSONFunctions.deserialize(dataInBody as JSONObject),
      new this.entityType(),
    ) as PartialEntity<TBaseModel>;

    delete (item as any)["_id"];
    delete (item as any)["createdAt"];
    delete (item as any)["updatedAt"];

    /*
     * An update that carries no columns writes nothing. Saying 200 to that is
     * the same lie in a different shape, so ask for at least one field.
     */
    if (Object.keys(item).length === 0) {
      throw new BadDataException(
        'No fields to update. Please include at least one field to update in the "data" object of the request body.',
      );
    }

    const numberOfDocsAffected: number = await this.service.updateOneById({
      id: new ObjectID(objectIdString),
      data: item,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    });

    /*
     * The permission layer narrows the update query after we build it (tenant
     * scope, access-control labels, owned scope), so it is possible to match
     * no rows at all. Reporting 200 for that told the client the edit was
     * saved when nothing was written - the change then "disappeared" on the
     * next page load with no error anywhere.
     */
    if (numberOfDocsAffected === 0) {
      throw new NotAuthorizedException(
        `Unable to update this ${(
          new this.entityType().singularName || "item"
        ).toLowerCase()}. It either does not exist, has been deleted, or you do not have permission to update it.`,
      );
    }

    return Response.sendEmptySuccessResponse(req, res);
  }

  @CaptureSpan()
  public async createItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeCreate(req, res);
    const body: JSONObject = req.body;

    const item: TBaseModel = BaseModel.fromJSON<TBaseModel>(
      body["data"] as JSONObject,
      this.entityType,
    ) as TBaseModel;

    const miscDataProps: JSONObject = JSONFunctions.deserialize(
      body["miscDataProps"] as JSONObject,
    );

    const createBy: CreateBy<TBaseModel> = {
      data: item,
      miscDataProps: miscDataProps,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    };

    const savedItem: BaseModel = await this.service.create(createBy);

    return Response.sendEntityResponse(req, res, savedItem, this.entityType);
  }

  public getRouter(): ExpressRouter {
    return this.router;
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
}

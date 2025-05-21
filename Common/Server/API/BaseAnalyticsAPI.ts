import AggregateBy from "../../Types/BaseDatabase/AggregateBy";
import UserMiddleware from "../Middleware/UserAuthorization";
import AnalyticsDatabaseService from "../Services/AnalyticsDatabaseService";
import CreateBy from "../Types/AnalyticsDatabase/CreateBy";
import GroupBy from "../Types/AnalyticsDatabase/GroupBy";
import Query from "../Types/AnalyticsDatabase/Query";
import Select from "../Types/AnalyticsDatabase/Select";
import Sort from "../Types/AnalyticsDatabase/Sort";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import AnalyticsDataModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DEFAULT_LIMIT,
  LIMIT_PER_PROJECT,
} from "../../Types/Database/LimitMax";
import BadRequestException from "../../Types/Exception/BadRequestException";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import { UserPermission } from "../../Types/Permission";
import PositiveNumber from "../../Types/PositiveNumber";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class BaseAnalyticsAPI<
  TAnalyticsDataModel extends AnalyticsDataModel,
  TBaseService extends AnalyticsDatabaseService<AnalyticsDataModel>,
> {
  public entityType: { new (): TAnalyticsDataModel };

  public router: ExpressRouter;
  public service: TBaseService;

  public constructor(
    type: { new (): TAnalyticsDataModel },
    service: TBaseService,
  ) {
    this.entityType = type;
    const router: ExpressRouter = Express.getRouter();
    // Create
    router.post(
      `${new this.entityType().crudApiPath.toString()}`,
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
      `${new this.entityType().crudApiPath?.toString()}/get-list`,
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
      `${new this.entityType().crudApiPath?.toString()}/get-list`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getList(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Aggregate
    router.post(
      `${new this.entityType().crudApiPath?.toString()}/aggregate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAggregate(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // Aggregate
    router.get(
      `${new this.entityType().crudApiPath?.toString()}/aggregate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getAggregate(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // count
    router.post(
      `${new this.entityType().crudApiPath?.toString()}/count`,
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
      `${new this.entityType().crudApiPath?.toString()}/:id/get-item`,
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
      `${new this.entityType().crudApiPath?.toString()}/:id/get-item`,
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
      `${new this.entityType().crudApiPath?.toString()}/:id`,
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
      `${new this.entityType().crudApiPath?.toString()}/:id`,
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

    const skip: PositiveNumber = req.query["skip"]
      ? new PositiveNumber(req.query["skip"] as string)
      : new PositiveNumber(0);

    const limit: PositiveNumber = req.query["limit"]
      ? new PositiveNumber(req.query["limit"] as string)
      : new PositiveNumber(DEFAULT_LIMIT);

    if (limit.toNumber() > LIMIT_PER_PROJECT) {
      throw new BadRequestException(
        "Limit should be less than " + LIMIT_PER_PROJECT,
      );
    }

    let query: Query<AnalyticsDataModel> = {};
    let select: Select<AnalyticsDataModel> = {};
    let sort: Sort<AnalyticsDataModel> = {};
    let groupBy: GroupBy<AnalyticsDataModel> = {};

    if (req.body) {
      query = JSONFunctions.deserialize(req.body["query"]) as Query<any>;

      select = JSONFunctions.deserialize(
        req.body["select"],
      ) as Select<AnalyticsDataModel>;

      sort = JSONFunctions.deserialize(
        req.body["sort"],
      ) as Sort<AnalyticsDataModel>;

      groupBy = JSONFunctions.deserialize(
        req.body["groupBy"],
      ) as GroupBy<AnalyticsDataModel>;
    }

    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const list: Array<AnalyticsDataModel> = await this.service.findBy({
      query,
      select,
      skip: skip,
      limit: limit,
      sort: sort,
      groupBy: groupBy,
      props: databaseProps,
    });

    const count: PositiveNumber = await this.service.countBy({
      query,
      groupBy: groupBy,
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
  public async getAggregate(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeList(req, res);

    let aggregateBy: AggregateBy<AnalyticsDataModel> | null = null;

    if (req.body && req.body["aggregateBy"]) {
      aggregateBy = JSONFunctions.deserialize(
        req.body["aggregateBy"] as JSONObject,
      ) as any;
    }

    let groupBy: GroupBy<AnalyticsDataModel> | null =
      req.body["groupBy"] || null;

    if (groupBy && Object.keys(groupBy).length > 0) {
      groupBy = JSONFunctions.deserialize(groupBy as JSONObject) as any;
    }

    if (groupBy && Object.keys(groupBy).length === 0) {
      groupBy = null;
    }

    if (!aggregateBy) {
      throw new BadRequestException("AggregateBy is required");
    }

    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const aggregateResult: AggregatedResult = await this.service.aggregateBy({
      ...aggregateBy,
      props: databaseProps,
    });

    return Response.sendJsonObjectResponse(req, res, {
      ...(aggregateResult as any),
    });
  }

  @CaptureSpan()
  public async count(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    let query: Query<AnalyticsDataModel> = {};

    await this.onBeforeCount(req, res);

    if (req.body) {
      query = JSONFunctions.deserialize(req.body["query"]) as Query<any>;
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
    const objectId: ObjectID = new ObjectID(req.params["id"] as string);
    await this.onBeforeGet(req, res);
    let select: Select<AnalyticsDataModel> = {};

    if (req.body) {
      select = JSONFunctions.deserialize(
        req.body["select"],
      ) as Select<AnalyticsDataModel>;
    }

    const item: AnalyticsDataModel | null = await this.service.findOneById({
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
    const objectId: ObjectID = new ObjectID(req.params["id"] as string);

    await this.service.deleteBy({
      query: {
        _id: objectId.toString(),
      },
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
    const objectId: ObjectID = new ObjectID(req.params["id"] as string);
    const objectIdString: string = objectId.toString();
    const body: JSONObject = req.body;

    const item: TAnalyticsDataModel =
      AnalyticsDataModel.fromJSON<TAnalyticsDataModel>(
        body["data"] as JSONObject,
        this.entityType,
      ) as TAnalyticsDataModel;

    delete (item as any)["_id"];
    delete (item as any)["createdAt"];
    delete (item as any)["updatedAt"];

    await this.service.updateBy({
      query: {
        _id: objectIdString,
      },
      data: item,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    });

    return Response.sendEmptySuccessResponse(req, res);
  }

  @CaptureSpan()
  public async createItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.onBeforeCreate(req, res);
    const body: JSONObject = req.body;

    const item: TAnalyticsDataModel =
      AnalyticsDataModel.fromJSON<TAnalyticsDataModel>(
        body["data"] as JSONObject,
        this.entityType,
      ) as TAnalyticsDataModel;

    const createBy: CreateBy<TAnalyticsDataModel> = {
      data: item,
      props: await CommonAPI.getDatabaseCommonInteractionProps(req),
    };

    const savedItem: AnalyticsDataModel = await this.service.create(createBy);

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

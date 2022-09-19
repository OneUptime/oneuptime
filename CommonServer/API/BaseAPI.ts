import BaseModel from 'Common/Models/BaseModel';
import DatabaseService from '../Services/DatabaseService';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';
import UserMiddleware from '../Middleware/UserAuthorization';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import Response from '../Utils/Response';
import ObjectID from 'Common/Types/ObjectID';
import { JSONFunctions, JSONObject } from 'Common/Types/JSON';
import CreateBy from '../Types/Database/CreateBy';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Query from '../Types/Database/Query';
import Select from '../Types/Database/Select';
import Sort from '../Types/Database/Sort';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import Populate from '../Types/Database/Populate';

export default class BaseAPI<
    TBaseModel extends BaseModel,
    TBaseService extends DatabaseService<BaseModel>
> {
    private entityType: { new (): TBaseModel };

    public router: ExpressRouter;
    private service: TBaseService;

    public constructor(type: { new (): TBaseModel }, service: TBaseService) {
        this.entityType = type;
        const router: ExpressRouter = Express.getRouter();

        // Create
        router.post(
            `/${new this.entityType().getCrudApiPath()?.toString()}`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await this.createItem(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );

        // List
        router.post(
            `/${new this.entityType().getCrudApiPath()?.toString()}/get-list`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await this.getList(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );

        // count
        router.post(
            `/${new this.entityType().getCrudApiPath()?.toString()}/count`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await this.count(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );

        // Get Item
        router.post(
            `/${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/:id/get-item`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await this.getItem(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );

        // Update
        router.put(
            `/${new this.entityType().getCrudApiPath()?.toString()}/:id`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await this.updateItem(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );

        // Delete
        router.delete(
            `/${new this.entityType().getCrudApiPath()?.toString()}/:id`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await this.deleteItem(req, res);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router = router;
        this.service = service;
    }

    public getDatabaseCommonInteractionProps(
        req: ExpressRequest
    ): DatabaseCommonInteractionProps {
        const props: DatabaseCommonInteractionProps = {
            tenantId: undefined,
            userGlobalAccessPermission: undefined,
            userTenantAccessPermission: undefined,
            userId: undefined,
            userType: undefined,
            isMultiTenantRequest: undefined,
        };

        if (
            (req as OneUptimeRequest).userAuthorization &&
            (req as OneUptimeRequest).userAuthorization?.userId
        ) {
            props.userId = (req as OneUptimeRequest).userAuthorization!.userId;
        }

        if ((req as OneUptimeRequest).userGlobalAccessPermission) {
            props.userGlobalAccessPermission = (
                req as OneUptimeRequest
            ).userGlobalAccessPermission;
        }

        if ((req as OneUptimeRequest).userTenantAccessPermission) {
            props.userTenantAccessPermission = (
                req as OneUptimeRequest
            ).userTenantAccessPermission;
        }

        if ((req as OneUptimeRequest).tenantId) {
            props.tenantId = (req as OneUptimeRequest).tenantId || undefined;
        }

        if (req.headers['is-multi-tenant-query']) {
            props.isMultiTenantRequest = true;
        }

        return props;
    }

    public async getList(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const skip: PositiveNumber = req.query['skip']
            ? new PositiveNumber(req.query['skip'] as string)
            : new PositiveNumber(0);

        const limit: PositiveNumber = req.query['limit']
            ? new PositiveNumber(req.query['limit'] as string)
            : new PositiveNumber(10);

        if (limit.toNumber() > LIMIT_PER_PROJECT) {
            throw new BadRequestException(
                'Limit should be less than ' + LIMIT_PER_PROJECT
            );
        }

        let query: Query<BaseModel> = {};
        let select: Select<BaseModel> = {};
        let populate: Populate<BaseModel> = {};
        let sort: Sort<BaseModel> = {};

        if (req.body) {
            query = JSONFunctions.deserialize(
                req.body['query']
            ) as Query<BaseModel>;

            select = JSONFunctions.deserialize(
                req.body['select']
            ) as Select<BaseModel>;

            if (req.body['populate']) {
                populate = JSONFunctions.deserialize(
                    req.body['populate']
                ) as Populate<BaseModel>;
            }

            sort = JSONFunctions.deserialize(
                req.body['sort']
            ) as Sort<BaseModel>;
        }

        const databaseProps: DatabaseCommonInteractionProps =
            this.getDatabaseCommonInteractionProps(req);

        const list: Array<BaseModel> = await this.service.findBy({
            query,
            select,
            skip: skip,
            limit: limit,
            sort: sort,
            populate,
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
            this.entityType
        );
    }

    public async count(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        let query: Query<BaseModel> = {};

        if (req.body) {
            query = JSONFunctions.deserialize(
                req.body['query']
            ) as Query<BaseModel>;
        }

        const databaseProps: DatabaseCommonInteractionProps =
            this.getDatabaseCommonInteractionProps(req);

        const count: PositiveNumber = await this.service.countBy({
            query,
            props: databaseProps,
        });

        return Response.sendJsonObjectResponse(req, res, {
            count: count.toNumber(),
        });
    }

    public async getItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const objectId: ObjectID = new ObjectID(req.params['id'] as string);

        let select: Select<BaseModel> = {};
        let populate: Populate<BaseModel> = {};

        if (req.body) {
            select = JSONFunctions.deserialize(
                req.body['select']
            ) as Select<BaseModel>;

            if (req.body['populate']) {
                populate = JSONFunctions.deserialize(
                    req.body['populate']
                ) as Populate<BaseModel>;
            }
        }

        const item: BaseModel | null = await this.service.findOneById({
            id: objectId,
            select,
            populate,
            props: this.getDatabaseCommonInteractionProps(req),
        });

        return Response.sendEntityResponse(req, res, item, this.entityType);
    }

    public async deleteItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const objectId: ObjectID = new ObjectID(req.params['id'] as string);

        await this.service.deleteBy({
            query: {
                _id: objectId.toString(),
            },
            props: this.getDatabaseCommonInteractionProps(req),
        });

        return Response.sendEmptyResponse(req, res);
    }

    public async updateItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const objectId: ObjectID = new ObjectID(req.params['id'] as string);
        const objectIdString: string = objectId.toString();
        const body: JSONObject = req.body;

        const item: QueryDeepPartialEntity<TBaseModel> =
            JSONFunctions.deserialize(
                body['data'] as JSONObject
            ) as QueryDeepPartialEntity<TBaseModel>;

        delete item['_id'];
        delete item['createdAt'];
        delete item['updatedAt'];

        await this.service.updateBy({
            query: {
                _id: objectIdString,
            },
            data: item,
            props: this.getDatabaseCommonInteractionProps(req),
        });

        return Response.sendEmptyResponse(req, res);
    }

    public async createItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const body: JSONObject = req.body;

        const item: TBaseModel = BaseModel.fromJSON<TBaseModel>(
            body['data'] as JSONObject,
            this.entityType
        ) as TBaseModel;

        const miscDataProps: JSONObject = JSONFunctions.deserialize(
            body['miscDataProps'] as JSONObject
        );

        const createBy: CreateBy<TBaseModel> = {
            data: item,
            miscDataProps: miscDataProps,
            props: this.getDatabaseCommonInteractionProps(req),
        };

        const savedItem: BaseModel = await this.service.create(createBy);

        return Response.sendEntityResponse(
            req,
            res,
            savedItem,
            this.entityType
        );
    }

    public getRouter(): ExpressRouter {
        return this.router;
    }

    public getEntityName(): string {
        return this.entityType.name;
    }
}

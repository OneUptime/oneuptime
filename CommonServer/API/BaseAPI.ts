import BaseModel from 'Common/Models/BaseModel';
import DatabaseService from '../Services/DatabaseService';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    OneUptimeRequest,
} from '../Utils/Express';
import UserMiddleware from '../Middleware/UserAuthorization';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import Response from '../Utils/Response';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';
import CreateBy from '../Types/DB/CreateBy';
import DatabaseCommonInteractionProps from '../Types/DB/DatabaseCommonInteractionProps';

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
            (req, res) => {
                this.createItem(req, res);
            }
        );

        // List
        router.get(
            `/${new this.entityType().getCrudApiPath()?.toString()}/list`,
            UserMiddleware.getUserMiddleware,
            (req, res) => {
                this.getList(req, res);
            }
        );

        // Get Item
        router.get(
            `/${new this.entityType().getCrudApiPath()?.toString()}/:id`,
            UserMiddleware.getUserMiddleware,
            (req, res) => {
                this.getItem(req, res);
            }
        );

        // Update
        router.put(
            `/${new this.entityType().getCrudApiPath()?.toString()}/:id`,
            UserMiddleware.getUserMiddleware,
            (req, res) => {
                this.updateItem(req, res);
            }
        );

        // Delete
        router.delete(
            `/${new this.entityType().getCrudApiPath()?.toString()}/:id`,
            UserMiddleware.getUserMiddleware,
            (req, res) => {
                this.deleteItem(req, res);
            }
        );

        this.router = router;
        this.service = service;
        debugger;
    }

    public getDatabaseCommonInteractionProps(req: ExpressRequest): DatabaseCommonInteractionProps {

        const props: DatabaseCommonInteractionProps = {};

        if ((req as OneUptimeRequest).userAuthorization && (req as OneUptimeRequest).userAuthorization?.userId) {
            props.userId = (req as OneUptimeRequest).userAuthorization!.userId;
        }

        if ((req as OneUptimeRequest).role && (req as OneUptimeRequest).role) {
            props.userRoleInProject = (req as OneUptimeRequest).role;
        }

        if ((req as OneUptimeRequest).role && (req as OneUptimeRequest).role) {
            props.userRoleInProject = (req as OneUptimeRequest).role;
        }

        return props; 
    }

    public async getList(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        const skip: PositiveNumber = req.query['skip']
            ? new PositiveNumber(req.query['skip'] as string)
            : new PositiveNumber(0);

        const limit: PositiveNumber = req.query['limit']
            ? new PositiveNumber(req.query['limit'] as string)
            : new PositiveNumber(10);

        if (limit.toNumber() > 50) {
            throw new BadRequestException('Limit should be less than 50');
        }

        const list: Array<BaseModel> = await this.service.getListByRole(
            oneuptimeRequest.role,
            {
                query: {},
                skip: skip,
                limit: limit,
            }
        );

        const count: PositiveNumber = await this.service.countBy({
            query: {},
        });

        return Response.sendListResponse(req, res, list, count);
    }

    public async getItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        const objectId: ObjectID = new ObjectID(req.params['id'] as string);

        const item: BaseModel | null = await this.service.getItemByRole(
            oneuptimeRequest.role,
            {
                query: {
                    _id: objectId.toString(),
                },
            }
        );

        return Response.sendItemResponse(req, res, item?.toJSON() || {});
    }

    public async deleteItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

        const objectId: ObjectID = new ObjectID(req.params['id'] as string);

        await this.service.deleteByRole(oneuptimeRequest.role, {
            query: {
                _id: objectId.toString(),
            },
        });

        return Response.sendEmptyResponse(req, res);
    }

    public async updateItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const objectId: ObjectID = new ObjectID(req.params['id'] as string);
        const body: JSONObject = req.body;

        const item: TBaseModel = BaseModel.fromJSON<TBaseModel>(
            body['data'] as JSONObject,
            this.entityType
        ) as TBaseModel;

        await this.service.updateByRole(oneuptimeRequest.role, {
            query: {
                _id: objectId.toString(),
            },
            data: item,
        });

        return Response.sendEmptyResponse(req, res);
    }

    public async createItem(
        req: ExpressRequest,
        res: ExpressResponse
    ): Promise<void> {
        debugger; 
        
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const body: JSONObject = req.body;

        const item: TBaseModel = BaseModel.fromJSON<TBaseModel>(
            body['data'] as JSONObject,
            this.entityType
        ) as TBaseModel;


        const createBy: CreateBy<TBaseModel> = {
            data: item,
            ...this.getDatabaseCommonInteractionProps(req)
        }

        const savedItem: BaseModel = await this.service.createByRole(
            oneuptimeRequest.role,
            createBy
        );

        return Response.sendItemResponse(req, res, savedItem);
    }

    public getRouter(): ExpressRouter {
        return this.router;
    }

    public getEntityName(): string {
        return this.entityType.name;
    }
}

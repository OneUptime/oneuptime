import BaseModel from 'Common/Models/BaseModel';
import DatabaseService from '../Services/DatabaseService';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    OneUptimeRequest,
} from '../Utils/Express';
import UserMiddleware from '../Middleware/UserAuthorization';

export default class BaseAPI<TBaseModel extends BaseModel, TBaseService extends DatabaseService<TBaseModel>> {

    private entityName: string;
    public router: ExpressRouter;

    private service: TBaseService;

    public constructor(type: { new(): TBaseModel }, service: TBaseService) {

        this.entityName = type.name;
        const router: ExpressRouter = Express.getRouter();

        // Create
        router.post(`${this.entityName}/`, UserMiddleware.getUserMiddleware, this.createItem);

        // List
        router.get(`${this.entityName}/`, UserMiddleware.getUserMiddleware,this.getList);

        // Get Item
        router.get(`${this.entityName}/:id`, UserMiddleware.getUserMiddleware, this.getItem);

        // Update
        router.put(`${this.entityName}/:id`, UserMiddleware.getUserMiddleware, this.updateItem);

        // Delete 
        router.delete(`${this.entityName}/:id`, UserMiddleware.getUserMiddleware, this.deleteItem);

        this.router = router;
        this.service = service;
    }

    public getList(req: ExpressRequest, res: ExpressResponse) {
        const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        
    }

    public getItem(req: ExpressRequest, res: ExpressResponse) {

    }

    public deleteItem(req: ExpressRequest, res: ExpressResponse) {

    }

    public updateItem(req: ExpressRequest, res: ExpressResponse) {

    }


    public createItem(req: ExpressRequest, res: ExpressResponse) {

    }

    public getRouter(): ExpressRouter {
        return this.router; 
    }

    public getEntityName(): string {
        return this.entityName; 
    }
}
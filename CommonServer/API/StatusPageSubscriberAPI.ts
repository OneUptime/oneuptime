
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import StatusPageSubscriberService, {
    Service as StatusPageSubscriberServiceType,
} from '../Services/StatusPageSubscriberService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import BaseAPI from './BaseAPI';
import Response from '../Utils/Response';

export default class StatusPageSubscriberAPI extends BaseAPI<
    StatusPageSubscriber,
    StatusPageSubscriberServiceType
> {
    public constructor() {
        super(StatusPageSubscriber, StatusPageSubscriberService);

        this.router.get(
            `/${new this.entityType().getCrudApiPath()?.toString()}/unsubscribe/:id`,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {

                    await this.service.updateOneBy({
                        query: {
                            _id: req.params['id'] as string,
                        },
                        data: {
                            isUnsubscribed: true,
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        }
                    });

                    return Response.sendHtmlResponse(req, res, '<html><body><p> You have been unsubscribed.</p><body><html>');
                } catch (err) {
                    next(err);
                }
            }
        );



       
    }
}

import MonitorGroup from 'Model/Models/MonitorGroup';
import MonitorGroupService, {
    Service as MonitorGroupServiceType,
} from '../Services/MonitorGroupService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import ObjectID from 'Common/Types/ObjectID';
import UserMiddleware from '../Middleware/UserAuthorization';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MonitorStatus from 'Model/Models/MonitorStatus';

export default class MonitorGroupAPI extends BaseAPI<
    MonitorGroup,
    MonitorGroupServiceType
> {
    public constructor() {
        super(MonitorGroup, MonitorGroupService);

        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/current-status/:monitorGroupId`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    // get group id.

                    if (!req.params['monitorGroupId']) {
                        throw new BadDataException(
                            'Monitor group id is required.'
                        );
                    }

                    const currentStatus: MonitorStatus =
                        await this.service.getCurrentStatus(
                            new ObjectID(
                                req.params['monitorGroupId'].toString()
                            ),
                            await this.getDatabaseCommonInteractionProps(req)
                        );

                    return Response.sendEntityResponse(
                        req,
                        res,
                        currentStatus,
                        MonitorStatus
                    );
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}

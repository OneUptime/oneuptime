import BaseAPI from './BaseAPI';
import Monitor from 'Model/Models/Monitor';
import Select from '../Types/Database/Select';
import UUID from '../Utils/UUID';
import MonitorService, {
    Service as MonitorServiceType,
} from '../Services/MonitorService';
import { ExpressRequest, ExpressResponse } from '../Utils/Express';
import Response from '../Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import NotFoundException from 'Common/Types/Exception/NotFoundException';
import NotAuthenticatedException from 'Common/Types/Exception/NotAuthenticatedException';

export default class MonitorAPI extends BaseAPI<Monitor, MonitorServiceType> {
    public constructor() {
        super(Monitor, MonitorService);

        // Fetch monitor status
        this.router.get(
            `${new this.entityType().getCrudApiPath()?.toString()}/status/:id`,
            async (req: ExpressRequest, res: ExpressResponse) => {
                const id: string = req.params['id'] as string;
                if (!id) {
                    throw new BadDataException('Monitor ID was not provided.');
                }

                const key: string = req.params['key'] as string;
                const isUUIDv1: boolean = UUID.validate(key);
                if (!key || !isUUIDv1) {
                    throw new BadDataException(
                        'You must provide a valid monitor key with this request.'
                    );
                }

                const select: Select<Monitor> = {
                    _id: true,
                    name: true,
                    createdAt: true,
                    monitorType: true,
                    monitoringInterval: true,
                    disableActiveMonitoring: true,
                    currentMonitorStatusId: true,
                    incomingRequestReceivedAt: true,
                    embeddedStatusKey: true,
                };

                const monitorStatus: Monitor | null =
                    await MonitorService.findOneById({
                        id,
                        select,
                        props: {
                            isRoot: true,
                        },
                    });

                if (!monitorStatus) {
                    throw new NotFoundException('Monitor does not exist.');
                }

                if (monitorStatus.embeddedStatusKey !== key) {
                    throw new NotAuthenticatedException(
                        'You are not authenticated to access this status page'
                    );
                }

                delete monitorStatus.embeddedStatusKey;
                return Response.sendJsonObjectResponse(req, res, monitorStatus);
            }
        );
    }
}

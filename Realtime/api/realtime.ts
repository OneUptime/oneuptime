import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import {
    sendErrorResponse,
    sendEmptyResponse,
} from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import RealtimeService from '../Services/RealtimeService';
import ObjectID from 'Common/Types/ObjectID';
import { JSONObject } from 'Common/Types/JSON';

router.post(
    ':project-id/:event-type',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const body: JSONObject = req.body;
            RealtimeService.send(
                new ObjectID(req.params['projectId'] as string),
                req.params['eventType'] as string,
                body
            );
            return sendEmptyResponse(req, res);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

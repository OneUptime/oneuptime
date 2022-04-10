import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router = express.getRouter();
import {
    sendErrorResponse,
    sendEmptyResponse,
} from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';
import ClusterKeyAuthorization from 'CommonServer/middlewares/ClusterKeyAuthorization';
import RealtimeService from '../Services/RealtimeService';

router.post(
    ':project-id/:event-type',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const body = req.body;
            RealtimeService.send(
                req.params['projectId'] as string,
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

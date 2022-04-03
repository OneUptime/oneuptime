import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const router = express.getRouter();
import {
    sendErrorResponse,
    sendEmptyResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';
import ClusterKeyAuthorization from 'common-server/middlewares/ClusterKeyAuthorization';
import RealtimeService from '../services/RealtimeService';

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

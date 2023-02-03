import type {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Express from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import type Exception from 'Common/Types/Exception/Exception';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import RealtimeService from '../Services/RealtimeService';
import ObjectID from 'Common/Types/ObjectID';
import type { JSONObject } from 'Common/Types/JSON';

router.post(
    ':project-id/:event-type',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const body: JSONObject = req.body;
            RealtimeService.send(
                new ObjectID(req.params['projectId'] as string),
                req.params['eventType'] as string,
                body
            );
            return Response.sendEmptyResponse(req, res);
        } catch (error) {
            return Response.sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

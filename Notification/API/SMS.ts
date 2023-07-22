import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import SmsService from '../Services/SmsService';
import Phone from 'Common/Types/Phone';
import ObjectID from 'Common/Types/ObjectID';

router.post(
    '/send',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const body: JSONObject = JSONFunctions.deserialize(req.body);

        await SmsService.sendSms(
            body['to'] as Phone,
            body['message'] as string,
            {
                projectId: body['projectId'] as ObjectID,
                from: body['from'] as Phone,
                isSensitive: (body['isSensitive'] as boolean) || false,
                userOnCallLogTimelineId:
                    (body['userOnCallLogTimelineId'] as ObjectID) || undefined,
            }
        );

        return Response.sendEmptyResponse(req, res);
    }
);

export default router;

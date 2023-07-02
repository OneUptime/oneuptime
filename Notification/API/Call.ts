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
import Phone from 'Common/Types/Phone';
import ObjectID from 'Common/Types/ObjectID';
import CallService from '../Services/CallService';
import CallRequest from 'Common/Types/Call/CallRequest';
import BadDataException from 'Common/Types/Exception/BadDataException';

router.post(
    '/make-call',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const body: JSONObject = JSONFunctions.deserialize(req.body);

        await CallService.makeCall(
            body['to'] as Phone,
            body['callRequest'] as CallRequest,
            {
                projectId: body['projectId'] as ObjectID,
                from: body['from'] as Phone,
                isSensitive: (body['isSensitive'] as boolean) || false,
            }
        );

        return Response.sendEmptyResponse(req, res);
    }
);

router.post(
    '/gather-call-input',
    async (req: ExpressRequest, res: ExpressResponse) => {
        const body: JSONObject = JSONFunctions.deserialize(req.body);

        const token: string | undefined = req.params['token'];

        if(!token) {
            return Response.sendErrorResponse(req, res, new BadDataException("Token is required."));
        }

        await CallService.makeCall(
            body['to'] as Phone,
            body['callRequest'] as CallRequest,
            {
                projectId: body['projectId'] as ObjectID,
                from: body['from'] as Phone,
                isSensitive: (body['isSensitive'] as boolean) || false,
            }
        );

        return Response.sendEmptyResponse(req, res);
    }
);


export default router;

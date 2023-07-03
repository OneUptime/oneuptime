
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';

import Response from '../Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import JSONFunctions from 'Common/Types/JSONFunctions';
import JSONWebToken from '../Utils/JsonWebToken';
import { OnCallInputRequest } from 'Common/Types/Call/CallRequest';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';

export default class NotificationMiddleware {

    public static async sendResponse(req: ExpressRequest, res: ExpressResponse, onCallInputRequest: OnCallInputRequest): Promise<void> {

        const response = new VoiceResponse();


        if (onCallInputRequest[req.body['Digits']]) {
            response.say(onCallInputRequest[req.body['Digits']]!.sayMessage);
        } else {
            response.say(onCallInputRequest['default']!.sayMessage);
        }

        return Response.sendXmlResponse(req, res, response.toString());
    }

    public static async isValidCallNotificationRequest(
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        req = req as OneUptimeRequest;


        if (!req.body['Digits']) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('Invalid input')
            );
        }


        if (!req.query['token']) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('Invalid token')
            );
        }

        const token: string = req.query['token'] as string;

        try {

            (req as any).callTokenData = JSONFunctions.deserialize(JSONWebToken.decodeJsonPayload(token));

        } catch (e) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('Invalid token')
            );
        }

        return next();
    }
}

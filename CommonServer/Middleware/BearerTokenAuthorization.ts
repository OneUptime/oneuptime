import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import JSONWebToken from '../Utils/JsonWebToken';
import { JSONObject } from 'Common/Types/JSON';

export default class BearerTokenAuthorization {
    public static async isAuthorizedBearerToken(
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        try {
            req = req as OneUptimeRequest;

            if (
                req.headers?.['authorization'] ||
                req.headers?.['Authorization']
            ) {
                let token: string | undefined | Array<string> =
                    req.headers['authorization'] ||
                    req.headers['Authorization'];
                token = token?.toString().replace('Bearer ', '');
                if (token) {
                    const tokenData: JSONObject =
                        JSONWebToken.decodeJsonPayload(token);

                    (req as OneUptimeRequest).bearerTokenData = tokenData;

                    return next();
                }
            }

            throw new NotAuthorizedException(
                'Invalid bearer token, or bearer token not provided.'
            );
        } catch (err) {
            next(err);
        }
    }
}

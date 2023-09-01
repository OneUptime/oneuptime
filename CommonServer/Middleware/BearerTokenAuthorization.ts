import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import JSONWebToken from '../Utils/JsonWebToken';

export default class BearerTokenAuthorization {
    public static async isAuthorizedBearerToken(
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        req = req as OneUptimeRequest;

        if (req.headers['authorization'] || req.headers['Authorization']) {
            let token =
                req.headers['authorization'] || req.headers['Authorization'];
            if (token) {
                token = token.toString().replace('Bearer ', '');

                const tokenData = JSONWebToken.decode(token);

                (req as OneUptimeRequest).bearerTokenData = tokenData;

                return next();
            }
            throw new NotAuthorizedException('Invalid bearer token.');
        }

        throw new NotAuthorizedException('Invalid bearer token.');
    }
}

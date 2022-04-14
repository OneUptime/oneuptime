import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';

const router: $TSFixMe = express.getRouter();
import UserService from '../services/userService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

// Route
// Description: reset refresh token and access token.
// Params:
// Param 1: req.body-> {refreshToken};
// Returns: 400: Error; 500: Server Error; 200: {
//                                                   jwtAccessToken: token.accessToken,
//                                                   jwtRefreshToken: token.refreshToken,
//                                               }
router.post('/new', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const jwtRefreshToken: $TSFixMe = req.body.refreshToken;

        if (!jwtRefreshToken) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Refresh Token not found.')
            );
        }
        const token: $TSFixMe = await UserService.getNewToken(jwtRefreshToken);
        const tokenData: $TSFixMe = {
            jwtAccessToken: token.accessToken,
            jwtRefreshToken: token.refreshToken,
        };

        return sendItemResponse(req, res, tokenData);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;

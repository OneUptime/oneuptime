import express, { Request, Response } from 'common-server/utils/express';

const router = express.getRouter();
import UserService from '../services/userService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

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
        const jwtRefreshToken = req.body.refreshToken;

        if (!jwtRefreshToken) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Refresh Token not found.',
            });
        }
        const token = await UserService.getNewToken(jwtRefreshToken);
        const tokenData = {
            jwtAccessToken: token.accessToken,
            jwtRefreshToken: token.refreshToken,
        };

        return sendItemResponse(req, res, tokenData);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;

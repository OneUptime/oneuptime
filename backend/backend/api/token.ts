import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/express';
import BadDataException from 'common/types/exception/bad-data-exception';

const router = express.getRouter();
import UserService from '../services/userService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception';

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
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Refresh Token not found.')
            );
        }
        const token = await UserService.getNewToken(jwtRefreshToken);
        const tokenData = {
            jwtAccessToken: token.accessToken,
            jwtRefreshToken: token.refreshToken,
        };

        return sendItemResponse(req, res, tokenData);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;

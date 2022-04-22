import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import SslService from '../services/sslService';

const router: ExpressRouter = Express.getRouter();

// Store acme challenge to the db
router.post('/challenge', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: $TSFixMe = req.body;

        const acmeChallenge: $TSFixMe = await SslService.create(data);
        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Fetch an acme challenge
router.get(
    '/challenge/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token }: $TSFixMe = req.params;
            const acmeChallenge: $TSFixMe = await SslService.findOneBy({
                query: { token },
                select: 'token keyAuthorization challengeUrl deleted deletedAt',
            });

            return sendItemResponse(req, res, acmeChallenge);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Fetch keyAuthorization for a token
 * Api to be consumed from the statuspage
 */
router.get(
    '/challenge/authorization/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token }: $TSFixMe = req.params;
            const acmeChallenge: $TSFixMe = await SslService.findOneBy({
                query: { token },
                select: 'token keyAuthorization challengeUrl deleted deletedAt',
            });
            if (!acmeChallenge) {
                return sendItemResponse(req, res, '');
            }
            return sendItemResponse(req, res, acmeChallenge.keyAuthorization);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Delete an acme challenge
router.delete(
    '/challenge/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token }: $TSFixMe = req.params;

            const acmeChallenge: $TSFixMe = await SslService.deleteBy({
                token,
            });
            return sendItemResponse(req, res, acmeChallenge);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

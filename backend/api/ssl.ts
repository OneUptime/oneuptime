import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/Utils/Express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/Utils/Response';
import Exception from 'common/types/exception/Exception';

import SslService from '../Services/sslService';

const router = express.getRouter();

// store acme challenge to the db
router.post('/challenge', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data = req.body;

        const acmeChallenge = await SslService.create(data);
        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// fetch an acme challenge
router.get(
    '/challenge/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token } = req.params;
            const acmeChallenge = await SslService.findOneBy({
                query: { token },
                select: 'token keyAuthorization challengeUrl deleted deletedAt',
            });

            return sendItemResponse(req, res, acmeChallenge);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch keyAuthorization for a token
// api to be consumed from the statuspage
router.get(
    '/challenge/authorization/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token } = req.params;
            const acmeChallenge = await SslService.findOneBy({
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

// delete an acme challenge
router.delete(
    '/challenge/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { token } = req.params;

            const acmeChallenge = await SslService.deleteBy({ token });
            return sendItemResponse(req, res, acmeChallenge);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

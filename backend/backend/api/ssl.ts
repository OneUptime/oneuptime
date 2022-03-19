import express, { Request, Response } from 'common-server/utils/express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import SslService from '../services/sslService';

const router = express.getRouter();

// store acme challenge to the db
router.post('/challenge', async (req: Request, res: Response) => {
    try {
        const data = req.body;

        const acmeChallenge = await SslService.create(data);
        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch an acme challenge
router.get('/challenge/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const acmeChallenge = await SslService.findOneBy({
            query: { token },
            select: 'token keyAuthorization challengeUrl deleted deletedAt',
        });

        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch keyAuthorization for a token
// api to be consumed from the statuspage
router.get(
    '/challenge/authorization/:token',
    async (req: Request, res: Response) => {
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
            return sendErrorResponse(req, res, error);
        }
    }
);

// delete an acme challenge
router.delete('/challenge/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;

        const acmeChallenge = await SslService.deleteBy({ token });
        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;

import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/Response';
import Exception from 'Common/Types/Exception/Exception';

import AccountStoreService from 'CommonServer/services/accountStoreService';

const router: ExpressRouter = Express.getRouter();

// Store account details to the db
router.post('/store', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: $TSFixMe = req.body;

        const account: $TSFixMe = await AccountStoreService.create(data);
        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Update account details in the db
router.put('/store/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { id }: $TSFixMe = req.params;
        const account: $TSFixMe = await AccountStoreService.updateOneBy(
            { id },
            req.body
        );

        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Fetch an account detail
router.get('/store/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { id }: $TSFixMe = req.params;
        const account: $TSFixMe = await AccountStoreService.findOneBy({
            query: { id },
            select: 'id privateKeyPem privateKeyJwk publicKeyPem publicKeyJwk key deleted deletedAt',
        });

        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Delete an account detail
router.delete(
    '/store/:id',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { id }: $TSFixMe = req.params;

            const account: $TSFixMe = await AccountStoreService.deleteBy({
                id,
            });
            return sendItemResponse(req, res, account);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception';

import AccountStoreService from '../services/accountStoreService';

const router = express.getRouter();

// store account details to the db
router.post('/store', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data = req.body;

        const account = await AccountStoreService.create(data);
        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// update account details in the db
router.put('/store/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { id } = req.params;
        const account = await AccountStoreService.updateOneBy({ id }, req.body);

        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// fetch an account detail
router.get('/store/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { id } = req.params;
        const account = await AccountStoreService.findOneBy({
            query: { id },
            select: 'id privateKeyPem privateKeyJwk publicKeyPem publicKeyJwk key deleted deletedAt',
        });

        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// delete an account detail
router.delete(
    '/store/:id',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { id } = req.params;

            const account = await AccountStoreService.deleteBy({ id });
            return sendItemResponse(req, res, account);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

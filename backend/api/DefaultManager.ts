import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';

import DefaultManagerService from '../services/defaultManagerService';

const router = express.getRouter();

// store default details to the db
router.put('/default', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const {
            store,
            challenges,
            renewOffset,
            renewStagger,
            accountKeyType,
            serverKeyType,
            subscriberEmail,
            agreeToTerms,
        } = req.body;

        if (!subscriberEmail) {
            return sendItemResponse(req, res, {});
        }

        const data = {};

        if (store) data.store = store;

        if (challenges) data.challenges = challenges;

        if (renewOffset) data.renewOffset = renewOffset;

        if (renewStagger) data.renewStagger = renewStagger;

        if (accountKeyType) data.accountKeyType = accountKeyType;

        if (serverKeyType) data.serverKeyType = serverKeyType;

        if (subscriberEmail) data.subscriberEmail = subscriberEmail;

        if (agreeToTerms) data.agreeToTerms = agreeToTerms;

        // if there's no default value
        // create a default value
        // we should only have one default and update as the need arises
        const defaultManager = await DefaultManagerService.updateOneBy(
            {},
            data
        );
        return sendItemResponse(req, res, defaultManager);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

router.get('/default', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const defaultManager = await DefaultManagerService.findOneBy({
            query: { deleted: false },
            select: 'store challenges renewOffset renewStagger accountKeyType serverKeyType subscriberEmail agreeToTerms deleted deletedAt',
        });

        return sendItemResponse(req, res, defaultManager);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;

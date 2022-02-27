import express from 'express';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
import DefaultManagerService from '../services/defaultManagerService';

const router = express.Router();

// store default details to the db
router.put('/default', async (req, res) => {
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'store' does not exist on type '{}'.
        if (store) data.store = store;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'challenges' does not exist on type '{}'.
        if (challenges) data.challenges = challenges;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'renewOffset' does not exist on type '{}'... Remove this comment to see the full error message
        if (renewOffset) data.renewOffset = renewOffset;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'renewStagger' does not exist on type '{}... Remove this comment to see the full error message
        if (renewStagger) data.renewStagger = renewStagger;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountKeyType' does not exist on type '... Remove this comment to see the full error message
        if (accountKeyType) data.accountKeyType = accountKeyType;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'serverKeyType' does not exist on type '{... Remove this comment to see the full error message
        if (serverKeyType) data.serverKeyType = serverKeyType;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'subscriberEmail' does not exist on type ... Remove this comment to see the full error message
        if (subscriberEmail) data.subscriberEmail = subscriberEmail;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'agreeToTerms' does not exist on type '{}... Remove this comment to see the full error message
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
        return sendErrorResponse(req, res, error);
    }
});

router.get('/default', async (req, res) => {
    try {
        const defaultManager = await DefaultManagerService.findOneBy({
            query: { deleted: false },
            select:
                'store challenges renewOffset renewStagger accountKeyType serverKeyType subscriberEmail agreeToTerms deleted deletedAt',
        });

        return sendItemResponse(req, res, defaultManager);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;

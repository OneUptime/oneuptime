const express = require('express');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const DefaultManagerService = require('../services/defaultManagerService');

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
        const defaultManager = await DefaultManagerService.updateOneBy(
            { subscriberEmail },
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

module.exports = router;

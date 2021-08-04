const express = require('express');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const SiteManagerService = require('../services/siteManagerService');

const router = express.Router();

// store site details to the db
router.post('/site', async (req, res) => {
    try {
        const data = req.body;

        const site = await SiteManagerService.create(data);
        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// update site details in the db
router.put('/site', async (req, res) => {
    try {
        const { subject } = req.query;
        const site = await SiteManagerService.updateOneBy(
            { subject },
            req.body
        );

        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch a site detail
router.get('/site', async (req, res) => {
    try {
        const { servername } = req.query;
        const site = await SiteManagerService.findOneBy({
            query: { subject: servername },
            select:
                'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });

        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch all sites
router.get('/sites', async (req, res) => {
    try {
        const sites = await SiteManagerService.findBy({
            query: {},
            select:
                'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });
        return sendItemResponse(req, res, sites);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch all sites by servernames
router.post('/site/servernames', async (req, res) => {
    try {
        const { servernames = [] } = req.body;
        const sites = await SiteManagerService.findBy({
            query: { subject: { $in: servernames } },
            select:
                'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });
        return sendItemResponse(req, res, sites);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch sites base on the options
router.post('/site/opts', async (req, res) => {
    try {
        const { issuedBefore, expiresBefore, renewBefore } = req.body;
        const query = { $or: [] };

        if (issuedBefore) {
            query.$or.push({
                issuedAt: {
                    $lt: issuedBefore,
                },
            });
        }
        if (expiresBefore) {
            query.$or.push({
                expiresAt: {
                    $lt: expiresBefore,
                },
            });
        }
        if (renewBefore) {
            query.$or.push({
                renewAt: {
                    $lt: renewBefore,
                },
            });
        }

        query.deleted = false;
        const sites = await SiteManagerService.findBy({
            query,
            select:
                'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });
        return sendItemResponse(req, res, sites);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// delete an site detail
router.delete('/site', async (req, res) => {
    try {
        const { subject } = req.query;

        const site = await SiteManagerService.deleteBy({ subject });
        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

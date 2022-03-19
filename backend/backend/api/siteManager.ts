import express, { Request, Response } from 'common-server/utils/express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

import SiteManagerService from '../services/siteManagerService';

const router = express.getRouter();

// store site details to the db
router.post('/site', async (req: Request, res: Response) => {
    try {
        const data = req.body;

        const site = await SiteManagerService.create(data);
        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// update site details in the db
router.put('/site', async (req: Request, res: Response) => {
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
router.get('/site', async (req: Request, res: Response) => {
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
router.get('/sites', async (req: Request, res: Response) => {
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
router.post('/site/servernames', async (req: Request, res: Response) => {
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
router.post('/site/opts', async (req: Request, res: Response) => {
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
router.delete('/site', async (req: Request, res: Response) => {
    try {
        const { subject } = req.query; // still handle this for legacy code
        const { domains } = req.body;

        let site = null;

        if (subject && subject.trim()) {
            site = await SiteManagerService.hardDelete({ subject });
        } else if (domains && domains.length > 0) {
            site = await SiteManagerService.hardDelete({
                subject: { $in: domains },
            });
        } else {
            site = await SiteManagerService.hardDelete({});
        }

        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;

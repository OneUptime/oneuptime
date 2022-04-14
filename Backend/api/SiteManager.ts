import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import SiteManagerService from '../services/siteManagerService';

const router: $TSFixMe = express.getRouter();

// store site details to the db
router.post('/site', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: $TSFixMe = req.body;

        const site: $TSFixMe = await SiteManagerService.create(data);
        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// update site details in the db
router.put('/site', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { subject }: $TSFixMe = req.query;
        const site: $TSFixMe = await SiteManagerService.updateOneBy(
            { subject },
            req.body
        );

        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// fetch a site detail
router.get('/site', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { servername }: $TSFixMe = req.query;
        const site: $TSFixMe = await SiteManagerService.findOneBy({
            query: { subject: servername },
            select: 'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });

        return sendItemResponse(req, res, site);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// fetch all sites
router.get('/sites', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const sites: $TSFixMe = await SiteManagerService.findBy({
            query: {},
            select: 'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });
        return sendItemResponse(req, res, sites);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// fetch all sites by servernames
router.post(
    '/site/servernames',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { servernames = [] }: $TSFixMe = req.body;
            const sites: $TSFixMe = await SiteManagerService.findBy({
                query: { subject: { $in: servernames } },
                select: 'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
            });
            return sendItemResponse(req, res, sites);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// fetch sites base on the options
router.post('/site/opts', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { issuedBefore, expiresBefore, renewBefore }: $TSFixMe = req.body;
        const query: $TSFixMe = { $or: [] };

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

        query['deleted'] = false;
        const sites: $TSFixMe = await SiteManagerService.findBy({
            query,
            select: 'subject altnames renewAt expiresAt issuedAt deleted deletedAt',
        });
        return sendItemResponse(req, res, sites);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// delete an site detail
router.delete('/site', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { subject }: $TSFixMe = req.query; // still handle this for legacy code
        const { domains }: $TSFixMe = req.body;

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
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;

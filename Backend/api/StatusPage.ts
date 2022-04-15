import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import PositiveNumber from 'Common/Types/PositiveNumber';
import StatusPageService from '../services/statusPageService';
import MonitorService from '../services/monitorService';
import ProbeService from '../services/probeService';
import UtilService from '../services/utilService';
import RealTimeService from '../services/realTimeService';
import DomainVerificationService from '../services/domainVerificationService';
import IncidentService from '../services/incidentService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
const router: $TSFixMe = express.getRouter();

import validUrl from 'valid-url';
import multer from 'multer';
import ErrorService from 'CommonServer/Utils/error';

import { toXML } from 'jstoxml';
import moment from 'moment';

import { getUser, checkUser } from '../middlewares/user';

import { isUserAdmin } from '../middlewares/project';
import storage from '../middlewares/upload';

import { isAuthorized } from '../middlewares/authorization';
import IncidentTimelineService from '../services/incidentTimelineService';

import { ipWhitelist } from '../middlewares/ipHandler';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import uuid from 'uuid';
import defaultStatusPageColors from '../config/statusPageColors';
import SubscriberService from '../services/subscriberService';
import ScheduledEventService from '../services/scheduledEventService';
import axios from 'axios';
import cheerio from 'cheerio';

import ApiBase from './base';

ApiBase({
    router,
    deleteApiProps: {
        enabled: true,
        authorizedByRole: ['admin'],
    },
    listApiProps: {
        enabled: true,
        authorizedByRole: ['member', 'admin'],
    },
    getApiProps: {
        enabled: true,
        authorizedByRole: ['member', 'admin'],
    },
    updateApiProps: {
        enabled: true,
        authorizedByRole: ['admin'],
    },
    createApiProps: {
        enabled: true,
        authorizedByRole: ['admin'],
    },
    isResourceInProject: true,
    service: StatusPageService,
    friendlyResourceName: 'Status Page',
    resourceName: 'StatusPage',
});

//Fetch tweets from user twitter handle
router.post(
    '/:projectId/tweets',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            let { handle }: $TSFixMe = req.body;

            if (handle.includes('https://twitter.com/')) {
                handle = handle.replace('https://twitter.com/', '');
            }

            if (handle.includes('http://twitter.com/')) {
                handle = handle.replace('http://twitter.com/', '');
            }

            if (!handle || (handle && handle.trim().length === 0)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'handle is required',
                });
            }

            const response: $TSFixMe = await StatusPageService.fetchTweets(
                handle
            );

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/:statusPageId/resetBubbleId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId, statusPageId }: $TSFixMe = req.params;
        const newStatusBubbleId: $TSFixMe = uuid.v4();
        try {
            // Response should be an updated statusPage
            const statusPage: $TSFixMe = await StatusPageService.updateOneBy(
                { projectId, _id: statusPageId },
                { statusBubbleId: newStatusBubbleId }
            );
            const populateStatusPage: $TSFixMe = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
                {
                    path: 'monitors.statusPageCategory',
                    select: 'name',
                },
            ];

            const selectStatusPage: $TSFixMe =
                'projectId domains monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle';

            const updatedStatusPage: $TSFixMe =
                await StatusPageService.getStatusPage({
                    query: { _id: statusPage._id },

                    userId: req.user.id,
                    populate: populateStatusPage,
                    select: selectStatusPage,
                });

            RealTimeService.statusPageEdit(updatedStatusPage);

            return sendItemResponse(req, res, updatedStatusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/theme',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId }: $TSFixMe = req.params;
        const { theme, statusPageId }: $TSFixMe = req.body;
        try {
            const statusPage: $TSFixMe = await StatusPageService.updateOneBy(
                { projectId, _id: statusPageId },
                { theme }
            );
            const populateStatusPage: $TSFixMe = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
                {
                    path: 'monitors.statusPageCategory',
                    select: 'name',
                },
            ];

            const selectStatusPage: $TSFixMe =
                'projectId domains monitors links twitterHandle slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

            const updatedStatusPage: $TSFixMe =
                await StatusPageService.getStatusPage({
                    query: { _id: statusPage._id },

                    userId: req.user.id,
                    populate: populateStatusPage,
                    select: selectStatusPage,
                });

            // Run in the background
            RealTimeService.statusPageEdit(updatedStatusPage);

            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route Description: Creates a domain and domainVerificationToken
 * Req.params -> {projectId, statusPageId}; req.body -> {domain}
 * Returns: response updated status page, error message
 */
router.put(
    '/:projectId/:statusPageId/domain',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId, statusPageId }: $TSFixMe = req.params;
        const {
            domain: subDomain,
            cert,
            privateKey,
            enableHttps,
            autoProvisioning,
        } = req.body;

        if (typeof subDomain !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Domain is not of type string.')
            );
        }

        if (!UtilService.isDomainValid(subDomain)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Domain is not valid.')
            );
        }

        try {
            const doesDomainBelongToProject: $TSFixMe =
                await DomainVerificationService.doesDomainBelongToProject(
                    projectId,
                    subDomain
                );

            if (doesDomainBelongToProject) {
                return sendErrorResponse(req, res, {
                    message: `This domain is already associated with another project`,
                    code: 400,
                });
            }

            const doesDomainExist: $TSFixMe =
                await StatusPageService.doesDomainExist(subDomain);

            if (doesDomainExist) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: `This custom domain ${subDomain} already exist`,
                });
            }

            const resp: $TSFixMe = await StatusPageService.createDomain(
                subDomain,
                projectId,
                statusPageId,
                cert,
                privateKey,
                enableHttps,
                autoProvisioning
            );
            return sendItemResponse(req, res, resp);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Reset status page colors to default colors
router.put(
    '/:projectId/:statusPageId/resetColors',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId, statusPageId }: $TSFixMe = req.params;
        const defaultBrandColor: $TSFixMe = defaultStatusPageColors.default;
        try {
            // Response should be an updated statusPage
            const response: $TSFixMe = await StatusPageService.updateOneBy(
                {
                    _id: statusPageId,
                    projectId,
                },
                { colors: defaultBrandColor }
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
/**
 * @description updates a particular domain from statuspage collection
 * @param {string} projectId id of the project
 * @param {string} statusPageId id of the status page
 * @param {string} domainId id of the domain on the status page
 * @returns response body
 */
router.put(
    '/:projectId/:statusPageId/:domainId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { projectId, statusPageId, domainId }: $TSFixMe = req.params;
        const {
            domain: newDomain,
            cert,
            privateKey,
            enableHttps,
            autoProvisioning,
        } = req.body;

        if (typeof newDomain !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Domain is not of type string.')
            );
        }

        if (!UtilService.isDomainValid(newDomain)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Domain is not valid.')
            );
        }

        try {
            // Response should be an updated statusPage
            const response: $TSFixMe = await StatusPageService.updateDomain(
                projectId,
                statusPageId,
                domainId,
                newDomain,
                cert,
                privateKey,
                enableHttps,
                autoProvisioning
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/certFile',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: 'cert',
                    maxCount: 1,
                },
            ]);
            upload(req, res, async (error: $TSFixMe): void => {
                let cert: $TSFixMe;
                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
                }

                if (req.files && req.files.cert && req.files.cert[0].filename) {
                    cert = req.files.cert[0].filename;
                }
                return sendItemResponse(req, res, { cert });
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/privateKeyFile',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: 'privateKey',
                    maxCount: 1,
                },
            ]);
            upload(req, res, async (error: $TSFixMe): void => {
                let privateKey: $TSFixMe;
                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
                }
                if (
                    req.files &&
                    req.files.privateKey &&
                    req.files.privateKey[0].filename
                ) {
                    privateKey = req.files.privateKey[0].filename;
                }
                return sendItemResponse(req, res, { privateKey });
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Fetch details about a custom domain
 * To be consumed by the status page
 */
router.get(
    '/tlsCredential',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { domain }: $TSFixMe = req.query;

            const user: $TSFixMe = req.user;

            if (!domain) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'No domain is specified',
                });
            }

            const statusPage: $TSFixMe = await StatusPageService.getStatusPage({
                query: { domains: { $elemMatch: { domain } } },
                userId: user,
                select: 'domains',
                populate: [
                    {
                        path: 'domains.domainVerificationToken',
                        select: 'domain',
                    },
                ],
            });

            let domainObj: $TSFixMe = {};
            statusPage &&
                statusPage.domains &&
                statusPage.domains.forEach((eachDomain: $TSFixMe) => {
                    if (eachDomain.domain === domain) {
                        domainObj = eachDomain;
                    }
                });

            return sendItemResponse(req, res, {
                cert: domainObj.cert,

                privateKey: domainObj.privateKey,

                autoProvisioning: domainObj.autoProvisioning,

                enableHttps: domainObj.enableHttps,

                domain: domainObj.domain,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/**
 * @description deletes a particular domain from statuspage collection
 * @param {string} projectId id of the project
 * @param {string} statusPageId id of the status page
 * @param {string} domainId id of the domain
 * @returns response body
 */
router.delete(
    '/:projectId/:statusPageId/:domainId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { statusPageId, domainId }: $TSFixMe = req.params;

        try {
            const response: $TSFixMe = await StatusPageService.deleteDomain(
                statusPageId,
                domainId
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route Description: Updating Status Page.
 * Params:
 * Param1:
 * Returns: response status, error message
 */
router.put(
    '/:projectId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        const data: $TSFixMe = req.body;
        const upload: $TSFixMe = multer({
            storage,
        }).fields([
            {
                name: 'favicon',
                maxCount: 1,
            },
            {
                name: 'logo',
                maxCount: 1,
            },
            {
                name: 'banner',
                maxCount: 1,
            },
        ]);

        if (data.links) {
            if (typeof data.links !== 'object') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'links are not of type object.',
                });
            }

            if (data.links.length > 5) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You can have up to five links.',
                });
            }

            for (let i: $TSFixMe = 0; i < data.links.length; i++) {
                if (!data.links[i].name) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Link name is required',
                    });
                }

                if (typeof data.links[i].name !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Link name is not of type text.',
                    });
                }
                if (!data.links[i].url) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'URL is required.',
                    });
                }

                if (typeof data.links[i].url !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'URL is not of type text.',
                    });
                }
                if (!validUrl.isUri(data.links[i].url)) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Please enter a valid URL.',
                    });
                }
            }
        }

        upload(req, res, async (error: $TSFixMe): void => {
            const files: $TSFixMe = req.files || {};
            const data: $TSFixMe = req.body;
            data.projectId = req.params.projectId;

            data.subProjectId = req.params.subProjectId;
            if (error) {
                ErrorService.log(error);
                return sendErrorResponse(req, res, error as Exception);
            }

            let statusPage: $TSFixMe;
            if (data._id) {
                statusPage = await StatusPageService.findOneBy({
                    query: { _id: data._id },
                    select: 'faviconPath logoPath bannerPath',
                });
                const imagesPath: $TSFixMe = {
                    faviconPath: statusPage.faviconPath,

                    logoPath: statusPage.logoPath,

                    bannerPath: statusPage.bannerPath,
                };
                if (
                    Object.keys(files).length === 0 &&
                    Object.keys(imagesPath).length !== 0
                ) {
                    data.faviconPath = imagesPath.faviconPath;
                    data.logoPath = imagesPath.logoPath;
                    data.bannerPath = imagesPath.bannerPath;
                    if (data.favicon === '') {
                        data.faviconPath = null;
                    }
                    if (data.logo === '') {
                        data.logoPath = null;
                    }
                    if (data.banner === '') {
                        data.bannerPath = null;
                    }
                } else {
                    if (files && files.favicon && files.favicon[0].filename) {
                        data.faviconPath = files.favicon[0].filename;
                    }

                    if (files && files.logo && files.logo[0].filename) {
                        data.logoPath = files.logo[0].filename;
                    }

                    if (files && files.banner && files.banner[0].filename) {
                        data.bannerPath = files.banner[0].filename;
                    }
                }
            }
            if (data.colors) {
                data.colors = JSON.parse(data.colors);
            }

            try {
                const statusPage: $TSFixMe =
                    await StatusPageService.updateOneBy(
                        { projectId: data.projectId, _id: data._id },
                        data
                    );

                const populateStatusPage: $TSFixMe = [
                    {
                        path: 'projectId',
                        select: 'name parentProjectId',
                        populate: { path: 'parentProjectId', select: '_id' },
                    },
                    {
                        path: 'domains.domainVerificationToken',
                        select: 'domain verificationToken verified ',
                    },
                    {
                        path: 'monitors.monitor',
                        select: 'name',
                    },
                    {
                        path: 'monitors.statusPageCategory',
                        select: 'name',
                    },
                ];

                const selectStatusPage: $TSFixMe =
                    'projectId domains monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle';

                const updatedStatusPage: $TSFixMe =
                    await StatusPageService.getStatusPage({
                        query: { _id: statusPage._id },

                        userId: req.user.id,
                        populate: populateStatusPage,
                        select: selectStatusPage,
                    });

                RealTimeService.statusPageEdit(updatedStatusPage);

                if (updatedStatusPage?.twitterHandle) {
                    const tweets: $TSFixMe =
                        await StatusPageService.fetchTweets(
                            updatedStatusPage.twitterHandle
                        );

                    RealTimeService.updateTweets(
                        tweets,
                        updatedStatusPage._id,
                        updatedStatusPage.projectId
                    );
                }

                return sendItemResponse(req, res, statusPage);
            } catch (error) {
                return sendErrorResponse(req, res, error as Exception);
            }
        });
    }
);

router.get(
    '/statusBubble',
    async (req: ExpressRequest, res: ExpressResponse) => {
        const statusPageId: $TSFixMe = req.query.statusPageId;
        const statusBubbleId: $TSFixMe = req.query.statusBubbleId;
        try {
            const selectProbe: $TSFixMe =
                'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';

            const probes: $TSFixMe = await ProbeService.findBy({
                query: {},
                limit: 0,
                skip: 0,
                select: selectProbe,
            });
            if (!statusPageId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'StatusPage Id is required',
                });
            }
            if (!statusBubbleId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'StatusBubble Id is required',
                });
            }

            const populateStatusPage: $TSFixMe = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
                {
                    path: 'monitors.statusPageCategory',
                    select: 'name',
                },
            ];

            const selectStatusPage: $TSFixMe =
                'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle';

            const statusPages: $TSFixMe = await StatusPageService.findBy({
                query: { _id: statusPageId, statusBubbleId },
                populate: populateStatusPage,
                select: selectStatusPage,
            });

            if (!(statusPages && statusPages.length)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'There are no statuspages attached to this Id',
                });
            }
            // Call the StatusPageService.

            const statusPage: $TSFixMe =
                await StatusPageService.getStatusBubble(statusPages, probes);
            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Route Description: Gets status pages of a project.
 * Params:
 * Param1: req.params-> {projectId};
 * Returns: response status, error message
 */

router.get(
    '/:projectId/dashboard',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        const projectId: $TSFixMe = req.params.projectId;
        try {
            // Call the StatusPageService.
            const populateStatusPage: $TSFixMe = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
                {
                    path: 'monitors.statusPageCategory',
                    select: 'name',
                },
            ];

            const selectStatusPage: $TSFixMe =
                'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage';

            const [statusPages, count]: $TSFixMe = await Promise.all([
                StatusPageService.findBy({
                    query: { projectId: projectId },
                    skip: req.query.skip || 0,
                    limit: req.query.limit || 10,
                    select: selectStatusPage,
                    populate: populateStatusPage,
                }),
                StatusPageService.countBy({
                    query: { projectId: projectId },
                }),
            ]);
            return sendListResponse(req, res, statusPages, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/StatusPages',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { data, count }: $TSFixMe =
                await StatusPageService.getStatusPagesByProjectId({
                    projectId: req.params.projectId,
                    skip: req.query.skip,
                    limit: req.query.limit,
                });
            return sendListResponse(req, res, data, count); // Frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/statuspage',
    getUser,
    isAuthorized,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        const projectId: $TSFixMe = req.params.projectId;

        try {
            const populateStatusPage: $TSFixMe = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
                {
                    path: 'monitors.statusPageCategory',
                    select: 'name',
                },
            ];

            const selectStatusPage: $TSFixMe =
                'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle multipleNotificationTypes';

            const [statusPage, count]: $TSFixMe = await Promise.all([
                StatusPageService.findBy({
                    query: { projectId },
                    skip: req.query.skip || 0,
                    limit: req.query.limit || 10,
                    select: selectStatusPage,
                    populate: populateStatusPage,
                }),
                StatusPageService.countBy({ query: { projectId } }),
            ]);
            return sendListResponse(req, res, statusPage, count); // Frontend expects sendListResponse
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// External status page api - get the data to show on status page using Slug
router.get(
    '/:statusPageSlug',
    checkUser,
    ipWhitelist,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        const statusPageSlug: $TSFixMe = req.params.statusPageSlug;
        const url: $TSFixMe = req.query.url;

        const user: $TSFixMe = req.user;
        let statusPage: $TSFixMe = {};
        const populateStatusPage: $TSFixMe = [
            {
                path: 'projectId',
                select: 'name parentProjectId',
                populate: { path: 'parentProjectId', select: '_id' },
            },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
            {
                path: 'monitors.monitor',
                select: 'name',
            },
            {
                path: 'monitors.statusPageCategory',
                select: 'name',
            },
        ];

        const selectStatusPage: $TSFixMe =
            'projectId domains monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle';

        try {
            // Call the StatusPageService.
            if (url && url !== 'null') {
                statusPage = await StatusPageService.getStatusPage({
                    query: { domains: { $elemMatch: { domain: url } } },
                    userId: user,
                    populate: populateStatusPage,
                    select: selectStatusPage,
                });
            } else if ((!url || url === 'null') && statusPageSlug) {
                statusPage = await StatusPageService.getStatusPage({
                    query: { slug: statusPageSlug },
                    userId: user,
                    populate: populateStatusPage,
                    select: selectStatusPage,
                });
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'StatusPage Slug or Url required',
                });
            }

            if (statusPage.isPrivate && !req.user) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'You are unauthorized to access the page.',
                });
            }
            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/:statusPageSlug/duplicateStatusPage',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, statusPageSlug }: $TSFixMe = req.params;
            const { subProjectId }: $TSFixMe = req.query;
            const { name }: $TSFixMe = req.body;

            if (!name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page name is empty',
                });
            }

            let statusPageProjectId: $TSFixMe = projectId;
            let filterMonitors: $TSFixMe = false;
            if (subProjectId) {
                statusPageProjectId = subProjectId;
                filterMonitors = true;
            }

            const response: $TSFixMe =
                await StatusPageService.duplicateStatusPage(
                    statusPageProjectId,
                    statusPageSlug,
                    name,
                    filterMonitors
                );

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:statusPageId/rss',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const statusPageId: $TSFixMe = req.params.statusPageId;
        const url: $TSFixMe = req.query.url;

        const user: $TSFixMe = req.user;
        let statusPage: $TSFixMe = {};

        try {
            // Call the StatusPageService.
            if (url && url !== 'null') {
                statusPage = await StatusPageService.getStatusPage({
                    query: { domains: { $elemMatch: { domain: url } } },
                    userId: user,
                    select: 'name isPrivate monitors projectId',
                });
            } else if ((!url || url === 'null') && statusPageId) {
                statusPage = await StatusPageService.getStatusPage({
                    query: { _id: statusPageId },
                    userId: user,
                    select: 'name isPrivate monitors projectId',
                });
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'StatusPage Id or Url required',
                });
            }

            if (statusPage.isPrivate && !req.user) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'You are unauthorized to access the page.',
                });
            }
            const { incidents }: $TSFixMe =
                await StatusPageService.getIncidents({
                    _id: statusPageId,
                });
            const refinedIncidents: $TSFixMe = [];
            for (const incident of incidents) {
                refinedIncidents.push({
                    item: {
                        title: incident.title,

                        guid: `${global.apiHost}/StatusPage/${statusPageId}/rss/${incident._id}`,
                        pubDate: new Date(incident.createdAt).toUTCString(),
                        description: `<![CDATA[Description: ${
                            incident.description
                        }<br>Incident Id: ${incident._id.toString()} <br>Monitor Name(s): ${handleMonitorList(
                            incident.monitors
                        )}<br>Acknowledge Time: ${
                            incident.acknowledgedAt
                        }<br>Resolve Time: ${incident.resolvedAt}<br>${
                            incident.investigationNote
                                ? `Investigation Note: ${incident.investigationNote}`
                                : ''
                        }]]>`,
                    },
                });
            }
            const xmlOptions: $TSFixMe = {
                indent: '  ',
                header: true,
            };

            const feedObj: $TSFixMe = {
                _name: 'rss',
                _attrs: {
                    version: '2.0',
                    'xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
                    'xmlns:wfw': 'http://wellformedweb.org/CommentAPI/',
                },
                _content: {
                    channel: [
                        {
                            title: `Incidents for status page ${statusPage.name}`,
                        },
                        {
                            description:
                                'RSS feed for all incidents related to monitors attached to status page',
                        },
                        {
                            link: `${global.apiHost}/StatusPage/${statusPageId}/rss`,
                        },
                        {
                            lastBuildDate: () => {
                                return new Date().toUTCString();
                            },
                        },
                        {
                            language: 'en',
                        },
                        ...refinedIncidents,
                    ],
                },
            };
            const finalFeed: $TSFixMe = toXML(feedObj, xmlOptions);
            res.contentType('application/rss+xml');
            return sendItemResponse(req, res, finalFeed);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.get(
    '/:projectId/:statusPageSlug/notes',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        let result: $TSFixMe;
        const statusPageSlug: $TSFixMe = req.params.statusPageSlug;
        const skip: $TSFixMe = req.query.skip || 0;
        const limit: $TSFixMe = req.query.limit || 10;
        const days: $TSFixMe = req.query.days || 14;
        const newTheme: $TSFixMe = req.query.newTheme;

        try {
            // Call the StatusPageService.
            const response: $TSFixMe = await StatusPageService.getNotes(
                { slug: statusPageSlug },
                skip,
                limit
            );
            const notes: $TSFixMe = response.notes;
            const count: $TSFixMe = response.count;
            const updatedNotes: $TSFixMe = [];
            if (newTheme) {
                if (notes.length > 0) {
                    for (const note of notes) {
                        const statusPageNote: $TSFixMe =
                            await StatusPageService.getIncidentNotes(
                                {
                                    incidentId: note._id,
                                    postOnStatusPage: true,
                                },
                                skip,
                                limit
                            );

                        const sortMsg: $TSFixMe =
                            statusPageNote.message.reverse();

                        updatedNotes.push({
                            ...note,
                            message: sortMsg,
                        });
                    }
                }

                result = formatNotes(updatedNotes, days);
                result = checkDuplicateDates(result);
            } else {
                result = notes;
            }
            return sendListResponse(req, res, result, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/incident/:incidentSlug',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { incidentSlug }: $TSFixMe = req.params;

            const incidentData: $TSFixMe = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });

            const incident: $TSFixMe = await StatusPageService.getIncident({
                _id: incidentData._id,
            });
            return sendItemResponse(req, res, incident);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:incidentSlug/incidentNotes',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { incidentSlug }: $TSFixMe = req.params;

            const incident: $TSFixMe = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });
            const { skip, limit, postOnStatusPage }: $TSFixMe = req.query;

            const response: $TSFixMe = await StatusPageService.getIncidentNotes(
                { incidentId: incident._id, postOnStatusPage },
                skip,
                limit
            );
            const { message, count }: $TSFixMe = response;
            return sendListResponse(req, res, message, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:monitorId/individualnotes',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        let date: $TSFixMe = req.query.date;

        date = new Date(date);
        const theme: $TSFixMe = req.query.theme;
        const start: $TSFixMe = new Date(
            date.getFullYear(),

            date.getMonth(),

            date.getDate(),
            0,
            0,
            0
        );
        const end: $TSFixMe = new Date(
            date.getFullYear(),

            date.getMonth(),

            date.getDate(),
            23,
            59,
            59
        );

        const skip: $TSFixMe = req.query.skip || 0;
        const limit: $TSFixMe = req.query.limit || 5;
        const query: $TSFixMe = {
            'monitors.monitorId': req.params.monitorId,
            deleted: false,
            createdAt: { $gte: start, $lt: end },
        };

        try {
            // Call the StatusPageService.
            const response: $TSFixMe = await StatusPageService.getNotesByDate(
                query,
                skip,
                limit
            );
            let notes: $TSFixMe = response.investigationNotes;
            if ((theme && typeof theme === 'boolean') || theme === 'true') {
                const updatedNotes: $TSFixMe = [];
                if (notes.length > 0) {
                    for (const note of notes) {
                        const statusPageNote: $TSFixMe =
                            await StatusPageService.getIncidentNotes(
                                {
                                    incidentId: note._id,
                                    postOnStatusPage: true,
                                },
                                skip,
                                0
                            );

                        const sortMsg: $TSFixMe =
                            statusPageNote.message.reverse();

                        updatedNotes.push({
                            ...note,
                            message: sortMsg,
                        });
                    }
                    notes = updatedNotes;
                }
                notes = checkDuplicateDates(notes);
            }
            const count: $TSFixMe = response.count;
            return sendListResponse(req, res, notes, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:statusPageSlug/events',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const statusPageSlug: $TSFixMe = req.params.statusPageSlug;
        const skip: $TSFixMe = req.query.skip || 0;
        const limit: $TSFixMe = req.query.limit || 5;
        const theme: $TSFixMe = req.query.theme;
        try {
            // Call the StatusPageService.
            const response: $TSFixMe = await StatusPageService.getEvents(
                { slug: statusPageSlug },
                skip,
                limit,

                theme
            );

            let events: $TSFixMe = response.events;
            const count: $TSFixMe = response.count;
            if ((theme && typeof theme === 'boolean') || theme === 'true') {
                const results: $TSFixMe = await fetchNotes(events, limit);
                events = results;
            }
            return sendListResponse(req, res, events, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:statusPageSlug/futureEvents',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;
            const { skip = 0, limit = 5, theme }: $TSFixMe = req.query;
            const response: $TSFixMe = await StatusPageService.getFutureEvents(
                { slug: statusPageSlug },
                skip,
                limit
            );
            if ((theme && typeof theme === 'boolean') || theme === 'true') {
                const results: $TSFixMe = await fetchNotes(
                    response.events,
                    limit
                );
                response.events = results;
            }
            const { events, count }: $TSFixMe = response;
            return sendListResponse(req, res, events, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:statusPageSlug/pastEvents',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;
            const { skip = 0, limit = 5, theme }: $TSFixMe = req.query;

            const response: $TSFixMe = await StatusPageService.getPastEvents(
                { slug: statusPageSlug },
                skip,
                limit
            );
            if ((theme && typeof theme === 'boolean') || theme === 'true') {
                const results: $TSFixMe = await fetchNotes(
                    response.events,
                    limit
                );
                response.events = results;
            }
            const { events, count }: $TSFixMe = response;

            return sendListResponse(req, res, events, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

const fetchNotes: Function = async (
    events: $TSFixMe,
    limit: PositiveNumber
): void => {
    const updatedEvents: $TSFixMe = [];
    if (events.length > 0) {
        for (const event of events) {
            const statusPageEvent: $TSFixMe =
                await StatusPageService.getEventNotes({
                    scheduledEventId: event._id,
                    type: 'investigation',
                });
            updatedEvents.push({
                ...event,
                notes: statusPageEvent.notes,
            });
        }

        events = formatNotes(updatedEvents, limit);
        events = checkDuplicateDates(events);
        return events;
    }
};

router.get(
    '/:projectId/notes/:scheduledEventSlug',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        const { scheduledEventSlug }: $TSFixMe = req.params;

        const { skip, limit }: $TSFixMe = req.query;

        const scheduledEventId: $TSFixMe =
            await ScheduledEventService.findOneBy({
                query: { slug: scheduledEventSlug },
                select: '_id createdById',
            });

        try {
            const response: $TSFixMe = await StatusPageService.getEventNotes(
                { scheduledEventId },
                skip,
                limit
            );
            const { notes, count }: $TSFixMe = response;
            return sendListResponse(req, res, notes, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:monitorId/individualevents',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        let date: $TSFixMe = req.query.date;

        date = moment(date).endOf('day').format();

        const skip: $TSFixMe = req.query.skip || 0;
        const limit: $TSFixMe = req.query.limit || 5;
        const theme: $TSFixMe = req.query.theme;

        const currentDate: $TSFixMe = moment().format();
        const query: $TSFixMe = {
            'monitors.monitorId': req.params.monitorId,
            showEventOnStatusPage: true,
            deleted: false,
            startDate: { $lte: date },
            endDate: {
                $gte: currentDate,
            },
        };

        try {
            // Call the StatusPageService.
            const response: $TSFixMe = await StatusPageService.getEventsByDate(
                query,
                skip,
                limit
            );
            let events: $TSFixMe = response.scheduledEvents;
            const count: $TSFixMe = response.count;
            if ((theme && typeof theme === 'boolean') || theme === 'true') {
                const updatedEvents: $TSFixMe = [];
                if (events.length > 0) {
                    for (const event of events) {
                        const statusPageEvent: $TSFixMe =
                            await StatusPageService.getEventNotes({
                                scheduledEventId: event._id,
                                type: 'investigation',
                            });
                        updatedEvents.push({
                            ...event,
                            notes: statusPageEvent.notes,
                        });
                    }
                    events = updatedEvents;
                }
            }
            return sendListResponse(req, res, events, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Get a particular scheduled event
router.get(
    '/:projectId/scheduledEvent/:scheduledEventId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { scheduledEventId }: $TSFixMe = req.params;

        try {
            const response: $TSFixMe = await StatusPageService.getEvent({
                slug: scheduledEventId,
            });
            return sendListResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
/*
 * Route
 * Description: Get all Monitor Statuses by monitorId
 */
router.post(
    '/:projectId/:monitorId/monitorStatuses',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { startDate, endDate }: $TSFixMe = req.body;
            const monitorId: $TSFixMe = req.params.monitorId;
            const monitorStatuses: $TSFixMe =
                await MonitorService.getMonitorStatuses(
                    monitorId,
                    startDate,
                    endDate
                );
            return sendListResponse(req, res, monitorStatuses);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/:monitorId/monitorLogs',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { monitorId }: $TSFixMe = req.params;
            const endDate: $TSFixMe = moment(Date.now());
            const startDate: $TSFixMe = moment(endDate).subtract(90, 'days');
            const {
                memory,
                cpu,
                storage,
                responseTime,
                temperature,
            }: $TSFixMe = req.body;
            const filter: $TSFixMe = {
                ...(!memory && {
                    maxMemoryUsed: 0,
                    memoryUsed: 0,
                }),
                ...(!cpu && {
                    maxCpuLoad: 0,
                    cpuLoad: 0,
                }),
                ...(!storage && {
                    maxStorageUsed: 0,
                    storageUsed: 0,
                }),
                ...(!responseTime && {
                    maxResponseTime: 0,
                    responseTime: 0,
                }),
                ...(!temperature && {
                    maxMainTemp: 0,
                    mainTemp: 0,
                }),
            };

            const monitorLogs: $TSFixMe =
                await MonitorService.getMonitorLogsByDay(
                    monitorId,
                    startDate,
                    endDate,
                    filter
                );
            return sendListResponse(req, res, monitorLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/probes',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const skip: $TSFixMe = req.query.skip || 0;
            const limit: $TSFixMe = req.query.limit || 0;
            const selectProbe: $TSFixMe =
                'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';
            const [probes, count]: $TSFixMe = await Promise.all([
                ProbeService.findBy({
                    query: {},
                    limit,
                    skip,
                    select: selectProbe,
                }),
                ProbeService.countBy({}),
            ]);
            return sendListResponse(req, res, probes, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:projectId/:statusPageSlug',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const statusPageSlug: $TSFixMe = req.params.statusPageSlug;

        const userId: $TSFixMe = req.user ? req.user.id : null;
        try {
            // Call the StatusPageService.
            const statusPage: $TSFixMe = await StatusPageService.deleteBy(
                { slug: statusPageSlug },
                userId
            );
            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/timeline/:incidentSlug',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { incidentSlug }: $TSFixMe = req.params;

            const incidentData: $TSFixMe = await IncidentService.findOneBy({
                query: { slug: incidentSlug },
                select: '_id',
            });
            /*
             * Setting limit to one
             * Since the frontend only need the last content (current content)
             * Of incident timeline
             */
            const { skip = 0, limit = 1 }: $TSFixMe = req.query;
            const populateIncTimeline: $TSFixMe = [
                { path: 'createdById', select: 'name' },
                {
                    path: 'probeId',
                    select: 'probeName probeImage',
                },
            ];
            const selectIncTimeline: $TSFixMe =
                'incidentId createdById probeId createdByZapier createdAt status incident_state';
            const timeline: $TSFixMe = await IncidentTimelineService.findBy({
                query: { incidentId: incidentData._id },
                skip,
                limit,
                populate: populateIncTimeline,
                select: selectIncTimeline,
            });
            return sendItemResponse(req, res, timeline);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/:statusPageSlug/timelines',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            const incidents: $TSFixMe = await StatusPageService.getNotes({
                slug: statusPageSlug,
            });
            const response: $TSFixMe =
                await IncidentTimelineService.getIncidentLastTimelines(
                    incidents.notes
                );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

/*
 * Get subscribers by monitorId in a statuspage
 *  Req.params-> {projectId, monitorId, statusPageId};
 *  Returns: response subscribers, error message
 */
router.get(
    '/:projectId/monitor/:statusPageId',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { statusPageId }: $TSFixMe = req.params;
            const skip: $TSFixMe = req.query.skip || 0;
            const limit: $TSFixMe = req.query.limit || 10;
            const populateStatusPage: $TSFixMe = [
                { path: 'monitors.monitor', select: '_id' },
            ];

            const statusPage: $TSFixMe = await StatusPageService.findOneBy({
                query: { _id: statusPageId },
                select: 'monitors',
                populate: populateStatusPage,
            });

            const monitors: $TSFixMe = statusPage.monitors.map(
                (mon: $TSFixMe) => {
                    return mon.monitor._id;
                }
            );
            const populate: $TSFixMe = [
                { path: 'projectId', select: 'name _id' },
                { path: 'monitorId', select: 'name _id' },
                { path: 'statusPageId', select: 'name _id' },
            ];
            const select: $TSFixMe =
                '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';

            const [subscribers, count]: $TSFixMe = await Promise.all([
                SubscriberService.findBy({
                    query: {
                        monitorId: monitors,
                    },
                    skip,
                    limit,
                    select,
                    populate,
                }),
                SubscriberService.countBy({
                    monitorId: monitors,
                }),
            ]);
            return sendItemResponse(req, res, {
                subscribers,
                skip,
                limit,
                count,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/createExternalStatusPage/:statusPageId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, statusPageId }: $TSFixMe = req.params;
            const { name, url }: $TSFixMe = req.body;
            const data: $TSFixMe = {};

            data.name = name;

            data.url = url;

            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Values can't be null",
                });
            }

            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page Name is required.',
                });
            }

            if (!data.url || !data.url.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page url is required.',
                });
            }

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }
            // To confirm the name and url is not created already
            const nameQuery: $TSFixMe = { name };
            const urlQuery: $TSFixMe = { url };

            const existingExternalStatusPageId: $TSFixMe =
                await StatusPageService.getExternalStatusPage(nameQuery);

            const existingExternalStatusPageUrl: $TSFixMe =
                await StatusPageService.getExternalStatusPage(urlQuery);
            if (existingExternalStatusPageId.length > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page Name is already present',
                });
            }
            if (existingExternalStatusPageUrl.length > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page Url is already present',
                });
            }
            // This scrapes the External Status Page
            try {
                const res: $TSFixMe = await axios.get(`${data.url}`);
                const $: $TSFixMe = cheerio.load(res.data);
                const status: $TSFixMe = $('span.status.font-large')
                    .text()
                    .replace(/\s\s+/g, ''); // To remove empty spaces
                const atlassianStatuspage: $TSFixMe = $(
                    '.powered-by a.color-secondary'
                ).text(); // This verifies that we are working with StatusPages Powered by Atlassian.
                if (atlassianStatuspage !== 'Powered by Statuspage') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'External Status Page Url is Invalid',
                    });
                }
                if (status === 'All Systems Operational') {
                    data.description = status;
                } else {
                    $('div.component-container.border-color').each(
                        (i: $TSFixMe, el: $TSFixMe) => {
                            const componentStatus: $TSFixMe = $(el)
                                .find('.component-status')
                                .text()
                                .replace(/\s\s+/g, '');
                            if (componentStatus !== 'Operational') {
                                data.description = componentStatus;
                            }
                        }
                    );
                }
            } catch (err) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page Url is Invalid',
                });
            }

            data.createdById = req.user ? req.user.id : null;

            data.projectId = projectId;

            data.statusPageId = statusPageId;

            await StatusPageService.createExternalStatusPage(data);

            const response: $TSFixMe =
                await StatusPageService.getExternalStatusPage();
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/updateExternalStatusPage/:externalStatusPageId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, externalStatusPageId }: $TSFixMe = req.params;
            const { name, url }: $TSFixMe = req.body;
            const data: $TSFixMe = {};

            data.name = name;

            data.url = url;
            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Values can't be null",
                });
            }

            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page Name is required.',
                });
            }

            if (!data.url || !data.url.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page url is required.',
                });
            }
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }
            if (!externalStatusPageId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page ID is required.',
                });
            }
            // This scrapes the External Status Page
            try {
                const res: $TSFixMe = await axios.get(`${data.url}`);
                const $: $TSFixMe = cheerio.load(res.data);
                const status: $TSFixMe = $('span.status.font-large')
                    .text()
                    .replace(/\s\s+/g, ''); // To remove empty spaces
                const atlassianStatuspage: $TSFixMe = $(
                    '.powered-by a.color-secondary'
                ).text();
                if (atlassianStatuspage !== 'Powered by Statuspage') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'External Status Page Url is Invalid',
                    });
                }
                if (status === 'All Systems Operational') {
                    data.description = status;
                } else {
                    $('div.component-container.border-color').each(
                        (i: $TSFixMe, el: $TSFixMe) => {
                            const componentStatus: $TSFixMe = $(el)
                                .find('.component-status')
                                .text()
                                .replace(/\s\s+/g, '');
                            if (componentStatus !== 'Operational') {
                                data.description = componentStatus;
                            }
                        }
                    );
                }
            } catch (err) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page Url is Invalid',
                });
            }

            await StatusPageService.updateExternalStatusPage(
                projectId,
                externalStatusPageId,
                data
            );

            const response: $TSFixMe =
                await StatusPageService.getExternalStatusPage();
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/fetchExternalStatusPages/:statusPageId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, statusPageId }: $TSFixMe = req.params;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }
            if (!statusPageId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Status Page ID is required.',
                });
            }

            // To fetch all created external statuspages
            const query: $TSFixMe = { projectId, statusPageId };

            const response: $TSFixMe =
                await StatusPageService.getExternalStatusPage(query);

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/deleteExternalStatusPage/:externalStatusPageId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, externalStatusPageId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }
            if (!externalStatusPageId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'External Status Page ID is required.',
                });
            }

            // Deleting the external Id
            await StatusPageService.deleteExternalStatusPage(
                projectId,
                externalStatusPageId,
                userId
            );

            const response: $TSFixMe =
                await StatusPageService.getExternalStatusPage();
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/announcement/:statusPageId',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, statusPageId }: $TSFixMe = req.params;
            const { data }: $TSFixMe = req.body;

            data.createdById = req.user ? req.user.id : null;

            if (!data) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: "Values can't be null",
                });
            }

            if (!data.name || !data.name.trim()) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Announcement name is required.',
                });
            }

            // Data.monitors should be an array containing id of monitor(s)
            if (data.monitors && !Array.isArray(data.monitors)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Monitors is not of type array',
                });
            }

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project ID is required.',
                });
            }

            data.projectId = projectId;
            data.statusPageId = statusPageId;
            const response: $TSFixMe =
                await StatusPageService.createAnnouncement(data);

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/announcement/:statusPageId/:announcementId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, statusPageId, announcementId }: $TSFixMe =
                req.params;
            const { data }: $TSFixMe = req.body;

            data.createdById = req.user ? req.user.id : null;

            if (!data.announcementToggle) {
                if (!data) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: "Values can't be null",
                    });
                }

                if (!data.name || !data.name.trim()) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Announcement name is required.',
                    });
                }

                // Data.monitors should be an array containing id of monitor(s)
                if (data.monitors && !Array.isArray(data.monitors)) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Monitors is not of type array',
                    });
                }

                if (!projectId) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Project ID is required.',
                    });
                }

                data.monitors = data.monitors.map((monitor: $TSFixMe) => {
                    return {
                        monitorId: monitor,
                    };
                });
            }

            const query: $TSFixMe = {
                projectId,
                statusPageId,
                _id: announcementId,
            };

            const response: $TSFixMe =
                await StatusPageService.updateAnnouncement(query, data);

            if (response && data.announcementToggle) {
                const date: $TSFixMe = new Date();
                const log: $TSFixMe = {};

                log.statusPageId = statusPageId;
                if (data.hideAnnouncement) {
                    log.endDate = date;

                    log.updatedById = data.createdById;

                    log.active = false;
                    await StatusPageService.updateAnnouncementLog(
                        { active: true },
                        log
                    );
                } else {
                    log.announcementId = announcementId;

                    log.createdById = data.createdById;

                    log.startDate = date;

                    log.active = true;
                    await StatusPageService.createAnnouncementLog(log);
                }
            }

            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/announcementLogs/:statusPageId',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageId }: $TSFixMe = req.params;
            const { skip, limit, theme }: $TSFixMe = req.query;
            const [logs, count]: $TSFixMe = await Promise.all([
                StatusPageService.getAnnouncementLogs(
                    {
                        statusPageId,
                    },
                    skip,
                    limit
                ),
                StatusPageService.countAnnouncementLogs({
                    statusPageId,
                }),
            ]);
            let announcementLogs: $TSFixMe = logs;

            if ((theme && typeof theme === 'boolean') || theme === 'true') {
                const updatedLogs: $TSFixMe = [];
                for (const log of announcementLogs) {
                    updatedLogs.push({ ...log });
                }

                announcementLogs = formatNotes(updatedLogs, 20);
                announcementLogs = checkDuplicateDates(announcementLogs);
            }

            return sendItemResponse(req, res, {
                announcementLogs,
                skip,
                limit,
                count,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/announcement/:statusPageId',
    checkUser,
    async (req: $TSFixMe, res: $TSFixMe): void => {
        try {
            const { projectId, statusPageId }: $TSFixMe = req.params;
            const { skip, limit, show }: $TSFixMe = req.query;
            const query: $TSFixMe = { projectId, statusPageId };

            if (show) {
                query.hideAnnouncement = false;
            }

            const [allAnnouncements, count]: $TSFixMe = await Promise.all([
                StatusPageService.getAnnouncements(query, skip, limit),
                StatusPageService.countAnnouncements(query),
            ]);

            return sendItemResponse(req, res, {
                allAnnouncements,
                skip,
                limit,
                count,
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:projectId/announcement/:statusPageSlug/single/:announcementSlug',
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, statusPageSlug, announcementSlug }: $TSFixMe =
                req.params;

            const { _id }: $TSFixMe = await StatusPageService.findOneBy({
                query: { slug: statusPageSlug },
                select: '_id',
            });
            const response: $TSFixMe =
                await StatusPageService.getSingleAnnouncement({
                    projectId,
                    statusPageId: _id,
                    slug: announcementSlug,
                });
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    `/:projectId/announcement/:announcementId/delete`,
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId, announcementId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const response: $TSFixMe =
                await StatusPageService.deleteAnnouncement(
                    {
                        projectId,
                        _id: announcementId,
                    },
                    userId
                );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    `/:projectId/announcementLog/:announcementLogId/delete`,
    checkUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { announcementLogId }: $TSFixMe = req.params;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const response: $TSFixMe =
                await StatusPageService.deleteAnnouncementLog(
                    {
                        _id: announcementLogId,
                    },
                    userId
                );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

const formatNotes: Function = (data: $TSFixMe = [], days: $TSFixMe): void => {
    const result: $TSFixMe = [];
    const limit: $TSFixMe = days - 1;

    for (let i: $TSFixMe = 0; i <= limit; i++) {
        const date: $TSFixMe = new Date();
        date.setDate(date.getDate() - i);

        if (data.length > 0) {
            for (const incident of data) {
                const { createdAt }: $TSFixMe = incident;
                const incidentDate: $TSFixMe = new Date(createdAt);

                // Check if any incidence occured on this day.
                if (incidentDate.toDateString() === date.toDateString()) {
                    const lastIncident: $TSFixMe = result[result.length - 1];
                    const lastIncidentDate: $TSFixMe = new Date(
                        lastIncident?.createdAt
                    );

                    // If date has been pushed into result array, and we find an incidence, replace date with the incidence, else push incidence
                    lastIncidentDate.toDateString() ===
                        incidentDate.toDateString() && !lastIncident._id
                        ? (result[result.length - 1] = incident)
                        : result.push(incident);
                }
            }
        }
    }

    return result;
};

function checkDuplicateDates(items: $TSFixMe): void {
    const track: $TSFixMe = {};

    const result: $TSFixMe = [];

    for (const item of items) {
        const date: $TSFixMe = String(item.createdAt).slice(0, 10);

        if (!track[date]) {
            item.style = true;

            track[date] = date;
        } else {
            item.style = false;
        }

        result.push(item);
    }
    return result;
}

function handleMonitorList(monitors: $TSFixMe): void {
    if (monitors.length === 1) {
        return monitors[0].monitorId.name;
    }
    if (monitors.length === 2) {
        return `${monitors[0].monitorId.name} and ${monitors[1].monitorId.name}`;
    }
    if (monitors.length === 3) {
        return `${monitors[0].monitorId.name}, ${monitors[1].monitorId.name} and ${monitors[2].monitorId.name}`;
    }
    if (monitors.length > 3) {
        return `${monitors[0].monitorId.name}, ${
            monitors[1].monitorId.name
        } and ${monitors.length - 2} others`;
    }
}

router.get(
    '/resources/:statusPageSlug/ongoing-events',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const ongoingEvents: $TSFixMe = await getOngoingScheduledEvents(
                req,

                statusPage.slug
            );

            return sendItemResponse(req, res, ongoingEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/future-events',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const futureEvents: $TSFixMe = await getFutureEvents(
                req,
                statusPage.slug
            );

            return sendItemResponse(req, res, futureEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/past-events',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const pastEvents: $TSFixMe = await getPastEvents(
                req,
                statusPage.slug
            );

            return sendItemResponse(req, res, pastEvents);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/probes',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const probes: $TSFixMe = await getProbes(req);

            return sendItemResponse(req, res, probes);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/monitor-logs',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const monitorLogs: $TSFixMe = await getMonitorLogs(
                req,
                statusPage.monitors
            );

            return sendItemResponse(req, res, monitorLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/announcements',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const { _id: statusPageId, projectId } = statusPage;

            const announcements: $TSFixMe = await getAnnouncements(
                req,
                statusPageId,
                projectId
            );

            return sendItemResponse(req, res, announcements);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/announcement-logs',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const announcementLogs: $TSFixMe = await getAnnouncementLogs(
                statusPage
            );

            return sendItemResponse(req, res, announcementLogs);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/monitor-timelines',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const timelines: $TSFixMe = await getMonitorTimelines(
                statusPage.slug
            );

            return sendItemResponse(req, res, timelines);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/statuspage-notes',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;

            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const statusPageNote: $TSFixMe = await getStatusPageNote(
                req,

                statusPage.slug,

                statusPage.theme
            );

            return sendItemResponse(req, res, statusPageNote);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/resources/:statusPageSlug/monitor-statuses',
    checkUser,
    ipWhitelist,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { statusPageSlug }: $TSFixMe = req.params;
            const { range }: $TSFixMe = req.query;
            const response: $TSFixMe = {};
            //Get status pages
            const statusPage: $TSFixMe = await getStatusPage(
                req,
                statusPageSlug
            );

            if (statusPage.error) {
                return sendErrorResponse(req, res, statusPage.data);
            }

            const { monitors }: $TSFixMe = statusPage;

            const monitorStatus: $TSFixMe = await getMonitorStatuses(
                req,
                monitors
            );

            response.monitorStatus = monitorStatus || {};

            statusPage.monitorsData.map((data: $TSFixMe) => {
                data.statuses = response.monitorStatus[data._id];
                return data;
            });

            response.statusPages = statusPage;

            const probes: $TSFixMe = await getProbes(req);

            const time: $TSFixMe = await calculateTime(
                statusPage,
                monitorStatus,
                probes,
                range
            );

            response.time = time || {};
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

async function getStatusPage(
    req: ExpressRequest,
    statusPageSlug: $TSFixMe
): void {
    const url: $TSFixMe = req.query.url;
    const user: $TSFixMe = req.user;
    let statusPage: $TSFixMe = {};
    const populateStatusPage: $TSFixMe = [
        {
            path: 'projectId',
            select: 'name parentProjectId',
            populate: { path: 'parentProjectId', select: '_id' },
        },
        {
            path: 'domains.domainVerificationToken',
            select: 'domain verificationToken verified ',
        },
        {
            path: 'monitors.monitor',
            select: 'name',
        },
        {
            path: 'monitors.statusPageCategory',
            select: 'name',
        },
    ];

    const selectStatusPage: $TSFixMe =
        'projectId domains monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle';

    // Call the StatusPageService.
    if (url && url !== 'null') {
        statusPage = await StatusPageService.getStatusPage({
            query: { domains: { $elemMatch: { domain: url } } },
            userId: user,
            populate: populateStatusPage,
            select: selectStatusPage,
        });
    } else if ((!url || url === 'null') && statusPageSlug) {
        statusPage = await StatusPageService.getStatusPage({
            query: { slug: statusPageSlug },
            userId: user,
            populate: populateStatusPage,
            select: selectStatusPage,
        });
    } else {
        return {
            error: true,
            data: new BadDataException('StatusPage Slug or Url required'),
        };
    }

    if (statusPage.isPrivate && !req.user) {
        return {
            error: true,
            data: {
                code: 401,
                message: 'You are unauthorized to access the page.',
            },
        };
    }
    return statusPage;
}

async function getOngoingScheduledEvents(
    req: ExpressRequest,
    statusPageSlug: $TSFixMe
): void {
    const { skip = 0, limit = 5, theme = false }: $TSFixMe = req.query;
    // Call the StatusPageService.
    const response: $TSFixMe = await StatusPageService.getEvents(
        { slug: statusPageSlug },
        skip,
        limit,

        theme
    );

    let events: $TSFixMe = response.events;
    const count: $TSFixMe = response.count;
    if ((theme && typeof theme === 'boolean') || theme === 'true') {
        const results: $TSFixMe = await fetchNotes(events, limit);
        events = results;
    }
    return { events, count };
}
async function getFutureEvents(
    req: ExpressRequest,
    statusPageSlug: $TSFixMe
): void {
    const { skip = 0, limit = 5, theme = false }: $TSFixMe = req.query;
    const response: $TSFixMe = await StatusPageService.getFutureEvents(
        { slug: statusPageSlug },
        skip,
        limit
    );
    if ((theme && typeof theme === 'boolean') || theme === 'true') {
        const results: $TSFixMe = await fetchNotes(response.events, limit);
        response.events = results;
    }
    return response;
}
async function getPastEvents(
    req: ExpressRequest,
    statusPageSlug: $TSFixMe
): void {
    const { skip = 0, limit = 5, theme = false }: $TSFixMe = req.query;

    const response: $TSFixMe = await StatusPageService.getPastEvents(
        { slug: statusPageSlug },
        skip,
        limit
    );
    if ((theme && typeof theme === 'boolean') || theme === 'true') {
        const results: $TSFixMe = await fetchNotes(response.events, limit);
        response.events = results;
    }

    return response;
}
async function getProbes(req: $TSFixMe): void {
    const skip: $TSFixMe = req.query.skip || 0;
    const limit: $TSFixMe = req.query.limit || 0;
    const selectProbe: $TSFixMe =
        'createdAt probeKey probeName version lastAlive deleted deletedAt probeImage';

    const probes: $TSFixMe = await ProbeService.findBy({
        query: {},
        limit,
        skip,
        select: selectProbe,
    });
    const count: $TSFixMe = await ProbeService.countBy({});
    return { probes, count };
}
async function getMonitorLogs(req: ExpressRequest, monitors: $TSFixMe): void {
    const logs: $TSFixMe = [];
    await Promise.all(
        monitors.map(async (monitor: $TSFixMe) => {
            const endDate: $TSFixMe = moment(Date.now());
            const startDate: $TSFixMe = moment(endDate).subtract(90, 'days');
            const {
                memory,
                cpu,
                storage,
                responseTime,
                temperature,
                monitor: monitorId,
            } = monitor;
            const filter: $TSFixMe = {
                ...(!memory && {
                    maxMemoryUsed: 0,
                    memoryUsed: 0,
                }),
                ...(!cpu && {
                    maxCpuLoad: 0,
                    cpuLoad: 0,
                }),
                ...(!storage && {
                    maxStorageUsed: 0,
                    storageUsed: 0,
                }),
                ...(!responseTime && {
                    maxResponseTime: 0,
                    responseTime: 0,
                }),
                ...(!temperature && {
                    maxMainTemp: 0,
                    mainTemp: 0,
                }),
            };

            const monitorLogs: $TSFixMe =
                await MonitorService.getMonitorLogsByDay(
                    monitorId._id,
                    startDate,
                    endDate,
                    filter
                );
            logs.push({
                logs: monitorLogs,
                monitorId: monitorId._id,
                count: monitorLogs.length,
            });
        })
    );
    return logs;
}

async function getAnnouncements(
    req: ExpressRequest,
    statusPageId: $TSFixMe,
    projectId: ObjectID
): void {
    const { skip, limit, show = true }: $TSFixMe = req.query;
    const query: $TSFixMe = { projectId, statusPageId };

    if (show) {
        query.hideAnnouncement = false;
    }

    const allAnnouncements: $TSFixMe = await StatusPageService.getAnnouncements(
        query,
        skip,
        limit
    );

    const count: $TSFixMe = await StatusPageService.countAnnouncements(query);

    return {
        allAnnouncements,
        skip,
        limit,
        count,
    };
}
//Get monitor status
async function getMonitorStatuses(
    req: ExpressRequest,
    monitors: $TSFixMe
): void {
    const status: $TSFixMe = {};
    const endDate: $TSFixMe = moment(Date.now());
    const startDate: $TSFixMe = moment(Date.now()).subtract(90, 'days');
    for (const data of monitors) {
        const monitorId: $TSFixMe = data.monitor._id;
        const monitorStatuses: $TSFixMe =
            await MonitorService.getMonitorStatuses(
                monitorId,
                startDate,
                endDate
            );

        status[monitorId] = monitorStatuses;
    }

    return status;
}
//Get timelines
async function getMonitorTimelines(statusPageSlug: $TSFixMe): void {
    const incidents: $TSFixMe = await StatusPageService.getNotes({
        slug: statusPageSlug,
    });
    const response: $TSFixMe =
        await IncidentTimelineService.getIncidentLastTimelines(incidents.notes);
    return response;
}
//Get status page notes
async function getStatusPageNote(
    req: ExpressRequest,
    statusPageSlug: $TSFixMe,
    theme: $TSFixMe
): void {
    let result: $TSFixMe;
    const skip: $TSFixMe = req.query.skip || 0;
    const limit: $TSFixMe = req.query.limit || 10;
    const days: $TSFixMe = req.query.days || 14;
    const newTheme: $TSFixMe = theme === 'Clean Theme';
    // Call the StatusPageService.
    const response: $TSFixMe = await StatusPageService.getNotes(
        { slug: statusPageSlug },
        skip,
        limit
    );
    const notes: $TSFixMe = response.notes;
    const count: $TSFixMe = response.count;
    const updatedNotes: $TSFixMe = [];
    if (newTheme) {
        if (notes.length > 0) {
            for (const note of notes) {
                const statusPageNote: $TSFixMe =
                    await StatusPageService.getIncidentNotes(
                        { incidentId: note._id, postOnStatusPage: true },
                        skip,
                        limit
                    );

                const sortMsg: $TSFixMe = statusPageNote.message.reverse();

                updatedNotes.push({
                    ...note,
                    message: sortMsg,
                });
            }
        }

        result = formatNotes(updatedNotes, days);
        result = checkDuplicateDates(result);
    } else {
        result = notes;
    }
    return { result, count };
}
//Get announcement logs
async function getAnnouncementLogs(
    statusPage: $TSFixMe,
    limit = 5,
    skip = 0
): void {
    const theme: $TSFixMe = statusPage.theme === 'Clean Theme';
    if (theme) {
        limit = statusPage.announcementLogsHistory || 14;
    }
    let announcementLogs: $TSFixMe =
        await StatusPageService.getAnnouncementLogs(
            {
                statusPageId: statusPage._id,
            },
            skip,
            limit
        );

    const count: $TSFixMe = await StatusPageService.countAnnouncementLogs({
        statusPageId: statusPage._id,
    });

    if ((theme && typeof theme === 'boolean') || theme === 'true') {
        const updatedLogs: $TSFixMe = [];
        for (const log of announcementLogs) {
            updatedLogs.push({ ...log });
        }

        announcementLogs = formatNotes(updatedLogs, 20);
        announcementLogs = checkDuplicateDates(announcementLogs);
    }

    return {
        announcementLogs,
        skip,
        limit,
        count,
    };
}
//Calculate time

async function calculateTime(
    statusPage: $TSFixMe,
    monitorStatus: $TSFixMe,
    probeData: $TSFixMe,
    range: $TSFixMe
): void {
    const result: $TSFixMe = {};
    const start: $TSFixMe = Date.now();
    const theme: $TSFixMe = statusPage.theme === 'Clean Theme';
    if (!theme) {
        range = 90;
    }

    await Promise.all(
        statusPage.monitors.map(async (data: $TSFixMe) => {
            const monitorId: $TSFixMe = data.monitor._id;

            const monitorData: $TSFixMe = statusPage.monitorsData.find(
                (a: $TSFixMe) => {
                    return String(a._id) === String(monitorId);
                }
            );
            const probe: $TSFixMe = probeData?.probes.filter(
                (probe: $TSFixMe) => {
                    return (
                        String(probe._id) ===
                        String(monitorData?.statuses[0]?._id)
                    );
                }
            );
            const statuses: $TSFixMe = filterProbeData(
                monitorData,
                probe[0],
                monitorStatus[monitorId]
            );

            const time: $TSFixMe = await MonitorService.calcTime(
                statuses,
                start,
                range
            );

            result[monitorId] = time;
        })
    );
    return result;
}

const filterProbeData: Function = (
    monitor: $TSFixMe,
    probe: $TSFixMe,
    backupStatus: $TSFixMe
): void => {
    const monitorStatuses: $TSFixMe = monitor?.statuses || backupStatus;
    const probesStatus: $TSFixMe =
        monitorStatuses && monitorStatuses.length > 0
            ? probe
                ? monitorStatuses.filter((probeStatuses: $TSFixMe) => {
                      return (
                          probeStatuses._id === null ||
                          String(probeStatuses._id) === String(probe._id)
                      );
                  })
                : monitorStatuses
            : [];
    const statuses: $TSFixMe =
        probesStatus &&
        probesStatus[0] &&
        probesStatus[0].statuses &&
        probesStatus[0].statuses.length > 0
            ? probesStatus[0].statuses
            : [];

    return statuses;
};
export default router;

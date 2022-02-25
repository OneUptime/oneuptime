import ServiceBase from './base'
const {
    schema: StatusPageModel,
    requiredFields,
} = require('../models/statusPage');

const publicListProps = {
    populate: [],
    select: ['_id', 'projectId', 'name', 'slug', 'title', 'description'],
};

const publicItemProps = {
    populate: [
        { path: 'projectId', select: 'parentProjectId' },
        { path: 'monitorIds', select: 'name' },
        { path: 'monitors.monitor', select: 'name' },
        {
            path: 'domains.domainVerificationToken',
            select: 'domain verificationToken verified ',
        },
    ],

    select: [
        'multipleNotificationTypes',
        'domains',
        'projectId',
        'monitors',
        'links',
        'slug',
        'title',
        'name',
        'isPrivate',
        'isSubscriberEnabled',
        'isGroupedByMonitorCategory',
        'showScheduledEvents',
        'moveIncidentToTheTop',
        'hideProbeBar',
        'hideUptime',
        'multipleNotifications',
        'hideResolvedIncident',
        'description',
        'copyright',
        'faviconPath',
        'logoPath',
        'bannerPath',
        'colors',
        'layout',
        'headerHTML',
        'footerHTML',
        'customCSS',
        'customJS',
        'statusBubbleId',
        'embeddedCss',
        'createdAt',
        'enableRSSFeed',
        'emailNotification',
        'smsNotification',
        'webhookNotification',
        'selectIndividualMonitors',
        'enableIpWhitelist',
        'ipWhitelist',
        'incidentHistoryDays',
        'scheduleHistoryDays',
        'announcementLogsHistory',
        'theme',
        'enableMultipleLanguage',
        'multipleLanguages',
        'twitterHandle',
    ],
};

const StatusPageServiceBase = new ServiceBase({
    model: StatusPageModel,
    requiredFields,
    friendlyName: 'Status Page',
    publicListProps: publicListProps,
    adminListProps: publicListProps,
    memberListProps: publicListProps,
    viewerListProps: publicListProps,
    publicItemProps: publicItemProps,
    adminItemProps: publicItemProps,
    memberItemProps: publicItemProps,
    viewerItemProps: publicItemProps,
});

export default {
    findBy: async function({ query, skip, limit, populate, select, sort }) {
        return await StatusPageServiceBase.findBy({
            query,
            skip,
            limit,
            populate,
            select,
            sort,
        });
    },

    findOneBy: async function({ query, select, populate, skip, limit, sort }) {
        return await StatusPageServiceBase.findOneBy({
            query,
            skip,
            limit,
            populate,
            select,
            sort,
        });
    },

    countBy: async function(query) {
        return await StatusPageServiceBase.countBy({ query });
    },

    create: async function({ data }) {
        data.domains = data.domains || [];
        data.colors = data.colors || defaultStatusPageColors.default;
        data.monitors = Array.isArray(data.monitors) ? [...data.monitors] : [];

        data.statusBubbleId = data.statusBubbleId || uuid.v4();

        const statusPage = await StatusPageServiceBase.create({
            data,
            checkDuplicatesValuesIn: ['name'],
            checkDuplicatesValuesInProject: true,
            slugifyField: 'name',
        });

        const populateStatusPage = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];
        const selectStatusPage =
            'multipleNotificationTypes domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme enableMultipleLanguage multipleLanguages twitterHandle';

        const newStatusPage = await this.findOneBy({
            _id: statusPage._id,
            populate: populateStatusPage,
            select: selectStatusPage,
        });

        return newStatusPage;
    },

    createDomain: async function(
        subDomain,
        projectId,
        statusPageId,
        cert,
        privateKey,
        enableHttps,
        autoProvisioning
    ) {
        let createdDomain = {};

        // check if domain already exist
        // only one domain in the db is allowed
        const existingBaseDomain = await DomainVerificationService.findOneBy({
            query: {
                domain: subDomain,
            },
            select: '_id',
        });

        if (!existingBaseDomain) {
            const creationData = {
                domain: subDomain,
                projectId,
            };
            // create the domain
            createdDomain = await DomainVerificationService.create(
                creationData
            );
        }

        const populateStatusPage = [
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const statusPage = await this.findOneBy({
            query: { _id: statusPageId },
            populate: populateStatusPage,
            select: 'domains',
        });

        if (statusPage) {
            // attach the domain id to statuspage collection and update it
            const domain = statusPage.domains.find(domain =>
                domain.domain === subDomain ? true : false
            );
            if (domain) {
                const error = new Error('Domain already exists');
                error.code = 400;
                throw error;
            }
            if (enableHttps && autoProvisioning) {
                // trigger addition of this particular domain
                // which should pass the acme challenge
                // acme challenge is to be processed from status page project
                const altnames = [subDomain];

                // before adding any domain
                // check if there's a certificate already created in the store
                // if there's none, add the domain to the flow
                const certificate = await CertificateStoreService.findOneBy({
                    query: { subject: subDomain },
                    select: 'id',
                });

                const greenlock = global.greenlock;
                if (!certificate && greenlock) {
                    // handle this in the background
                    greenlock.add({
                        subject: altnames[0],
                        altnames: altnames,
                    });
                }
            }

            statusPage.domains = [
                ...statusPage.domains,
                {
                    domain: subDomain,
                    cert,
                    privateKey,
                    enableHttps,
                    autoProvisioning,
                    domainVerificationToken:
                        createdDomain._id || existingBaseDomain._id,
                },
            ];
            return await this.updateOneBy(
                { _id: statusPage._id },
                {
                    domains: statusPage.domains,
                }
            );
        } else {
            const error = new Error('Status page not found or does not exist');
            error.code = 400;
            throw error;
        }
    },

    // update all the occurence of the old domain to the new domain
    // use regex to replace the value
    updateCustomDomain: async function(domainId, newDomain, oldDomain) {
        const _this = this;
        const populateStatusPage = [
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const statusPages = await _this.findBy({
            query: {
                domains: {
                    $elemMatch: { domainVerificationToken: domainId },
                },
            },
            populate: populateStatusPage,
            select: '_id domains',
        });

        for (const statusPage of statusPages) {
            const statusPageId = statusPage._id;
            const domains = [];
            for (const eachDomain of statusPage.domains) {
                if (
                    String(eachDomain.domainVerificationToken._id) ===
                    String(domainId)
                ) {
                    eachDomain.domain = eachDomain.domain.replace(
                        oldDomain,
                        newDomain
                    );
                }
                domains.push(eachDomain);
            }

            if (domains && domains.length > 0) {
                await _this.updateOneBy({ _id: statusPageId }, { domains });
            }
        }
    },

    updateDomain: async function(
        projectId,
        statusPageId,
        domainId,
        newDomain,
        cert,
        privateKey,
        enableHttps,
        autoProvisioning
    ) {
        let createdDomain = {};
        const _this = this;

        const existingBaseDomain = await DomainVerificationService.findOneBy({
            query: { domain: newDomain },
            select: '_id',
        });

        if (!existingBaseDomain) {
            const creationData = {
                domain: newDomain,
                projectId,
            };
            // create the domain
            createdDomain = await DomainVerificationService.create(
                creationData
            );
        }
        const populateStatusPage = [
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const statusPage = await this.findOneBy({
            query: { _id: statusPageId },
            populate: populateStatusPage,
            select: 'domains',
        });

        if (!statusPage) {
            const error = new Error('Status page not found or does not exist');
            error.code = 400;
            throw error;
        }

        let doesDomainExist = false;
        const domainList = [...statusPage.domains];
        const updatedDomainList = [];

        for (const eachDomain of domainList) {
            if (String(eachDomain._id) === String(domainId)) {
                if (eachDomain.domain !== newDomain) {
                    doesDomainExist = await _this.doesDomainExist(newDomain);
                }
                // if domain exist
                // break the loop
                if (doesDomainExist) break;

                eachDomain.domain = newDomain;
                eachDomain.cert = cert;
                eachDomain.privateKey = privateKey;
                eachDomain.enableHttps = enableHttps;
                eachDomain.autoProvisioning = autoProvisioning;
                if (autoProvisioning && enableHttps) {
                    // trigger addition of this particular domain
                    // which should pass the acme challenge
                    // acme challenge is to be processed from status page project
                    const altnames = [eachDomain.domain];

                    // before adding any domain
                    // check if there's a certificate already created in the store
                    // if there's none, add the domain to the flow
                    const certificate = await CertificateStoreService.findOneBy(
                        {
                            query: { subject: eachDomain.domain },
                            select: 'id',
                        }
                    );

                    const greenlock = global.greenlock;
                    if (!certificate && greenlock) {
                        // handle this in the background
                        greenlock.add({
                            subject: altnames[0],
                            altnames: altnames,
                        });
                    }
                }
                eachDomain.domainVerificationToken =
                    createdDomain._id || existingBaseDomain._id;
            }

            updatedDomainList.push(eachDomain);
        }

        if (doesDomainExist) {
            const error = new Error(
                `This custom domain ${newDomain} already exist`
            );
            error.code = 400;
            throw error;
        }

        statusPage.domains = updatedDomainList;

        const result = await this.updateOneBy(
            { _id: statusPage._id },
            { domains: statusPage.domains }
        );
        return result;
    },

    deleteDomain: async function(statusPageId, domainId) {
        const populateStatusPage = [
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];
        const statusPage = await this.findOneBy({
            query: { _id: statusPageId },
            populate: populateStatusPage,
            select: 'domains',
        });

        if (!statusPage) {
            const error = new Error('Status page not found or does not exist');
            error.code = 400;
            throw error;
        }

        let deletedDomain = null;
        const remainingDomains = statusPage.domains.filter(domain => {
            if (String(domain._id) === String(domainId)) {
                deletedDomain = domain;
            }
            return String(domain._id) !== String(domainId);
        });

        const greenlock = global.greenlock;
        // delete any associated certificate (only for auto provisioned ssl)
        // handle this in the background
        if (
            deletedDomain.enableHttps &&
            deletedDomain.autoProvisioning &&
            greenlock
        ) {
            greenlock.remove({ subject: deletedDomain.domain }).finally(() => {
                CertificateStoreService.deleteBy({
                    subject: deletedDomain.domain,
                });
            });
        }

        statusPage.domains = remainingDomains;
        return await this.updateOneBy(
            { _id: statusPage._id },
            { domains: statusPage.domains }
        );
    },

    duplicateStatusPage: async function(
        statusPageProjectId,
        statusPageSlug,
        statusPageName,
        filterMonitors
    ) {
        const populate = [
            {
                path: 'monitors.monitor',
                select: 'name',
                populate: { path: 'projectId', select: '_id' },
            },
        ];

        const select =
            '_id projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotificationTypes hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist deleted incidentHistoryDays scheduleHistoryDays announcementLogsHistory onlineText offlineText degradedText deletedAt deletedById theme multipleLanguages enableMultipleLanguage twitterHandle';
        const statusPage = await this.findOneBy({
            query: { slug: statusPageSlug },
            select,
            populate,
        });

        const data = { ...statusPage };
        data.projectId = statusPageProjectId;
        data.name = statusPageName;
        if (filterMonitors && data.monitors) {
            data.monitors = data.monitors
                .filter(monitorObj => {
                    // values.statuspageId is sub project id selected on the dropdown
                    if (
                        String(monitorObj.monitor.projectId._id) ===
                        String(statusPageProjectId)
                    ) {
                        return true;
                    }
                    return false;
                })
                .map(monitorObj => {
                    monitorObj.monitor = monitorObj.monitor._id;
                    return monitorObj;
                });
        }
        if (!filterMonitors && data.monitors) {
            // just filter and use only ids
            data.monitors = data.monitors.map(monitorObj => {
                monitorObj.monitor =
                    monitorObj.monitor._id || monitorObj.monitor;
                return monitorObj;
            });
        }

        return this.create(data);
    },

    deleteBy: async function(query, userId) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const statusPage = await StatusPageModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );

        if (statusPage) {
            const populateSubscriber = [
                { path: 'projectId', select: 'name' },
                { path: 'monitorId', select: 'name' },
                { path: 'statusPageId', select: 'name' },
            ];
            const subscribers = await SubscriberService.findBy({
                query: { statusPageId: statusPage._id },
                select: '_id',
                populate: populateSubscriber,
            });
            await Promise.all(
                subscribers.map(async subscriber => {
                    await SubscriberService.deleteBy(
                        { _id: subscriber._id },
                        userId
                    );
                })
            );

            const greenlock = global.greenlock;
            // delete all certificate pipeline for the custom domains
            // handle this for autoprovisioned custom domains
            const customDomains = [...statusPage.domains];
            for (const eachDomain of customDomains) {
                if (
                    eachDomain.enableHttps &&
                    eachDomain.autoProvisioning &&
                    greenlock
                ) {
                    greenlock
                        .remove({ subject: eachDomain.domain })
                        .finally(() => {
                            CertificateStoreService.deleteBy({
                                subject: eachDomain.domain,
                            });
                        });
                }
            }
        }
        return statusPage;
    },

    removeMonitor: async function(monitorId) {
        const populateStatusPage = [
            {
                path: 'monitors.monitor',
                select: '_id name',
            },
        ];

        const selectStatusPage = 'monitors _id';

        const statusPages = await this.findBy({
            query: { 'monitors.monitor': monitorId },
            select: selectStatusPage,
            populate: populateStatusPage,
        });
        for (const statusPage of statusPages) {
            const monitors = statusPage.monitors.filter(
                monitorData =>
                    String(monitorData.monitor._id || monitorData.monitor) !==
                    String(monitorId)
            );

            if (monitors.length !== statusPage.monitors.length) {
                await this.updateOneBy({ _id: statusPage._id }, { monitors });
            }
        }
    },

    updateOneBy: async function(query, data) {
        const existingStatusPage = await this.findBy({
            query: {
                name: data.name,
                projectId: data.projectId,
                _id: { $not: { $eq: data._id } },
            },
            select: 'slug',
        });
        if (existingStatusPage && existingStatusPage.length > 0) {
            const error = new Error(
                'StatusPage with that name already exists.'
            );
            error.code = 400;
            throw error;
        }

        if (data && data.name) {
            existingStatusPage.slug = getSlug(data.name);
        }

        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        // run this in the background
        try {
            if (data && data.groupedMonitors) {
                for (const [key, value] of Object.entries(
                    data.groupedMonitors
                )) {
                    const monitorIds = value.map(
                        monitorObj => monitorObj.monitor
                    );
                    MonitorService.updateBy(
                        { _id: { $in: monitorIds } },
                        { statusPageCategory: key }
                    );
                }
            }
        } catch (error) {
            ErrorService.log(
                'statusPageService.updateOneBy > MonitorService.updateBy',
                error
            );
        }

        let updatedStatusPage = await StatusPageModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );

        const populateStatusPage = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            { path: 'monitors.statusPageCategory', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage =
            'multipleNotificationTypes domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme multipleLanguages enableMultipleLanguage twitterHandle';

        if (updatedStatusPage) {
            updatedStatusPage = await this.findOneBy({
                query: { _id: updatedStatusPage._id },
                populate: populateStatusPage,
                select: selectStatusPage,
            });
        }
        return updatedStatusPage;
    },

    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await StatusPageModel.updateMany(query, {
            $set: data,
        });

        const populateStatusPage = [
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
        ];

        const selectStatusPage =
            'multipleNotificationTypes domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        updatedData = await this.findBy({
            query,
            populate: populateStatusPage,
            select: selectStatusPage,
        });
        return updatedData;
    },

    getNotes: async function(query, skip, limit) {
        const _this = this;

        if (!skip) skip = 0;

        if (!limit || isNaN(limit)) limit = 5;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        const statuspages = await _this.findBy({
            query,
            skip: 0,
            limit,
            select: 'hideResolvedIncident monitors',
            populate: [
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
            ],
        });
        const checkHideResolved = statuspages[0].hideResolvedIncident;
        let option = {};
        if (checkHideResolved) {
            option = {
                resolved: false,
            };
        }

        const withMonitors = statuspages.filter(
            statusPage => statusPage.monitors.length
        );
        const statuspage = withMonitors[0];
        const monitorIds = statuspage
            ? statuspage.monitors.map(m => m.monitor._id)
            : [];
        if (monitorIds && monitorIds.length) {
            const populate = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: { path: 'componentId', select: 'name slug' },
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name color' },
                {
                    path: 'acknowledgedByIncomingHttpRequest',
                    select: 'name',
                },
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                { path: 'probes.probeId', select: 'name _id' },
            ];
            const select =
                'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber createdAt';

            const [notes, count] = await Promise.all([
                IncidentService.findBy({
                    query: {
                        'monitors.monitorId': { $in: monitorIds },
                        hideIncident: false,
                        ...option,
                    },
                    limit,
                    skip,
                    populate,
                    select,
                }),
                IncidentService.countBy({
                    'monitors.monitorId': { $in: monitorIds },
                    hideIncident: false,
                    ...option,
                }),
            ]);

            return { notes, count };
        } else {
            const error = new Error('No monitors on this status page');
            error.code = 400;
            throw error;
        }
    },

    getIncident: async function(query) {
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: { path: 'componentId', select: 'name slug' },
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'name _id' },
        ];
        const select =
            'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const incident = await IncidentService.findOneBy({
            query,
            select,
            populate,
        });

        return incident;
    },

    getIncidentNotes: async function(query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};
        query.deleted = false;

        const populateIncidentMessage = [
            {
                path: 'incidentId',
                select: 'idNumber name slug',
            },
            { path: 'createdById', select: 'name' },
        ];

        const selectIncidentMessage =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        const [message, count] = await Promise.all([
            IncidentMessageService.findBy({
                query,
                skip,
                limit,
                populate: populateIncidentMessage,
                select: selectIncidentMessage,
            }),
            IncidentMessageService.countBy(query),
        ]);

        return { message, count };
    },

    getNotesByDate: async function(query, skip, limit) {
        const populate = [
            {
                path: 'monitors.monitorId',
                select: 'name slug componentId projectId type',
                populate: { path: 'componentId', select: 'name slug' },
            },
            { path: 'createdById', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'resolvedBy', select: 'name' },
            { path: 'acknowledgedBy', select: 'name' },
            { path: 'incidentPriority', select: 'name color' },
            {
                path: 'acknowledgedByIncomingHttpRequest',
                select: 'name',
            },
            { path: 'resolvedByIncomingHttpRequest', select: 'name' },
            { path: 'createdByIncomingHttpRequest', select: 'name' },
            { path: 'probes.probeId', select: 'name _id' },
        ];
        const select =
            'createdAt slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

        const [incidents, count] = await Promise.all([
            IncidentService.findBy({
                query,
                limit,
                skip,
                populate,
                select,
            }),
            IncidentService.countBy(query),
        ]);

        const investigationNotes = incidents.map(incident => {
            // return all the incident object
            return incident;
        });
        return { investigationNotes, count };
    },

    getEvents: async function(query, skip, limit) {
        const _this = this;

        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};
        query.deleted = false;

        const statuspages = await _this.findBy({
            query,
            skip: 0,
            limit,
            select: 'monitors',
            populate: [
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
            ],
        });

        const withMonitors = statuspages.filter(
            statusPage => statusPage.monitors.length
        );
        const statuspage = withMonitors[0];
        const monitorIds = statuspage
            ? statuspage.monitors.map(m => m.monitor)
            : [];
        if (monitorIds && monitorIds.length) {
            const currentDate = moment();
            const eventIds = [];

            const populate = [
                { path: 'resolvedBy', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'createdById', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: {
                        path: 'componentId',
                        select: 'name slug',
                    },
                },
            ];
            const select =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            let events = await Promise.all(
                monitorIds.map(async monitorId => {
                    const scheduledEvents = await ScheduledEventsService.findBy(
                        {
                            query: {
                                'monitors.monitorId': monitorId,
                                showEventOnStatusPage: true,
                                startDate: { $lte: currentDate },
                                endDate: {
                                    $gte: currentDate,
                                },
                                resolved: false,
                            },
                            select,
                            populate,
                        }
                    );
                    scheduledEvents.map(event => {
                        const id = String(event._id);
                        if (!eventIds.includes(id)) {
                            eventIds.push(id);
                        }
                        return event;
                    });

                    return scheduledEvents;
                })
            );

            events = flattenArray(events);
            // do not repeat the same event two times
            events = eventIds.map(id => {
                return events.find(event => String(event._id) === String(id));
            });
            const count = events.length;

            return { events, count };
        } else {
            const error = new Error('No monitors on this status page');
            error.code = 400;
            throw error;
        }
    },

    getFutureEvents: async function(query, skip, limit) {
        const _this = this;

        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};
        query.deleted = false;

        const statuspages = await _this.findBy({
            query,
            skip: 0,
            limit,
            select: 'monitors',
            populate: [
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
            ],
        });

        const withMonitors = statuspages.filter(
            statusPage => statusPage.monitors.length
        );
        const statuspage = withMonitors[0];
        let monitorIds = statuspage
            ? statuspage.monitors.map(m => m.monitor)
            : [];
        monitorIds = monitorIds.map(monitor => monitor._id || monitor);
        if (monitorIds && monitorIds.length) {
            const currentDate = moment();
            const eventIds = [];
            const populate = [
                { path: 'resolvedBy', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'createdById', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: {
                        path: 'componentId',
                        select: 'name slug',
                    },
                },
            ];
            const select =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            let events = await Promise.all(
                monitorIds.map(async monitorId => {
                    const scheduledEvents = await ScheduledEventsService.findBy(
                        {
                            query: {
                                'monitors.monitorId': monitorId,
                                showEventOnStatusPage: true,
                                startDate: { $gt: currentDate },
                            },
                            select,
                            populate,
                        }
                    );
                    scheduledEvents.map(event => {
                        const id = String(event._id);
                        if (!eventIds.includes(id)) {
                            eventIds.push(id);
                        }
                        return event;
                    });

                    return scheduledEvents;
                })
            );

            events = flattenArray(events);
            // do not repeat the same event two times
            events = eventIds.map(id => {
                return events.find(event => String(event._id) === String(id));
            });

            // // sort in ascending start date
            events = events.sort((a, b) => b.startDate - a.startDate);

            const count = events.length;
            return { events, count };
        } else {
            const error = new Error('No monitors on this status page');
            error.code = 400;
            throw error;
        }
    },

    getPastEvents: async function(query, skip, limit) {
        const _this = this;

        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};
        query.deleted = false;

        const statuspages = await _this.findBy({
            query,
            skip: 0,
            limit,
            select: 'monitors',
            populate: [
                {
                    path: 'monitors.monitor',
                    select: '_id name',
                },
            ],
        });

        const withMonitors = statuspages.filter(
            statusPage => statusPage.monitors.length
        );
        const statuspage = withMonitors[0];
        const monitorIds = statuspage
            ? statuspage.monitors.map(m => m.monitor)
            : [];
        if (monitorIds && monitorIds.length) {
            const currentDate = moment();
            const eventIds = [];
            const populate = [
                { path: 'resolvedBy', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'createdById', select: 'name' },
                {
                    path: 'monitors.monitorId',
                    select: 'name',
                    populate: {
                        path: 'componentId',
                        select: 'name slug',
                    },
                },
            ];
            const select =
                'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

            let events = await Promise.all(
                monitorIds.map(async monitorId => {
                    const scheduledEvents = await ScheduledEventsService.findBy(
                        {
                            query: {
                                'monitors.monitorId': monitorId,
                                showEventOnStatusPage: true,
                                endDate: { $lt: currentDate },
                            },
                            populate,
                            select,
                        }
                    );
                    scheduledEvents.map(event => {
                        const id = String(event._id);
                        if (!eventIds.includes(id)) {
                            eventIds.push(id);
                        }
                        return event;
                    });

                    return scheduledEvents;
                })
            );

            events = flattenArray(events);
            // do not repeat the same event two times
            events = eventIds.map(id => {
                return events.find(event => String(event._id) === String(id));
            });

            // sort in ascending start date
            events = events.sort((a, b) => a.startDate - b.startDate);

            const count = events.length;
            return { events: limitEvents(events, limit, skip), count };
        } else {
            const error = new Error('No monitors on this status page');
            error.code = 400;
            throw error;
        }
    },

    getEvent: async function(query) {
        const populate = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: {
                    path: 'componentId',
                    select: 'name slug',
                },
            },
        ];
        const select =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const scheduledEvent = await ScheduledEventsService.findOneBy({
            query,
            select,
            populate,
        });
        return scheduledEvent;
    },

    getEventNotes: async function(query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};
        query.deleted = false;

        const populate = [
            { path: 'createdById', select: 'name' },
            {
                path: 'scheduledEventId',
                select: 'name monitors alertSubscriber projectId',
                populate: {
                    path: 'projectId',
                    select: 'name replyAddress',
                },
            },
        ];
        const select =
            'updated content type event_state createdAt updatedAt createdById scheduledEventId';

        const [eventNote, count] = await Promise.all([
            ScheduledEventNoteService.findBy({
                query,
                limit,
                skip,
                populate,
                select,
            }),
            ScheduledEventNoteService.countBy(query),
        ]);

        return { notes: eventNote, count };
    },

    getEventsByDate: async function(query, skip, limit) {
        const populate = [
            { path: 'resolvedBy', select: 'name' },
            { path: 'projectId', select: 'name slug' },
            { path: 'createdById', select: 'name' },
            {
                path: 'monitors.monitorId',
                select: 'name',
                populate: {
                    path: 'componentId',
                    select: 'name slug',
                },
            },
        ];
        const select =
            'cancelled showEventOnStatusPage callScheduleOnEvent monitorDuringEvent monitorDuringEvent recurring interval alertSubscriber resolved monitors name startDate endDate description createdById projectId slug createdAt ';

        const [scheduledEvents, count] = await Promise.all([
            ScheduledEventsService.findBy({
                query,
                limit,
                skip,
                populate,
                select,
            }),
            ScheduledEventsService.countBy(query),
        ]);

        return { scheduledEvents, count };
    },

    getStatusPage: async function({ query, userId, populate, select }) {
        const thisObj = this;
        if (!query) {
            query = {};
        }

        query.deleted = false;

        let statusPagesQuery = StatusPageModel.find(query)
            .sort([['createdAt', -1]])
            .lean();

        statusPagesQuery = handleSelect(select, statusPagesQuery);
        statusPagesQuery = handlePopulate(populate, statusPagesQuery);

        const statusPages = await statusPagesQuery;

        let statusPage = null;

        if (
            query &&
            query.domains &&
            query.domains.$elemMatch &&
            query.domains.$elemMatch.domain
        ) {
            const domain = query.domains.$elemMatch.domain;

            const verifiedStatusPages = statusPages.filter(
                page =>
                    page &&
                    page.domains.length > 0 &&
                    page.domains.filter(
                        domainItem =>
                            domainItem &&
                            domainItem.domain === domain &&
                            domainItem.domainVerificationToken &&
                            domainItem.domainVerificationToken.verified === true
                    ).length > 0
            );
            if (verifiedStatusPages.length > 0) {
                statusPage = verifiedStatusPages[0];
            }
        } else {
            if (statusPages.length > 0) {
                statusPage = statusPages[0];
            }
        }

        if (statusPage && (statusPage._id || statusPage.id)) {
            const permitted = await thisObj.isPermitted(userId, statusPage);
            if (!permitted) {
                const error = new Error(
                    'You are unauthorized to access the page please login to continue.'
                );
                error.code = 401;
                throw error;
            }

            const monitorIds = statusPage.monitors.map(monitorObj =>
                String(monitorObj.monitor._id || monitorObj.monitor)
            );
            const projectId = statusPage.projectId._id || statusPage.projectId;
            const subProjects = await ProjectService.findBy({
                query: {
                    $or: [{ parentProjectId: projectId }, { _id: projectId }],
                },
                select: '_id',
            });
            const subProjectIds = subProjects
                ? subProjects.map(project => project._id)
                : null;
            const monitors = await MonitorService.getMonitorsBySubprojects(
                subProjectIds,
                0,
                0
            );
            const filteredMonitorData = monitors.map(subProject => {
                return subProject.monitors.filter(monitor =>
                    monitorIds.includes(monitor._id.toString())
                );
            });
            statusPage.monitorsData = _.flatten(filteredMonitorData);
        } else {
            if (statusPages.length > 0) {
                const error = new Error('Domain not verified');
                error.code = 400;
                throw error;
            } else {
                const error = new Error('Page Not Found');
                error.code = 400;
                throw error;
            }
        }
        return statusPage;
    },

    getIncidents: async function(query) {
        const _this = this;

        if (!query) query = {};

        const statuspages = await _this.findBy({
            query,
            select: 'monitors',
            populate: [
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
            ],
        });

        const withMonitors = statuspages.filter(
            statusPage => statusPage.monitors.length
        );
        const statuspage = withMonitors[0];
        const monitorIds =
            statuspage && statuspage.monitors.map(m => m.monitor._id);
        if (monitorIds && monitorIds.length) {
            const populate = [
                {
                    path: 'monitors.monitorId',
                    select: 'name slug componentId projectId type',
                    populate: { path: 'componentId', select: 'name slug' },
                },
                { path: 'createdById', select: 'name' },
                { path: 'projectId', select: 'name slug' },
                { path: 'resolvedBy', select: 'name' },
                { path: 'acknowledgedBy', select: 'name' },
                { path: 'incidentPriority', select: 'name color' },
                {
                    path: 'acknowledgedByIncomingHttpRequest',
                    select: 'name',
                },
                { path: 'resolvedByIncomingHttpRequest', select: 'name' },
                { path: 'createdByIncomingHttpRequest', select: 'name' },
                { path: 'probes.probeId', select: 'name _id' },
            ];
            const select =
                'slug createdAt notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

            const [incidents, count] = await Promise.all([
                IncidentService.findBy({
                    query: { 'monitors.monitorId': { $in: monitorIds } },
                    select,
                    populate,
                }),
                IncidentService.countBy({
                    'monitors.monitorId': { $in: monitorIds },
                }),
            ]);
            return { incidents, count };
        } else {
            const error = new Error('No monitors on this status page');
            error.code = 400;
            throw error;
        }
    },
    isPermitted: async function(userId, statusPage) {
        const fn = async resolve => {
            if (statusPage.isPrivate) {
                if (userId) {
                    const project = await ProjectService.findOneBy({
                        query: { _id: statusPage.projectId._id },
                        select: '_id users',
                    });
                    if (project && project._id) {
                        if (
                            project.users.some(user => user.userId === userId)
                        ) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            } else {
                resolve(true);
            }
        };
        return fn;
    },

    getStatusPagesByProjectId: async function({
        projectId,
        skip = 0,
        limit = 10,
    }) {
        const _this = this;

        const selectStatusPage = 'slug title name description _id';

        const [data, count] = await Promise.all([
            _this.findBy({
                query: { projectId },
                skip: skip,
                limit: limit,
                select: selectStatusPage,
                pupulate: [],
            }),
            _this.countBy({ query: { projectId } }),
        ]);

        return {
            data,
            count,
        };
    },

    hardDeleteBy: async function(query) {
        await StatusPageModel.deleteMany(query);
        return 'Status Page(s) Removed Successfully!';
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;

        const populateStatusPage = [
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
        ];

        const selectStatusPage =
            'multipleNotificationTypes domains projectId monitors links twitterHandle slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const statusPage = await _this.findBy({
            query,
            populate: populateStatusPage,
            select: selectStatusPage,
        });
        if (statusPage && statusPage.length > 1) {
            const statusPages = await Promise.all(
                statusPage.map(async statusPage => {
                    const statusPageId = statusPage._id;
                    statusPage = await _this.updateOneBy(
                        { _id: statusPageId, deleted: true },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    await SubscriberService.restoreBy({
                        statusPageId,
                        deleted: true,
                    });
                    return statusPage;
                })
            );
            return statusPages;
        }
    },
    // get status pages for this incident
    getStatusPagesForIncident: async (incidentId, skip, limit) => {
        // first get the monitor, then scan status page collection containing the monitor
        let { monitors } = await IncidentModel.findById(incidentId).select(
            'monitors.monitorId'
        );

        let statusPages = [];
        let count = 0;
        if (monitors) {
            monitors = monitors.map(
                monitor => monitor.monitorId._id || monitor.monitorId
            );
            count = await StatusPageModel.find({
                'monitors.monitor': { $in: monitors },
            }).countDocuments({ 'monitors.monitor': { $in: monitors } });
            if (count) {
                statusPages = await StatusPageModel.find({
                    'monitors.monitor': { $in: monitors },
                })
                    .lean()
                    .populate('projectId')
                    .populate('monitors.monitor')
                    .skip(skip)
                    .limit(limit)
                    .exec();
            }
        }
        return { statusPages: statusPages || [], count };
    },

    getStatusBubble: async (statusPages, probes) => {
        if (statusPages && statusPages[0]) {
            statusPages = statusPages[0];
        }
        const endDate = moment(Date.now());
        const startDate = moment(Date.now()).subtract(90, 'days');
        const monitorsIds =
            statusPages && statusPages.monitors
                ? statusPages.monitors.map(m =>
                      m.monitor && m.monitor._id ? m.monitor._id : null
                  )
                : [];
        const statuses = await Promise.all(
            monitorsIds.map(async m => {
                return await MonitorService.getMonitorStatuses(
                    m,
                    startDate,
                    endDate
                );
            })
        );
        const bubble = await getServiceStatus(statuses, probes);
        let statusMessage = '';
        if (bubble === 'all') {
            statusMessage = 'All services are online';
        } else if (bubble === 'some') {
            statusMessage = 'Some services are offline';
        } else if (bubble === 'none') {
            statusMessage = 'All services are offline';
        } else if (bubble === 'some-degraded') {
            statusMessage = 'Some services are degraded';
        }
        return { bubble, statusMessage };
    },

    doesDomainExist: async function(domain) {
        const _this = this;
        const statusPage = await _this.countBy({
            query: {
                domains: { $elemMatch: { domain } },
            },
        });

        if (!statusPage || statusPage === 0) return false;

        return true;
    },

    createExternalStatusPage: async function(data) {
        const externalStatusPage = new ExternalStatusPageModel();
        externalStatusPage.url = data.url || null;
        externalStatusPage.name = data.name || null;
        externalStatusPage.description = data.description || null;
        externalStatusPage.projectId = data.projectId || null;
        externalStatusPage.statusPageId = data.statusPageId || null;
        externalStatusPage.createdById = data.createdById || null;
        const newExternalStatusPage = await externalStatusPage.save();

        return newExternalStatusPage;
    },
    getExternalStatusPage: async function(query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;
        const externalStatusPages = await ExternalStatusPageModel.find(query);
        return externalStatusPages;
    },
    updateExternalStatusPage: async function(projectId, _id, data) {
        const query = { projectId, _id };

        const externalStatusPages = await ExternalStatusPageModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return externalStatusPages;
    },
    deleteExternalStatusPage: async function(projectId, _id, userId) {
        const query = { projectId, _id };

        const externalStatusPages = await ExternalStatusPageModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return externalStatusPages;
    },

    createAnnouncement: async function(data) {
        // reassign data.monitors with a restructured monitor data
        data.monitors = data.monitors.map(monitor => ({
            monitorId: monitor,
        }));
        // slugify announcement name
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }

        const announcement = new AnnouncementModel();
        announcement.name = data.name || null;
        announcement.projectId = data.projectId || null;
        announcement.statusPageId = data.statusPageId || null;
        announcement.description = data.description || null;
        announcement.monitors = data.monitors || null;
        announcement.createdById = data.createdById || null;
        announcement.slug = data.slug || null;
        const newAnnouncement = await announcement.save();

        return newAnnouncement;
    },

    getAnnouncements: async function(query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;
        const allAnnouncements = await AnnouncementModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip)
            .populate('createdById', 'name')
            .populate('monitors.monitorId', 'name');
        return allAnnouncements;
    },

    countAnnouncements: async function(query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await AnnouncementModel.countDocuments(query);
        return count;
    },

    getSingleAnnouncement: async function(query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const response = await AnnouncementModel.findOne(query);
        return response;
    },

    updateAnnouncement: async function(query, data) {
        const _this = this;
        if (!query) {
            query = {};
        }
        query.deleted = false;
        if (!data.hideAnnouncement) {
            await _this.updateManyAnnouncement({
                statusPageId: query.statusPageId,
            });
        }
        const response = await AnnouncementModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );

        if (!data.hideAnnouncement && data.announcementToggle) {
            AlertService.sendAnnouncementNotificationToSubscribers(
                response
            ).catch(error => {
                ErrorService.log(
                    'StatusPageService.updateAnnouncement > AlertService.sendAnnouncementNotificationToSubscribers',
                    error
                );
            });
        }

        const log = {
            active: false,
            endDate: new Date(),
            updatedById: data.createdById,
        };
        await _this.updateAnnouncementLog({ active: true }, log);

        return response;
    },

    updateManyAnnouncement: async function(query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const response = await AnnouncementModel.updateMany(
            query,
            {
                $set: { hideAnnouncement: true },
            },
            {
                new: true,
            }
        );
        return response;
    },

    deleteAnnouncement: async function(query, userId) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const response = await AnnouncementModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return response;
    },

    createAnnouncementLog: async function(data) {
        const announcementLog = new AnnouncementLogModel();
        announcementLog.announcementId = data.announcementId || null;
        announcementLog.createdById = data.createdById || null;
        announcementLog.statusPageId = data.statusPageId || null;
        announcementLog.startDate = data.startDate || null;
        announcementLog.endDate = data.endDate || null;
        announcementLog.active = data.active || null;
        const newAnnouncementLog = await announcementLog.save();
        return newAnnouncementLog;
    },

    updateAnnouncementLog: async function(query, data) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const response = await AnnouncementLogModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return response;
    },

    getAnnouncementLogs: async function(query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        query.deleted = false;
        const announcementLogs = await AnnouncementLogModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip)
            .populate({
                path: 'announcementId',
                select: 'name description',
                populate: { path: 'monitors.monitorId', select: 'name' },
            });
        return announcementLogs;
    },

    deleteAnnouncementLog: async function(query, userId) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const response = await AnnouncementLogModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return response;
    },

    countAnnouncementLogs: async function(query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const count = await AnnouncementLogModel.countDocuments(query);
        return count;
    },

    fetchTweets: async handle => {
        const userData = await axios.get(
            `https://api.twitter.com/2/users/by/username/${handle}?user.fields=id`,
            {
                headers: {
                    Authorization: `Bearer ${bearer}`,
                },
            }
        );

        const userId = userData?.data?.data?.id || false;
        let response = '';

        if (userId) {
            const tweetData = await axios.get(
                `https://api.twitter.com/2/users/${userId}/tweets?tweet.fields=created_at&exclude=retweets,replies`,
                {
                    headers: {
                        Authorization: `Bearer ${bearer}`,
                    },
                }
            );

            response = tweetData.data.data;
        }

        return response;
    },
};

// handle the unique pagination for scheduled events on status page
function limitEvents(events, limit, skip) {
    skip = skip * limit;
    if (skip !== 0) {
        limit += limit;
    }
    return events.slice(skip, limit);
}

const filterProbeData = (monitor, probe) => {
    const monitorStatuses = monitor && monitor.length > 0 ? monitor : null;

    const probesStatus =
        monitorStatuses && monitorStatuses.length > 0
            ? probe
                ? monitorStatuses.filter(probeStatuses => {
                      return (
                          probeStatuses._id === null ||
                          probeStatuses._id === probe._id
                      );
                  })
                : monitorStatuses
            : [];
    const statuses =
        probesStatus &&
        probesStatus[0] &&
        probesStatus[0].statuses &&
        probesStatus[0].statuses.length > 0
            ? probesStatus[0].statuses
            : [];

    return statuses;
};

const getServiceStatus = (monitorsData, probes) => {
    const monitorsLength = monitorsData.length;
    const probesLength = probes && probes.length;

    const totalServices = monitorsLength * probesLength;
    let onlineServices = totalServices;
    let degraded = 0;

    monitorsData.forEach(monitor => {
        probes.forEach(probe => {
            const statuses = filterProbeData(monitor, probe);
            const monitorStatus =
                statuses && statuses.length > 0
                    ? statuses[0].status || 'online'
                    : 'online';
            if (monitorStatus === 'offline') {
                onlineServices--;
            }
            if (monitorStatus === 'degraded') {
                degraded++;
            }
        });
    });

    if (onlineServices === totalServices) {
        if (degraded !== 0) return 'some-degraded';
        return 'all';
    } else if (onlineServices === 0) {
        return 'none';
    } else if (onlineServices < totalServices) {
        return 'some';
    }
};

import IncidentModel from '../models/incident'

import IncidentService from './incidentService'
import ScheduledEventsService from './scheduledEventService'
import MonitorService from './monitorService'
import ErrorService from 'common-server/utils/error'
import SubscriberService from './subscriberService'
import ProjectService from './projectService'
import AlertService from './alertService'
import _ from 'lodash'
import defaultStatusPageColors from '../config/statusPageColors'
import DomainVerificationService from './domainVerificationService'
import flattenArray from '../utils/flattenArray'
import ScheduledEventNoteService from './scheduledEventNoteService'
import IncidentMessageService from './incidentMessageService'
import moment from 'moment'
import uuid from 'uuid'
import CertificateStoreService from './certificateStoreService'
import AnnouncementModel from '../models/announcements'
import ExternalStatusPageModel from '../models/externalStatusPage'
import getSlug from '../utils/getSlug'
import AnnouncementLogModel from '../models/announcementLogs'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
import axios from 'axios'
const bearer = process.env.TWITTER_BEARER_TOKEN;

/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const StatusPageService = require('../services/statusPageService');
const MonitorService = require('../services/monitorService');
const ProbeService = require('../services/probeService');
const UtilService = require('../services/utilService');
const RealTimeService = require('../services/realTimeService');
const DomainVerificationService = require('../services/domainVerificationService');

const router = express.Router();
const validUrl = require('valid-url');
const multer = require('multer');
const ErrorService = require('../services/errorService');
const { toXML } = require('jstoxml');

const { getUser, checkUser } = require('../middlewares/user');
const { getSubProjects } = require('../middlewares/subProject');
const { isUserAdmin } = require('../middlewares/project');
const storage = require('../middlewares/upload');
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route Description: Adding a status page to the project.
// req.params->{projectId}; req.body -> {[monitorIds]}
// Returns: response status page, error message

router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    try {
        const data = req.body;
        data.projectId = req.params.projectId;

        // Sanitize
        if (!data.monitorIds) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ids are required.',
            });
        }

        if (!Array.isArray(data.monitorIds)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor IDs are not stored in an array.',
            });
        }

        if (!data.name) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Status Page name is empty',
            });
        }

        // Call the StatusPageService.
        const statusPage = await StatusPageService.create(data);
        return sendItemResponse(req, res, statusPage);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route Description: Creates a domain and domainVerificationToken
// req.params -> {projectId, statusPageId}; req.body -> {domain}
// Returns: response updated status page, error message
router.put(
    '/:projectId/:statusPageId/domain',
    getUser,
    isAuthorized,
    async (req, res) => {
        const { projectId, statusPageId } = req.params;
        const subDomain = req.body.domain;

        if (typeof subDomain !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Domain is not of type string.',
            });
        }

        if (!UtilService.isDomainValid(subDomain)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Domain is not valid.',
            });
        }

        try {
            const doesDomainBelongToProject = await DomainVerificationService.doesDomainBelongToProject(
                projectId,
                subDomain
            );

            if (doesDomainBelongToProject) {
                return sendErrorResponse(req, res, {
                    message:
                        'This domain is already associated with another project',
                    code: 400,
                });
            }
            const response = await StatusPageService.createDomain(
                subDomain,
                projectId,
                statusPageId
            );
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

// Route Description: Updating Status Page.
// Params:
// Param1:
// Returns: response status, error message
router.put('/:projectId', getUser, isAuthorized, isUserAdmin, async function(
    req,
    res
) {
    const data = req.body;
    const upload = multer({
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

        for (let i = 0; i < data.links.length; i++) {
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
            let counter = 0;
            for (let j = 0; j < data.links.length; j++) {
                if (data.links[i].name == data.links[j].name) {
                    counter++;
                }
                if (data.links[i].url == data.links[j].url) {
                    counter++;
                }
            }
            if (counter > 2) {
                {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Duplicate name or url present. Please check.',
                    });
                }
            }
        }
    }

    upload(req, res, async function(error) {
        const files = req.files || {};
        const data = req.body;
        data.projectId = req.params.projectId;
        data.subProjectId = req.params.subProjectId;
        if (error) {
            ErrorService.log(error);
            return sendErrorResponse(req, res, error);
        }

        let statusPage;
        if (data._id) {
            statusPage = await StatusPageService.findOneBy({
                _id: data._id,
            });
            const imagesPath = {
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
            const statusPage = await StatusPageService.updateOneBy(
                { projectId: data.projectId, _id: data._id },
                data
            );

            const updatedStatusPage = await StatusPageService.getStatusPage(
                { _id: statusPage._id },
                req.user.id
            );
            await RealTimeService.statusPageEdit(updatedStatusPage);

            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    });
});

// Route Description: Gets status pages of a project.
// Params:
// Param1: req.params-> {projectId};
// Returns: response status, error message

router.get('/:projectId/dashboard', getUser, isAuthorized, async function(
    req,
    res
) {
    const projectId = req.params.projectId;
    try {
        // Call the StatusPageService.
        const statusPages = await StatusPageService.findBy(
            { projectId: projectId },
            req.query.skip || 0,
            req.query.limit || 10
        );
        const count = await StatusPageService.countBy({ projectId: projectId });
        return sendListResponse(req, res, statusPages, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get(
    '/:projectId/statuspages',
    getUser,
    isAuthorized,
    getSubProjects,
    async function(req, res) {
        const subProjectIds = req.user.subProjects
            ? req.user.subProjects.map(project => project._id)
            : null;
        try {
            const statusPages = await StatusPageService.getSubProjectStatusPages(
                subProjectIds
            );
            return sendItemResponse(req, res, statusPages); // frontend expects sendItemResponse
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

router.get('/:projectId/statuspage', getUser, isAuthorized, async function(
    req,
    res
) {
    const projectId = req.params.projectId;
    try {
        const statusPage = await StatusPageService.findBy(
            { projectId },
            req.query.skip || 0,
            req.query.limit || 10
        );
        const count = await StatusPageService.countBy({ projectId });
        return sendListResponse(req, res, statusPage, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// External status page api - get the data to show on status page
router.get('/:statusPageId', checkUser, async function(req, res) {
    const statusPageId = req.params.statusPageId;
    const url = req.query.url;
    const user = req.user;
    let statusPage = {};
    try {
        // Call the StatusPageService.
        if (url && url !== 'null') {
            statusPage = await StatusPageService.getStatusPage(
                { domains: { $elemMatch: { domain: url } } },
                user
            );
        } else if ((!url || url === 'null') && statusPageId) {
            statusPage = await StatusPageService.getStatusPage(
                { _id: statusPageId },
                user
            );
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
        } else {
            return sendItemResponse(req, res, statusPage);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:statusPageId/rss', checkUser, async function(req, res) {
    const statusPageId = req.params.statusPageId;
    const url = req.query.url;
    const user = req.user;
    let statusPage = {};
    try {
        // Call the StatusPageService.
        if (url && url !== 'null') {
            statusPage = await StatusPageService.getStatusPage(
                { domains: { $elemMatch: { domain: url } } },
                user
            );
        } else if ((!url || url === 'null') && statusPageId) {
            statusPage = await StatusPageService.getStatusPage(
                { _id: statusPageId },
                user
            );
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
        } else {
            const { incidents } = await StatusPageService.getIncidents({
                _id: statusPageId,
            });
            const refinedIncidents = [];
            for (const incident of incidents) {
                refinedIncidents.push({
                    Incident: {
                        IncidentType: incident.incidentType,
                        IncidentId: incident._id.toString(),
                        MonitorName: incident.monitorId.name,
                        MonitorId: incident.monitorId._id.toString(),
                        ManuallyCreated: incident.manuallyCreated,
                        InvestigationNote: incident.investigationNote,
                    },
                });
            }
            const xmlOptions = {
                indent: '  ',
                header: true,
            };

            const feedObj = {
                _name: 'rss',
                _attrs: {
                    version: '2.0',
                },
                _content: [
                    {
                        Title: `Incidents for status page ${statusPage.title}`,
                    },
                    {
                        Description:
                            'RSS feed for all incidents related to monitors attached to status page',
                    },
                    {
                        Link: `${global.apiHost}/statusPage/rss`,
                    },
                    {
                        LastBuildDate: () => new Date(),
                    },
                    {
                        Language: 'en',
                    },
                    {
                        Incidents: refinedIncidents,
                    },
                ],
            };
            const finalFeed = toXML(feedObj, xmlOptions);
            res.contentType('application/rss');
            return sendItemResponse(req, res, finalFeed);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
router.get('/:projectId/:statusPageId/notes', checkUser, async function(
    req,
    res
) {
    const statusPageId = req.params.statusPageId;
    const skip = req.query.skip || 0;
    const limit = req.query.limit || 5;
    try {
        // Call the StatusPageService.
        const response = await StatusPageService.getNotes(
            { _id: statusPageId },
            skip,
            limit
        );
        const notes = response.notes;
        const count = response.count;
        return sendListResponse(req, res, notes, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:monitorId/individualnotes', checkUser, async function(
    req,
    res
) {
    let date = req.query.date;
    date = new Date(date);
    const start = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0
    );
    const end = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        23,
        59,
        59
    );

    const skip = req.query.skip || 0;
    const limit = req.query.limit || 5;
    const query = {
        monitorId: req.params.monitorId,
        deleted: false,
        createdAt: { $gte: start, $lt: end },
    };

    try {
        // Call the StatusPageService.
        const response = await StatusPageService.getNotesByDate(
            query,
            skip,
            limit
        );
        const notes = response.investigationNotes;
        const count = response.count;
        return sendListResponse(req, res, notes, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:statusPageId/events', checkUser, async function(
    req,
    res
) {
    const statusPageId = req.params.statusPageId;
    const skip = req.query.skip || 0;
    const limit = req.query.limit || 5;
    try {
        // Call the StatusPageService.
        const response = await StatusPageService.getEvents(
            { _id: statusPageId },
            skip,
            limit
        );
        const events = response.events;
        const count = response.count;
        return sendListResponse(req, res, events, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:monitorId/individualevents', checkUser, async function(
    req,
    res
) {
    let date = req.query.date;
    date = new Date(date);
    const start = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0
    );
    const end = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        23,
        59,
        59
    );

    const skip = req.query.skip || 0;
    const limit = req.query.limit || 5;
    const query = {
        monitorId: req.params.monitorId,
        showEventOnStatusPage: true,
        deleted: false,
        startDate: { $lt: end },
        endDate: { $gte: start },
    };

    try {
        // Call the StatusPageService.
        const response = await StatusPageService.getEventsByDate(
            query,
            skip,
            limit
        );
        const events = response.scheduledEvents;
        const count = response.count;
        return sendListResponse(req, res, events, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
// Route
// Description: Get all Monitor Statuses by monitorId
router.post('/:projectId/:monitorId/monitorStatuses', checkUser, async function(
    req,
    res
) {
    try {
        const { startDate, endDate } = req.body;
        const monitorId = req.params.monitorId;
        const monitorStatuses = await MonitorService.getMonitorStatuses(
            monitorId,
            startDate,
            endDate
        );
        return sendListResponse(req, res, monitorStatuses);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/probes', checkUser, async function(req, res) {
    try {
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 0;
        const probes = await ProbeService.findBy({}, limit, skip);
        const count = await ProbeService.countBy({});
        return sendListResponse(req, res, probes, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete(
    '/:projectId/:statusPageId',
    getUser,
    isAuthorized,
    isUserAdmin,
    async function(req, res) {
        const statusPageId = req.params.statusPageId;
        const userId = req.user ? req.user.id : null;
        try {
            // Call the StatusPageService.
            const statusPage = await StatusPageService.deleteBy(
                { _id: statusPageId },
                userId
            );
            return sendItemResponse(req, res, statusPage);
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;

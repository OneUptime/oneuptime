/**
 *
 * Copyright HackerBay, Inc.
 *
 */


var express = require('express');
var StatusPageService = require('../services/statusPageService');

var router = express.Router();
var UtilService = require('../services/utilService');
var validUrl = require('valid-url');
var multer = require('multer');
var ErrorService = require('../services/errorService');
const { toXML } = require('jstoxml');
const { BACKEND_HOST } = process.env;

const { getUser, checkUser } = require('../middlewares/user');
const { getSubProjects } = require('../middlewares/subProject');
const { isUserAdmin } = require('../middlewares/project');
const storage = require('../middlewares/upload');
const {
    isAuthorized
} = require('../middlewares/authorization');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route Description: Adding a status page to the project.
// req.params->{projectId}; req.body -> {[monitorIds]}
// Returns: response status page, error message

router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        var data = req.body;
        data.projectId = req.params.projectId;

        // Sanitize
        if (!data.monitorIds) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor ids are required.'
            });
        }

        if (!Array.isArray(data.monitorIds)) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitor IDs are not stored in an array.'
            });
        }

        // Call the StatusPageService.
        var statusPage = await StatusPageService.create(data);
        return sendItemResponse(req, res, statusPage);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route Description: Updating Status Page.
// Params:
// Param1:
// Returns: response status, error message
router.put('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {

    var data = req.body;
    var upload = multer({
        storage
    }).fields([
        {
            name: 'favicon',
            maxCount: 1
        }, {
            name: 'logo',
            maxCount: 1
        }
    ]);

    if (data.domain) {
        if (typeof data.domain !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Domain is not of type string.'
            });
        }

        if (!(UtilService.isDomainValid(data.domain))) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Domain is not valid.'
            });
        }
    }

    if (data.links) {
        if (typeof data.links !== 'object') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'links are not of type object.'
            });
        }

        if (data.links.length > 5) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You can have up to five links.'
            });
        }

        for (var i = 0; i < data.links.length; i++) {
            if (!data.links[i].name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Link name is required'
                });
            }

            if (typeof data.links[i].name !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Link name is not of type text.'
                });
            }
            if (!data.links[i].url) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'URL is required.'
                });
            }

            if (typeof data.links[i].url !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'URL is not of type text.'
                });
            }
            if (!(validUrl.isUri(data.links[i].url))) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Please enter a valid URL.'
                });
            }
            var counter = 0;
            for (var j = 0; j < data.links.length; j++) {
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
                        message: 'Duplicate name or url present. Please check.'
                    });
                }
            }
        }
    }

    upload(req, res, async function (error) {
        var files = req.files || {};
        let data = req.body;
        data.projectId = req.params.projectId;
        data.subProjectId = req.params.subProjectId;
        if (error) {
            ErrorService.log(error);
            return sendErrorResponse(req, res, error);
        }

        if (data._id) {
            statusPage = await StatusPageService.findOneBy({ _id: data._id });
            let imagesPath = {
                faviconPath: statusPage.faviconPath,
                logoPath: statusPage.logoPath
            };
            if (Object.keys(files).length === 0 && Object.keys(imagesPath).length !== 0) {
                data.faviconPath = imagesPath.faviconPath;
                data.logoPath = imagesPath.logoPath;
            }
            else {
                if (files && files.favicon && files.favicon[0].filename) {

                    data.faviconPath = files.favicon[0].filename;
                }

                if (files && files.logo && files.logo[0].filename) {
                    data.logoPath = files.logo[0].filename;
                }
            }
        }

        try {
            var statusPage = await StatusPageService.updateOneBy({ _id: data._id }, data);
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

router.get('/:projectId/dashboard', getUser, isAuthorized, async function (req, res) {
    let projectId = req.params.projectId;
    try {
        // Call the StatusPageService.
        var statusPages = await StatusPageService.findBy({ projectId: projectId }, req.query.skip || 0, req.query.limit || 10);
        var count = await StatusPageService.countBy({ projectId: projectId });
        return sendListResponse(req, res, statusPages, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/statuspages', getUser, isAuthorized, getSubProjects, async function (req, res) {
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try {
        var statusPages = await StatusPageService.getSubProjectStatusPages(subProjectIds);
        return sendItemResponse(req, res, statusPages); // frontend expects sendItemResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/statuspage', getUser, isAuthorized, async function (req, res) {
    var projectId = req.params.projectId;
    try {
        var statusPage = await StatusPageService.findBy({ projectId }, req.query.skip || 0, req.query.limit || 10);
        var count = await StatusPageService.countBy({ projectId });
        return sendListResponse(req, res, statusPage, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// External status page api - get the data to show on status page
router.get('/:statusPageId', checkUser, async function (req, res) {
    var statusPageId = req.params.statusPageId;
    var url = req.query.url;
    var user = req.user;
    var statusPage = {};
    try {
        // Call the StatusPageService.
        if (url && url !== 'null') {
            statusPage = await StatusPageService.getStatus({ domain: url }, user);
        } else if ((!url || url === 'null') && statusPageId) {
            statusPage = await StatusPageService.getStatus({ _id: statusPageId }, user);
        }
        else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'StatusPage Id or Url required'
            });
        }
        return sendItemResponse(req, res, statusPage);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:statusPageId/rss', checkUser, async function (req, res) {
    var statusPageId = req.params.statusPageId;
    var url = req.query.url;
    var user = req.user;
    var statusPage = {};
    try {
        // Call the StatusPageService.
        if (url && url !== 'null') {
            statusPage = await StatusPageService.getStatus({ domain: url }, user);
        } else if ((!url || url === 'null') && statusPageId) {
            statusPage = await StatusPageService.getStatus({ _id: statusPageId }, user);
        }
        else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'StatusPage Id or Url required'
            });
        }
        var { incidents } = await StatusPageService.getIncidents({ _id: statusPageId });
        var refinedIncidents = [];
        for (var incident of incidents) {
            refinedIncidents.push({
                Incident: {
                    IncidentType: incident.incidentType,
                    IncidentId: incident._id.toString(),
                    MonitorName: incident.monitorId.name,
                    MonitorId: incident.monitorId._id.toString(),
                    ManuallyCreated: incident.manuallyCreated,
                    InvestigationNote: incident.investigationNote,
                }
            });
        }
        const xmlOptions = {
            indent: '  ',
            header: true
        };

        var feedObj = {
            _name: 'rss',
            _attrs: {
                version: '2.0'
            },
            _content: [
                {
                    Title: `Incidents for status page ${statusPage.title}`
                },
                {
                    Description: 'RSS feed for all incidents related to monitors attached to status page'
                },
                {
                    Link: `${BACKEND_HOST}/statusPage/rss`
                },
                {
                    LastBuildDate: () => new Date()
                },
                {
                    Language: 'en'
                },
                {
                    Incidents: refinedIncidents
                }
            ]
        };
        var finalFeed = toXML(feedObj, xmlOptions);
        res.contentType('application/rss');
        return sendItemResponse(req, res, finalFeed);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
router.get('/:projectId/:statusPageId/notes', checkUser, async function (req, res) {
    var statusPageId = req.params.statusPageId;
    var skip = req.query.skip || 0;
    var limit = req.query.limit || 5;
    try {
        // Call the StatusPageService.
        let response = await StatusPageService.getNotes({ _id: statusPageId }, skip, limit);
        let notes = response.notes;
        let count = response.count;
        return sendListResponse(req, res, notes, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:monitorId/individualnotes', checkUser, async function (req, res) {
    var date = req.query.date;
    date = new Date(date);
    var start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    var end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

    var skip = req.query.skip || 0;
    var limit = req.query.limit || 5;
    var query = {
        monitorId: req.params.monitorId,
        deleted: false,
        createdAt: { $gte: start, $lt: end }
    };

    try {
        // Call the StatusPageService.
        let response = await StatusPageService.getNotesByDate(query, skip, limit);
        let notes = response.investigationNotes;
        let count = response.count;
        return sendListResponse(req, res, notes, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:statusPageId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var statusPageId = req.params.statusPageId;
    var userId = req.user ? req.user.id : null;
    try {
        // Call the StatusPageService.
        let statusPage = await StatusPageService.deleteBy({ _id: statusPageId }, userId);
        return sendItemResponse(req, res, statusPage);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

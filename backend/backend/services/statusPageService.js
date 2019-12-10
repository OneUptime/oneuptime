/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {

    findBy: async function (query, skip, limit) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};

        query.deleted = false;
        try {
            var statusPages = await StatusPageModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate('monitorIds', 'name')
                .lean();
        } catch (error) {
            ErrorService.log('StatusPageModel.find', error);
            throw error;
        }
        return statusPages;
    },

    create: async function (data) {
        var statusPageModel = new StatusPageModel();
        statusPageModel.projectId = data.projectId || null;
        statusPageModel.domain = data.domain || null;
        statusPageModel.links = data.links || null;
        statusPageModel.title = data.title || null;
        statusPageModel.name = data.name || null;
        statusPageModel.isPrivate = data.isPrivate || null;
        statusPageModel.description = data.description || null;
        statusPageModel.copyright = data.copyright || null;
        statusPageModel.faviconPath = data.faviconPath || null;
        statusPageModel.logoPath = data.logoPath || null;
        statusPageModel.deleted = data.deleted || false;
        statusPageModel.isSubscriberEnabled = data.isSubscriberEnabled || false;

        if (!data.monitorIds) {
            statusPageModel.monitorIds = null;
        }
        else {
            // if monitorIds is array
            if (data.monitorIds.length !== undefined) {
                statusPageModel.monitorId = [];
                for (let monitorId of data.monitorIds) {
                    statusPageModel.monitorId.push(monitorId);
                }
            } else {
                statusPageModel.monitorId = data.monitorIds;
            }
        }
        try {
            var statusPage = await statusPageModel.save();
        } catch (error) {
            ErrorService.log('statusPageModel.save', error);
            throw error;
        }
        return statusPage;
    },


    countBy: async function (query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        try {
            var count = await StatusPageModel.count(query);
        } catch (error) {
            ErrorService.log('StatusPageModel.count', error);
            throw error;
        }
        return count;
    },

    deleteBy: async function (query, userId) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var statusPage = await StatusPageModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });

            if (statusPage) {
                var subscribers = await SubscriberService.findBy({ statusPageId: statusPage._id });

                await Promise.all(subscribers.map(async (subscriber) => {
                    await SubscriberService.deleteBy({ _id: subscriber }, userId);
                }));
            }
        } catch (error) {
            ErrorService.log('StatusPageModel.deleteBy', error);
            throw error;
        }

        return statusPage;
    },

    removeMonitor: async function (monitorId) {
        try {
            var statusPage = await StatusPageModel.findOneAndUpdate({ monitorIds: monitorId }, {
                $pull: { monitorIds: monitorId }
            });
        } catch (error) {
            ErrorService.log('StatusPageModel.findOneAndUpdate', error);
            throw error;
        }
        return statusPage;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var statusPage = await StatusPageModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate('monitorIds', 'name');
        } catch (error) {
            ErrorService.log('StatusPageModel.findOne', error);
            throw error;
        }

        return statusPage;
    },

    updateBy: async function (query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        try {
            var updatedStatusPage = await StatusPageModel.findOneAndUpdate(query, {
                $set: data
            }, {
                new: true
            });
        } catch (error) {
            ErrorService.log('StatusPageModel.findOneAndUpdate', error);
            throw error;
        }
        return updatedStatusPage;
    },

    getNotes: async function (query, skip, limit) {
        var _this = this;

        if (!skip) skip = 0;

        if (!limit) limit = 5;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};
        try {
            var statuspages = await _this.findBy(query, 0, limit);

            const withMonitors = statuspages.filter((statusPage) => statusPage.monitorIds.length);
            let statuspage = withMonitors[0];
            var monitorIds = statuspage.monitorIds.map(m => m._id);
            if (monitorIds && monitorIds.length) {
                var notes = await IncidentService.findBy({ monitorId: { $in: monitorIds } }, limit, skip);
                var count = await IncidentService.countBy({ monitorId: { $in: monitorIds } });

                return { notes, count };
            }
            else {
                let error = new Error('no monitor to check');
                error.code = 400;
                ErrorService.log('StatusPage.getNotes', error);
                throw error;
            }
        } catch (error) {
            if (error.message.indexOf('at path "monitorId"') !== -1) {
                ErrorService.log('IncidentService.findBy', error);
            } else {
                ErrorService.log('StatusPage.getNotes', error);
            }
            throw error;
        }
    },

    getNotesByDate: async function (query, skip, limit) {
        try {
            var incidents = await IncidentService.findBy(query, limit, skip);

            var investigationNotes = incidents.map(incident => {
                return {
                    investigationNote: incident.investigationNote ? incident.investigationNote : '',
                    createdAt: incident.createdAt,
                    monitorId: incident.monitorId,
                    resolved: incident.resolved,
                    _id: incident._id,
                };
            });
            var count = await IncidentService.countBy(query);
        } catch (error) {
            ErrorService.log('IncidentService.getNotesByDate', error);
            throw error;
        }

        return { investigationNotes, count };
    },

    getStatus: async function (query, user) {
        var thisObj = this;
        if (!query) {
            query = {};
        }

        query.deleted = false;
        try {
            var statusPage = await StatusPageModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('projectId', 'name')
                .populate({
                    path: 'monitorIds',
                    select: 'name data type monitorCategoryId',
                    populate: { path: 'monitorCategoryId', select: 'name' }
                })
                .lean();
            var projectId = statusPage.projectId._id;
            var subProjects = await ProjectService.findBy({ $or: [{ parentProjectId: projectId }, { _id: projectId }] });
            var subProjectIds = subProjects ? subProjects.map(project => project._id) : null;
            var monitors = await MonitorService.getMonitors(subProjectIds, 0, 0);
            statusPage.monitorsData = monitors;

            if (statusPage && (statusPage._id || statusPage.id)) {
                var permitted = await thisObj.isPermitted(user, statusPage);

                if (!permitted) {
                    let error = new Error('You are unauthorized to access the page please login to continue.');
                    error.code = 401;
                    ErrorService.log('StatusPageService.getStatus', error);
                    throw error;
                }
            }
            else {
                let error = new Error('StatusPage Not present');
                error.code = 400;
                ErrorService.log('StatusPageService.getStatus', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('StatusPageService.getStatus', error);
            throw error;
        }

        return statusPage;
    },

    isPermitted: async function (user, statusPage) {
        return new Promise(async (resolve) => {
            if (statusPage.isPrivate) {
                if (user) {
                    try {
                        var project = await ProjectService.findOneBy({ _id: statusPage.projectId._id });
                    } catch (error) {
                        ErrorService.log('ProjectService.findOneBy', error);
                        throw error;
                    }
                    if (project && project._id) {
                        if (project.users.some(({ userId }) => userId === user.id)) {
                            resolve(true);
                        }
                        else {
                            resolve(false);
                        }
                    }
                    else {
                        resolve(false);
                    }
                }
                else {
                    resolve(false);
                }
            }
            else {
                resolve(true);
            }
        });
    },

    getSubProjectStatusPages: async function (subProjectIds) {
        var _this = this;
        let subProjectStatusPages = await Promise.all(subProjectIds.map(async (id) => {
            let statusPages = await _this.findBy({ projectId: id }, 0, 10);
            let count = await _this.countBy({ projectId: id });
            return { statusPages, count, _id: id, skip: 0, limit: 10 };
        }));
        return subProjectStatusPages;
    },

    hardDeleteBy: async function (query) {
        try {
            await StatusPageModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('StatusPageModel.deleteMany', error);
            throw error;
        }
        return 'Status Page(s) Removed Successfully!';
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;
        let statusPage = await _this.findBy(query);
        if (statusPage && statusPage.length > 1) {
            const statusPages = await Promise.all(statusPage.map(async (statusPage) => {
                const statusPageId = statusPage._id;
                statusPage = await _this.updateBy({ _id: statusPageId, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await SubscriberService.restoreBy({ statusPageId, deleted: true });
                return statusPage;
            }));
            return statusPages;
        } else {
            statusPage = statusPage[0];
            if (statusPage) {
                const statusPageId = statusPage._id;
                statusPage = await _this.updateBy({ _id: statusPage, deleted: true }, {
                    deleted: false,
                    deletedAt: null,
                    deleteBy: null
                });
                await SubscriberService.restoreBy({ statusPageId, deleted: true });
            }
            return statusPage;
        }
    }
};

var StatusPageModel = require('../models/statusPage');
var IncidentService = require('./incidentService');
var MonitorService = require('./monitorService');
var ErrorService = require('./errorService');
var SubscriberService = require('./subscriberService');
var ProjectService = require('./projectService');

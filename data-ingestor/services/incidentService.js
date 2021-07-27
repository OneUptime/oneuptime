const ErrorService = require('./errorService');
const incidentCollection = global.db.collection('incidents');
const { ObjectId } = require('mongodb');
const { postApi } = require('../utils/api');
const { realtimeUrl } = require('../utils/config');
const ProjectService = require('./projectService');

const realtimeBaseUrl = `${realtimeUrl}/api/realtime`;

module.exports = {
    findBy: async function({ query, limit, skip }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const incidents = await incidentCollection
                .find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .toArray();

            return incidents;
        } catch (error) {
            ErrorService.log('incidentService.findBy', error);
            throw error;
        }
    },

    // Description: Get Incident by incident Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with incident or error.
    findOneBy: async function({ query }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const incident = await incidentCollection.findOne(query);
            return incident;
        } catch (error) {
            ErrorService.log('incidentService.findOne', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const _this = this;
            const oldIncident = await _this.findOneBy({
                query: { _id: ObjectId(query._id), deleted: { $ne: null } },
            });

            const notClosedBy = oldIncident && oldIncident.notClosedBy;
            if (data.notClosedBy) {
                data.notClosedBy = notClosedBy.concat(data.notClosedBy);
            }
            data.manuallyCreated =
                data.manuallyCreated ||
                (oldIncident && oldIncident.manuallyCreated) ||
                false;

            if (
                data.reason &&
                Array.isArray(data.reason) &&
                data.reason.length > 0
            ) {
                data.reason = data.reason.join('\n');
            }

            let updatedIncident = await incidentCollection.updateOne(query, {
                $set: data,
            });

            updatedIncident = await _this.findOneBy({
                query,
            });
            const project = await ProjectService.findOneBy({
                query: {
                    _id: ObjectId(
                        updatedIncident.projectId._id ||
                            updatedIncident.projectId
                    ),
                },
            });
            const projectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : updatedIncident.projectId._id || updatedIncident.projectId;

            // realtime update
            postApi(
                `${realtimeBaseUrl}/update-incident`,
                { incident: updatedIncident, projectId },
                true
            );

            return updatedIncident;
        } catch (error) {
            ErrorService.log('incidentService.updateOneBy', error);
            throw error;
        }
    },
};

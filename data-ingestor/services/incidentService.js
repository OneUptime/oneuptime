const ErrorService = require('./errorService');
const incidentCollection = global.db.collection('incidents');
const { postApi } = require('../utils/api');

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

            // THIS IS AN EXCEPTION TO THE NORMAL FLOW
            // WHY?
            // Instead of running multiple aggregate pipelines and also running multiple data formatting
            // we will send this request to the backend, to use mongoose for the processing
            // ADVANTAGE?
            // Save resource and computational speed, since mongoose is already optimise to populate fields and deeply nested fields
            return await postApi('api/incident/data-ingestor/update-incident', {
                query,
                data,
            });
        } catch (error) {
            ErrorService.log('incidentService.updateOneBy', error);
            throw error;
        }
    },
};

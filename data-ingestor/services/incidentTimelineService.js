const IncidentService = require('./incidentService');
const ErrorService = require('./errorService');
const incidentTimelineCollection = global.db.collection('incidenttimelines');
const { ObjectId } = require('mongodb');
const { postApi } = require('../utils/api');
const moment = require('moment');

module.exports = {
    create: async function(data) {
        try {
            let incidentTimeline = {};

            incidentTimeline.incidentId = data.incidentId;
            if (data.createdById) {
                incidentTimeline.createdById = data.createdById;
            }
            if (data.probeId) {
                incidentTimeline.probeId = data.probeId;
            }
            if (data.incident_state) {
                incidentTimeline.incident_state = data.incident_state;
            }
            incidentTimeline.createdByZapier = data.createdByZapier || false;
            incidentTimeline.status = data.status;
            incidentTimeline.createdAt = new Date(moment().format());

            const result = await incidentTimelineCollection.insertOne(
                incidentTimeline
            );

            const [timeline, incident] = await Promise.all([
                this.findOneBy({
                    _id: ObjectId(result.insertedId),
                }),
                IncidentService.findOneBy({
                    query: { _id: ObjectId(data.incidentId) },
                    // select: 'projectId',
                }),
            ]);
            incidentTimeline = timeline;

            if (incident) {
                const _incidentTimeline = Object.assign(
                    {},
                    incidentTimeline._doc || incidentTimeline,
                    {
                        projectId: incident.projectId._id || incident.projectId,
                    }
                );

                // TODO
                // have an api endpoint on the backend
                // send api request from here, and handle realtime update there
                postApi(
                    'api/incident/data-ingestor/realtime/update-incident-timeline',
                    _incidentTimeline
                );
                // RealTimeService.updateIncidentTimeline(_incidentTimeline);
            }

            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.create', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            const incidentTimeline = await incidentTimelineCollection.findOne(
                query
            );
            // .lean()
            // .populate('createdById', 'name')
            // .populate('probeId', 'probeName');

            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.findOneBy', error);
            throw error;
        }
    },
};

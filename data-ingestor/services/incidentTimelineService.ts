import IncidentService from './incidentService';
import ErrorService from './errorService';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const incidentTimelineCollection = global.db.collection('incidenttimelines');
import { ObjectId } from 'mongodb';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
import moment from 'moment';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { realtimeUrl } from '../utils/config';
import ProjectService from './projectService';

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    create: async function(data: $TSFixMe) {
        try {
            let incidentTimeline = {};

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'incidentId' does not exist on type '{}'.
            incidentTimeline.incidentId = data.incidentId;
            if (data.createdById) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type '{}'... Remove this comment to see the full error message
                incidentTimeline.createdById = data.createdById;
            }
            if (data.probeId) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
                incidentTimeline.probeId = data.probeId;
            }
            if (data.incident_state) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'incident_state' does not exist on type '... Remove this comment to see the full error message
                incidentTimeline.incident_state = data.incident_state;
            }
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdByZapier' does not exist on type ... Remove this comment to see the full error message
            incidentTimeline.createdByZapier = data.createdByZapier || false;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            incidentTimeline.status = data.status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            incidentTimeline.createdAt = new Date(moment().format());
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
            incidentTimeline.deleted = false;

            const result = await incidentTimelineCollection.insertOne(
                incidentTimeline
            );

            const [timeline, incident] = await Promise.all([
                this.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    _id: ObjectId(result.insertedId),
                }),
                IncidentService.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    query: { _id: ObjectId(data.incidentId) },
                }),
            ]);
            incidentTimeline = timeline;

            if (incident) {
                const _incidentTimeline = Object.assign(
                    {},
                    // @ts-expect-error ts-migrate(2339) FIXME: Property '_doc' does not exist on type '{}'.
                    incidentTimeline._doc || incidentTimeline,
                    {
                        projectId: incident.projectId._id || incident.projectId,
                    }
                );

                const project = ProjectService.findOneBy({
                    query: {
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        _id: ObjectId(
                            _incidentTimeline.projectId._id ||
                                _incidentTimeline.projectId
                        ),
                    },
                });
                const projectId = project
                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'parentProjectId' does not exist on type ... Remove this comment to see the full error message
                      project.parentProjectId
                        ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'parentProjectId' does not exist on type ... Remove this comment to see the full error message
                          project.parentProjectId._id || project.parentProjectId
                        : // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'Promise<any... Remove this comment to see the full error message
                          project._id
                    : // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type '{}'.
                      incidentTimeline.projectId._id ||
                      // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type '{}'.
                      incidentTimeline.projectId;

                // realtime update
                postApi(
                    `${realtimeBaseUrl}/update-incident-timeline`,
                    {
                        incidentTimeline: _incidentTimeline,
                        projectId,
                    },
                    true
                ).catch((error: $TSFixMe) => {
                    ErrorService.log('incidentTimelineService.create', error);
                });
            }

            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.create', error);
            throw error;
        }
    },

    findOneBy: async function(query: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const incidentTimeline = await incidentTimelineCollection.findOne(
                query
            );

            return incidentTimeline;
        } catch (error) {
            ErrorService.log('incidentTimelineService.findOneBy', error);
            throw error;
        }
    },
};

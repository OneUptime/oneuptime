import IncidentService from './incidentService';

const incidentTimelineCollection: $TSFixMe =
    global.db.collection('incidenttimelines');
import { ObjectId } from 'mongodb';

import { post } from '../Utils/api';
import moment from 'moment';
import Query from 'CommonServer/types/db/Query';
import { realtimeUrl } from '../Config';
import ProjectService from './projectService';

const realtimeBaseUrl: string = `${realtimeUrl}/realtime`;

export default {
    create: async function (data: $TSFixMe): void {
        let incidentTimeline: $TSFixMe = {};

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

        incidentTimeline.deleted = false;

        const result: $TSFixMe = await incidentTimelineCollection.insertOne(
            incidentTimeline
        );

        const [timeline, incident]: $TSFixMe = await Promise.all([
            this.findOneBy({
                _id: ObjectId(result.insertedId),
            }),
            IncidentService.findOneBy({
                query: { _id: ObjectId(data.incidentId) },
            }),
        ]);
        incidentTimeline = timeline;

        if (incident) {
            const _incidentTimeline: $TSFixMe = Object.assign(
                {},

                incidentTimeline._doc || incidentTimeline,
                {
                    projectId: incident.projectId._id || incident.projectId,
                }
            );

            const project: $TSFixMe = ProjectService.findOneBy({
                query: {
                    _id: ObjectId(
                        _incidentTimeline.projectId._id ||
                            _incidentTimeline.projectId
                    ),
                },
            });
            const projectId: $TSFixMe = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : incidentTimeline.projectId._id || incidentTimeline.projectId;

            // Realtime update
            post(
                `${realtimeBaseUrl}/update-incident-timeline`,
                {
                    incidentTimeline: _incidentTimeline,
                    projectId,
                },
                true
            );
        }

        return incidentTimeline;
    },

    findOneBy: async function (query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const incidentTimeline: $TSFixMe =
            await incidentTimelineCollection.findOne(query);

        return incidentTimeline;
    },
};

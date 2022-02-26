import ErrorService from './errorService'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const incidentCollection = global.db.collection('incidents');
import { ObjectId } from 'mongodb'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { realtimeUrl } from '../utils/config'
import ProjectService from './projectService'

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    findBy: async function({
        query,
        limit,
        skip
    }: $TSFixMe) {
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
    findOneBy: async function({
        query
    }: $TSFixMe) {
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

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
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
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
            // TODO
            // fetch and populate all the fields
            updatedIncident = await incidentCollection
                .aggregate([
                    { $match: query },
                    {
                        $addFields: {
                            createdById: { $toObjectId: '$createdById' },
                        },
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'createdById',
                            foreignField: '_id',
                            as: 'createdById',
                        },
                    },
                    {
                        $lookup: {
                            from: 'projects',
                            localField: 'projectId',
                            foreignField: '_id',
                            as: 'projectId',
                        },
                    },
                    {
                        $addFields: {
                            resolvedBy: { $toObjectId: '$resolvedBy' },
                        },
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'resolvedBy',
                            foreignField: '_id',
                            as: 'resolvedBy',
                        },
                    },
                    {
                        $addFields: {
                            acknowledgedBy: { $toObjectId: '$acknowledgedBy' },
                        },
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'acknowledgedBy',
                            foreignField: '_id',
                            as: 'acknowledgedBy',
                        },
                    },
                    {
                        $addFields: {
                            incidentPriority: {
                                $toObjectId: '$incidentPriority',
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: 'incidentpriorities',
                            localField: 'incidentPriority',
                            foreignField: '_id',
                            as: 'incidentPriority',
                        },
                    },
                    {
                        $addFields: {
                            acknowledgedByIncomingHttpRequest: {
                                $toObjectId:
                                    '$acknowledgedByIncomingHttpRequest',
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: 'incomingrequests',
                            localField: 'acknowledgedByIncomingHttpRequest',
                            foreignField: '_id',
                            as: 'acknowledgedByIncomingHttpRequest',
                        },
                    },
                    {
                        $addFields: {
                            resolvedByIncomingHttpRequest: {
                                $toObjectId: '$resolvedByIncomingHttpRequest',
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: 'incomingrequests',
                            localField: 'resolvedByIncomingHttpRequest',
                            foreignField: '_id',
                            as: 'resolvedByIncomingHttpRequest',
                        },
                    },
                    {
                        $addFields: {
                            createdByIncomingHttpRequest: {
                                $toObjectId: '$createdByIncomingHttpRequest',
                            },
                        },
                    },
                    {
                        $lookup: {
                            from: 'incomingrequests',
                            localField: 'createdByIncomingHttpRequest',
                            foreignField: '_id',
                            as: 'createdByIncomingHttpRequest',
                        },
                    },
                    {
                        $lookup: {
                            from: 'monitors',
                            localField: 'monitors.monitorId',
                            foreignField: '_id',
                            as: 'monitorId',
                        },
                    },
                    {
                        $lookup: {
                            from: 'components',
                            localField: 'monitorId.componentId',
                            foreignField: '_id',
                            as: 'componentId',
                        },
                    },
                    {
                        $lookup: {
                            from: 'projects',
                            localField: 'monitorId.projectId',
                            foreignField: '_id',
                            as: 'monitorProjectId',
                        },
                    },
                ])
                .toArray();
            updatedIncident = updatedIncident[0];

            /**
             * REASONABLE ASSUMPTIONS FOR DATA RESTRUCTURING
             *
             * 1. Incidents created by probe will always have a single monitor in the monitors array
             * 2. The single monitor will be attached to one component and one project
             */

            if (
                updatedIncident.createdById &&
                Array.isArray(updatedIncident.createdById)
            ) {
                updatedIncident.createdById = updatedIncident.createdById[0];
            }
            if (
                updatedIncident.projectId &&
                Array.isArray(updatedIncident.projectId)
            ) {
                updatedIncident.projectId = updatedIncident.projectId[0];
            }
            if (
                updatedIncident.resolvedBy &&
                Array.isArray(updatedIncident.resolvedBy)
            ) {
                updatedIncident.resolvedBy = updatedIncident.resolvedBy[0];
            }
            if (
                updatedIncident.acknowledgedBy &&
                Array.isArray(updatedIncident.acknowledgedBy)
            ) {
                updatedIncident.acknowledgedBy =
                    updatedIncident.acknowledgedBy[0];
            }
            if (
                updatedIncident.incidentPriority &&
                Array.isArray(updatedIncident.incidentPriority)
            ) {
                updatedIncident.incidentPriority =
                    updatedIncident.incidentPriority[0];
            }
            if (
                updatedIncident.acknowledgedByIncomingHttpRequest &&
                Array.isArray(updatedIncident.acknowledgedByIncomingHttpRequest)
            ) {
                updatedIncident.acknowledgedByIncomingHttpRequest =
                    updatedIncident.acknowledgedByIncomingHttpRequest[0];
            }
            if (
                updatedIncident.resolvedByIncomingHttpRequest &&
                Array.isArray(updatedIncident.resolvedByIncomingHttpRequest)
            ) {
                updatedIncident.resolvedByIncomingHttpRequest =
                    updatedIncident.resolvedByIncomingHttpRequest[0];
            }
            if (
                updatedIncident.createdByIncomingHttpRequest &&
                Array.isArray(updatedIncident.createdByIncomingHttpRequest)
            ) {
                updatedIncident.createdByIncomingHttpRequest =
                    updatedIncident.createdByIncomingHttpRequest[0];
            }
            if (
                updatedIncident.monitorId &&
                Array.isArray(updatedIncident.monitorId)
            ) {
                const monitor = updatedIncident.monitorId[0];

                // if there's monitor, then projectId and componentId should be available
                if (monitor) {
                    const projectId = updatedIncident.monitorProjectId[0];
                    const componentId = updatedIncident.componentId[0];

                    updatedIncident.monitors = [
                        {
                            monitorId: {
                                ...monitor,
                                projectId,
                                componentId,
                            },
                        },
                    ];
                }
            }

            const project = await ProjectService.findOneBy({
                query: {
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
                {
                    incident: updatedIncident,
                    projectId,
                },
                true
            ).catch((error: $TSFixMe) => {
                ErrorService.log('incidentService.updateOneBy', error);
            });

            return updatedIncident;
        } catch (error) {
            ErrorService.log('incidentService.updateOneBy', error);
            throw error;
        }
    },
};

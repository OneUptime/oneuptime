const monitorStatusCollection = global.db.collection('monitorstatuses');
import { ObjectId } from 'mongodb';
import Query from 'common-server/types/db/Query';
import { post } from '../utils/api';
import MonitorService from './monitorService';
import moment from 'moment';
import ProjectService from './projectService';

import { realtimeUrl } from '../utils/config';

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    create: async function (data: $TSFixMe) {
        const query = {};

        if (data.monitorId) query.monitorId = data.monitorId;

        if (data.probeId) query.probeId = data.probeId;

        let previousMonitorStatus = await this.findBy({
            query,
            limit: 1,
        });
        previousMonitorStatus = previousMonitorStatus[0];

        if (
            !previousMonitorStatus ||
            (previousMonitorStatus &&
                previousMonitorStatus.status !== data.status)
        ) {
            // check if monitor has a previous status
            // check if previous status is different from the current status
            // if different, end the previous status and create a new monitor status
            const now = new Date(moment().format());
            if (previousMonitorStatus) {
                if (
                    data.status === 'enable' &&
                    previousMonitorStatus.status === 'disabled' &&
                    previousMonitorStatus.lastStatus
                ) {
                    data.status = previousMonitorStatus.lastStatus;
                }
                await this.updateOneBy(
                    {
                        _id: ObjectId(previousMonitorStatus._id),
                    },
                    {
                        endTime: now,
                    }
                );
            }

            const monitorStatusData = {
                monitorId: data.monitorId,
                probeId: data.probeId || null,
                incidentId: data.incidentId || null,
                manuallyCreated: data.manuallyCreated || false,
                status: data.status,
                createdAt: now,
                startTime: now,
                deleted: false,
            };
            if (data.lastStatus) {
                monitorStatusData.lastStatus = data.lastStatus;
            }

            const result = await monitorStatusCollection.insertOne(
                monitorStatusData
            );
            const savedMonitorStatus = await this.findOneBy({
                _id: ObjectId(result.insertedId),
            });

            await this.sendMonitorStatus(savedMonitorStatus);

            return savedMonitorStatus;
        }
    },

    updateOneBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        await monitorStatusCollection.updateOne(query, { $set: data });
        const updatedMonitorStatus = await monitorStatusCollection.findOne(
            query
        );
        return updatedMonitorStatus;
    },

    findOneBy: async function (query: Query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const monitorStatus = await monitorStatusCollection.findOne(query);
        return monitorStatus;
    },

    findBy: async function ({ query, limit, skip, sort }: $TSFixMe) {
        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const incidents = await monitorStatusCollection
            .find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .toArray();

        return incidents;
    },

    async sendMonitorStatus(data: $TSFixMe) {
        const monitor = await MonitorService.findOneBy({
            query: { _id: ObjectId(data.monitorId) },
            // select: 'projectId',
            // populate: [{ path: 'projectId', select: '_id' }],
        });
        if (monitor && monitor.projectId) {
            const project = await ProjectService.findOneBy({
                query: {
                    _id: ObjectId(monitor.projectId._id || monitor.projectId),
                },
            });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            // realtime update
            post(
                `${realtimeBaseUrl}/update-monitor-status`,
                {
                    data,
                    projectId: monitor.projectId._id || monitor.projectId,
                    monitorId: data.monitorId,
                    parentProjectId,
                },
                true
            );
        }
    },
};

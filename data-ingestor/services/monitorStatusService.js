const monitorStatusCollection = global.db.collection('monitorstatuses');
const { ObjectId } = require('mongodb');
const ErrorService = require('../services/errorService');
const { postApi } = require('../utils/api');
const MonitorService = require('./monitorService');
const moment = require('moment');
const ProjectService = require('./projectService');
const { realtimeUrl } = require('../utils/config');

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

module.exports = {
    create: async function(data) {
        try {
            const query = {};
            if (data.monitorId) query.monitorId = data.monitorId;
            if (data.probeId) query.probeId = data.probeId;

            const previousMonitorStatus = await this.findOneBy(query);

            if (
                !previousMonitorStatus ||
                (previousMonitorStatus &&
                    previousMonitorStatus.status !== data.status)
            ) {
                // check if monitor has a previous status
                // check if previous status is different from the current status
                // if different, end the previous status and create a new monitor status
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
                            endTime: new Date(moment().format()),
                        }
                    );
                }

                const now = new Date(moment().format());
                const monitorStatusData = {
                    monitorId: data.monitorId,
                    probeId: data.probeId || null,
                    incidentId: data.incidentId || null,
                    manuallyCreated: data.manuallyCreated || false,
                    status: data.status,
                    createdAt: now,
                    startTime: now,
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
        } catch (error) {
            ErrorService.log('MonitorStatusService.create', error);
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

            await monitorStatusCollection.updateOne(query, { $set: data });
            const updatedMonitorStatus = await monitorStatusCollection.findOne(
                query
            );
            return updatedMonitorStatus;
        } catch (error) {
            ErrorService.log('MonitorStatusService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const monitorStatus = await monitorStatusCollection.findOne(query);
            return monitorStatus;
        } catch (error) {
            ErrorService.log('MonitorStatusService.findOneBy', error);
            throw error;
        }
    },

    async sendMonitorStatus(data) {
        try {
            const monitor = await MonitorService.findOneBy({
                query: { _id: ObjectId(data.monitorId) },
                // select: 'projectId',
                // populate: [{ path: 'projectId', select: '_id' }],
            });
            if (monitor && monitor.projectId) {
                const project = await ProjectService.findOneBy({
                    query: {
                        _id: ObjectId(
                            monitor.projectId._id || monitor.projectId
                        ),
                    },
                });
                const parentProjectId = project
                    ? project.parentProjectId
                        ? project.parentProjectId._id || project.parentProjectId
                        : project._id
                    : monitor.projectId._id || monitor.projectId;

                // realtime update
                postApi(
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
        } catch (error) {
            ErrorService.log('MonitorStatusService.sendMonitorStatus', error);
            throw error;
        }
    },
};

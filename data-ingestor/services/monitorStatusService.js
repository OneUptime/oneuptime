const monitorStatusCollection = global.db.collection('monitorstatuses');
const { ObjectId } = require('mongodb');
const ErrorService = require('../services/errorService');
const { postApi } = require('../utils/api');
const MonitorService = require('./monitorService');
const moment = require('moment');

module.exports = {
    create: async function(data) {
        try {
            const query = {};
            if (data.monitorId) query.monitorId = data.monitorId;
            if (data.probeId) query.probeId = data.probeId;

            const previousMonitorStatus = await monitorStatusCollection.findOne(
                query
            );

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
                const savedMonitorStatus = await monitorStatusCollection.findOne(
                    { _id: ObjectId(result.insertedId) }
                );

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
            query.deleted = false;

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
                // run in the background
                // RealTimeService.updateMonitorStatus(
                //     data,
                //     monitor.projectId._id
                // );
                postApi(
                    'api/monitor/data-ingestor/realtime/update-monitor-status',
                    {
                        data,
                        projectId: monitor.projectId._id || monitor.projectId,
                    }
                );
            }
        } catch (error) {
            ErrorService.log('MonitorStatusService.sendMonitorStatus', error);
            throw error;
        }
    },
};

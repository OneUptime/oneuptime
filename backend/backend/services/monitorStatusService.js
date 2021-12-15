module.exports = {
    create: async function(data) {
        try {
            const query = {};
            if (data.monitorId) query.monitorId = data.monitorId;
            if (data.probeId) query.probeId = data.probeId;

            const select = '_id status lastStatus';
            let previousMonitorStatus = await this.findBy({
                query,
                limit: 1,
                select,
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
                            _id: previousMonitorStatus._id,
                        },
                        {
                            endTime: Date.now(),
                        }
                    );
                }

                const monitorStatus = new MonitorStatusModel();
                if (data.lastStatus) {
                    monitorStatus.lastStatus = data.lastStatus;
                }
                monitorStatus.monitorId = data.monitorId;
                monitorStatus.probeId = data.probeId || null;
                monitorStatus.incidentId = data.incidentId || null;
                monitorStatus.manuallyCreated = data.manuallyCreated || false;
                monitorStatus.status = data.status;

                const savedMonitorStatus = await monitorStatus.save();

                await this.sendMonitorStatus(savedMonitorStatus);

                return savedMonitorStatus;
            }
        } catch (error) {
            ErrorService.log('MonitorStatusService.create', error);
            throw error;
        }
    },

    // allData is an array of object
    // to be bulk written to the db
    createMany: async function(allData) {
        try {
            const dataList = [];
            for (const data of allData) {
                const query = {};
                if (data.monitorId) query.monitorId = data.monitorId;
                if (data.probeId) query.probeId = data.probeId;

                const select = '_id status lastStatus';
                let previousMonitorStatus = await this.findBy({
                    query,
                    limit: 1,
                    select,
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
                                _id: previousMonitorStatus._id,
                            },
                            {
                                endTime: Date.now(),
                            }
                        );
                    }

                    dataList.push(data);
                }
            }
            const _this = this;
            if (dataList.length > 0) {
                const docs = await MonitorStatusModel.insertMany(dataList);
                // we don't want to await this ):
                docs.forEach(doc => _this.sendMonitorStatus(doc));

                return docs;
            }
            return null;
        } catch (error) {
            ErrorService.log('MonitorStatusService.createMany', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            const updatedMonitorStatus = await MonitorStatusModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            return updatedMonitorStatus;
        } catch (error) {
            ErrorService.log('MonitorStatusService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            let updatedData = await MonitorStatusModel.updateMany(query, {
                $set: data,
            });
            const select =
                '_id monitorId probeId incidentId status manuallyCreated startTime endTime lastStatus createdAt deleted';
            updatedData = await this.findBy({ query, select });
            return updatedData;
        } catch (error) {
            ErrorService.log('MonitorStatusService.updateMany', error);
            throw error;
        }
    },

    findBy: async function({ query, limit, skip, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            let monitorStatusQuery = MonitorStatusModel.find(query)
                .lean()
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip);
            monitorStatusQuery = handleSelect(select, monitorStatusQuery);
            monitorStatusQuery = handlePopulate(populate, monitorStatusQuery);

            const monitorStatus = await monitorStatusQuery;
            return monitorStatus;
        } catch (error) {
            ErrorService.log('monitorStatusService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            let monitorStatusQuery = MonitorStatusModel.findOne(query).lean();
            monitorStatusQuery = handleSelect(select, monitorStatusQuery);
            monitorStatusQuery = handlePopulate(populate, monitorStatusQuery);

            const monitorStatus = await monitorStatusQuery;
            return monitorStatus;
        } catch (error) {
            ErrorService.log('MonitorStatusService.findOneBy', error);
            throw error;
        }
    },

    async sendMonitorStatus(data) {
        try {
            const monitor = await MonitorService.findOneBy({
                query: { _id: data.monitorId },
                select: 'projectId',
                populate: [{ path: 'projectId', select: '_id' }],
            });
            if (monitor) {
                try {
                    // run in the background
                    RealTimeService.updateMonitorStatus(
                        data,
                        monitor.projectId._id
                    );
                } catch (error) {
                    ErrorService.log(
                        'realtimeService.updateMonitorStatus',
                        error
                    );
                }
            }
        } catch (error) {
            ErrorService.log('MonitorStatusService.sendMonitorStatus', error);
            throw error;
        }
    },
    deleteBy: async function(query, userId) {
        try {
            const _this = this;
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const monitorStatus = await MonitorStatusModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedById: userId,
                        deletedAt: Date.now(),
                    },
                },
                {
                    new: true,
                }
            );
            if (monitorStatus) {
                const {
                    manuallyCreated,
                    probeId,
                    createdAt,
                    endTime,
                } = monitorStatus;
                const previousMonitorStatuses = await MonitorStatusModel.find({
                    manuallyCreated,
                    probeId,
                    deleted: false,
                    createdAt: { $lte: createdAt },
                }).sort([['createdAt', -1]]);
                if (previousMonitorStatuses && previousMonitorStatuses.length) {
                    const previousMonitorStatus = previousMonitorStatuses[0];
                    await _this.updateOneBy(
                        { _id: previousMonitorStatus._id },
                        { endTime }
                    );
                }
            }
            return monitorStatus;
        } catch (error) {
            ErrorService.log('monitorStatusService.deleteBy', error);
            throw error;
        }
    },
};

const MonitorStatusModel = require('../models/monitorStatus');
const MonitorService = require('../services/monitorService');
const RealTimeService = require('./realTimeService');
const ErrorService = require('../services/errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

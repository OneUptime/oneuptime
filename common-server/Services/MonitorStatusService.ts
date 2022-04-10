export default class Service {
    async create(data: $TSFixMe) {
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
    }

    // allData is an array of object
    // to be bulk written to the db
    async createMany(allData: $TSFixMe) {
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

        if (dataList.length > 0) {
            const docs = await MonitorStatusModel.insertMany(dataList);
            // we don't want to await this ):

            docs.forEach((doc: $TSFixMe) => this.sendMonitorStatus(doc));

            return docs;
        }
        return null;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
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
    }

    async updateBy(query: Query, data: $TSFixMe) {
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
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
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
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const monitorStatusQuery = MonitorStatusModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        monitorStatusQuery.select(select);
        monitorStatusQuery.populate(populate);

        const monitorStatus = await monitorStatusQuery;
        return monitorStatus;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const monitorStatusQuery = MonitorStatusModel.findOne(query)
            .sort(sort)
            .lean();
        monitorStatusQuery.select(select);
        monitorStatusQuery.populate(populate);

        const monitorStatus = await monitorStatusQuery;
        return monitorStatus;
    }

    async sendMonitorStatus(data: $TSFixMe) {
        const monitor = await MonitorService.findOneBy({
            query: { _id: data.monitorId },
            select: 'projectId',
            populate: [{ path: 'projectId', select: '_id' }],
        });
        if (monitor) {
            // run in the background
            RealTimeService.updateMonitorStatus(data, monitor.projectId._id);
        }
    }

    async deleteBy(query: Query, userId: string) {
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
            const { manuallyCreated, probeId, createdAt, endTime } =
                monitorStatus;
            const previousMonitorStatuses = await MonitorStatusModel.find({
                manuallyCreated,
                probeId,
                deleted: false,
                createdAt: { $lte: createdAt },
            });
            if (previousMonitorStatuses && previousMonitorStatuses.length) {
                const previousMonitorStatus = previousMonitorStatuses[0];
                await this.updateOneBy(
                    { _id: previousMonitorStatus._id },
                    { endTime }
                );
            }
        }
        return monitorStatus;
    }
}

import MonitorStatusModel from '../Models/monitorStatus';
import MonitorService from './MonitorService';
import RealTimeService from './realTimeService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

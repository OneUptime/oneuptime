import MonitorSlaModel from '../Models/monitorSla';
import MonitorService from './MonitorService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    public async create(data: $TSFixMe): void {
        const monitorSlaCount: $TSFixMe = await this.countBy({
            name: data.name,
            projectId: data.projectId,
        });
        if (monitorSlaCount && monitorSlaCount > 0) {
            const error: $TSFixMe = new Error(
                'Monitor SLA with the same name already exist'
            );

            error.code = 400;
            throw error;
        }

        if (data.isDefault) {
            /*
             * Automatically set isDefault to false
             * For any previous SLA with a default status
             */
            await MonitorSlaModel.findOneAndUpdate(
                {
                    projectId: data.projectId,
                    isDefault: true,
                },
                { $set: { isDefault: false } }
            );
        }

        const createdMonitorSla: $TSFixMe = await MonitorSlaModel.create(data);

        if (data.monitors && data.monitors.length > 0) {
            let monitorIds: $TSFixMe = [...data.monitors];
            monitorIds = [...new Set(monitorIds)];

            await MonitorService.updateManyMonitorSla(
                monitorIds,
                createdMonitorSla._id
            );
        }

        return createdMonitorSla;
    }

    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }

        const monitorSlaQuery: $TSFixMe = MonitorSlaModel.findOne(query)
            .sort(sort)
            .lean();

        monitorSlaQuery.select(select);
        monitorSlaQuery.populate(populate);

        const monitorSla: $TSFixMe = await monitorSlaQuery;
        return monitorSla;
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }

        const monitorSlaQuery: $TSFixMe = MonitorSlaModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        monitorSlaQuery.select(select);
        monitorSlaQuery.populate(populate);

        const monitorSla: $TSFixMe = await monitorSlaQuery;

        return monitorSla;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }

        /*
         * Check if we are only setting default sla
         * Or using update modal for editing the details
         */
        if (!data.handleDefault) {
            const monitorSla: $TSFixMe = await this.findOneBy({
                query: { name: data.name, projectId: query.projectId },
                select: '_id',
            });

            if (monitorSla && String(monitorSla._id) !== String(query._id)) {
                const error: $TSFixMe = new Error(
                    'Monitor SLA with the same name already exist'
                );

                error.code = 400;
                throw error;
            }

            const monitors: $TSFixMe = await MonitorService.findBy({
                query: { monitorSla: query._id },
                select: '_id',
            });
            const initialMonitorIds: $TSFixMe = monitors.map(
                (monitor: $TSFixMe) => {
                    return monitor._id;
                }
            );

            const removedMonitors: $TSFixMe = [];
            if (data.monitors && data.monitors.length > 0) {
                let monitorIds: $TSFixMe = [...data.monitors];
                monitorIds = [...new Set(monitorIds)];
                monitorIds = monitorIds.map((id: $TSFixMe) => {
                    return String(id);
                });
                initialMonitorIds.forEach((monitorId: $TSFixMe) => {
                    if (!monitorIds.includes(String(monitorId))) {
                        removedMonitors.push(monitorId);
                    }
                });
                await MonitorService.updateManyMonitorSla(
                    monitorIds,
                    query._id
                );
            } else {
                /*
                 * Unset monitorSla for removed monitors
                 * At this point all the monitors were removed
                 */

                await MonitorService.unsetColumnsOfManyMonitors(
                    initialMonitorIds,
                    { monitorSla: true }
                );
            }

            // Unset monitorSla for removed monitors
            if (removedMonitors && removedMonitors.length > 0) {
                await MonitorService.unsetColumnsOfManyMonitors(
                    removedMonitors,
                    { monitorSla: true }
                );
            }
        }

        let monitorSla: $TSFixMe;
        if (data.isDefault) {
            monitorSla = await this.findOneBy({
                query: { projectId: query.projectId, isDefault: true },
                select: '_id',
            });
        }

        if (monitorSla && String(monitorSla._id) !== String(query._id)) {
            await MonitorSlaModel.findOneAndUpdate(
                { _id: monitorSla._id },
                { $set: { isDefault: false } }
            );
        }

        let updatedMonitorSla: $TSFixMe =
            await MonitorSlaModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

        if (!updatedMonitorSla) {
            throw new BadDataException(
                'Monitor SLA not found or does not exist'
            );
        }

        const selectMonSla: $TSFixMe =
            'name projectId isDefault frequency monitorUptime deleted deletedAt';

        const populateMonSla: $TSFixMe = [
            { path: 'projectId', select: 'name slug' },
        ];
        updatedMonitorSla = await this.findOneBy({
            query,
            select: selectMonSla,
            populate: populateMonSla,
        });

        return updatedMonitorSla;
    }

    public async deleteBy(query: Query): void {
        const deletedSla: $TSFixMe = await MonitorSlaModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                },
            },
            { new: true }
        );

        return deletedSla;
    }

    public async hardDelete(query: Query): void {
        await MonitorSlaModel.deleteMany(query);
        return 'Monitor SLA(s) deleted successfully';
    }
    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const count: $TSFixMe = await MonitorSlaModel.countDocuments(query);
        return count;
    }
}

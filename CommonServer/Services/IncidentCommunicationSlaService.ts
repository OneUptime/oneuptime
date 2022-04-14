import IncidentCommunicationSlaModel from '../Models/incidentCommunicationSla';
import MonitorService from './MonitorService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create(data: $TSFixMe): void {
        const incidentCommunicationSla: $TSFixMe = await this.countBy({
            name: data.name,
            projectId: data.projectId,
        });

        if (incidentCommunicationSla && incidentCommunicationSla > 0) {
            const error: $TSFixMe = new Error(
                'Incident communication SLA with the same name already exist'
            );

            error.code = 400;
            throw error;
        }

        if (data.isDefault) {
            // automatically set isDefault to false
            // for any previous SLA with a default status
            await IncidentCommunicationSlaModel.findOneAndUpdate(
                {
                    projectId: data.projectId,
                    isDefault: true,
                },
                { $set: { isDefault: false } }
            );
        }

        const createdIncidentCommunicationSla: $TSFixMe =
            await IncidentCommunicationSlaModel.create(data);

        if (data.monitors && data.monitors.length > 0) {
            let monitorIds = [...data.monitors];
            monitorIds = [...new Set(monitorIds)];
            await MonitorService.updateManyIncidentCommunicationSla(
                monitorIds,
                createdIncidentCommunicationSla._id
            );
        }

        return createdIncidentCommunicationSla;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const incidentCommunicationSlaQuery: $TSFixMe =
            IncidentCommunicationSlaModel.findOne(query).sort(sort).lean();

        incidentCommunicationSlaQuery.select(select);

        incidentCommunicationSlaQuery.populate(populate);

        const incidentCommunicationSla: $TSFixMe = await incidentCommunicationSlaQuery;
        return incidentCommunicationSla;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const incidentCommunicationSlaQuery: $TSFixMe =
            IncidentCommunicationSlaModel.find(query)
                .lean()
                .sort(sort)
                .limit(limit.toNumber())
                .skip(skip.toNumber());

        incidentCommunicationSlaQuery.select(select);

        incidentCommunicationSlaQuery.populate(populate);

        const incidentCommunicationSla: $TSFixMe = await incidentCommunicationSlaQuery;
        return incidentCommunicationSla;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        // check if we are only setting default sla
        // or using update modal for editing the details

        if (!data.handleDefault) {
            const incidentCommunicationSla: $TSFixMe = await this.findOneBy({
                query: { name: data.name, projectId: query.projectId },
                select: '_id',
            });

            if (
                incidentCommunicationSla &&
                String(incidentCommunicationSla._id) !== String(query._id)
            ) {
                const error: $TSFixMe = new Error(
                    'Incident communication SLA with the same name already exist'
                );

                error.code = 400;
                throw error;
            }

            const monitors: $TSFixMe = await MonitorService.findBy({
                query: { incidentCommunicationSla: query._id },
                select: '_id',
            });
            const initialMonitorIds: $TSFixMe = monitors.map(
                (monitor: $TSFixMe) => monitor._id
            );

            const removedMonitors: $TSFixMe = [];
            if (data.monitors && data.monitors.length > 0) {
                let monitorIds = [...data.monitors];
                monitorIds = [...new Set(monitorIds)];
                monitorIds = monitorIds.map(id => String(id));
                initialMonitorIds.forEach((monitorId: $TSFixMe) => {
                    if (!monitorIds.includes(String(monitorId))) {
                        removedMonitors.push(monitorId);
                    }
                });

                await MonitorService.updateManyIncidentCommunicationSla(
                    monitorIds,
                    query._id
                );
            } else {
                // unset incidentCommunicationSla for removed monitors
                // at this point all the monitors were removed
                await MonitorService.unsetColumnsOfManyMonitors(
                    initialMonitorIds,
                    { incidentCommunicationSla: true }
                );
            }

            // unset incidentCommunicationSla for removed monitors
            if (removedMonitors && removedMonitors.length > 0) {
                await MonitorService.unsetColumnsOfManyMonitors(
                    removedMonitors,
                    { incidentCommunicationSla: true }
                );
            }
        }

        let incidentSla;
        if (data.isDefault) {
            incidentSla = await this.findOneBy({
                query: { projectId: query.projectId, isDefault: true },
                select: '_id',
            });
        }

        if (incidentSla && String(incidentSla._id) !== String(query._id)) {
            await IncidentCommunicationSlaModel.findOneAndUpdate(
                { _id: incidentSla._id },
                { $set: { isDefault: false } }
            );
        }

        let updatedIncidentCommunicationSla =
            await IncidentCommunicationSlaModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

        if (!updatedIncidentCommunicationSla) {
            const error: $TSFixMe = new Error(
                'Incident Communication SLA not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        const selectIncidentComSla: $TSFixMe =
            'name projectId isDefault alertTime alertTime deleted duration';

        const populateIncidentComSla: $TSFixMe = [
            { path: 'projectId', select: 'name slug' },
        ];

        updatedIncidentCommunicationSla = await this.findOneBy({
            query,
            select: selectIncidentComSla,
            populate: populateIncidentComSla,
        });

        return updatedIncidentCommunicationSla;
    }

    async deleteBy(query: Query): void {
        const deletedSla: $TSFixMe = await IncidentCommunicationSlaModel.findOneAndUpdate(
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

    async hardDelete(query: Query): void {
        await IncidentCommunicationSlaModel.deleteMany(query);
        return 'Incident Communication SLA(s) deleted successfully';
    }
    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const count: $TSFixMe = await IncidentCommunicationSlaModel.countDocuments(query);
        return count;
    }
}

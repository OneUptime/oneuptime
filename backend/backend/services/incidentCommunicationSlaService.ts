import IncidentCommunicationSlaModel from '../models/incidentCommunicationSla';
import MonitorService from './monitorService';
import handlePopulate from '../utils/populate';
import handleSelect from '../utils/select';

export default {
    create: async function(data: $TSFixMe) {
        const incidentCommunicationSla = await this.countBy({
            name: data.name,
            projectId: data.projectId,
        });

        if (incidentCommunicationSla && incidentCommunicationSla > 0) {
            const error = new Error(
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

        const createdIncidentCommunicationSla = await IncidentCommunicationSlaModel.create(
            data
        );

        if (data.monitors && data.monitors.length > 0) {
            let monitorIds = [...data.monitors];
            monitorIds = [...new Set(monitorIds)];
            await MonitorService.updateManyIncidentCommunicationSla(
                monitorIds,
                createdIncidentCommunicationSla._id
            );
        }

        return createdIncidentCommunicationSla;
    },
    findOneBy: async function({ query, select, populate }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let incidentCommunicationSlaQuery = IncidentCommunicationSlaModel.findOne(
            query
        ).lean();

        incidentCommunicationSlaQuery = handleSelect(
            select,
            incidentCommunicationSlaQuery
        );

        incidentCommunicationSlaQuery = handlePopulate(
            populate,
            incidentCommunicationSlaQuery
        );

        const incidentCommunicationSla = await incidentCommunicationSlaQuery;
        return incidentCommunicationSla;
    },
    findBy: async function({ query, limit, skip, populate, select }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let incidentCommunicationSlaQuery = IncidentCommunicationSlaModel.find(
            query
        )
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        incidentCommunicationSlaQuery = handleSelect(
            select,
            incidentCommunicationSlaQuery
        );

        incidentCommunicationSlaQuery = handlePopulate(
            populate,
            incidentCommunicationSlaQuery
        );

        const incidentCommunicationSla = await incidentCommunicationSlaQuery;
        return incidentCommunicationSla;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        // check if we are only setting default sla
        // or using update modal for editing the details

        if (!data.handleDefault) {
            const incidentCommunicationSla = await this.findOneBy({
                query: { name: data.name, projectId: query.projectId },
                select: '_id',
            });

            if (
                incidentCommunicationSla &&
                String(incidentCommunicationSla._id) !== String(query._id)
            ) {
                const error = new Error(
                    'Incident communication SLA with the same name already exist'
                );

                error.code = 400;
                throw error;
            }

            const monitors = await MonitorService.findBy({
                query: { incidentCommunicationSla: query._id },
                select: '_id',
            });
            const initialMonitorIds = monitors.map(
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

        let updatedIncidentCommunicationSla = await IncidentCommunicationSlaModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        if (!updatedIncidentCommunicationSla) {
            const error = new Error(
                'Incident Communication SLA not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        const selectIncidentComSla =
            'name projectId isDefault alertTime alertTime deleted duration';

        const populateIncidentComSla = [
            { path: 'projectId', select: 'name slug' },
        ];

        updatedIncidentCommunicationSla = await this.findOneBy({
            query,
            select: selectIncidentComSla,
            populate: populateIncidentComSla,
        });

        return updatedIncidentCommunicationSla;
    },
    deleteBy: async function(query: $TSFixMe) {
        const deletedSla = await IncidentCommunicationSlaModel.findOneAndUpdate(
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
    },
    hardDelete: async function(query: $TSFixMe) {
        await IncidentCommunicationSlaModel.deleteMany(query);
        return 'Incident Communication SLA(s) deleted successfully';
    },
    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await IncidentCommunicationSlaModel.countDocuments(query);
        return count;
    },
};

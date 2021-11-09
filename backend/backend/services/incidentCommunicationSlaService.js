const IncidentCommunicationSlaModel = require('../models/incidentCommunicationSla');
const MonitorService = require('./monitorService');
const ErrorService = require('./errorService');
const handlePopulate = require('../utils/populate');
const handleSelect = require('../utils/select');

module.exports = {
    create: async function(data) {
        try {
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
        } catch (error) {
            ErrorService.log('incidentCommunicationSlaService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
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
        } catch (error) {
            ErrorService.log(
                'incidentCommunicationSlaService.findOneBy',
                error
            );
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, populate, select }) {
        try {
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
        } catch (error) {
            ErrorService.log('incidentCommunicationSlaService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
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
                const initialMonitorIds = monitors.map(monitor => monitor._id);

                const removedMonitors = [];
                if (data.monitors && data.monitors.length > 0) {
                    let monitorIds = [...data.monitors];
                    monitorIds = [...new Set(monitorIds)];
                    monitorIds = monitorIds.map(id => String(id));
                    initialMonitorIds.forEach(monitorId => {
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
        } catch (error) {
            ErrorService.log(
                'incidentCommunicationSlaService.updateOneBy',
                error
            );
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
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
        } catch (error) {
            ErrorService.log('incidentCommunicationSlaService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await IncidentCommunicationSlaModel.deleteMany(query);
            return 'Incident Communication SLA(s) deleted successfully';
        } catch (error) {
            ErrorService.log(
                'incidentCommunicationSlaService.hardDelete',
                error
            );
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await IncidentCommunicationSlaModel.countDocuments(
                query
            );
            return count;
        } catch (error) {
            ErrorService.log('incidentCommunicationSlaService.countBy', error);
            throw error;
        }
    },
};

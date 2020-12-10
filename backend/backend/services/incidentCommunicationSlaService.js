const IncidentCommunicationSlaModel = require('../models/incidentCommunicationSla');
const MonitorService = require('./monitorService');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const incidentCommunicationSla = await this.findOneBy({
                name: data.name,
                projectId: data.projectId,
            });

            if (incidentCommunicationSla) {
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
                const monitorIds = [...data.monitors];
                for (const monitorId of monitorIds) {
                    await MonitorService.updateOneBy(
                        { _id: monitorId },
                        {
                            incidentCommunicationSla:
                                createdIncidentCommunicationSla._id,
                        }
                    );
                }
            }

            return createdIncidentCommunicationSla;
        } catch (error) {
            ErrorService.log('incidentCommunicationSlaService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const incidentCommunicationSla = await IncidentCommunicationSlaModel.findOne(
                query
            )
                .populate('projectId')
                .lean();

            return incidentCommunicationSla;
        } catch (error) {
            ErrorService.log(
                'incidentCommunicationSlaService.findOneBy',
                error
            );
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const incidentCommunicationSla = await IncidentCommunicationSlaModel.find(
                query
            )
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId');

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
                    name: data.name,
                    projectId: query.projectId,
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
                    incidentCommunicationSla: query._id,
                });
                const initialMonitorIds = monitors.map(monitor => monitor._id);

                const removedMonitors = [];
                if (data.monitors && data.monitors.length > 0) {
                    let monitorIds = [...data.monitors];
                    monitorIds = monitorIds.map(id => String(id));
                    initialMonitorIds.forEach(monitorId => {
                        if (!monitorIds.includes(String(monitorId))) {
                            removedMonitors.push(monitorId);
                        }
                    });
                    for (const monitorId of monitorIds) {
                        await MonitorService.updateOneBy(
                            { _id: monitorId },
                            {
                                incidentCommunicationSla: query._id,
                            }
                        );
                    }
                } else {
                    // unset incidentCommunicationSla for removed monitors
                    // at this point all the monitors were removed
                    for (const monitorId of initialMonitorIds) {
                        await MonitorService.updateOneBy(
                            { _id: monitorId },
                            null,
                            { incidentCommunicationSla: query._id }
                        );
                    }
                }

                // unset incidentCommunicationSla for removed monitors
                if (removedMonitors && removedMonitors.length > 0) {
                    for (const monitorId of removedMonitors) {
                        await MonitorService.updateOneBy(
                            { _id: monitorId },
                            null,
                            { incidentCommunicationSla: query._id }
                        );
                    }
                }
            }

            let incidentSla;
            if (data.isDefault) {
                incidentSla = await this.findOneBy({
                    projectId: query.projectId,
                    isDefault: true,
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

            updatedIncidentCommunicationSla = await updatedIncidentCommunicationSla
                .populate('projectId')
                .execPopulate();

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

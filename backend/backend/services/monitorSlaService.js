const MonitorSlaModel = require('../models/monitorSla');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const monitorSla = await this.findOneBy({
                name: data.name,
                projectId: data.projectId,
            });
            if (monitorSla) {
                const error = new Error(
                    'Monitor SLA with the same name already exist'
                );
                error.code = 400;
                throw error;
            }

            if (data.isDefault) {
                // automatically set isDefault to false
                // for any previous SLA with a default status
                await MonitorSlaModel.findOneAndUpdate(
                    {
                        projectId: data.projectId,
                        isDefault: true,
                    },
                    { $set: { isDefault: false } }
                );
            }

            const createdMonitorSla = await MonitorSlaModel.create(data);

            return createdMonitorSla;
        } catch (error) {
            ErrorService.log('monitorSlaService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const monitorSla = await MonitorSlaModel.findOne(query)
                .populate('projectId')
                .lean();

            return monitorSla;
        } catch (error) {
            ErrorService.log('monitorSlaService.findOneBy', error);
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

            const monitorSla = await MonitorSlaModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId');

            return monitorSla;
        } catch (error) {
            ErrorService.log('monitorSlaService.findBy', error);
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
                const monitorSla = await this.findOneBy({
                    name: data.name,
                    projectId: query.projectId,
                });

                if (
                    monitorSla &&
                    String(monitorSla._id) !== String(query._id)
                ) {
                    const error = new Error(
                        'Monitor SLA with the same name already exist'
                    );
                    error.code = 400;
                    throw error;
                }
            }

            let monitorSla;
            if (data.isDefault) {
                monitorSla = await this.findOneBy({
                    projectId: query.projectId,
                    isDefault: true,
                });
            }

            if (monitorSla && String(monitorSla._id) !== String(query._id)) {
                await MonitorSlaModel.findOneAndUpdate(
                    { _id: monitorSla._id },
                    { $set: { isDefault: false } }
                );
            }

            let updatedMonitorSla = await MonitorSlaModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (!updatedMonitorSla) {
                const error = new Error(
                    'Monitor SLA not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            updatedMonitorSla = await updatedMonitorSla
                .populate('projectId')
                .execPopulate();

            return updatedMonitorSla;
        } catch (error) {
            ErrorService.log('monitorSlaService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const deletedSla = await MonitorSlaModel.findOneAndUpdate(
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
            ErrorService.log('monitorSlaService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await MonitorSlaModel.deleteMany(query);
            return 'Monitor SLA(s) deleted successfully';
        } catch (error) {
            ErrorService.log('monitorSlaService.hardDelete', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await MonitorSlaModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('monitorSlaService.countBy', error);
            throw error;
        }
    },
};

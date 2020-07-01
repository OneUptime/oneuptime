const ContainerSecurityLogModel = require('../models/containerSecurityLog');
const ErrorService = require('./errorService');

module.exports = {
    create: async function({ securityId, componentId, data }) {
        try {
            if (!securityId) {
                const error = new Error('Security ID is required');
                error.code = 400;
                ErrorService.log('containerSecurityLogService.create', error);
                throw error;
            }

            if (!componentId) {
                const error = new Error('Component ID is required');
                error.code = 400;
                ErrorService.log('containerSecurityLogService.create', error);
                throw error;
            }

            if (!data) {
                const error = new Error('Please provide a scan log');
                error.code = 400;
                ErrorService.log('containerSecurityLogService.create', error);
                throw error;
            }

            let securityLog = await this.findOneBy({ securityId });

            if (!securityLog) {
                securityLog = await ContainerSecurityLogModel.create({
                    securityId,
                    componentId,
                    data,
                });
            } else {
                securityLog = await this.updateOneBy(
                    { _id: securityLog._id },
                    data
                );
            }

            return securityLog;
        } catch (error) {
            ErrorService.log('containerSecurityLogService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const securityLog = await ContainerSecurityLogModel.findOne(query)
                .populate('securityId')
                .populate('componentId');

            return securityLog;
        } catch (error) {
            ErrorService.log('containerSecurityLogService.findOneBy', error);
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

            const securityLogs = await ContainerSecurityLogModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId')
                .populate('securityId');

            return securityLogs;
        } catch (error) {
            ErrorService.log('containerSecurityLogService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const containerSecurityLog = ContainerSecurityLogModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (!containerSecurityLog) {
                const error = new Error(
                    'Container Security Log not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return containerSecurityLog;
        } catch (error) {
            ErrorService.log('containerSecurityLogService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let securityLog = this.findOneBy(query);

            if (!securityLog) {
                const error = new Error(
                    'Container Security Log not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            securityLog = this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            return securityLog;
        } catch (error) {
            ErrorService.log('containerSecurityLogService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await ContainerSecurityLogModel.deleteMany(query);
            return 'Container Security logs deleted successfully';
        } catch (error) {
            ErrorService.log('containerSecurityLogService.hardDelete', error);
            throw error;
        }
    },
};

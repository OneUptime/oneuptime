const ContainerSecurityModel = require('../models/containerSecurity');
const ErrorService = require('./errorService');
const moment = require('moment');
const { decrypt } = require('../config/encryptDecrypt');
const ContainerSecurityLogService = require('./containerSecurityLogService');
const DockerCredentialService = require('./dockerCredentialService');

module.exports = {
    create: async function(data) {
        try {
            const containerNameExist = await this.findOneBy({
                name: data.name,
                componentId: data.componentId,
            });
            const imagePathExist = await this.findOneBy({
                imagePath: data.imagePath,
                componentId: data.componentId,
            });
            const dockerCredentialExist = await DockerCredentialService.findOneBy(
                { _id: data.dockerCredential }
            );

            if (containerNameExist) {
                const error = new Error(
                    'Container security with this name already exist in this component'
                );
                error.code = 400;
                throw error;
            }

            if (imagePathExist) {
                const error = new Error(
                    'Container security with this image path already exist in this component'
                );
                error.code = 400;
                throw error;
            }

            if (!dockerCredentialExist) {
                const error = new Error(
                    'Docker Credential not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const containerSecurity = await ContainerSecurityModel.create(data);
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const containerSecurity = await ContainerSecurityModel.findOne(
                query
            )
                .populate('componentId')
                .populate('dockerCredential');

            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.findOneBy', error);
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

            const containerSecurities = await ContainerSecurityModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId')
                .populate('dockerCredential');

            return containerSecurities;
        } catch (error) {
            ErrorService.log('containerSecurityService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const containerSecurity = await ContainerSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            ).populate('dockerCredential');

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let containerSecurity = await this.findOneBy(query);

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const securityLog = await ContainerSecurityLogService.findOneBy({
                securityId: containerSecurity._id,
            });

            if (securityLog) {
                await ContainerSecurityLogService.deleteBy({
                    _id: securityLog._id,
                });
            }

            containerSecurity = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await ContainerSecurityModel.deleteMany(query);
            return 'Container Securities deleted successfully';
        } catch (error) {
            ErrorService.log('containerSecurityService.hardDelete', error);
            throw error;
        }
    },
    getSecuritiesToScan: async function() {
        try {
            const oneDay = moment()
                .subtract(1, 'days')
                .toDate();
            const securities = await this.findBy({
                $or: [{ lastScan: { $lt: oneDay } }, { scanned: false }],
            });
            return securities;
        } catch (error) {
            ErrorService.log(
                'containerSecurityService.getSecuritiesToScan',
                error
            );
            throw error;
        }
    },
    decryptPassword: async function(security) {
        try {
            security.dockerCredential.dockerPassword = await decrypt(
                security.dockerCredential.dockerPassword
            );
            return security;
        } catch (error) {
            ErrorService.log('containerSecurityService.decryptPassword', error);
            throw error;
        }
    },
    updateScanTime: async function(query) {
        try {
            const newDate = new Date();
            const containerSecurity = await this.updateOneBy(query, {
                lastScan: newDate,
                scanned: true,
            });
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.updateScanTime', error);
            throw error;
        }
    },
};

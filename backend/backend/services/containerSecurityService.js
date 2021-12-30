const ContainerSecurityModel = require('../models/containerSecurity');
const ErrorService = require('./errorService');
const moment = require('moment');
const { decrypt } = require('../config/encryptDecrypt');
const ContainerSecurityLogService = require('./containerSecurityLogService');
const DockerCredentialService = require('./dockerCredentialService');
const ResourceCategoryService = require('./resourceCategoryService');
const getSlug = require('../utils/getSlug');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const RealTimeService = require('./realTimeService');

module.exports = {
    create: async function(data) {
        try {
            const [
                containerNameExist,
                imagePathExist,
                dockerCredentialExist,
            ] = await Promise.all([
                this.findOneBy({
                    query: { name: data.name, componentId: data.componentId },
                    select: '_id',
                }),
                this.findOneBy({
                    query: {
                        imagePath: data.imagePath,
                        componentId: data.componentId,
                    },
                    select: '_id',
                }),
                DockerCredentialService.findOneBy({
                    query: { _id: data.dockerCredential },
                    select: '_id',
                }),
            ]);

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
            const resourceCategoryCount = await ResourceCategoryService.countBy(
                {
                    _id: data.resourceCategory,
                }
            );
            if (!resourceCategoryCount || resourceCategoryCount === 0) {
                delete data.resourceCategory;
            }
            data.slug = getSlug(data.name);
            const containerSecurity = await ContainerSecurityModel.create(data);
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            // won't be using lean() here because of iv cypher for password
            let containerSecurityQuery = ContainerSecurityModel.findOne(query);
            containerSecurityQuery = handleSelect(
                select,
                containerSecurityQuery
            );
            containerSecurityQuery = handlePopulate(
                populate,
                containerSecurityQuery
            );

            const containerSecurity = await containerSecurityQuery;
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            // won't be using lean() here because of iv cypher for password
            let containerSecurityQuery = ContainerSecurityModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            containerSecurityQuery = handleSelect(
                select,
                containerSecurityQuery
            );
            containerSecurityQuery = handlePopulate(
                populate,
                containerSecurityQuery
            );

            const containerSecurities = await containerSecurityQuery;
            return containerSecurities;
        } catch (error) {
            ErrorService.log('containerSecurityService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, unsetData = null) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            // The received value from probe service is '{ scanning: true }'
            if (data && data.name) {
                data.slug = getSlug(data.name);
            }

            let containerSecurity = await ContainerSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (unsetData) {
                containerSecurity = await ContainerSecurityModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const populate = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select:
                        'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            containerSecurity = this.findOneBy({
                query: { _id: containerSecurity._id },
                select,
                populate,
            });
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let containerSecurity = await this.findOneBy({
                query,
                select: '_id',
            });

            if (!containerSecurity) {
                const error = new Error(
                    'Container Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const securityLog = await ContainerSecurityLogService.findOneBy({
                query: { securityId: containerSecurity._id },
                select: '_id',
            });

            if (securityLog) {
                await ContainerSecurityLogService.deleteBy({
                    _id: securityLog._id,
                });
            }

            await this.updateOneBy(query, {
                deleted: true,
                deleteAt: Date.now(),
            });

            containerSecurity = await this.findOneBy({
                query: { ...query, deleted: true },
                select: '_id name slug',
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
            const populate = [
                { path: 'componentId', select: 'name slug _id' },
                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'dockerCredential',
                    select:
                        'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
                },
            ];
            const select =
                'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
            const securities = await this.findBy({
                query: {
                    $or: [{ lastScan: { $lt: oneDay } }, { scanned: false }],
                    scanning: false,
                },
                select,
                populate,
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
            const values = [];
            for (let i = 0; i <= 15; i++)
                values.push(security.dockerCredential.iv[i]);
            const iv = Buffer.from(values);
            security.dockerCredential.dockerPassword = await decrypt(
                security.dockerCredential.dockerPassword,
                iv
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
                scanning: false,
            });

            try {
                RealTimeService.handleScanning({ security: containerSecurity });
            } catch (error) {
                ErrorService.log('realtimeService.handleScanning', error);
            }
            return containerSecurity;
        } catch (error) {
            ErrorService.log('containerSecurityService.updateScanTime', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await ContainerSecurityModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('containerSecurityService.countBy', error);
            throw error;
        }
    },
};

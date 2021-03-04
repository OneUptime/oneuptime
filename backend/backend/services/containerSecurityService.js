const ContainerSecurityModel = require('../models/containerSecurity');
const ErrorService = require('./errorService');
const moment = require('moment');
const generate = require('nanoid/generate');
const slugify = require('slugify');
const { decrypt } = require('../config/encryptDecrypt');
const ContainerSecurityLogService = require('./containerSecurityLogService');
const DockerCredentialService = require('./dockerCredentialService');
const ResourceCategoryService = require('./resourceCategoryService');

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
            const resourceCategory = await ResourceCategoryService.findBy({
                _id: data.resourceCategory,
            });
            if (!resourceCategory) {
                delete data.resourceCategory;
            }
            let name = data.name;
            name = slugify(name);
            name = `${name}-${generate('1234567890', 8)}`;
            data.slug = name.toLowerCase();
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
                .populate('resourceCategory', 'name')
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
                .populate('resourceCategory', 'name')
                .populate('dockerCredential');

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
            let name = data.name;
            name = slugify(name);
            name = `${name}-${generate('1234567890', 8)}`;
            data.slug = name.toLowerCase();
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

            containerSecurity = this.findOneBy({
                _id: containerSecurity._id,
            });
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

            await this.updateOneBy(query, {
                deleted: true,
                deleteAt: Date.now(),
            });

            containerSecurity = await this.findOneBy({
                ...query,
                deleted: true,
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
                scanning: false,
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
            global.io.emit(
                `security_${containerSecurity._id}`,
                containerSecurity
            );
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

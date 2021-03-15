const ApplicationSecurityModel = require('../models/applicationSecurity');
const ErrorService = require('./errorService');
const moment = require('moment');
const generate = require('nanoid/generate');
const slugify = require('slugify');
const { decrypt } = require('../config/encryptDecrypt');
const ApplicationSecurityLogService = require('./applicationSecurityLogService');
const GitCredentialService = require('./gitCredentialService');
const ResourceCategoryService = require('./resourceCategoryService');

module.exports = {
    create: async function(data) {
        try {
            const applicationNameExist = await this.findOneBy({
                name: data.name,
                componentId: data.componentId,
            });
            const gitRepositoryUrlExist = await this.findOneBy({
                gitRepositoryUrl: data.gitRepositoryUrl,
                componentId: data.componentId,
            });
            const gitCredentialExist = await GitCredentialService.findOneBy({
                _id: data.gitCredential,
            });

            if (applicationNameExist) {
                const error = new Error(
                    'Application security with this name already exist in this component'
                );
                error.code = 400;
                throw error;
            }

            if (gitRepositoryUrlExist) {
                const error = new Error(
                    'Application security with this git repository url already exist in this component'
                );
                error.code = 400;
                throw error;
            }

            if (!gitCredentialExist) {
                const error = new Error(
                    'Git Credential not found or does not exist'
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
            const applicationSecurity = await ApplicationSecurityModel.create(
                data
            );
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const applicationSecurity = await ApplicationSecurityModel.findOne(
                query
            )
                .populate('componentId')
                .populate('resourceCategory', 'name')
                .populate('gitCredential');

            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.findOneBy', error);
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

            const applicationSecurities = await ApplicationSecurityModel.find(
                query
            )
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('componentId')
                .populate('resourceCategory', 'name')
                .populate('gitCredential');

            return applicationSecurities;
        } catch (error) {
            ErrorService.log('applicationSecurityService.findBy', error);
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
            let applicationSecurity = await ApplicationSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            ).populate('gitCredential');

            if (unsetData) {
                applicationSecurity = await ApplicationSecurityModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }
            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            applicationSecurity = this.findOneBy({
                _id: applicationSecurity._id,
            });
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let applicationSecurity = await this.findOneBy(query);

            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const securityLog = await ApplicationSecurityLogService.findOneBy({
                securityId: applicationSecurity._id,
            });

            // delete log associated with this application security
            if (securityLog) {
                await ApplicationSecurityLogService.deleteBy({
                    _id: securityLog._id,
                });
            }

            await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            applicationSecurity = await this.findOneBy({
                ...query,
                deleted: true,
            });
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await ApplicationSecurityModel.deleteMany(query);
            return 'Application Securities deleted successfully';
        } catch (error) {
            ErrorService.log('applicationSecurityService.hardDelete', error);
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
                'applicationSecurityService.getSecuritiesToScan',
                error
            );
            throw error;
        }
    },
    decryptPassword: async function(security) {
        try {
            const values = [];
            for (let i = 0; i <= 15; i++)
                values.push(security.gitCredential.iv[i]);
            const iv = Buffer.from(values);
            security.gitCredential.gitPassword = await decrypt(
                security.gitCredential.gitPassword,
                iv
            );
            return security;
        } catch (error) {
            ErrorService.log(
                'applicatioinSecurityService.decryptPassword',
                error
            );
            throw error;
        }
    },
    updateScanTime: async function(query) {
        try {
            const newDate = new Date();
            const applicationSecurity = await this.updateOneBy(query, {
                lastScan: newDate,
                scanned: true,
                scanning: false,
            });
            global.io.emit(
                `security_${applicationSecurity._id}`,
                applicationSecurity
            );
            return applicationSecurity;
        } catch (error) {
            ErrorService.log(
                'applicationSecurityService.updateScanTime',
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
            const count = await ApplicationSecurityModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('applicationSecurityService.countBy', error);
            throw error;
        }
    },
};

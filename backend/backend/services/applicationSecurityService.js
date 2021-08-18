const ApplicationSecurityModel = require('../models/applicationSecurity');
const ErrorService = require('./errorService');
const moment = require('moment');
const { decrypt } = require('../config/encryptDecrypt');
const ApplicationSecurityLogService = require('./applicationSecurityLogService');
const GitCredentialService = require('./gitCredentialService');
const ResourceCategoryService = require('./resourceCategoryService');
const getSlug = require('../utils/getSlug');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const RealTimeService = require('./realTimeService');

module.exports = {
    create: async function(data) {
        try {
            const [
                applicationNameExist,
                gitRepositoryUrlExist,
                gitCredentialExist,
            ] = await Promise.all([
                this.findOneBy({
                    query: { name: data.name, componentId: data.componentId },
                    select: '_id',
                }),
                this.findOneBy({
                    query: {
                        gitRepositoryUrl: data.gitRepositoryUrl,
                        componentId: data.componentId,
                    },
                    select: '_id',
                }),
                GitCredentialService.findOneBy({
                    query: { _id: data.gitCredential },
                    select: '_id',
                }),
            ]);

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
            const resourceCategoryCount = await ResourceCategoryService.countBy(
                {
                    _id: data.resourceCategory,
                }
            );
            if (!resourceCategoryCount || resourceCategoryCount === 0) {
                delete data.resourceCategory;
            }
            data.slug = getSlug(data.name);
            const applicationSecurity = await ApplicationSecurityModel.create(
                data
            );
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, populate, select }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            // won't be using lean() here because of iv cypher for password
            let applicationSecurityQuery = ApplicationSecurityModel.findOne(
                query
            );

            applicationSecurityQuery = handleSelect(
                select,
                applicationSecurityQuery
            );

            applicationSecurityQuery = handlePopulate(
                populate,
                applicationSecurityQuery
            );

            const applicationSecurity = await applicationSecurityQuery;
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.findOneBy', error);
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

            // won't be using lean() here because of iv cypher for password
            let applicationSecuritiesQuery = ApplicationSecurityModel.find(
                query
            )
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            applicationSecuritiesQuery = handleSelect(
                select,
                applicationSecuritiesQuery
            );
            applicationSecuritiesQuery = handlePopulate(
                populate,
                applicationSecuritiesQuery
            );

            const applicationSecurities = await applicationSecuritiesQuery;
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
            if (data && data.name) {
                data.slug = getSlug(data.name);
            }
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

            const populateApplicationSecurity = [
                { path: 'componentId', select: '_id slug name slug' },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            applicationSecurity = this.findOneBy({
                query: { _id: applicationSecurity._id },
                populate: populateApplicationSecurity,
                select: selectApplicationSecurity,
            });
            return applicationSecurity;
        } catch (error) {
            ErrorService.log('applicationSecurityService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let applicationSecurity = await this.countBy(query);

            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            const securityLog = await ApplicationSecurityLogService.findOneBy({
                query: { securityId: applicationSecurity._id },
                select: '_id',
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

            const populateApplicationSecurity = [
                { path: 'componentId', select: '_id slug name slug' },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            applicationSecurity = await this.findOneBy({
                query: { ...query, deleted: true },
                populate: populateApplicationSecurity,
                select: selectApplicationSecurity,
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

            const populateApplicationSecurity = [
                {
                    path: 'componentId',
                    select: '_id slug name slug',
                },

                { path: 'resourceCategory', select: 'name' },
                {
                    path: 'gitCredential',
                    select: 'gitUsername gitPassword iv projectId deleted',
                },
            ];

            const selectApplicationSecurity =
                '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

            const securities = await this.findBy({
                query: {
                    $or: [{ lastScan: { $lt: oneDay } }, { scanned: false }],
                    scanning: false,
                },
                select: selectApplicationSecurity,
                populate: populateApplicationSecurity,
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

            RealTimeService.handleScanning({ security: applicationSecurity });
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

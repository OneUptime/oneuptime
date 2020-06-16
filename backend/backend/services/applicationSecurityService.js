const ApplicationSecurityModel = require('../models/applicationSecurity');
const ErrorService = require('./errorService');
const moment = require('moment');
const { decrypt } = require('../config/encryptDecrypt');
const ApplicationSecurityLogService = require('./applicationSecurityLogService');

module.exports = {
    create: async function(data) {
        try {
            const applicationNameExist = await this.findOneBy({
                name: data.name,
            });

            if (applicationNameExist) {
                const error = new Error(
                    'Application security with this name already exist'
                );
                error.code = 400;
                throw error;
            }

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
                .populate('gitCredential');

            return applicationSecurities;
        } catch (error) {
            ErrorService.log('applicationSecurityService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const applicationSecurity = await ApplicationSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );

            if (!applicationSecurity) {
                const error = new Error(
                    'Application Security not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

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

            applicationSecurity = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
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
            security.gitCredential.gitPassword = await decrypt(
                security.gitCredential.gitPassword
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
            });
            return applicationSecurity;
        } catch (error) {
            ErrorService.log(
                'applicationSecurityService.updateScanTime',
                error
            );
            throw error;
        }
    },
};

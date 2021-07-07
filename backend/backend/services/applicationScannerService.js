module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let applicationScannerKey;
            if (data.applicationScannerKey) {
                applicationScannerKey = data.applicationScannerKey;
            } else {
                applicationScannerKey = uuidv1();
            }
            const storedApplicationScanner = await _this.findOneBy({
                applicationScannerName: data.applicationScannerName,
            });
            if (
                storedApplicationScanner &&
                storedApplicationScanner.applicationScannerName
            ) {
                const error = new Error(
                    'applicationScanner name already exists.'
                );
                error.code = 400;
                ErrorService.log('applicationScanner.create', error);
                throw error;
            } else {
                const applicationScanner = new ApplicationScannerModel();
                applicationScanner.applicationScannerKey = applicationScannerKey;
                applicationScanner.applicationScannerName =
                    data.applicationScannerName;
                applicationScanner.version = data.applicationScannerVersion;
                const savedApplicationScanner = await applicationScanner.save();
                return savedApplicationScanner;
            }
        } catch (error) {
            ErrorService.log('applicationScannerService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const applicationScanner = await ApplicationScannerModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return applicationScanner;
        } catch (error) {
            ErrorService.log('applicationScannerService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const applicationScanner = await ApplicationScannerModel.findOne(
                query,
                {
                    deleted: false,
                }
            ).lean();
            return applicationScanner;
        } catch (error) {
            ErrorService.log('applicationScannerService.findOneBy', error);
            throw error;
        }
    },

    updateApplicationScannerStatus: async function(applicationScannerId) {
        try {
            const applicationScanner = await ApplicationScannerModel.findOneAndUpdate(
                { _id: applicationScannerId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
            return applicationScanner;
        } catch (error) {
            ErrorService.log(
                'applicationScannerService.updateApplicationScannerStatus',
                error
            );
            throw error;
        }
    },
};

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

const ApplicationScannerModel = require('../models/applicationScanner');
const ErrorService = require('./errorService');
const uuidv1 = require('uuid/v1');


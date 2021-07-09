module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let containerScannerKey;
            if (data.containerScannerKey) {
                containerScannerKey = data.containerScannerKey;
            } else {
                containerScannerKey = uuidv1();
            }
            const storedContainerScanner = await _this.findOneBy({
                containerScannerName: data.containerScannerName,
            });
            if (
                storedContainerScanner &&
                storedContainerScanner.containerScannerName
            ) {
                const error = new Error(
                    'containerScanner name already exists.'
                );
                error.code = 400;
                ErrorService.log('containerScanner.create', error);
                throw error;
            } else {
                const containerScanner = new ContainerScannerModel();
                containerScanner.containerScannerKey = containerScannerKey;
                containerScanner.containerScannerName =
                    data.containerScannerName;
                containerScanner.version = data.containerScannerVersion;
                const savedContainerScanner = await containerScanner.save();
                return savedContainerScanner;
            }
        } catch (error) {
            ErrorService.log('containerScannerService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const containerScanner = await ContainerScannerModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return containerScanner;
        } catch (error) {
            ErrorService.log('containerScannerService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const containerScanner = await ContainerScannerModel.findOne(
                query,
                {
                    deleted: false,
                }
            ).lean();
            return containerScanner;
        } catch (error) {
            ErrorService.log('containerScannerService.findOneBy', error);
            throw error;
        }
    },

    updateContainerScannerStatus: async function(containerScannerId) {
        try {
            const containerScanner = await ContainerScannerModel.findOneAndUpdate(
                { _id: containerScannerId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
            return containerScanner;
        } catch (error) {
            ErrorService.log(
                'containerScannerService.updateContainerScannerStatus',
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

const ContainerScannerModel = require('../models/containerScanner');
const ErrorService = require('./errorService');
const uuidv1 = require('uuid/v1');

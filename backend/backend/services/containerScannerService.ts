export default {
    create: async function(data) {
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
            const error = new Error('containerScanner name already exists.');

            error.code = 400;
            throw error;
        } else {
            const containerScanner = new ContainerScannerModel();

            containerScanner.containerScannerKey = containerScannerKey;

            containerScanner.containerScannerName = data.containerScannerName;

            containerScanner.version = data.containerScannerVersion;
            const savedContainerScanner = await containerScanner.save();
            return savedContainerScanner;
        }
    },

    updateOneBy: async function(query, data) {
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
    },

    findOneBy: async function(query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const containerScanner = await ContainerScannerModel.findOne(
            query
        ).lean();
        return containerScanner;
    },

    updateContainerScannerStatus: async function(containerScannerId) {
        const containerScanner = await ContainerScannerModel.findOneAndUpdate(
            { _id: containerScannerId },
            { $set: { lastAlive: Date.now() } },
            { new: true }
        );
        return containerScanner;
    },
};

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

import ContainerScannerModel from '../models/containerScanner';

import { v1 as uuidv1 } from 'uuid';

export default class Service {
    async create(data) {
        let containerScannerKey;
        if (data.containerScannerKey) {
            containerScannerKey = data.containerScannerKey;
        } else {
            containerScannerKey = uuidv1();
        }
        const storedContainerScanner = await this.findOneBy({
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
    }

    async updateOneBy(query, data) {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const containerScanner = await ContainerScannerModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );
        return containerScanner;
    }

    async findOneBy(query) {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const containerScanner = await ContainerScannerModel.findOne(
            query
        ).lean();
        return containerScanner;
    }

    async updateContainerScannerStatus(containerScannerId) {
        const containerScanner = await ContainerScannerModel.findOneAndUpdate(
            { _id: containerScannerId },
            { $set: { lastAlive: Date.now() } },
            { new: true }
        );
        return containerScanner;
    }
}

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

import ContainerScannerModel from '../Models/containerScanner';

import { v1 as uuidv1 } from 'uuid';

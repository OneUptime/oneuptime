export default class Service {
    public async create(data: $TSFixMe): void {
        let containerScannerKey: $TSFixMe;
        if (data.containerScannerKey) {
            containerScannerKey = data.containerScannerKey;
        } else {
            containerScannerKey = uuidv1();
        }
        const storedContainerScanner: $TSFixMe = await this.findOneBy({
            containerScannerName: data.containerScannerName,
        });
        if (
            storedContainerScanner &&
            storedContainerScanner.containerScannerName
        ) {
            throw new BadDataException('containerScanner name already exists.');
        } else {
            const containerScanner: $TSFixMe = new ContainerScannerModel();

            containerScanner.containerScannerKey = containerScannerKey;

            containerScanner.containerScannerName = data.containerScannerName;

            containerScanner.version = data.containerScannerVersion;
            const savedContainerScanner: $TSFixMe =
                await containerScanner.save();
            return savedContainerScanner;
        }
    }

    public async updateOneBy(query, data): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const containerScanner: $TSFixMe =
            await ContainerScannerModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
        return containerScanner;
    }

    public async findOneBy(query: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const containerScanner: $TSFixMe = await ContainerScannerModel.findOne(
            query
        ).lean();
        return containerScanner;
    }

    public async updateContainerScannerStatus(
        containerScannerId: $TSFixMe
    ): void {
        const containerScanner: $TSFixMe =
            await ContainerScannerModel.findOneAndUpdate(
                { _id: containerScannerId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
        return containerScanner;
    }
}

/**
 * Verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

import ContainerScannerModel from '../Models/containerScanner';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { v1 as uuidv1 } from 'uuid';

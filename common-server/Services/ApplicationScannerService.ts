export default class Service {
    async create(data) {
        let applicationScannerKey;
        if (data.applicationScannerKey) {
            applicationScannerKey = data.applicationScannerKey;
        } else {
            applicationScannerKey = uuidv1();
        }

        const storedApplicationScanner = await this.findOneBy({
            query: { applicationScannerName: data.applicationScannerName },
            select: 'applicationScannerName',
        });
        if (
            storedApplicationScanner &&
            storedApplicationScanner.applicationScannerName
        ) {
            const error = new Error('applicationScanner name already exists.');

            error.code = 400;
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
    }

    async updateOneBy(query: Query, data) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const applicationScanner =
            await ApplicationScannerModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
        return applicationScanner;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const applicationScannerQuery = ApplicationScannerModel.findOne(query)
            .sort(sort)
            .lean();

        applicationScannerQuery.select(select);
        applicationScannerQuery.populate(populate);
        const applicationScanner = await applicationScannerQuery;
        return applicationScanner;
    }

    async updateApplicationScannerStatus(applicationScannerId: string) {
        const applicationScanner =
            await ApplicationScannerModel.findOneAndUpdate(
                { _id: applicationScannerId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
        return applicationScanner;
    }
}

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

import ApplicationScannerModel from '../Models/applicationScanner';

import { v1 as uuidv1 } from 'uuid';

import FindOneBy from '../Types/DB/FindOneBy';
import Query from '../Types/DB/Query';

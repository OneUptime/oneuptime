export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    create: async function(data) {
        const _this = this;
        let applicationScannerKey;
        if (data.applicationScannerKey) {
            applicationScannerKey = data.applicationScannerKey;
        } else {
            applicationScannerKey = uuidv1();
        }

        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { applicationScannerNam... Remove this comment to see the full error message
        const storedApplicationScanner = await _this.findOneBy({
            query: { applicationScannerName: data.applicationScannerName },
            select: 'applicationScannerName',
        });
        if (
            storedApplicationScanner &&
            storedApplicationScanner.applicationScannerName
        ) {
            const error = new Error('applicationScanner name already exists.');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        } else {
            const applicationScanner = new ApplicationScannerModel();
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationScannerKey' does not exist on... Remove this comment to see the full error message
            applicationScanner.applicationScannerKey = applicationScannerKey;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'applicationScannerName' does not exist o... Remove this comment to see the full error message
            applicationScanner.applicationScannerName =
                data.applicationScannerName;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type 'Documen... Remove this comment to see the full error message
            applicationScanner.version = data.applicationScannerVersion;
            const savedApplicationScanner = await applicationScanner.save();
            return savedApplicationScanner;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    updateOneBy: async function(query, data) {
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
    },

    // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'query' implicitly has an 'any' ty... Remove this comment to see the full error message
    findOneBy: async function({ query, select, populate }) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let applicationScannerQuery = ApplicationScannerModel.findOne(
            query
        ).lean();

        applicationScannerQuery = handleSelect(select, applicationScannerQuery);
        applicationScannerQuery = handlePopulate(
            populate,
            applicationScannerQuery
        );
        const applicationScanner = await applicationScannerQuery;
        return applicationScanner;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'applicationScannerId' implicitly has an... Remove this comment to see the full error message
    updateApplicationScannerStatus: async function(applicationScannerId) {
        const applicationScanner = await ApplicationScannerModel.findOneAndUpdate(
            { _id: applicationScannerId },
            { $set: { lastAlive: Date.now() } },
            { new: true }
        );
        return applicationScanner;
    },
};

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

import ApplicationScannerModel from '../models/applicationScanner'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v1: uuidv1 } from 'uuid'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

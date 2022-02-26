export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        } else {
            const containerScanner = new ContainerScannerModel();
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerScannerKey' does not exist on t... Remove this comment to see the full error message
            containerScanner.containerScannerKey = containerScannerKey;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'containerScannerName' does not exist on ... Remove this comment to see the full error message
            containerScanner.containerScannerName = data.containerScannerName;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'version' does not exist on type 'Documen... Remove this comment to see the full error message
            containerScanner.version = data.containerScannerVersion;
            const savedContainerScanner = await containerScanner.save();
            return savedContainerScanner;
        }
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'containerScannerId' implicitly has an '... Remove this comment to see the full error message
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

import ContainerScannerModel from '../models/containerScanner'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v1: uuidv1 } from 'uuid'

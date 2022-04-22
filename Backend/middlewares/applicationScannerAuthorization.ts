import ApplicationScannerService from '../Services/applicationScannerService';
import { sendErrorResponse } from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    ExpressResponse,
    ExpressRequest,
    NextFunction,
} from 'CommonServer/Utils/Express';
const CLUSTER_KEY: $TSFixMe = process.env.CLUSTER_KEY;
export default {
    isAuthorizedApplicationScanner: async function (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void {
        let applicationScannerKey: $TSFixMe,
            applicationScannerName: $TSFixMe,
            clusterKey: $TSFixMe,
            applicationScannerVersion: $TSFixMe;

        if (req.params && req.params['applicationscannerkey']) {
            applicationScannerKey = req.params['applicationscannerkey'];
        } else if (req.query && req.query['applicationScannerKey']) {
            applicationScannerKey = req.query['applicationscannerkey'];
        } else if (req.headers && req.headers['applicationscannerkey']) {
            applicationScannerKey = req.headers['applicationscannerkey'];
        } else if (req.body && req.body.applicationScannerKey) {
            applicationScannerKey = req.body.applicationScannerKey;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('applicationScanner Key not found.')
            );
        }

        if (req.params && req.params['applicationscannername']) {
            applicationScannerName = req.params['applicationscannername'];
        } else if (req.query && req.query['applicationscannername']) {
            applicationScannerName = req.query['applicationscannername'];
        } else if (req.headers && req.headers['applicationscannername']) {
            applicationScannerName = req.headers['applicationscannername'];
        } else if (req.body && req.body.applicationscannerName) {
            applicationScannerName = req.body.applicationscannername;
        } else {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('applicationScanner Name not found.')
            );
        }

        if (req.params && req.params['clusterKey']) {
            clusterKey = req.params['clusterKey'];
        } else if (req.query && req.query['clusterKey']) {
            clusterKey = req.query['clusterKey'];
        } else if (
            req.headers &&
            (req.headers['clusterkey'] || req.headers['clusterkey'])
        ) {
            // Header keys are automatically transformed to lowercase
            clusterKey = req.headers['clusterkey'] || req.headers['clusterkey'];
        } else if (req.body && req.body.clusterKey) {
            clusterKey = req.body.clusterKey;
        }

        if (req.params && req.params['applicationscannerversion']) {
            applicationScannerVersion = req.params['applicationscannerversion'];
        } else if (req.query && req.query['applicationscannerversion']) {
            applicationScannerVersion = req.query['applicationscannerversion'];
        } else if (req.headers && req.headers['applicationscannerversion']) {
            applicationScannerVersion =
                req.headers['applicationscannerversion'];
        } else if (req.body && req.body.applicationscannerversion) {
            applicationScannerVersion = req.body.applicationscannerversion;
        }

        let applicationScanner: $TSFixMe = null;

        if (clusterKey && clusterKey === CLUSTER_KEY) {
            /*
             * If cluster key matches then just query by applicationScanner name,
             * Because if the applicationScanner key does not match, we can update applicationScanner key later
             * Without updating mongodb database manually.
             */

            applicationScanner = await ApplicationScannerService.findOneBy({
                query: { applicationScannerName },
                select: '_id applicationScannerKey',
            });
        } else {
            applicationScanner = await ApplicationScannerService.findOneBy({
                query: { applicationScannerKey, applicationScannerName },
                select: '_id applicationScannerKey',
            });
        }

        if (
            !applicationScanner &&
            (!clusterKey || clusterKey !== CLUSTER_KEY)
        ) {
            return sendErrorResponse(req, res, {
                code: 400,
                message:
                    'applicationScanner key and applicationScanner name do not match.',
            });
        }

        if (!applicationScanner) {
            //Create a new applicationScanner.
            applicationScanner = await ApplicationScannerService.create({
                applicationScannerKey,
                applicationScannerName,
                applicationScannerVersion,
            });
        }

        if (
            applicationScanner.applicationScannerKey !== applicationScannerKey
        ) {
            //Update applicationScanner key becasue it does not match.
            await ApplicationScannerService.updateOneBy(
                {
                    applicationScannerName,
                },
                { applicationScannerKey }
            );
        }
        req.applicationScanner = {};
        req.applicationScanner.id = applicationScanner._id;

        const [applicationScannerValue]: $TSFixMe = await Promise.all([
            ApplicationScannerService.findOneBy({
                query: { applicationScannerKey, applicationScannerName },
                select: 'version',
            }),
            ApplicationScannerService.updateApplicationScannerStatus(
                applicationScanner._id
            ),
        ]);

        if (
            !applicationScannerValue.version ||
            applicationScannerValue.version !== applicationScannerVersion
        ) {
            await ApplicationScannerService.updateOneBy(
                {
                    applicationScannerName,
                },
                { version: applicationScannerVersion }
            );
        }

        return next();
    },
};

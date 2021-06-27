/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const ApplicationScannerService = require('../services/ApplicationScannerService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const ErrorService = require('../services/errorService');
const CLUSTER_KEY = process.env.CLUSTER_KEY;
module.exports = {
    isAuthorizedApplicationScanner: async function (req, res, next) {
        try {
            let applicationScannerKey, applicationScannerName, clusterKey, applicationScannerVersion;

            if (req.params.applicationscannerkey) {
                applicationScannerKey = req.params.applicationscannerkey;
            } else if (req.query.applicationScannerKey) {
                applicationScannerKey = req.query.applicationscannerkey;
            } else if (req.headers['applicationscannerkey']) {
                applicationScannerKey = req.headers['applicationscannerkey'];
            } else if (req.headers['applicationscannerkey']) {
                applicationScannerKey = req.headers['applicationscannerkey'];
            } else if (req.body.applicationScannerKey) {
                applicationScannerKey = req.body.applicationScannerKey;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'applicationScanner Key not found.',
                });
            }

            if (req.params.applicationscannername) {
                applicationScannerName = req.params.applicationscannername;
            } else if (req.query.applicationscannername) {
                applicationScannerName = req.query.applicationscannername;
            } else if (req.headers['applicationscannername']) {
                applicationScannerName = req.headers['applicationscannername'];
            } else if (req.headers['applicationscannername']) {
                applicationScannerName = req.headers['applicationscannername'];
            } else if (req.body.applicationscannerName) {
                applicationScannerName = req.body.applicationscannername;
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'applicationScanner Name not found.',
                });
            }

            if (req.params.clusterKey) {
                clusterKey = req.params.clusterkey;
            } else if (req.query.clusterKey) {
                clusterKey = req.query.clusterkey;
            } else if (req.headers['clusterKey']) {
                clusterKey = req.headers['clusterKey'];
            } else if (req.headers['clusterkey']) {
                clusterKey = req.headers['clusterkey'];
            } else if (req.body.clusterKey) {
                clusterKey = req.body.clusterKey;
            }

            if (req.params.applicationscannerversion) {
                applicationScannerVersion = req.params.applicationscannerversion;
            } else if (req.query.applicationscannerversion) {
                applicationScannerVersion = req.query.applicationscannerversion;
            } else if (req.headers['applicationscannerversion']) {
                applicationScannerVersion = req.headers['applicationscannerversion'];
            } else if (req.body.applicationscannerversion) {
                applicationScannerVersion = req.body.applicationscannerversion;
            }

            let applicationScanner = null;

            if (clusterKey && clusterKey === CLUSTER_KEY) {
                // if cluster key matches then just query by applicationScanner name,
                // because if the applicationScanner key does not match, we can update applicationScanner key later
                // without updating mongodb database manually.
                applicationScanner = await ApplicationScannerService.findOneBy({ applicationScannerName });
            } else {
                applicationScanner = await ApplicationScannerService.findOneBy({ applicationScannerKey, applicationScannerName });
            }

            if (!applicationScanner && (!clusterKey || clusterKey !== CLUSTER_KEY)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'applicationScanner key and applicationScanner name do not match.',
                });
            }

            if (!applicationScanner) {
                //create a new applicationScanner.
                applicationScanner = await ApplicationScannerService.create({
                    applicationScannerKey,
                    applicationScannerName,
                    applicationScannerVersion,
                });
            }

            if (applicationScanner.applicationScannerKey !== applicationScannerKey) {
                //update applicationScanner key becasue it does not match.
                await ApplicationScannerService.updateOneBy(
                    {
                        applicationScannerName,
                    },
                    { applicationScannerKey }
                );
            }
            req.applicationScanner = {};
            req.applicationScanner.id = applicationScanner._id;
            await ApplicationScannerService.updateApplicationScannerStatus(applicationScanner._id);

            //Update applicationScanner version
            const applicationScannerValue = await ApplicationScannerService.findOneBy({
                applicationScannerKey,
                applicationScannerName,
            });

            if (!applicationScannerValue.version || applicationScannerValue.version !== applicationScannerVersion) {
                await ApplicationScannerService.updateOneBy(
                    {
                        applicationScannerName,
                    },
                    { version: applicationScannerVersion }
                );
            }

            next();
        } catch (error) {
            ErrorService.log('applicationScannerAuthorization.isAuthorizedApplicationScanner', error);
            throw error;
        }
    },
};

/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const ApplicationScannerService = require('../services/applicationScannerService');
const ApplicationSecurityService = require('../services/applicationSecurityService');
const router = express.Router();

const isAuthorizedApplicationScanner = require('../middlewares/applicationScannerAuthorization')
    .isAuthorizedApplicationScanner;
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const getUser = require('../middlewares/user').getUser;
const { isAuthorized } = require('../middlewares/authorization');
const multer = require('multer');
const storage = require('../middlewares/upload');
// const MUTEX_RESOURCES = require('../constants/MUTEX_RESOURCES');
// const getMutex = require('../constants/mutexProvider');


// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put('/update/image', getUser, async function (req, res) {
    try {
        const upload = multer({
            storage,
        }).fields([
            {
                name: 'applicationScannerImage',
                maxCount: 1,
            },
        ]);
        upload(req, res, async function (error) {
            const applicationScannerId = req.body.id;
            const data = req.body;

            if (error) {
                return sendErrorResponse(req, res, error);
            }
            if (
                req.files &&
                req.files.applicationScannerImage &&
                req.files.applicationScannerImage[0].filename
            ) {
                data.applicationScannerImage = req.files.applicationScannerImage[0].filename;
            }

            // Call the ApplicationScannerService
            const save = await ApplicationScannerService.updateOneBy({ _id: applicationScannerId }, data);
            return sendItemResponse(req, res, save);
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});


router.get('/applicationSecurities', isAuthorizedApplicationScanner, async function (
    req,
    res
) {
    try {
        const response = await ApplicationSecurityService.getSecuritiesToScan();
        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/scan/git', isAuthorizedApplicationScanner, async function (req, res) {
    try {
        let { security } = req.body;

        security = await ApplicationSecurityService.decryptPassword(security);
        const securityLog = await ApplicationScannerService.scanApplicationSecurity(
            security
        );
        global.io.emit(`securityLog_${security._id}`, securityLog);
        return sendItemResponse(req, res, securityLog);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

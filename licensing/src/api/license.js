/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const express = require('express');
const router = express.Router();
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

const LicenseService = require('../services/licenseService');

router.post('/', async (req, res) => {
    try {
        const data = req.body;

        if (!data.license) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'License must be present.',
            });
        }

        if (typeof data.license !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'License is not in string format.',
            });
        }

        if (!data.email) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email must be present.',
            });
        }

        if (typeof data.email !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email is not in string format.',
            });
        }

        const item = await LicenseService.confirm({
            license: data.license,
            email: data.email,
            limit: data.limit || 100,
        });

        return sendItemResponse(req, res, item);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

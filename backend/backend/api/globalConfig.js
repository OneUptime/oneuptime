/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');

const router = express.Router();
const GlobalConfigService = require('../services/globalConfigService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const twilioService = require('../services/twilioService');

// Route Description: Creating global config(s).
// Body: [{name, value}] | {name, value}
// Return: [{name, value, createdAt}] | {name, value, createdAt}

router.post('/', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        let configs;

        if (Array.isArray(req.body)) {
            configs = req.body;
        } else {
            configs = [req.body];
        }

        const globalConfigs = [];

        // Sanitize
        for (const config of configs) {
            const { name, value } = config;

            if (!name) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Name must be present.',
                });
            }

            if (typeof name !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Name is not in string format.',
                });
            }

            if (
                !value &&
                name !== 'auditLogMonitoringStatus' &&
                name !== 'emailLogMonitoringStatus'
            ) {
                // Audit Log Status can be 'false'
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Value must be present.',
                });
            }
            if (name === 'twilio') {
                const data = {
                    accountSid: value['account-sid'],
                    authToken: value['authentication-token'],
                    phoneNumber: value['phone'],
                };
                await twilioService.test(data);
            }

            let globalConfig = await GlobalConfigService.findOneBy({ name });

            if (globalConfig) {
                globalConfig = await GlobalConfigService.updateOneBy(
                    { name },
                    { value }
                );
            } else {
                globalConfig = await GlobalConfigService.create({
                    name,
                    value,
                });
            }

            globalConfigs.unshift(globalConfig);
        }

        if (globalConfigs.length > 1) {
            return sendListResponse(req, res, globalConfigs);
        } else {
            return sendItemResponse(req, res, globalConfigs[0]);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route Description: Getting global configs.
// Params: [name];
// Return: [{name, value, createdAt}]

router.post('/configs', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        const names = req.body;

        const globalConfigs = await GlobalConfigService.findBy({
            name: { $in: names },
        });

        if (globalConfigs && globalConfigs.length > 0) {
            return sendListResponse(req, res, globalConfigs);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Global configs do not exists.',
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route Description: Getting global config by name.
// Params: {name};
// Return: {name, value, createdAt}

router.get('/:name', getUser, isUserMasterAdmin, async function(req, res) {
    try {
        let globalConfig = await GlobalConfigService.findOneBy({
            name: req.params.name,
        });
        // If audit logs status was fetched and it doesnt exist, we need to create it
        if (!globalConfig && req.params.name === 'auditLogMonitoringStatus') {
            const auditLogConfig = {
                name: 'auditLogMonitoringStatus',
                value: true,
            };
            await GlobalConfigService.create(auditLogConfig);
        }

        // If email logs status was fetched and it doesnt exist, we need to create it
        if (!globalConfig && req.params.name === 'emailLogMonitoringStatus') {
            const emailLogConfig = {
                name: 'emailLogMonitoringStatus',
                value: true,
            };
            await GlobalConfigService.create(emailLogConfig);
        }

        // If SMS logs status was fetched and it doesnt exist, we need to create it
        if (!globalConfig && req.params.name === 'smsLogMonitoringStatus') {
            const smsLogConfig = {
                name: 'smsLogMonitoringStatus',
                value: true,
            };
            await GlobalConfigService.create(smsLogConfig);
        }
        globalConfig = await GlobalConfigService.findOneBy({
            name: req.params.name,
        });

        if (globalConfig) {
            return sendItemResponse(req, res, globalConfig);
        } else {
            return sendItemResponse(req, res, {});
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

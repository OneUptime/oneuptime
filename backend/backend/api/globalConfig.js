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

// Route Description: Creating global config(s).
// Body: [{name, value}] | {name, value}
// Return: [{name, value, createdAt}] | {name, value, createdAt}

router.post('/', async function(req, res) {
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

            if (!value) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Value must be present.',
                });
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

        if (globalConfigs.length > 0) {
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

router.post('/configs', async function(req, res) {
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

router.get('/:name', async function(req, res) {
    try {
        const globalConfig = await GlobalConfigService.findOneBy({
            name: req.params.name,
        });

        if (globalConfig) {
            return sendItemResponse(req, res, globalConfig);
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Global config does not exists.',
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

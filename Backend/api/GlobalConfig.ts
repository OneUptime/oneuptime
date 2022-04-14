import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';

const router: $TSFixMe = express.getRouter();
import GlobalConfigService from '../services/globalConfigService';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
const isUserMasterAdmin: $TSFixMe = require('../middlewares/user').isUserMasterAdmin;
import twilioService from '../services/twilioService';

// Route Description: Creating global config(s).
// Body: [{name, value}] | {name, value}
// Return: [{name, value, createdAt}] | {name, value, createdAt}

router.post(
    '/',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            let configs;

            if (Array.isArray(req.body)) {
                configs = req.body;
            } else {
                configs = [req.body];
            }

            const globalConfigs: $TSFixMe = [];

            // Sanitize
            for (const config of configs) {
                const { name, value }: $TSFixMe = config;

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
                    name !== 'emailLogMonitoringStatus' &&
                    name !== 'smsLogMonitoringStatus' &&
                    name !== 'callLogMonitoringStatus'
                ) {
                    // Audit or Email or SMS or Call Log Status can be 'false'
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Value must be present.',
                    });
                }
                if (name === 'twilio') {
                    const data: $TSFixMe = {
                        accountSid: value['account-sid'],
                        authToken: value['authentication-token'],
                        phoneNumber: value['phone'],
                    };
                    await twilioService.test(data);
                }

                const selectConfig: string = 'name value createdAt';
                let globalConfig = await GlobalConfigService.findOneBy({
                    query: { name },
                    select: selectConfig,
                });

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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route Description: Getting global configs.
// Params: [name];
// Return: [{name, value, createdAt}]

router.post(
    '/configs',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const names: $TSFixMe = req.body;

            const selectConfig: string = 'name value createdAt';
            const globalConfigs: $TSFixMe = await GlobalConfigService.findBy({
                query: { name: { $in: names } },
                select: selectConfig,
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
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route Description: Getting global config by name.
// Params: {name};
// Return: {name, value, createdAt}

router.get(
    '/:name',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const selectConfig: string = 'name value createdAt';
            const { name }: $TSFixMe = req.params;
            let globalConfig = await GlobalConfigService.findOneBy({
                query: { name: name },
                select: selectConfig,
            });
            // If audit logs status was fetched and it doesn't exist, we need to create it
            if (!globalConfig && name === 'auditLogMonitoringStatus') {
                const auditLogConfig: $TSFixMe = {
                    name: 'auditLogMonitoringStatus',
                    value: true,
                };
                await GlobalConfigService.create(auditLogConfig);
            }

            // If email logs status was fetched and it doesn't exist, we need to create it
            if (!globalConfig && name === 'emailLogMonitoringStatus') {
                const emailLogConfig: $TSFixMe = {
                    name: 'emailLogMonitoringStatus',
                    value: true,
                };
                await GlobalConfigService.create(emailLogConfig);
            }

            // If SMS logs status was fetched and it doesnt exist, we need to create it
            if (!globalConfig && name === 'smsLogMonitoringStatus') {
                const smsLogConfig: $TSFixMe = {
                    name: 'smsLogMonitoringStatus',
                    value: true,
                };
                await GlobalConfigService.create(smsLogConfig);
            }

            // If Call logs status was fetched and it doesnt exist, we need to create it
            if (!globalConfig && name === 'callLogMonitoringStatus') {
                const callLogConfig: $TSFixMe = {
                    name: 'callLogMonitoringStatus',
                    value: true,
                };
                await GlobalConfigService.create(callLogConfig);
            }
            globalConfig = await GlobalConfigService.findOneBy({
                query: { name },
                select: selectConfig,
            });

            if (globalConfig) {
                return sendItemResponse(req, res, globalConfig);
            } else {
                return sendItemResponse(req, res, {});
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

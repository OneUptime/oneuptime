import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router: $TSFixMe = express.getRouter();

import SubscriberService from '../services/subscriberService';
import MonitorService from '../services/monitorService';

const getUser: $TSFixMe = require('../middlewares/user').getUser;

import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

// Route Description: Adding / Updating subscriber to the project.
// req.params->{projectId}; req.body -> {monitorIds, alertVia, contactEmail, contactPhone, }
// Returns: response status page, error message

router.post(
    '/:projectId/:statusPageId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const body: $TSFixMe = req.body;
            const data: $TSFixMe = {};

            data.projectId = req.params.projectId;

            data.statusPageId = req.params.statusPageId;

            data.notificationType = body.notificationType;

            if (!body.userDetails) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'user details must be present.',
                });
            }

            if (body.userDetails && !body.userDetails.method) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'subscribe method must be present.',
                });
            }

            if (
                body.userDetails &&
                typeof body.userDetails.method !== 'string'
            ) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Alert via method is not in string format.',
                });
            }

            if (body.userDetails.method === 'email') {
                if (!body.userDetails.email) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'email must be present.',
                    });
                }

                if (
                    body.userDetails.email &&
                    typeof body.userDetails.email !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Email address is not in string format.',
                    });
                }

                data.contactEmail = body.userDetails.email;
            } else if (body.userDetails.method === 'sms') {
                if (!body.userDetails.phone_number) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'phone number must be present.',
                    });
                }

                if (
                    body.userDetails.phone_number &&
                    typeof body.userDetails.phone_number !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'phone number is not in string format.',
                    });
                }

                if (!body.userDetails.country) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'country code must be present.',
                    });
                }

                if (
                    body.userDetails.country &&
                    typeof body.userDetails.country !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'country code is not in string format.',
                    });
                }

                data.contactPhone = body.userDetails.phone_number;

                data.countryCode = body.userDetails.country;
            } else if (body.userDetails.method === 'webhook') {
                if (!body.userDetails.endpoint) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'endpoint url must be present.',
                    });
                }

                if (
                    body.userDetails.endpoint &&
                    typeof body.userDetails.endpoint !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'endpoint url is not in string format.',
                    });
                }

                if (!body.userDetails.email) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'email must be present.',
                    });
                }

                if (
                    body.userDetails.email &&
                    typeof body.userDetails.email !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Email address is not in string format.',
                    });
                }

                data.contactWebhook = body.userDetails.endpoint;

                data.contactEmail = body.userDetails.email;
            }

            const monitors: $TSFixMe = body.monitors;

            data.alertVia = body.userDetails.method;

            const subscriber: $TSFixMe = await SubscriberService.subscribe(
                data,
                monitors
            );
            return sendItemResponse(req, res, subscriber);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/subscribe/:monitorId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            data.projectId = req.params.projectId;
            data.monitorId = req.params.monitorId;
            if (!data.alertVia) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Subscribe method must be present.',
                });
            }

            if (typeof data.alertVia !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Alert via method is not in string format.',
                });
            }

            if (data.alertVia === 'email') {
                if (!data.contactEmail) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'email must be present.',
                    });
                }

                if (
                    data.contactEmail &&
                    typeof data.contactEmail !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Email address is not in string format.',
                    });
                }
            } else if (data.alertVia === 'sms') {
                if (!data.contactPhone) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'phone number must be present.',
                    });
                }

                if (
                    data.contactPhone &&
                    typeof data.contactPhone !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'phone number is not in string format.',
                    });
                }

                if (!data.countryCode) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'country code must be present.',
                    });
                }

                if (data.countryCode && typeof data.countryCode !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'country code is not in string format.',
                    });
                }
            } else if (data.alertVia === 'webhook') {
                if (!data.contactWebhook) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'endpoint url must be present.',
                    });
                }

                if (
                    data.contactWebhook &&
                    typeof data.contactWebhook !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'endpoint url is not in string format.',
                    });
                }

                if (!data.contactEmail) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'email must be present.',
                    });
                }

                if (
                    data.contactEmail &&
                    typeof data.contactEmail !== 'string'
                ) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Email address is not in string format.',
                    });
                }
                if (!data.webhookMethod) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Webhook http method must be present',
                    });
                }
                if (!['get', 'post'].includes(data.webhookMethod)) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Webhook http method must be a valid method',
                    });
                }
            }
            const hasSubscribed: $TSFixMe =
                await SubscriberService.subscriberCheck(data);
            if (hasSubscribed) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You are already subscribed to this monitor.',
                });
            } else {
                let subscriber: $TSFixMe;
                if (data.alertVia === 'email') {
                    const subscriberExist: $TSFixMe =
                        await SubscriberService.findByOne({
                            query: {
                                monitorId: data.monitorId,
                                contactEmail: data.contactEmail,
                                subscribed: false,
                            },
                            select: '_id',
                        });
                    if (subscriberExist) {
                        subscriber = await SubscriberService.updateOneBy(
                            {
                                monitorId: data.monitorId,
                                contactEmail: data.contactEmail,
                            },
                            { subscribed: true }
                        );
                    } else {
                        subscriber = await SubscriberService.create(data);
                    }
                } else {
                    subscriber = await SubscriberService.create(data);
                }
                return sendItemResponse(req, res, subscriber);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// get subscribers by projectId
// req.params-> {projectId};
// Returns: response subscriber, error message
router.get('/:projectId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const projectId: $TSFixMe = req.params.projectId;
        const skip: $TSFixMe = req.query['skip'] || 0;
        const limit: $TSFixMe = req.query['limit'] || 10;
        const select: $TSFixMe =
            'monitorId projectId statusPageId alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod notificationType createdAt subscribed';

        const [subscribers, count]: $TSFixMe = await Promise.all([
            SubscriberService.findBy({ projectId, skip, limit, select }),
            SubscriberService.countBy({ projectId: projectId }),
        ]);
        return sendListResponse(req, res, subscribers, count);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

//get subscribers by monitorId
// req.params-> {projectId, monitorId};
// Returns: response subscriber, error message
router.get(
    '/:projectId/monitor/:monitorId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const monitorId: $TSFixMe = req.params.monitorId;
            const skip: $TSFixMe = req.query['skip'] || 0;
            const limit: $TSFixMe = req.query['limit'] || 10;
            const populate: $TSFixMe = [
                { path: 'projectId', select: 'name _id' },
                { path: 'monitorId', select: 'name _id' },
                { path: 'statusPageId', select: 'name _id' },
            ];
            const select: $TSFixMe =
                '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';
            const [subscribers, count]: $TSFixMe = await Promise.all([
                SubscriberService.findBy({
                    query: { monitorId: monitorId, subscribed: true },
                    skip,
                    limit,
                    select,
                    populate,
                }),
                SubscriberService.countBy({ monitorId: monitorId }),
            ]);
            return sendListResponse(req, res, subscribers, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//get monitors by subscriberId
// req.params-> {subscriberId};
// Returns: response subscriber, error message
router.get(
    '/monitorList/:subscriberId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const subscriberId: $TSFixMe = req.params.subscriberId;

            const subscriber: $TSFixMe = await SubscriberService.findBy({
                query: { _id: subscriberId },
                select: 'contactEmail',
            });

            const select: $TSFixMe =
                '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';

            const subscriptions: $TSFixMe = await SubscriberService.findBy({
                query: {
                    contactEmail: subscriber[0].contactEmail,
                    subscribed: true,
                },
                select,
            });

            const monitorIds: $TSFixMe = subscriptions.map(
                subscription => subscription.monitorId
            );

            const subscriberMonitors: $TSFixMe = await MonitorService.findBy({
                query: { _id: { $in: monitorIds }, deleted: false },
                select: '_id',
            });

            const filteredSubscriptions: $TSFixMe = [];

            subscriptions.map((subscription: $TSFixMe) => {
                return subscriberMonitors.map((subscriberMonitor: $TSFixMe) => {
                    if (
                        String(subscription.monitorId) ===
                        String(subscriberMonitor._id)
                    ) {
                        return filteredSubscriptions.push(subscription);
                    }

                    return null;
                });
            });

            return sendListResponse(req, res, filteredSubscriptions);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Get a subscriber.
//req.params-> {projectId, subscriberId}
// Returns: response subscriber, error message
router.get(
    '/:projectId/:subscriberId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId: $TSFixMe = req.params.projectId;
            const subscriberId: $TSFixMe = req.params.subscriberId;
            const populate: $TSFixMe = [
                { path: 'projectId', select: 'name _id' },
                { path: 'monitorId', select: 'name _id' },
            ];
            const select: $TSFixMe =
                '_id projectId monitorId statusPageId createdAt alertVia contactEmail contactPhone countryCode contactWebhook webhookMethod';
            const subscriber: $TSFixMe = await SubscriberService.findByOne({
                query: { _id: subscriberId, projectId: projectId },
                select,
                populate,
            });
            return sendItemResponse(req, res, subscriber);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//unsubscribe subscriber.
//req.params-> {monitorId, subscriberId}
// Returns: response subscriber, error message
router.put(
    '/unsubscribe/:monitorId/:email',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { email, monitorId }: $TSFixMe = req.params;
            const subscriber: $TSFixMe = await SubscriberService.updateOneBy(
                { monitorId, contactEmail: email },
                { subscribed: false }
            );
            return sendItemResponse(req, res, subscriber);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
//  delete a subscriber.
//  req.params-> {projectId, subscriberId}
//  Returns: response subscriber, error message
router.delete(
    '/:projectId/:subscriberId',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const subscriberId: $TSFixMe = req.params.subscriberId;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            const subscriber: $TSFixMe = await SubscriberService.deleteBy(
                { _id: subscriberId },
                userId
            );
            return sendItemResponse(req, res, subscriber);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/:monitorId/csv',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            data.projectId = req.params.projectId;
            data.monitorId = req.params.monitorId;

            if (data.data.length === 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Empty files submitted',
                });
            }
            const result: $TSFixMe =
                await SubscriberService.subscribeFromCSVFile(data);
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();

const SubscriberService = require('../services/subscriberService');
const MonitorService = require('../services/monitorService');

const getUser = require('../middlewares/user').getUser;

const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route Description: Adding / Updating subscriber to the project.
// req.params->{projectId}; req.body -> {monitorIds, alertVia, contactEmail, contactPhone, }
// Returns: response status page, error message

router.post('/:projectId/:statusPageId', async function(req, res) {
    try {
        const body = req.body;
        const data = {};
        data.projectId = req.params.projectId;
        data.statusPageId = req.params.statusPageId;

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

        if (body.userDetails && typeof body.userDetails.method !== 'string') {
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

        const monitors = body.monitors;
        data.alertVia = body.userDetails.method;

        const subscriber = await SubscriberService.subscribe(data, monitors);
        return sendItemResponse(req, res, subscriber);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/subscribe/:monitorId', async function(req, res) {
    try {
        const data = req.body;
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

            if (data.contactEmail && typeof data.contactEmail !== 'string') {
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

            if (data.contactPhone && typeof data.contactPhone !== 'string') {
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

            if (data.contactEmail && typeof data.contactEmail !== 'string') {
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
        const hasSubscribed = await SubscriberService.subscriberCheck(data);
        if (hasSubscribed) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You are already subscribed to this monitor.',
            });
        } else {
            let subscriber;
            if (data.alertVia === 'email') {
                const subscriberExist = await SubscriberService.findByOne({
                    monitorId: data.monitorId,
                    contactEmail: data.contactEmail,
                    subscribed: false,
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
        return sendErrorResponse(req, res, error);
    }
});

// get subscribers by projectId
// req.params-> {projectId};
// Returns: response subscriber, error message
router.get('/:projectId', async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const subscribers = await SubscriberService.findBy(
            { projectId: projectId },
            skip,
            limit
        );
        const count = await SubscriberService.countBy({ projectId: projectId });
        return sendListResponse(req, res, subscribers, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

//get subscribers by monitorId
// req.params-> {projectId, monitorId};
// Returns: response subscriber, error message
router.get('/:projectId/monitor/:monitorId', async function(req, res) {
    try {
        const monitorId = req.params.monitorId;
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const subscribers = await SubscriberService.findBy(
            { monitorId: monitorId, subscribed: true },
            skip,
            limit
        );
        const count = await SubscriberService.countBy({ monitorId: monitorId });
        return sendListResponse(req, res, subscribers, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

//get monitors by subscriberId
// req.params-> {subscriberId};
// Returns: response subscriber, error message
router.get('/monitorList/:subscriberId', async function(req, res) {
    try {
        const subscriberId = req.params.subscriberId;

        const subscriber = await SubscriberService.findBy({
            _id: subscriberId,
        });

        const subscriptions = await SubscriberService.findBy({
            contactEmail: subscriber[0].contactEmail,
            subscribed: true,
        });

        const monitorIds = subscriptions.map(
            subscription => subscription.monitorId
        );

        const subscriberMonitors = await MonitorService.findBy({
            _id: { $in: monitorIds },
            deleted: false,
        });

        const filteredSubscriptions = [];

        subscriptions.map(subscription => {
            subscriberMonitors.map(subscriberMonitor => {
                if (
                    String(subscription.monitorId) ===
                    String(subscriberMonitor._id)
                ) {
                    filteredSubscriptions.push(subscription);
                }
            });
        });

        return sendListResponse(req, res, filteredSubscriptions);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

//Get a subscriber.
//req.params-> {projectId, subscriberId}
// Returns: response subscriber, error message
router.get('/:projectId/:subscriberId', async function(req, res) {
    try {
        const projectId = req.params.projectId;
        const subscriberId = req.params.subscriberId;
        const subscriber = await SubscriberService.findByOne({
            _id: subscriberId,
            projectId: projectId,
        });
        return sendItemResponse(req, res, subscriber);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

//unsubscribe subscriber.
//req.params-> {monitorId, subscriberId}
// Returns: response subscriber, error message
router.put('/unsubscribe/:monitorId/:email', async function(req, res) {
    try {
        const { email, monitorId } = req.params;
        const subscriber = await SubscriberService.updateOneBy(
            { monitorId, contactEmail: email },
            { subscribed: false }
        );
        return sendItemResponse(req, res, subscriber);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});
//  delete a subscriber.
//  req.params-> {projectId, subscriberId}
//  Returns: response subscriber, error message
router.delete('/:projectId/:subscriberId', getUser, async function(req, res) {
    try {
        const subscriberId = req.params.subscriberId;
        const userId = req.user ? req.user.id : null;
        const subscriber = await SubscriberService.deleteBy(
            { _id: subscriberId },
            userId
        );
        return sendItemResponse(req, res, subscriber);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/:monitorId/csv', async function(req, res) {
    try {
        const data = req.body;
        data.projectId = req.params.projectId;
        data.monitorId = req.params.monitorId;

        if (data.data.length === 0) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Empty files submitted',
            });
        }
        const result = await SubscriberService.subscribeFromCSVFile(data);
        return sendItemResponse(req, res, result);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

/**
 *
 * Copyright HackerBay, Inc.
 *
 */


let express = require('express');
let router = express.Router();

let SubscriberService = require('../services/subscriberService');

let getUser = require('../middlewares/user').getUser;

let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route Description: Adding / Updating subscriber to the project.
// req.params->{projectId}; req.body -> {monitorIds, alertVia, contactEmail, contactPhone, }
// Returns: response status page, error message

router.post('/:projectId/:statusPageId', async function (req, res) {
    try{
        let body = req.body;
        let data = {};
        data.projectId = req.params.projectId;
        data.statusPageId = req.params.statusPageId;
    
        if(!body.monitors){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Monitors must be present.'
            });
        }
    
        if(!body.userDetails){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'user details must be present.'
            });
        }
    
        if(body.userDetails && !body.userDetails.method){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'subscribe method must be present.'
            });
        }
    
        if (body.userDetails && typeof body.userDetails.method !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Alert via method is not in string format.'
            });
        }
    
        if (body.userDetails.method === 'email') {
            if (!body.userDetails.email) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'email must be present.'
                });
            }
    
            if (body.userDetails.email && typeof body.userDetails.email !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email address is not in string format.'
                });
            }
    
        }
    
        else if (body.userDetails.method === 'sms') {
            if (!body.userDetails.phone_number) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'phone number must be present.'
                });
            }
    
            if (body.userDetails.phone_number && typeof body.userDetails.phone_number !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'phone number is not in string format.'
                });
            }
    
            if (!body.userDetails.country) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'country code must be present.'
                });
            }
    
            if (body.userDetails.country && typeof body.userDetails.country !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'country code is not in string format.'
                });
            }
        }
    
        else if (body.userDetails.method === 'webhook') {
            if (!body.userDetails.endpoint) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'endpoint url must be present.'
                });
            }
    
            if (body.userDetails.endpoint && typeof body.userDetails.endpoint !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'endpoint url is not in string format.'
                });
            }
    
            if (!body.userDetails.email) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'email must be present.'
                });
            }
    
            if (body.userDetails.email && typeof body.userDetails.email !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email address is not in string format.'
                });
            }
        }
    
        let monitors = body.monitors;
        data.alertVia = body.userDetails.method;
        data.contactEmail = body.userDetails.email || null;
        data.contactPhone = body.userDetails.phone_number || null;
        data.countryCode = body.userDetails.country || null;
        data.contactWebhook = body.userDetails.endpoint || null;
        data.monitorId = '';

        let subscriber = await SubscriberService.subscribe(data,monitors);
        return sendItemResponse(req, res, subscriber);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/subscribe/:monitorId', async function (req, res) {
    try{
        let data = req.body;
        data.projectId = req.params.projectId;
        data.monitorId = req.params.monitorId;
    
        if(!data.alertVia){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Subscribe method must be present.'
            });
        }
    
        if (typeof data.alertVia !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Alert via method is not in string format.'
            });
        }
    
        if (data.alertVia === 'email') {
            if (!data.contactEmail) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'email must be present.'
                });
            }
    
            if (data.contactEmail && typeof data.contactEmail !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email address is not in string format.'
                });
            }
    
        }
    
        else if(data.alertVia === 'sms') {
            if(!data.contactPhone) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'phone number must be present.'
                });
            }
    
            if (data.contactPhone && typeof data.contactPhone !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'phone number is not in string format.'
                });
            }
    
            if (!data.countryCode) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'country code must be present.'
                });
            }
    
            if (data.countryCode && typeof data.countryCode !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'country code is not in string format.'
                });
            }
        }
    
        else if (data.alertVia === 'webhook') {
            if (!data.contactWebhook) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'endpoint url must be present.'
                });
            }
    
            if (data.contactWebhook && typeof data.contactWebhook !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'endpoint url is not in string format.'
                });
            }
    
            if (!data.contactEmail) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'email must be present.'
                });
            }
    
            if (data.contactEmail && typeof data.contactEmail !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email address is not in string format.'
                });
            }
        }
        let hasSubscribed = await SubscriberService.subscriberCheck(data);
        if(hasSubscribed){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You are already subscribed to this monitor.'
            });
        }else{
            let subscriber = await SubscriberService.create(data);
            return sendItemResponse(req, res, subscriber);
        }
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// get subscribers by projectId
// req.params-> {projectId};
// Returns: response subscriber, error message
router.get('/:projectId', async function (req, res) {
    try{
        let projectId = req.params.projectId;
        let skip = req.query.skip || 0;
        let limit = req.query.limit || 10;
        let subscribers = await SubscriberService.findBy({projectId: projectId}, skip, limit);
        let count = await SubscriberService.countBy({projectId: projectId});
        return sendListResponse(req, res, subscribers, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

//get subscribers by monitorId
// req.params-> {projectId, monitorId};
// Returns: response subscriber, error message
router.get('/:projectId/monitor/:monitorId', async function (req, res) {
    try{
        let monitorId = req.params.monitorId;
        let skip = req.query.skip || 0;
        let limit = req.query.limit || 10;
        let subscribers = await SubscriberService.findBy({monitorId: monitorId }, skip, limit);
        let count = await SubscriberService.countBy({monitorId: monitorId});
        return sendListResponse(req, res, subscribers, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

//Get a subscriber.
//req.params-> {projectId, subscriberId}
// Returns: response subscriber, error message
router.get('/:projectId/:subscriberId', async function (req, res) {
    try{
        let projectId = req.params.projectId;
        let subscriberId = req.params.subscriberId;
        let subscriber = await SubscriberService.findByOne({_id: subscriberId, projectId: projectId});
        return sendItemResponse(req, res, subscriber);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

//  delete a subscriber.
//  req.params-> {projectId, subscriberId}
//  Returns: response subscriber, error message
router.delete('/:projectId/:subscriberId', getUser, async function (req, res) {
    try{
        let subscriberId = req.params.subscriberId;
        let userId = req.user ? req.user.id : null;
        let subscriber = await SubscriberService.deleteBy({_id: subscriberId}, userId);
        return sendItemResponse(req, res, subscriber);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

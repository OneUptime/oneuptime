/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');
let SmsTemplateService = require('../services/smsTemplateService');

let router = express.Router();

const createDOMPurify = require('dompurify');
const jsdom = require('jsdom').jsdom;
const window = jsdom('').defaultView;
const DOMPurify = createDOMPurify(window);

const {
    isAuthorized
} = require('../middlewares/authorization');
let getUser = require('../middlewares/user').getUser;
let isUserOwner = require('../middlewares/project').isUserOwner;

let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let data = req.body;
        data.projectId = req.params.projectId;

        if(!data.body){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'SMS body is required.'
            });
        }

        data.body = await DOMPurify.sanitize(data.body);
        let smsTemplate = await SmsTemplateService.create(data);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:templateId/reset', getUser, isAuthorized, async function(req, res){
    try {
        let projectId = req.params.projectId;
        let templateId = req.params.templateId;
        await SmsTemplateService.resetTemplate(projectId, templateId);
        let templates = await SmsTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized,  async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let templates = await SmsTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/smsTemplate/:smsTemplateId', getUser, isAuthorized, async function (req, res) {
    try {
        let smsTemplateId = req.params.smsTemplateId;
        let smsTemplates = await SmsTemplateService.findOneBy({ _id: smsTemplateId });
        return sendItemResponse(req, res, smsTemplates);
    } catch(error) {
        return sendErrorResponse( req, res, error );
    }
});

router.put('/:projectId/smsTemplate/:smsTemplateId', getUser, isAuthorized, async function (req, res) {
    try {
        let data = req.body;
        let smsTemplateId = req.params.smsTemplateId;
        // Call the SMSTemplateService
        data.body = await DOMPurify.sanitize(data.body);
        let smsTemplate = await SmsTemplateService.updateOneBy({_id : smsTemplateId},data);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.put('/:projectId', getUser, isAuthorized, async function (req, res){
    try {
        let data = [];
        for(let value of req.body){

            if(!value.body){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'SMS body is required.'
                });
            }
            // sanitize template markup
            value.projectId = req.params.projectId;
            value.body = await DOMPurify.sanitize(value.body);
            data.push(value);
        }
        for(let value of data){
            await SmsTemplateService.updateOneBy({_id : value._id},value);
        }
        let smsTemplates = await SmsTemplateService.getTemplates(req.params.projectId);
        return sendItemResponse(req, res, smsTemplates);
    } catch (error) {
        sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/smsTemplate/:smsTemplateId', getUser, isUserOwner, async function(req, res){
    try {
        let smsTemplateId = req.params.smsTemplateId;
        let userId = req.user.id;
        let smsTemplate = await SmsTemplateService.deleteBy({_id: smsTemplateId}, userId);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
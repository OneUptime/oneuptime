/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var SmsTemplateService = require('../services/smsTemplateService');

var router = express.Router();

const createDOMPurify = require('dompurify');
const jsdom = require('jsdom').jsdom;
const window = jsdom('').defaultView;
const DOMPurify = createDOMPurify(window);

const {
    isAuthorized
} = require('../middlewares/authorization');
var getUser = require('../middlewares/user').getUser;
var isUserOwner = require('../middlewares/project').isUserOwner;

var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        var data = req.body;
        data.projectId = req.params.projectId;

        if(!data.body){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'SMS body is required.'
            });
        }

        data.body = await DOMPurify.sanitize(data.body);
        var smsTemplate = await SmsTemplateService.create(data);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:templateId/reset', getUser, isAuthorized, async function(req, res){
    try {
        var projectId = req.params.projectId;
        var templateId = req.params.templateId;
        await SmsTemplateService.resetTemplate(projectId, templateId);
        var templates = await SmsTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized,  async function (req, res) {
    try {
        var projectId = req.params.projectId;
        var templates = await SmsTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/smsTemplate/:smsTemplateId', getUser, isAuthorized, async function (req, res) {
    try {
        var smsTemplateId = req.params.smsTemplateId;
        var smsTemplates = await SmsTemplateService.findOneBy({ _id: smsTemplateId });
        return sendItemResponse(req, res, smsTemplates);
    } catch(error) {
        return sendErrorResponse( req, res, error );
    }
});

router.put('/:projectId/smsTemplate/:smsTemplateId', getUser, isAuthorized, async function (req, res) {
    try {
        var data = req.body;
        var smsTemplateId = req.params.smsTemplateId;
        // Call the SMSTemplateService
        data.body = await DOMPurify.sanitize(data.body);
        var smsTemplate = await SmsTemplateService.updateBy({_id : smsTemplateId},data);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.put('/:projectId', getUser, isAuthorized, async function (req, res){
    try {
        var data = [];
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
            await SmsTemplateService.updateBy({_id : value._id},value);
        }
        var smsTemplates = await SmsTemplateService.getTemplates(req.params.projectId);
        return sendItemResponse(req, res, smsTemplates);
    } catch (error) {
        sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/smsTemplate/:smsTemplateId', getUser, isUserOwner, async function(req, res){
    try {
        var smsTemplateId = req.params.smsTemplateId;
        var userId = req.user.id;
        var smsTemplate = await SmsTemplateService.deleteBy({_id: smsTemplateId}, userId);
        return sendItemResponse(req, res, smsTemplate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
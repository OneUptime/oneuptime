/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');
let EmailTemplateService = require('../services/emailTemplateService');

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

    try{
        let data = req.body;
        data.projectId = req.params.projectId;
        if(!data.subject){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email subject is required.'
            });
        }

        if(!data.body){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Email body is required.'
            });
        }

        // sanitize template markup
        data.subject = await DOMPurify.sanitize(data.subject);
        data.body = await DOMPurify.sanitize(data.body, {WHOLE_DOCUMENT: true});
        let emailTemplate = await EmailTemplateService.create(data);
        return sendItemResponse(req, res, emailTemplate);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:templateId/reset', getUser, isAuthorized, async function(req, res){
    try {
        let projectId = req.params.projectId;
        let templateId = req.params.templateId;
        await EmailTemplateService.resetTemplate(projectId, templateId);
        let templates = await EmailTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized,  async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let templates = await EmailTemplateService.getTemplates(projectId);
        return sendItemResponse(req, res, templates);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/emailTemplate/:emailTemplateId', getUser, isAuthorized, async function (req, res) {
    try {
        let emailTemplateId = req.params.emailTemplateId;
        let emailTemplates = await EmailTemplateService.findOneBy({ _id: emailTemplateId });
        return sendItemResponse(req, res, emailTemplates);
    } catch(error) {
        return sendErrorResponse( req, res, error );
    }
});

router.put('/:projectId/emailTemplate/:emailTemplateId', getUser, isAuthorized, async function (req, res) {
    try {
        let data = req.body;
        let Id = req.params.emailTemplateId;
        // Call the EmailTemplateService
        let emailTemplate = await EmailTemplateService.updateOneBy({_id:Id},data);
        return sendItemResponse(req, res, emailTemplate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           );
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.put('/:projectId', getUser, isAuthorized, async function (req, res){
    try{
        let data = [];
        for(let value of req.body){
            if(!value.subject){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email subject is required.'
                });
            }

            if(!value.body){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email body is required.'
                });
            }
            // sanitize template markup
            value.projectId = req.params.projectId;
            value.subject = await DOMPurify.sanitize(value.subject);
            value.body = await DOMPurify.sanitize(value.body, {WHOLE_DOCUMENT: true});
            data.push(value);
        }
        for(let value of data){
            await EmailTemplateService.updateOneBy({_id:value._id},value);
        }
        let emailTemplates = await EmailTemplateService.getTemplates(req.params.projectId);
        return sendItemResponse(req, res, emailTemplates);
    }catch(error){
        sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/emailTemplate/:emailTemplateId', getUser, isUserOwner, async function(req, res){
    try{
        let emailTemplateId = req.params.emailTemplateId;
        let userId = req.user.id;
        let emailTemplate = await EmailTemplateService.deleteBy({_id: emailTemplateId}, userId);
        return sendItemResponse(req, res, emailTemplate);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
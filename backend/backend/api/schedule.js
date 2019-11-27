/**
 *
 * Copyright HackerBay, Inc.
 *
 */


let express = require('express');
let ScheduleService = require('../services/scheduleService');

let router = express.Router();
let isUserAdmin = require('../middlewares/project').isUserAdmin;
let getUser = require('../middlewares/user').getUser;
let getSubProjects = require('../middlewares/subProject').getSubProjects;
const {
    isAuthorized
} = require('../middlewares/authorization');
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    let data = req.body;
    let userId = req.user ? req.user.id : null;
    data.createdById = userId;
    data.projectId = req.params.projectId;

    if(!data.name){
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Name is required'
        });
    }

    try{
        let schedule = await ScheduleService.create(data);
        return sendItemResponse(req, res, schedule);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    let projectId = req.params.projectId;
    try{
        let schedules = await ScheduleService.findBy({projectId: projectId}, req.query.limit || 10, req.query.skip || 0);
        let count = await ScheduleService.countBy({projectId});
        return sendListResponse(req, res, schedules, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/schedules', getUser, isAuthorized, getSubProjects, async function (req, res) {
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try{
        var schedules = await ScheduleService.getSubProjectSchedules(subProjectIds);
        return sendItemResponse(req, res, schedules); // frontend expects sendItemResponse
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/schedule', getUser, isAuthorized, async function(req, res){
    var projectId = req.params.projectId;
    try{
        var schedule = await ScheduleService.findBy({projectId}, req.query.limit || 10, req.query.skip || 0);
        var count = await ScheduleService.countBy({projectId});
        return sendListResponse(req, res, schedule, count); // frontend expects sendListResponse
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:scheduleId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    let scheduleId = req.params.scheduleId;
    let data = req.body;
    data._id = scheduleId;

    try{
        let schedule = await ScheduleService.update(data);
        return sendItemResponse(req, res, schedule);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:scheduleId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var scheduleId = req.params.scheduleId;
    var userId = req.user ? req.user.id : null;

    if (!scheduleId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ScheduleId must be present.'
        });
    }

    try{
        let schedule = await ScheduleService.deleteBy({_id: scheduleId}, userId);
        return sendItemResponse(req, res, schedule);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:scheduleId/getescalation', getUser, isAuthorized, async (req, res)=>{
    let scheduleId = req.params.scheduleId;
    try{
        let response = await ScheduleService.getEscalation(scheduleId);
        return sendListResponse(req, res, response.escalations, response.count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/:scheduleId/addEscalation', getUser, isAuthorized, isUserAdmin, async(req, res)=>{
    let userId = req.user ? req.user.id : null;
    let scheduleId = req.params.scheduleId;
    let escalationData = [];

    for(let value of req.body){
        let storagevalue = {};
        let teamMember = [];
        if(!value.callFrequency){
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Call Frequency is required'
            });
        }
        storagevalue.callFrequency = value.callFrequency;
        storagevalue.smsFrequency = value.smsFrequency;
        storagevalue.emailFrequency = value.emailFrequency;
        storagevalue.projectId = req.params.projectId;
        storagevalue.scheduleId = scheduleId;
        storagevalue.createdById = userId;
        if(value._id) storagevalue._id = value._id;

        for(let escalation of value.teamMember){
            let data = {};  

            if(!escalation.member){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Team Members is required'
                });
            }

            if(!escalation.email && !escalation.call && !escalation.sms){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Alert Via is required'
                });
            }

            if(!escalation.timezone){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Timezone is required' 
                });
            }
            
            if(!escalation.startTime){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Escalation start time is required'
                });
            }
            
            if(!escalation.endTime){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Escalation end time is required'
                });
            }
          

            data.member = escalation.member;
            data.email = escalation.email;
            data.call = escalation.call;
            data.sms = escalation.sms;
            data.startTime = escalation.startTime;
            data.endTime = escalation.endTime;
            data.timezone = escalation.timezone;

            teamMember.push(data);
        }
        storagevalue.teamMember = teamMember;
        escalationData.push(storagevalue);
    }

    try{
        let escalation = await ScheduleService.addEscalation(scheduleId, escalationData,userId);
        return sendItemResponse(req, res, escalation);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
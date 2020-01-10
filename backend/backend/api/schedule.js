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
    try {
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
        let schedule = await ScheduleService.create(data);
        return sendItemResponse(req, res, schedule);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        let schedules = await ScheduleService.findBy({projectId: projectId}, req.query.limit || 10, req.query.skip || 0);
        let count = await ScheduleService.countBy({projectId});
        return sendListResponse(req, res, schedules, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/schedules', getUser, isAuthorized, getSubProjects, async function (req, res) {
    try {
        var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
        var schedules = await ScheduleService.getSubProjectSchedules(subProjectIds);
        return sendItemResponse(req, res, schedules); // frontend expects sendItemResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/schedule', getUser, isAuthorized, async function(req, res){
    try {
        var projectId = req.params.projectId;
        var schedule = await ScheduleService.findBy({projectId}, req.query.limit || 10, req.query.skip || 0);
        var count = await ScheduleService.countBy({projectId});
        return sendListResponse(req, res, schedule, count); // frontend expects sendListResponse
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/:scheduleId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    try {
        let scheduleId = req.params.scheduleId;
        let data = req.body;
        let schedule = await ScheduleService.updateOneBy({_id : scheduleId},data);
        return sendItemResponse(req, res, schedule);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.delete('/:projectId/:scheduleId', getUser, isAuthorized, isUserAdmin, async function (req, res) {

    try {
        var scheduleId = req.params.scheduleId;
        var userId = req.user ? req.user.id : null;

        if (!scheduleId) {
            return sendErrorResponse( req, res, {
                code: 400,
                message: 'ScheduleId must be present.'
            });
        }
        let schedule = await ScheduleService.deleteBy({_id: scheduleId}, userId);
        return sendItemResponse(req, res, schedule);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/:scheduleId/getescalation', getUser, isAuthorized, async (req, res)=>{
    try {
        let scheduleId = req.params.scheduleId;
        let response = await ScheduleService.getEscalation(scheduleId);
        return sendListResponse(req, res, response.escalations, response.count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/:scheduleId/addEscalation', getUser, isAuthorized, isUserAdmin, async(req, res)=>{
    try {
        let userId = req.user ? req.user.id : null;
        let scheduleId = req.params.scheduleId;
        let escalationData = [];

        for(let value of req.body){
            let storagevalue = {};
            let tempTeam = [];
            if(!value.callFrequency){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Call Frequency is required'
                });
            }

            if(!value.email && !value.call && !value.sms){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'At least one type of alert is required'
                });
            }
            storagevalue.callFrequency = value.callFrequency;
            storagevalue.smsFrequency = value.smsFrequency;
            storagevalue.emailFrequency = value.emailFrequency;
            storagevalue.rotationFrequency = value.rotationFrequency;
            storagevalue.rotationInterval = value.rotationInterval;
            storagevalue.email = value.email;
            storagevalue.call = value.call;
            storagevalue.sms = value.sms;
            storagevalue.projectId = req.params.projectId;
            storagevalue.scheduleId = scheduleId;
            storagevalue.createdById = userId;

            if(value._id) storagevalue._id = value._id;

            for (let team  of value.team) {
                let rotationData = {};
                let teamMember = [];

                for (let TM of team.teamMember) {
                    let data = {};
                    if (!TM.member) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: 'Team Members is required'
                        });
                    }
                    data.member = TM.member;
                    data.startTime = TM.startTime;
                    data.endTime = TM.endTime;
                    data.timezone = TM.timezone;
                    teamMember.push(data);
                }
                rotationData.teamMember = teamMember;
                tempTeam.push(rotationData);
            }
            storagevalue.team = tempTeam;
            escalationData.push(storagevalue);
        }
        let escalation = await ScheduleService.addEscalation(scheduleId, escalationData, userId);
        return sendItemResponse(req, res, escalation);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

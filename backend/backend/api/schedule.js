/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');
let ScheduleService = require('../services/scheduleService');
let moment = require('moment');
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
        let escalations = [];
        var escalationPolicyCount = 0;
        for(let value of req.body) {

            escalationPolicyCount ++;
            let storagevalue = {};
            let tempTeam = [];

            
            if(!value.email && !value.call && !value.sms){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Please select how should Fyipe alert your team - SMS, Email OR Call'+ (req.body.length> 1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if(value.email && !value.emailFrequency){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Number of Email Reminders is required '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if(value.call && !value.callFrequency){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Number of Call Reminders is required '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if(value.sms && !value.smsFrequency){
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Number of SMS Reminders is required '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if (value.rotationFrequency && !value.rotationInterval) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Please specify Rotation Interval '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if ((value.rotationFrequency && value.rotationInterval) && !value.rotationSwitchTime) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Please specify "First rotation happens on" '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if ((value.rotationFrequency && value.rotationInterval) && (value.rotationSwitchTime && !value.rotationTimezone)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You must specify timezone for "First rotation happens on" '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if (value.rotationFrequency && (value.teams.length <= 1)) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You need more than one team for rotations '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                });
            }

            if(value.callFrequency && typeof value.callFrequency === "string"){
                value.callFrequency = parseInt(value.callFrequency);
            }

            if(value.smsFrequency && typeof value.smsFrequency === "string"){
                value.smsFrequency = parseInt(value.smsFrequency);
            }

            if(value.emailFrequency && typeof value.emailFrequency === "string"){
                value.emailFrequency = parseInt(value.emailFrequency);
            }

            if(value.rotationSwitchTime && typeof value.rotationSwitchTime === "string"){
                value.emailFrequency = new Date(value.rotationSwitchTime);
            }

            
            storagevalue.callFrequency = value.callFrequency;
            storagevalue.smsFrequency = value.smsFrequency;
            storagevalue.emailFrequency = value.emailFrequency;
        
            storagevalue.rotationFrequency = value.rotationFrequency;
            storagevalue.rotationInterval = value.rotationInterval;
            storagevalue.rotationSwitchTime = value.rotationSwitchTime;
            storagevalue.rotationTimezone = value.rotationTimezone;
            storagevalue.email = value.email;
            storagevalue.call = value.call;
            storagevalue.sms = value.sms;
            storagevalue.projectId = req.params.projectId;
            storagevalue.scheduleId = scheduleId;
            storagevalue.createdById = userId;

            if(value._id) storagevalue._id = value._id;

            for (let team  of value.teams) {
                let rotationData = {};
                let teamMembers = [];
                if (!team.teamMembers || team.teamMembers.length === 0) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Team Members are required '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                    });
                }

                for (let teamMember of team.teamMembers) {
                    let data = {};
                    if (!teamMember.userId) {
                        
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: 'Please add team members to your on-call schedule '+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                        });
                    }

                    //if any of these values are notspecified, then.
                    if((!teamMember.startTime || !teamMember.endTime || !teamMember.timezone) && (teamMember.startTime || teamMember.endTime || teamMember.timezone)){
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: 'On-Call Start Time, On-Call End Time, and Timezone are required if you select to add "On-call duty times" for a team member'+ (req.body.length>1 ?' in Escalation Policy '+escalationPolicyCount : '')
                        });
                    }

                    if(teamMember.startTime && typeof teamMember.startTime === "string"){
                        teamMember.startTime = new Date(teamMember.startTime);
                    }

                    if(teamMember.endTime && typeof teamMember.endTime === "string"){
                        teamMember.startTime = new Date(teamMember.endTime);
                    }

                    data.userId = teamMember.userId;
                    data.startTime = teamMember.startTime
                    data.endTime = teamMember.endTime
                    data.timezone = teamMember.timezone;
                    teamMembers.push(data);
                }
                
                rotationData.teamMembers = teamMembers;
                tempTeam.push(rotationData);
            }
            storagevalue.teams = tempTeam;
            escalations.push(storagevalue);
        }
        let escalation = await ScheduleService.addEscalation(scheduleId, escalations, userId);
        return sendItemResponse(req, res, escalation);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

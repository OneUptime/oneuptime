
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');

var router = express.Router();
var TeamService = require('../services/teamService');
var isUserAdmin = require('../middlewares/project').isUserAdmin;
var RealTimeService = require('../services/realTimeService');
var NotificationService = require('../services/notificationService');
const getUser = require('../middlewares/user').getUser;
const getSubProjects = require('../middlewares/subProject').getSubProjects;
const {
    isAuthorized
} = require('../middlewares/authorization');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route
// Description: Getting details of team members of the project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.user-> {id}
// Returns: 200: An array of users belonging to the project.
router.get('/:projectId', getUser, isAuthorized, async function (req, res) {
    var projectId = req.params.projectId;

    try{
        // Call the TeamService
        var users = await TeamService.getTeamMembersBy({_id: projectId}); // frontend expects sendItemResponse
        return sendItemResponse(req, res, users);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/:projectId/teamMembers', getUser, isAuthorized, getSubProjects, async function (req, res) {
    var subProjectIds = req.user.subProjects ? req.user.subProjects.map(project => project._id) : null;
    try{
        let subProjectTeamMembers = await Promise.all(subProjectIds.map(async (id)=>{
            let teamMembers = await TeamService.getTeamMembersBy({_id: id});
            let count = teamMembers.length;
            return {teamMembers, count, _id: id};
        }));
        return sendItemResponse(req, res, subProjectTeamMembers); // frontend expects sendItemResponse
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Adding team members by Project Admin.
// Params:
// Param 1: req.body-> {emails, role}; req.headers-> {token}; req.params-> {projectId}
// Returns: 200: An array of users belonging to the project; 400: Error.
router.post('/:projectId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var data = req.body;
    var userId = req.user ? req.user : null;

    if (!data.emails) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Please enter emails of members you want to add to this project.'
        });
    }

    if (typeof data.emails !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Emails is not of type text.'
        });
    }

    if (!data.role) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Please select member role.'
        });
    }

    if (typeof data.role !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Role should be in the text format.'
        });
    }

    try{
        // Call the TeamService
        var users = await TeamService.inviteTeamMembers(req.user.id, req.params.projectId, data.emails, data.role);
        if (!users) {
            return sendErrorResponse( req, res, {
                code: 400,
                message: 'Something went wrong. Please try again.'
            });
        }else {
            await RealTimeService.createTeamMember(req.params.projectId,{users,userId:userId.id});
            return sendItemResponse(req, res, users);
        }
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Removing team member by Project Admin.
// Params:
// Param 1: req.body-> {team_member_id}; req.headers-> {token}; req.params-> {projectId}
// Returns: 200: "User successfully removed"; 400: Error.
router.delete('/:projectId/:teamMemberId', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var userId = req.user ? req.user.id : null;
    var teamMemberUserId = req.params.teamMemberId;
    var projectId = req.params.projectId;

    if (!req.params.teamMemberId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Team member to be deleted from the project must be present.'
        });
    }

    if (typeof req.params.teamMemberId !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Team member to be deleted from the project is not in string type.'
        });
    }

    try{
        // Call the TeamService
        const teamMembers = await TeamService.removeTeamMember(projectId, userId, teamMemberUserId);
        return sendItemResponse(req, res, teamMembers);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Updating role of team member by Project Admin.
// Params:
// Param 1: req.body-> {teamMemberId, role }; req.headers-> {token}; req.params-> {projectId}
// Returns: 200: "Role changed successfully"; 400: Error; 500: Server Error.
router.put('/:projectId/:teamMemberId/changerole', getUser, isAuthorized, isUserAdmin, async function (req, res) {
    var data = req.body;
    data.teamMemberId = req.params.teamMemberId;
    if (!data.teamMemberId) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Team member to be updated from the project must be present.'
        });
    }

    if (typeof data.teamMemberId !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Team member to be updated from the project is not in string type.'
        });
    }

    if (!data.role) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Role must be present.'
        });
    }

    if (typeof data.role !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Role is not in string type.'
        });
    }

    var userId = req.user ? req.user.id : null;
    var teamMemberId = data.teamMemberId;

    try{
        if (data.role === 'Owner') {
            // Call the TeamService
            await TeamService.updateTeamMemberRole(req.params.projectId, userId, teamMemberId, data.role);
            var teamMembers = await TeamService.updateTeamMemberRole(req.params.projectId, userId, userId, data.role);
            await NotificationService.create(req.params.projectId, `A team members role was updated by ${req.user.name}`,req.user.id,'information');
            return sendItemResponse(req, res, teamMembers);
        } else {
            // Call the TeamService
            var updatedTeamMembers = await TeamService.updateTeamMemberRole(req.params.projectId, userId, teamMemberId, data.role);
            await NotificationService.create(req.params.projectId, `A team members role was updated by ${req.user.name}`,req.user.id,'information');
            return sendItemResponse(req, res, updatedTeamMembers);
        }
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
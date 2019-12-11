/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    //Description: Get all team members of Project or Subproject.
    //Params:
    //Param 1: projectId: Project id.
    //Param 2: subProjectId: SubProject id
    //Returns: list of team members
    getTeamMembersBy: async function (query) {
        try {
            var projectMembers = [];
            var projects = await ProjectService.findBy(query);
            if(projects && projects.length > 0){
                // check for parentProject and add parent project users
                if(query.parentProjectId && projects[0]){
                    var parentProject = await ProjectService.findOneBy({ _id: projects[0].parentProjectId, deleted: { $ne: null } });
                    projectMembers = projectMembers.concat(parentProject.users);
                }
                var projectUsers = projects.map(project => project.users);
                projectUsers.map((users)=>{
                    projectMembers = projectMembers.concat(users);
                });
            }
            var usersId = projectMembers.map(user => user.userId.toString() );
            usersId = [...new Set(usersId)];

            let users = [];
            for (let id of usersId){
                var user = await UserService.findOneBy({ _id: id });
                users.push(user);
            }

            var response = [];
            for (let i = 0; i < users.length; i++) {
                if(users[i]){
                    response.push({ userId: users[i]._id, email: users[i].email, name: users[i].name, role: projectMembers[i].role, lastActive: users[i].lastActive });
                }
            }
            return response;
        } catch (error) {
            ErrorService.log('teamService.getTeamMembersBy', error);
            throw error;
        }
    },

    getSeats: async function (members) {
        try {
            var seats = members.filter(async user => {
                var count = 0;
                var user_member = await UserService.findOneBy({ _id: user.userId });
                domains.domains.forEach(domain => {
                    if (user_member.email.indexOf(domain) > -1) {
                        count++;
                    }
                });
                if (count > 0) {
                    return false;
                }
                else {
                    return true;
                }
            });
            await Promise.all(seats);
            seats = seats.length;
            return seats;
        } catch (error) {
            ErrorService.log('teamService.getSeats', error);
            throw error;
        }
    },

    //Description: Invite new team members by Admin.
    //Params:
    //Param 1: projectId: Project id.
    //Param 2: emails: Emails of new user added by Admin.
    //Param 3: role: Role set by Admin.
    //Returns: promise
    inviteTeamMembers: async function (addedByUserId, projectId, emails, role) {
        var addedBy = await UserService.findOneBy({_id: addedByUserId});
        emails = emails.split(',');
        var _this = this;
        var subProject = null;

        //Checks if users to be added to project are not duplicate.
        let duplicateEmail = false;
        emails.forEach(function (element, index) {
            // Find if there is a duplicate or not
            if (emails.indexOf(element, index + 1) > -1) {
                duplicateEmail = true;
            }
        });

        if (duplicateEmail) {
            let error = new Error('Duplicate email present. Please check.');
            error.code = 400;
            throw error;

        } else {
            var project = await ProjectService.findOneBy({ _id: projectId });
            if(project.parentProjectId){
                subProject = project;
                project = await ProjectService.findOneBy({ _id: subProject.parentProjectId });
            }
            var projectTeamMembers = await _this.getTeamMembersBy({ parentProjectId: project._id });
            if(subProject){
                var teamMembers = await _this.getTeamMembersBy({ _id: subProject._id });
            }else{
                teamMembers = await _this.getTeamMembersBy({ _id: project._id });
            }
            // const plan = await Plans.getPlanById(project.stripePlanId);
            var seats = await _this.getSeats(projectTeamMembers);
            var projectSeats = project.seats;
            if (typeof (projectSeats) === 'string') {
                projectSeats = parseInt(projectSeats);
            }

            // Checks if users to be added as team members are already present or not.
            let isUserInProject = await _this.checkUser(teamMembers, emails);
            if (isUserInProject){
                let error = new Error('These users are already members of the project.');
                error.code = 400;
                ErrorService.log('TeamService.inviteTeamMembers', error);
                throw error;
            } else {
                // Get no of users to be added
                var extraUsersToAdd = emails.length;
                try {
                    var invite = await _this.inviteTeamMembersMethod(projectId, emails, role, addedBy, extraUsersToAdd);
                } catch (error) {
                    ErrorService.log('TeamService.inviteTeamMembersMethod', error);
                    throw error;
                }
                return invite;
            }
        }
    },

    async checkUser (teamMembers, emails){
        var teamMembersEmail = [];

        for (let i = 0; i < teamMembers.length; i++) {
            let user = await UserService.findOneBy({ _id: teamMembers[i].userId });
            teamMembersEmail.push(user.email);
        }

        for (let i = 0; i < teamMembersEmail.length; i++) {
            if ((emails.filter(email => email === teamMembersEmail[i])).length > 0) {
                return true;
            }
        }
        return false;
    },

    //Description: Invite new team members method.
    //Params:
    //Param 1: projectId: Project id.
    //Param 2: emails: Emails of new user added by Admin.
    //Param 3: role: Role set by Admin.
    //Param 4: addedBy: Admin who added the user.
    //Param 5: project: Project.
    //Returns: promise
    inviteTeamMembersMethod: async function (projectId, emails, role, addedBy, extraUsersToAdd) {
        try {
            var invitedTeamMembers = [];
            var projectUsers = [];
            var _this = this;
            var subProject = null;
            var project = await ProjectService.findOneBy({_id: projectId});
            var registerUrl = ACCOUNTS_HOST ? `${ACCOUNTS_HOST}/register` : 'https://accounts.fyipe.com/register';
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({_id: subProject.parentProjectId});
            }

            for (var i = 0; i < emails.length; i++) {
                // Finds registered users and new users that will be added as team members.
                var user = await UserService.findOneBy({ email: emails[i] });

                if (user) {
                    invitedTeamMembers.push(user);
                } else {
                    var newUser = await UserService.create({
                        email: emails[i],
                        createdAt: Date.now()
                    });

                    invitedTeamMembers.push(newUser);
                }
            }
            await Promise.all(invitedTeamMembers);
            let members = [];

            for (let member of invitedTeamMembers){
                if (member.name) {
                    projectUsers = await _this.getTeamMembersBy({ parentProjectId: project._id });
                    let userInProject = projectUsers.find(user => user.userId === member._id);
                    if(userInProject){
                        if(role === 'Viewer'){
                            await MailService.sendExistingStatusPageViewerMail(subProject, addedBy, member.email);
                        }else{
                            await MailService.sendExistingUserAddedToSubProjectMail(subProject, addedBy, member.email);
                        }
                        await NotificationService.create(project._id, `New user added to ${subProject.name} subproject by ${addedBy.name}`,addedBy.id,'information');
                    }else{
                        if(role === 'Viewer'){
                            await MailService.sendNewStatusPageViewerMail(project, addedBy, member.email);
                        }else{
                            await MailService.sendExistingUserAddedToProjectMail(project, addedBy, member.email);
                        }
                        await NotificationService.create(project._id, `New user added to the project by ${addedBy.name}`,addedBy.id,'information');
                    }
                } else {
                    if(role === 'Viewer'){
                        await MailService.sendNewStatusPageViewerMail(project, addedBy, member.email);
                    }else{
                        await MailService.sendNewUserAddedToProjectMail(project, addedBy, member.email, registerUrl);
                    }
                    await NotificationService.create(project._id, `New user added to the project by ${addedBy.name}`,addedBy.id,'information');
                }
                members.push({
                    userId: member._id,
                    role: role
                });
            }

            if(subProject){
                members = members.concat(subProject.users);
                await ProjectService.updateOneBy({_id: subProject._id},{ users: members});
            }else{
                let allProjectMembers = members.concat(project.users);
                await ProjectService.updateOneBy({_id: projectId},{ users: allProjectMembers});
                var subProjects = await ProjectService.findBy({parentProjectId: project._id});
                // add user to all subProjects
                await Promise.all(subProjects.map(async(subProject)=>{
                    let subProjectMembers = members.concat(subProject.users);
                    await ProjectService.updateOneBy({_id: subProject._id},{ users: subProjectMembers});
                }));
            }
            projectUsers = await _this.getTeamMembersBy({ parentProjectId: project._id });

            var projectSeats = project.seats;
            if (typeof (projectSeats) === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            var newProjectSeats = projectSeats + extraUsersToAdd;

            await PaymentService.changeSeats(project.stripeSubscriptionId, newProjectSeats);

            await ProjectService.updateOneBy({ _id: project._id},{ seats: newProjectSeats.toString() });

            var response = [];
            var team = await _this.getTeamMembersBy({ _id: project._id });
            var teamusers = {
                projectId: project._id,
                team: team
            };
            response.push(teamusers);
            var subProjectTeams = await ProjectService.findBy({parentProjectId: project._id});
            if(subProjectTeams.length > 0){
                var subProjectTeamsUsers = await Promise.all(subProjectTeams.map(async(subProject)=>{
                    team = await _this.getTeamMembersBy({ _id: subProject._id });
                    teamusers = {
                        projectId: subProject._id,
                        team: team
                    };
                    return teamusers;
                }));
                response = response.concat(subProjectTeamsUsers);
            }
            return response;
        } catch (error) {
            ErrorService.log('teamService.inviteTeamMembersMethod', error);
            throw error;
        }
    },



    //Description: Remove Team Member  by Admin.
    //Params:
    //Param 1: projectId: Admin project id.
    //Param 2: userId: User id of admin.
    //Param 3: teamMemberUserId: Team Member Id of user to delete by Owner.
    //Returns: promise
    removeTeamMember: async function (projectId, userId, teamMemberUserId) {
        var _this = this;
        var index;
        var subProject = null;
        if (userId === teamMemberUserId) {
            let error = new Error('Admin User cannot delete himself');
            error.code = 400;
            ErrorService.log('teamService.inviteTeamMembers', error);
            throw error;

        } else {
            var project = await ProjectService.findOneBy({_id: projectId});
            if(project.parentProjectId){
                subProject = project;
                project = await ProjectService.findOneBy({_id: subProject.parentProjectId});
            }
            if(subProject){
                for (let i = 0; i < subProject.users.length; i++) {
                    if (teamMemberUserId == subProject.users[i].userId) {
                        index = i;
                        break;
                    } else {
                        index = -1;
                    }
                }
            }else{
                for (let i = 0; i < project.users.length; i++) {
                    if (teamMemberUserId == project.users[i].userId) {
                        index = i;
                        break;
                    } else {
                        index = -1;
                    }
                }
            }
            // Checks if team member to be removed is present in the project or not.
            if (index === -1) {
                let error = new Error('Member to be deleted from the project does not exist.');
                error.code = 400;
                ErrorService.log('teamService.removeTeamMember', error);
                throw error;

            } else {
                if(subProject){
                    // removes team member from subProject
                    await ProjectService.exitProject(subProject._id, teamMemberUserId);
                }else{
                    // removes team member from project
                    await ProjectService.exitProject(project._id, teamMemberUserId);

                    // remove user from all subProjects.
                    var subProjects = await ProjectService.findBy({ parentProjectId: project._id});
                    if(subProjects.length > 0){
                        await Promise.all(subProjects.map(async (subProject)=>{
                            await ProjectService.exitProject(subProject._id, teamMemberUserId);
                        }));
                    }
                }

                project = await ProjectService.findOneBy({_id: project._id});
                let user = await UserService.findOneBy({ _id: userId });
                let member = await UserService.findOneBy({ _id: teamMemberUserId });
                if(subProject){
                    await MailService.sendRemoveFromSubProjectEmailToUser(subProject, user, member.email);
                    await NotificationService.create(project._id, `User removed from subproject ${subProject.name} by ${user.name}`,userId,'information');
                }else{
                    await MailService.sendRemoveFromProjectEmailToUser(project, user, member.email);
                    await NotificationService.create(project._id, `User removed from the project by ${user.name}`,userId,'information');
                }
                var team = await _this.getTeamMembersBy({ _id: project._id });

                // send response
                var response = [];
                var teamusers = {
                    projectId: project._id,
                    team: team
                };
                response.push(teamusers);
                var subProjectTeams = await ProjectService.findBy({parentProjectId: project._id});
                if(subProjectTeams.length > 0){
                    var subProjectTeamsUsers = await Promise.all(subProjectTeams.map(async(subProject)=>{
                        team = await _this.getTeamMembersBy({ _id: subProject._id });
                        teamusers = {
                            projectId: subProject._id,
                            team: team
                        };
                        return teamusers;
                    }));
                    response = response.concat(subProjectTeamsUsers);
                }
                team = await _this.getTeamMembersBy({ _id: projectId });
                await RealTimeService.deleteTeamMember(project._id, { response, teamMembers: team, projectId });
                return response;
            }
        }
    },

    //Description: Change Team Member role by Admin.
    //Params:
    //Param 1: projectId: Project id.
    //Param 2: userId: User id.
    //Param 3: teamMemberUserId: id of Team Member.
    //Param 4: nextRole: Role of user to updated by Admin.
    //Returns: promise
    updateTeamMemberRole: async function (projectId, userId, teamMemberUserId, role) {
        try{
            let _this = this;
            var previousRole = '';
            var nextRole = role;
            var index;
            var subProject = null;
            var project = await ProjectService.findOneBy({ _id: projectId });

            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({ _id: subProject.parentProjectId });
            }
            if (subProject) {
                index = subProject.users.findIndex(user => user.userId === teamMemberUserId);
            } else {
                index = project.users.findIndex(user => user.userId === teamMemberUserId);
            }

            // Checks if user to be updated is present in the project.
            if (index === -1) {
                let error = new Error('User whose role is to be changed is not present in the project.');
                error.code = 400;
                ErrorService.log('teamService.updateTeamMemberRole', error);
                throw error;
            } else {
                if(subProject){
                    previousRole = subProject.users[index].role;
                }else{
                    previousRole = project.users[index].role;
                }
                // Checks if next project role is different from previous role.
                if (nextRole === previousRole) {
                    let error = new Error('Please provide role different from current role and try again.');
                    error.code = 400;
                    ErrorService.log('teamService.updateTeamMemberRole', error);
                    throw error;
                } else {
                    if(subProject){
                        subProject.users[index].role = nextRole;
                        // save project
                        subProject = await ProjectService.saveProject(subProject);
                    }else{
                        project.users[index].role = nextRole;
                        // save project
                        project = await ProjectService.saveProject(project);
                        // update user role for all subProjects.
                        var subProjects = await ProjectService.findBy({parentProjectId: project._id});
                        await Promise.all(subProjects.map(async(subProject)=>{
                            index = subProject.users.findIndex(user => user.userId === teamMemberUserId);
                            if(index !== -1){
                                subProject.users[index].role = nextRole;
                                subProject = await ProjectService.saveProject(subProject);
                            }
                        }));
                    }
                    let user = await UserService.findOneBy({ _id: userId });
                    let member = await UserService.findOneBy({ _id: teamMemberUserId });
                    if(subProject){
                        await MailService.sendChangeRoleEmailToUser(subProject, user, member.email, role);
                    }else{
                        await MailService.sendChangeRoleEmailToUser(project, user, member.email, role);
                    }

                    // send response
                    var response = [];
                    var team = await _this.getTeamMembersBy({ _id: project._id });
                    var teamusers = {
                        projectId: project._id,
                        team: team
                    };
                    response.push(teamusers);
                    var subProjectTeams = await ProjectService.findBy({parentProjectId: project._id});
                    if(subProjectTeams.length > 0){
                        var subProjectTeamsUsers = await Promise.all(subProjectTeams.map(async(subProject)=>{
                            team = await _this.getTeamMembersBy({ _id: subProject._id });
                            teamusers = {
                                projectId: subProject._id,
                                team: team
                            };
                            return teamusers;
                        }));
                        response = response.concat(subProjectTeamsUsers);
                    }
                    team = await _this.getTeamMembersBy({ _id: projectId });
                    await RealTimeService.updateTeamMemberRole(project._id, { response, teamMembers: team, projectId });
                    return response;
                }
            }
        } catch (error) {
            ErrorService.log('teamService.updateTeamMemberRole', error);
            throw error;
        }
    }
};

var ProjectService = require('../services/projectService');
var UserService = require('../services/userService');
var MailService = require('../services/mailService');
var PaymentService = require('../services/paymentService');
var NotificationService = require('../services/notificationService');
var RealTimeService = require('../services/realTimeService');
var ErrorService = require('./errorService');
var domains = require('../config/domains');
var { ACCOUNTS_HOST } = process.env;

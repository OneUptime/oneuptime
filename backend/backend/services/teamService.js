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
    getTeamMembersBy: async function(query) {
        try {
            let projectMembers = [];
            const projects = await ProjectService.findBy(query);
            if (projects && projects.length > 0) {
                // check for parentProject and add parent project users
                if (query.parentProjectId && projects[0]) {
                    const parentProject = await ProjectService.findOneBy({
                        _id: projects[0].parentProjectId,
                        deleted: { $ne: null },
                    });
                    projectMembers = projectMembers.concat(parentProject.users);
                }
                const projectUsers = projects.map(project => project.users);
                projectUsers.forEach(users => {
                    projectMembers = projectMembers.concat(users);
                });
            }
            let usersId = projectMembers.map(user => user.userId.toString());
            usersId = [...new Set(usersId)];

            const users = [];
            for (const id of usersId) {
                const user = await UserService.findOneBy({ _id: id });
                users.push(user);
            }

            const response = [];
            for (let i = 0; i < users.length; i++) {
                if (users[i]) {
                    response.push({
                        userId: users[i]._id,
                        email: users[i].email,
                        name: users[i].name,
                        role: projectMembers[i].role,
                        lastActive: users[i].lastActive,
                    });
                }
            }
            return response;
        } catch (error) {
            ErrorService.log('teamService.getTeamMembersBy', error);
            throw error;
        }
    },

    getTeamMemberBy: async function(projectId, teamMemberUserId) {
        let index;
        let subProject = null;

        try {
            let project = await ProjectService.findOneBy({ _id: projectId });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            if (subProject) {
                for (let i = 0; i < subProject.users.length; i++) {
                    if (teamMemberUserId == subProject.users[i].userId) {
                        index = i;
                        break;
                    } else {
                        index = -1;
                    }
                }
            } else {
                for (let i = 0; i < project.users.length; i++) {
                    if (teamMemberUserId == project.users[i].userId) {
                        index = i;
                        break;
                    } else {
                        index = -1;
                    }
                }
            }
            // Checks if team member is present in the project or not.
            if (index === -1) {
                const error = new Error('Member does not exist in project.');
                error.code = 400;
                ErrorService.log('teamService.getTeamMemberBy', error);
                throw error;
            } else {
                const user = await UserService.findOneBy({
                    _id: teamMemberUserId,
                });
                return user;
            }
        } catch (error) {
            ErrorService.log('teamService.getTeamMemberBy', error);
            throw error;
        }
    },

    getSeats: async function(members) {
        try {
            let seats = members.filter(async user => {
                let count = 0;
                const user_member = await UserService.findOneBy({
                    _id: user.userId,
                });
                domains.domains.forEach(domain => {
                    if (user_member.email.indexOf(domain) > -1) {
                        count++;
                    }
                });
                if (count > 0) {
                    return false;
                } else {
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
    inviteTeamMembers: async function(addedByUserId, projectId, emails, role) {
        const addedBy = await UserService.findOneBy({ _id: addedByUserId });
        emails = emails.split(',');
        const _this = this;
        let subProject = null;

        //Checks if users to be added to project are not duplicate.
        let duplicateEmail = false;
        emails.forEach(function(element, index) {
            // Find if there is a duplicate or not
            if (emails.indexOf(element, index + 1) > -1) {
                duplicateEmail = true;
            }
        });

        if (duplicateEmail) {
            const error = new Error('Duplicate email present. Please check.');
            error.code = 400;
            throw error;
        } else {
            let project = await ProjectService.findOneBy({ _id: projectId });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            let teamMembers = null;
            if (subProject) {
                teamMembers = await _this.getTeamMembersBy({
                    _id: subProject._id,
                });
            } else {
                teamMembers = await _this.getTeamMembersBy({
                    _id: project._id,
                });
            }

            let projectSeats = project.seats;
            if (typeof projectSeats === 'string') {
                projectSeats = parseInt(projectSeats);
            }

            // Checks if users to be added as team members are already present or not.
            const isUserInProject = await _this.checkUser(teamMembers, emails);
            if (isUserInProject) {
                const error = new Error(
                    'These users are already members of the project.'
                );
                error.code = 400;
                ErrorService.log('TeamService.inviteTeamMembers', error);
                throw error;
            } else {
                // Get no of users to be added
                const extraUsersToAdd = emails.length;
                try {
                    const invite = await _this.inviteTeamMembersMethod(
                        projectId,
                        emails,
                        role,
                        addedBy,
                        extraUsersToAdd
                    );
                    return invite;
                } catch (error) {
                    ErrorService.log(
                        'TeamService.inviteTeamMembersMethod',
                        error
                    );
                    throw error;
                }
            }
        }
    },

    async checkUser(teamMembers, emails) {
        const teamMembersEmail = [];

        for (let i = 0; i < teamMembers.length; i++) {
            const user = await UserService.findOneBy({
                _id: teamMembers[i].userId,
            });
            teamMembersEmail.push(user.email);
        }

        for (let i = 0; i < teamMembersEmail.length; i++) {
            if (
                emails.filter(email => email === teamMembersEmail[i]).length > 0
            ) {
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
    inviteTeamMembersMethod: async function(
        projectId,
        emails,
        role,
        addedBy,
        extraUsersToAdd
    ) {
        try {
            const invitedTeamMembers = [];
            let projectUsers = [];
            const _this = this;
            let subProject = null;
            let project = await ProjectService.findOneBy({ _id: projectId });
            const registerUrl = `${global.accountsHost}/register`;
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }

            for (let i = 0; i < emails.length; i++) {
                // Finds registered users and new users that will be added as team members.
                const user = await UserService.findOneBy({ email: emails[i] });

                if (user) {
                    invitedTeamMembers.push(user);
                } else {
                    const newUser = await UserService.create({
                        email: emails[i],
                        createdAt: Date.now(),
                    });

                    invitedTeamMembers.push(newUser);
                }
            }
            await Promise.all(invitedTeamMembers);
            let members = [];

            for (const member of invitedTeamMembers) {
                if (member.name) {
                    projectUsers = await _this.getTeamMembersBy({
                        parentProjectId: project._id,
                    });
                    const userInProject = projectUsers.find(
                        user => user.userId === member._id
                    );
                    if (userInProject) {
                        if (role === 'Viewer') {
                            await MailService.sendExistingStatusPageViewerMail(
                                subProject,
                                addedBy,
                                member.email
                            );
                        } else {
                            await MailService.sendExistingUserAddedToSubProjectMail(
                                subProject,
                                addedBy,
                                member.email
                            );
                        }
                        await NotificationService.create(
                            project._id,
                            `New user added to ${subProject.name} subproject by ${addedBy.name}`,
                            addedBy.id,
                            'information'
                        );
                    } else {
                        if (role === 'Viewer') {
                            await MailService.sendNewStatusPageViewerMail(
                                project,
                                addedBy,
                                member.email
                            );
                        } else {
                            await MailService.sendExistingUserAddedToProjectMail(
                                project,
                                addedBy,
                                member.email
                            );
                        }
                        await NotificationService.create(
                            project._id,
                            `New user added to the project by ${addedBy.name}`,
                            addedBy.id,
                            'information'
                        );
                    }
                } else {
                    if (role === 'Viewer') {
                        await MailService.sendNewStatusPageViewerMail(
                            project,
                            addedBy,
                            member.email
                        );
                    } else {
                        await MailService.sendNewUserAddedToProjectMail(
                            project,
                            addedBy,
                            member.email,
                            registerUrl
                        );
                    }
                    await NotificationService.create(
                        project._id,
                        `New user added to the project by ${addedBy.name}`,
                        addedBy.id,
                        'information'
                    );
                }
                members.push({
                    userId: member._id,
                    role: role,
                });
            }

            if (subProject) {
                members = members.concat(subProject.users);
                await ProjectService.updateOneBy(
                    { _id: subProject._id },
                    { users: members }
                );
            } else {
                const allProjectMembers = members.concat(project.users);
                await ProjectService.updateOneBy(
                    { _id: projectId },
                    { users: allProjectMembers }
                );
                const subProjects = await ProjectService.findBy({
                    parentProjectId: project._id,
                });
                // add user to all subProjects
                await Promise.all(
                    subProjects.map(async subProject => {
                        const subProjectMembers = members.concat(
                            subProject.users
                        );
                        await ProjectService.updateOneBy(
                            { _id: subProject._id },
                            { users: subProjectMembers }
                        );
                    })
                );
            }
            projectUsers = await _this.getTeamMembersBy({
                parentProjectId: project._id,
            });

            let projectSeats = project.seats;
            if (typeof projectSeats === 'string') {
                projectSeats = parseInt(projectSeats);
            }
            const newProjectSeats = projectSeats + extraUsersToAdd;

            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                newProjectSeats
            );

            await ProjectService.updateOneBy(
                { _id: project._id },
                { seats: newProjectSeats.toString() }
            );

            let response = [];
            let team = await _this.getTeamMembersBy({ _id: project._id });
            let teamusers = {
                projectId: project._id,
                team: team,
            };
            response.push(teamusers);
            const subProjectTeams = await ProjectService.findBy({
                parentProjectId: project._id,
            });
            if (subProjectTeams.length > 0) {
                const subProjectTeamsUsers = await Promise.all(
                    subProjectTeams.map(async subProject => {
                        team = await _this.getTeamMembersBy({
                            _id: subProject._id,
                        });
                        teamusers = {
                            projectId: subProject._id,
                            team: team,
                        };
                        return teamusers;
                    })
                );
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
    removeTeamMember: async function(projectId, userId, teamMemberUserId) {
        const _this = this;
        let index;
        let subProject = null;
        if (userId === teamMemberUserId) {
            const error = new Error('Admin User cannot delete himself');
            error.code = 400;
            ErrorService.log('teamService.inviteTeamMembers', error);
            throw error;
        } else {
            let project = await ProjectService.findOneBy({ _id: projectId });
            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            if (subProject) {
                for (let i = 0; i < subProject.users.length; i++) {
                    if (teamMemberUserId == subProject.users[i].userId) {
                        index = i;
                        break;
                    } else {
                        index = -1;
                    }
                }
            } else {
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
                const error = new Error(
                    'Member to be deleted from the project does not exist.'
                );
                error.code = 400;
                ErrorService.log('teamService.removeTeamMember', error);
                throw error;
            } else {
                if (subProject) {
                    // removes team member from subProject
                    await ProjectService.exitProject(
                        subProject._id,
                        teamMemberUserId
                    );
                } else {
                    // removes team member from project
                    await ProjectService.exitProject(
                        project._id,
                        teamMemberUserId
                    );

                    // remove user from all subProjects.
                    const subProjects = await ProjectService.findBy({
                        parentProjectId: project._id,
                    });
                    if (subProjects.length > 0) {
                        await Promise.all(
                            subProjects.map(async subProject => {
                                await ProjectService.exitProject(
                                    subProject._id,
                                    teamMemberUserId
                                );
                            })
                        );
                    }
                }

                project = await ProjectService.findOneBy({ _id: project._id });
                const user = await UserService.findOneBy({ _id: userId });
                const member = await UserService.findOneBy({
                    _id: teamMemberUserId,
                });
                if (subProject) {
                    await MailService.sendRemoveFromSubProjectEmailToUser(
                        subProject,
                        user,
                        member.email
                    );
                    await NotificationService.create(
                        project._id,
                        `User removed from subproject ${subProject.name} by ${user.name}`,
                        userId,
                        'information'
                    );
                } else {
                    await MailService.sendRemoveFromProjectEmailToUser(
                        project,
                        user,
                        member.email
                    );
                    await NotificationService.create(
                        project._id,
                        `User removed from the project by ${user.name}`,
                        userId,
                        'information'
                    );
                }
                let team = await _this.getTeamMembersBy({ _id: project._id });

                // send response
                let response = [];
                let teamusers = {
                    projectId: project._id,
                    team: team,
                };
                response.push(teamusers);
                const subProjectTeams = await ProjectService.findBy({
                    parentProjectId: project._id,
                });
                if (subProjectTeams.length > 0) {
                    const subProjectTeamsUsers = await Promise.all(
                        subProjectTeams.map(async subProject => {
                            team = await _this.getTeamMembersBy({
                                _id: subProject._id,
                            });
                            teamusers = {
                                projectId: subProject._id,
                                team: team,
                            };
                            return teamusers;
                        })
                    );
                    response = response.concat(subProjectTeamsUsers);
                }
                team = await _this.getTeamMembersBy({ _id: projectId });
                await RealTimeService.deleteTeamMember(project._id, {
                    response,
                    teamMembers: team,
                    projectId,
                });
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
    updateTeamMemberRole: async function(
        projectId,
        userId,
        teamMemberUserId,
        role
    ) {
        try {
            const _this = this;
            let previousRole = '';
            const nextRole = role;
            let index;
            let subProject = null;
            let project = await ProjectService.findOneBy({ _id: projectId });

            if (project.parentProjectId) {
                subProject = project;
                project = await ProjectService.findOneBy({
                    _id: subProject.parentProjectId,
                });
            }
            if (subProject) {
                index = subProject.users.findIndex(
                    user => user.userId === teamMemberUserId
                );
            } else {
                index = project.users.findIndex(
                    user => user.userId === teamMemberUserId
                );
            }

            // Checks if user to be updated is present in the project.
            if (index === -1) {
                const error = new Error(
                    'User whose role is to be changed is not present in the project.'
                );
                error.code = 400;
                ErrorService.log('teamService.updateTeamMemberRole', error);
                throw error;
            } else {
                if (subProject) {
                    previousRole = subProject.users[index].role;
                } else {
                    previousRole = project.users[index].role;
                }
                // Checks if next project role is different from previous role.
                if (nextRole === previousRole) {
                    const error = new Error(
                        'Please provide role different from current role and try again.'
                    );
                    error.code = 400;
                    ErrorService.log('teamService.updateTeamMemberRole', error);
                    throw error;
                } else {
                    if (subProject) {
                        subProject.users[index].role = nextRole;
                        // save project
                        subProject = await ProjectService.saveProject(
                            subProject
                        );
                    } else {
                        project.users[index].role = nextRole;
                        // save project
                        project = await ProjectService.saveProject(project);
                        // update user role for all subProjects.
                        const subProjects = await ProjectService.findBy({
                            parentProjectId: project._id,
                        });
                        await Promise.all(
                            subProjects.map(async subProject => {
                                index = subProject.users.findIndex(
                                    user => user.userId === teamMemberUserId
                                );
                                if (index !== -1) {
                                    subProject.users[index].role = nextRole;
                                    subProject = await ProjectService.saveProject(
                                        subProject
                                    );
                                }
                            })
                        );
                    }
                    const user = await UserService.findOneBy({ _id: userId });
                    const member = await UserService.findOneBy({
                        _id: teamMemberUserId,
                    });
                    if (subProject) {
                        await MailService.sendChangeRoleEmailToUser(
                            subProject,
                            user,
                            member.email,
                            role
                        );
                    } else {
                        await MailService.sendChangeRoleEmailToUser(
                            project,
                            user,
                            member.email,
                            role
                        );
                    }

                    // send response
                    let response = [];
                    let team = await _this.getTeamMembersBy({
                        _id: project._id,
                    });
                    let teamusers = {
                        projectId: project._id,
                        team: team,
                    };
                    response.push(teamusers);
                    const subProjectTeams = await ProjectService.findBy({
                        parentProjectId: project._id,
                    });
                    if (subProjectTeams.length > 0) {
                        const subProjectTeamsUsers = await Promise.all(
                            subProjectTeams.map(async subProject => {
                                team = await _this.getTeamMembersBy({
                                    _id: subProject._id,
                                });
                                teamusers = {
                                    projectId: subProject._id,
                                    team: team,
                                };
                                return teamusers;
                            })
                        );
                        response = response.concat(subProjectTeamsUsers);
                    }
                    team = await _this.getTeamMembersBy({ _id: projectId });
                    await RealTimeService.updateTeamMemberRole(project._id, {
                        response,
                        teamMembers: team,
                        projectId,
                    });
                    return response;
                }
            }
        } catch (error) {
            ErrorService.log('teamService.updateTeamMemberRole', error);
            throw error;
        }
    },
};

const ProjectService = require('../services/projectService');
const UserService = require('../services/userService');
const MailService = require('../services/mailService');
const PaymentService = require('../services/paymentService');
const NotificationService = require('../services/notificationService');
const RealTimeService = require('../services/realTimeService');
const ErrorService = require('./errorService');
const domains = require('../config/domains');

export default {
    //Description: Get all team members of Project or Subproject.
    //Params:
    //Param 1: projectId: Project id.
    //Param 2: subProjectId: SubProject id
    //Returns: list of team members
    getTeamMembersBy: async function(query: $TSFixMe) {
        let projectMembers: $TSFixMe = [];
        
        const projects = await ProjectService.findBy({
            query,
            select: 'users parentProjectId',
        });
        if (projects && projects.length > 0) {
            // check for parentProject and add parent project users
            if (query.parentProjectId && projects[0]) {
                
                const parentProject = await ProjectService.findOneBy({
                    query: {
                        _id: projects[0].parentProjectId,
                        deleted: { $ne: null },
                    },
                    select: 'users',
                });
                projectMembers = projectMembers.concat(parentProject.users);
            }
            const projectUsers = projects.map(
                (project: $TSFixMe) => project.users
            );
            projectUsers.forEach((users: $TSFixMe) => {
                projectMembers = projectMembers.concat(users);
            });
        }

        let usersId: $TSFixMe = [];
        
        // eslint-disable-next-line array-callback-return
        projectMembers.map(user => {
            if (user.show) {
                usersId.push(user.userId.toString());
            }
        });

        usersId = [...new Set(usersId)];

        const users = await UserService.findBy({
            query: { _id: usersId },
            select: '_id email name lastActive',
        });

        const response = [];
        for (let i = 0; i < users.length; i++) {
            const memberDetail = projectMembers.filter(
                
                member => member.userId === users[i]._id.toString()
            )[0];

            response.push({
                userId: users[i]._id,
                email: users[i].email,
                name: users[i].name,
                role: memberDetail.role,
                lastActive: users[i].lastActive,
                show: memberDetail.show,
            });
        }
        return response;
    },

    getTeamMemberBy: async function(
        projectId: $TSFixMe,
        teamMemberUserId: $TSFixMe
    ) {
        let index;
        let subProject = null;

        
        let project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId users',
        });
        if (project.parentProjectId) {
            subProject = project;
            
            project = await ProjectService.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: 'users',
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
            throw error;
        } else {
            const select =
                'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            const user = await UserService.findOneBy({
                query: { _id: teamMemberUserId },
                select,
            });
            return user;
        }
    },

    getSeats: async function(members: $TSFixMe) {
        let seats = members.filter(async (user: $TSFixMe) => {
            let count = 0;
            const user_member = await UserService.findOneBy({
                query: { _id: user.userId },
                select: 'email',
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
    },

    //Description: Invite new team members by Admin.
    //Params:
    //Param 1: projectId: Project id.
    //Param 2: emails: Emails of new user added by Admin.
    //Param 3: role: Role set by Admin.
    //Returns: promise
    inviteTeamMembers: async function(
        addedByUserId: $TSFixMe,
        projectId: $TSFixMe,
        emails: $TSFixMe,
        role: $TSFixMe
    ) {
        const addedBy = await UserService.findOneBy({
            query: { _id: addedByUserId },
            select: 'name _id',
        });
        emails = emails.toLowerCase().split(',');
        const _this = this;
        let subProject = null;

        //Checks if users to be added to project are not duplicate.
        let duplicateEmail = false;
        emails.forEach(function(element: $TSFixMe, index: $TSFixMe) {
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
            
            let project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProjectId seats',
            });
            if (project && project.parentProjectId) {
                subProject = project;
                
                project = await ProjectService.findOneBy({
                    query: { _id: subProject.parentProjectId },
                    select: 'seats',
                });
            }
            const teamMembers = await _this.getTeamMembers(projectId);
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
                throw error;
            } else {
                // remove hidden admin if on list
                const adminUser = await UserService.findOneBy({
                    query: { role: 'master-admin' },
                    select: '_id projects email',
                });

                if (adminUser && emails.includes(adminUser.email)) {
                    const isAdminInProject = adminUser.projects.filter(
                        (proj: $TSFixMe) =>
                            proj._id.toString() === projectId.toString()
                    );
                    let isHiddenAdminUser = false;

                    if (isAdminInProject) {
                        isHiddenAdminUser = isAdminInProject[0]?.users.filter(
                            (user: $TSFixMe) =>
                                user.show === false &&
                                user.role === 'Administrator' &&
                                user.userId === adminUser._id.toString()
                        );
                    }

                    
                    if (isHiddenAdminUser && isHiddenAdminUser.length > 0) {
                        await _this.removeTeamMember(
                            projectId,
                            addedBy._id,
                            adminUser._id
                        );
                    }
                }

                // Get no of users to be added
                const extraUsersToAdd = emails.length;
                const invite = await _this.inviteTeamMembersMethod(
                    projectId,
                    emails,
                    role,
                    addedBy,
                    extraUsersToAdd
                );
                return invite;
            }
        }
    },

    //Description: Retrieve Members, Administrator and Owners of a Project or subProject
    //Params:
    //Param 1: projectId: Project id.
    //Returns: promise
    getTeamMembers: async function(projectId: $TSFixMe) {
        const _this = this;
        
        const subProject = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId',
        });
        if (subProject && subProject.parentProjectId) {
            
            const project = await ProjectService.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: '_id',
            });
            return await _this.getTeamMembersBy({
                _id: project._id,
            });
        }
        if (subProject) {
            return await _this.getTeamMembersBy({
                _id: subProject._id,
            });
        }
        return [];
    },

    isValidBusinessEmails: function(emails: $TSFixMe) {
        let valid = true;
        if (emails && emails.length > 0) {
            for (let i = 0; i < emails.length; i++) {
                if (!emaildomains.test(emails[i])) {
                    valid = false;
                    break;
                }
            }
        }
        return valid;
    },

    async checkUser(teamMembers: $TSFixMe, emails: $TSFixMe) {
        const teamMembersEmail: $TSFixMe = [];

        for (let i = 0; i < teamMembers.length; i++) {
            const user = await UserService.findOneBy({
                query: { _id: teamMembers[i].userId },
                select: 'email',
            });
            teamMembersEmail.push(user.email);
        }

        for (let i = 0; i < teamMembersEmail.length; i++) {
            if (
                emails.filter(
                    (email: $TSFixMe) => email === teamMembersEmail[i]
                ).length > 0
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
        projectId: $TSFixMe,
        emails: $TSFixMe,
        role: $TSFixMe,
        addedBy: $TSFixMe,
        extraUsersToAdd: $TSFixMe
    ) {
        const invitedTeamMembers = [];
        let projectUsers = [];
        const _this = this;
        let subProject = null;
        
        let project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId seats _id users stripeSubscriptionId name',
        });
        if (project && project.parentProjectId) {
            subProject = project;
            
            project = await ProjectService.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: 'seats _id users stripeSubscriptionId name',
            });
        }

        for (let i = 0; i < emails.length; i++) {
            const email = emails[i];
            if (!email) {
                continue;
            }
            // Finds registered users and new users that will be added as team members.
            const user = await UserService.findOneBy({
                query: { email },
                select: 'name email _id',
            });

            if (user) {
                invitedTeamMembers.push(user);
            } else {
                const newUser = await UserService.create({
                    email,
                });

                invitedTeamMembers.push(newUser);
            }
        }
        await Promise.all(invitedTeamMembers);
        let members = [];

        for (const member of invitedTeamMembers) {
            
            let registerUrl = `${global.accountsHost}/register`;
            if (member.name) {
                projectUsers = await _this.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                const userInProject = projectUsers.find(
                    user => user.userId === member._id
                );
                try {
                    if (userInProject) {
                        if (role === 'Viewer') {
                            MailService.sendExistingStatusPageViewerMail(
                                subProject,
                                addedBy,
                                member.email
                            );
                        } else {
                            MailService.sendExistingUserAddedToSubProjectMail(
                                subProject,
                                addedBy,
                                member.email
                            );
                        }
                        
                        NotificationService.create(
                            project._id,
                            `New user added to ${subProject.name} subproject by ${addedBy.name}`,
                            addedBy.id,
                            'information'
                        );
                    } else {
                        if (role === 'Viewer') {
                            MailService.sendNewStatusPageViewerMail(
                                project,
                                addedBy,
                                member.email
                            );
                        } else {
                            MailService.sendExistingUserAddedToProjectMail(
                                project,
                                addedBy,
                                member.email
                            );
                        }
                        
                        NotificationService.create(
                            project._id,
                            `New user added to the project by ${addedBy.name}`,
                            addedBy.id,
                            'information'
                        );
                    }
                } catch (error) {
                    ErrorService.log(
                        'teamService.inviteTeamMembersMethod',
                        error
                    );
                }
            } else {
                const verificationTokenModel = new VerificationTokenModel({
                    userId: member._id,
                    token: crypto.randomBytes(16).toString('hex'),
                });
                const verificationToken = await verificationTokenModel.save();
                if (verificationToken) {
                    
                    registerUrl = `${registerUrl}?token=${verificationToken.token}`;
                }
                try {
                    if (role === 'Viewer') {
                        MailService.sendNewStatusPageViewerMail(
                            project,
                            addedBy,
                            member.email
                        );
                    } else {
                        MailService.sendNewUserAddedToProjectMail(
                            project,
                            addedBy,
                            member.email,
                            registerUrl
                        );
                    }
                    
                    NotificationService.create(
                        project._id,
                        `New user added to the project by ${addedBy.name}`,
                        addedBy.id,
                        'information'
                    );
                } catch (error) {
                    ErrorService.log(
                        'teamService.inviteTeamMembersMethod',
                        error
                    );
                }
            }
            members.push({
                userId: member._id,
                role: role,
            });
        }
        const existingUsers = await _this.getTeamMembersBy({
            parentProjectId: project._id,
        });

        if (subProject) {
            members = members.concat(subProject.users);
            await ProjectService.updateOneBy(
                { _id: subProject._id },
                { users: members }
            );
        } else {
            const allProjectMembers = members.concat(project.users);
            const [, subProjects] = await Promise.all([
                ProjectService.updateOneBy(
                    { _id: projectId },
                    { users: allProjectMembers }
                ),
                
                ProjectService.findBy({
                    query: { parentProjectId: project._id },
                    select: 'users _id',
                }),
            ]);
            // add user to all subProjects
            for (const subProject of subProjects) {
                const subProjectMembers = members
                    .map(user => ({ ...user, show: false }))
                    .concat(subProject.users);
                await ProjectService.updateOneBy(
                    { _id: subProject._id },
                    { users: subProjectMembers }
                );
            }
        }
        projectUsers = await _this.getTeamMembersBy({
            parentProjectId: project._id,
        });

        let projectSeats = project.seats;
        if (typeof projectSeats === 'string') {
            projectSeats = parseInt(projectSeats);
        }
        for (const email of emails) {
            const user = existingUsers.find(
                data => String(data.email) === String(email)
            );
            if (user) {
                extraUsersToAdd = extraUsersToAdd - 1;
            }
        }
        let newProjectSeats = projectSeats;

        if (role !== 'Viewer') {
            newProjectSeats = projectSeats + extraUsersToAdd;
        }

        if (IS_SAAS_SERVICE) {
            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                newProjectSeats
            );
        }

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
            query: { parentProjectId: project._id },
            select: '_id',
        });
        if (subProjectTeams.length > 0) {
            const subProjectTeamsUsers = await Promise.all(
                subProjectTeams.map(async (subProject: $TSFixMe) => {
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
    },

    //Description: Remove Team Member  by Admin.
    //Params:
    //Param 1: projectId: Admin project id.
    //Param 2: userId: User id of admin.
    //Param 3: teamMemberUserId: Team Member Id of user to delete by Owner.
    //Returns: promise
    removeTeamMember: async function(
        projectId: $TSFixMe,
        userId: $TSFixMe,
        teamMemberUserId: $TSFixMe
    ) {
        const _this = this;
        let index;
        let subProject = null;

        if (userId === teamMemberUserId) {
            const error = new Error('Admin User cannot delete himself');
            
            error.code = 400;
            throw error;
        } else {
            
            let project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'parentProjectId users _id',
            });
            if (project.parentProjectId) {
                subProject = project;
                
                project = await ProjectService.findOneBy({
                    query: { _id: subProject.parentProjectId },
                    select: 'users _id',
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
                throw error;
            } else {
                if (subProject) {
                    // removes team member from subProject
                    
                    await ProjectService.exitProject(
                        subProject._id,
                        teamMemberUserId,
                        userId
                    );
                } else {
                    // removes team member from project
                    
                    await ProjectService.exitProject(
                        project._id,
                        teamMemberUserId,
                        userId
                    );
                    // remove user from all subProjects.
                    
                    const subProjects = await ProjectService.findBy({
                        query: { parentProjectId: project._id },
                        select: '_id',
                    });
                    if (subProjects.length > 0) {
                        await Promise.all(
                            subProjects.map(async (subProject: $TSFixMe) => {
                                
                                await ProjectService.exitProject(
                                    subProject._id,
                                    teamMemberUserId,
                                    userId
                                );
                            })
                        );
                    }
                }

                const [projectObj, user, member] = await Promise.all([
                    
                    ProjectService.findOneBy({
                        query: { _id: project._id },
                        select: '_id name',
                    }),
                    UserService.findOneBy({
                        query: { _id: userId },
                        select: 'name',
                    }),
                    UserService.findOneBy({
                        query: { _id: teamMemberUserId },
                        select: 'email',
                    }),
                ]);
                project = projectObj;

                try {
                    if (subProject) {
                        MailService.sendRemoveFromSubProjectEmailToUser(
                            subProject,
                            user,
                            member.email
                        );
                        
                        NotificationService.create(
                            project._id,
                            `User removed from subproject ${subProject.name} by ${user.name}`,
                            userId,
                            'information'
                        );
                    } else {
                        MailService.sendRemoveFromProjectEmailToUser(
                            project,
                            user,
                            member.email
                        );
                        
                        NotificationService.create(
                            project._id,
                            `User removed from the project by ${user.name}`,
                            userId,
                            'information'
                        );
                    }
                } catch (error) {
                    ErrorService.log('teamService.removeTeamMember', error);
                }
                let team = await _this.getTeamMembersBy({
                    _id: project._id,
                });

                // send response
                let response = [];
                let teamusers = {
                    projectId: project._id,
                    team: team,
                };
                response.push(teamusers);
                
                const subProjectTeams = await ProjectService.findBy({
                    query: { parentProjectId: project._id },
                    select: '_id',
                });
                if (subProjectTeams.length > 0) {
                    const subProjectTeamsUsers = await Promise.all(
                        subProjectTeams.map(async (subProject: $TSFixMe) => {
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
                // run in the background
                // RealTimeService.deleteTeamMember(project._id, {
                //     response,
                //     teamMembers: team,
                //     projectId,
                // });
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
        projectId: $TSFixMe,
        userId: $TSFixMe,
        teamMemberUserId: $TSFixMe,
        role: $TSFixMe
    ) {
        const _this = this;
        let previousRole = '';
        const nextRole = role;
        let index;
        let subProject = null;
        let subProjects = null;
        
        let project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId users _id name seats stripeSubscriptionId',
        });

        if (project.parentProjectId) {
            subProject = project;
            
            project = await ProjectService.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: 'users _id name seats stripeSubscriptionId',
            });
        }
        if (subProject) {
            index = subProject.users.findIndex(
                (user: $TSFixMe) => user.userId === teamMemberUserId
            );
        } else {
            index = project.users.findIndex(
                (user: $TSFixMe) => user.userId === teamMemberUserId
            );
        }

        
        subProjects = await ProjectService.findBy({
            query: { parentProjectId: project._id },
            select: 'users _id',
        });
        const prevTeams = subProjects
            .concat(project)
            .map((res: $TSFixMe) => res.users);
        const prevFlatTeams = flatten(prevTeams);
        const prevTeamArr = prevFlatTeams.filter(
            user => String(user.userId) === String(teamMemberUserId)
        );
        const checkPrevViewer = prevTeamArr.every(
            data => data.role === 'Viewer'
        );

        // Checks if user to be updated is present in the project.
        if (index === -1) {
            const error = new Error(
                'User whose role is to be changed is not present in the project.'
            );
            
            error.code = 400;
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
                throw error;
            } else {
                if (subProject) {
                    subProject.users[index].role = nextRole;
                    await ProjectService.updateOneBy(
                        { _id: subProject._id },
                        { users: subProject.users }
                    );
                } else {
                    project.users[index].role = nextRole;
                    await ProjectService.updateOneBy(
                        { _id: project._id },
                        { users: project.users }
                    );
                    // update user role for all subProjects.

                    await Promise.all(
                        subProjects.map(async (subProject: $TSFixMe) => {
                            index = subProject.users.findIndex(
                                (user: $TSFixMe) =>
                                    user.userId === teamMemberUserId
                            );
                            if (index !== -1) {
                                subProject.users[index].role = nextRole;
                                await ProjectService.updateOneBy(
                                    { _id: subProject._id },
                                    { users: subProject.users }
                                );
                            }
                        })
                    );
                }
                const [user, member] = await Promise.all([
                    UserService.findOneBy({
                        query: { _id: userId },
                        select: 'name',
                    }),
                    UserService.findOneBy({
                        query: { _id: teamMemberUserId },
                        select: 'email',
                    }),
                ]);
                try {
                    if (subProject) {
                        MailService.sendChangeRoleEmailToUser(
                            subProject,
                            user,
                            member.email,
                            role
                        );
                    } else {
                        MailService.sendChangeRoleEmailToUser(
                            project,
                            user,
                            member.email,
                            role
                        );
                    }
                } catch (error) {
                    ErrorService.log('teamService.updateTeamMemberRole', error);
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
                    query: { parentProjectId: project._id },
                    select: '_id',
                });
                if (subProjectTeams.length > 0) {
                    const subProjectTeamsUsers = await Promise.all(
                        subProjectTeams.map(async (subProject: $TSFixMe) => {
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

                // run in the background
                RealTimeService.updateTeamMemberRole(project._id, {
                    response,
                    teamMembers: team,
                    projectId,
                });
                const teams = response.map(res => res.team);
                const flatTeams = flatten(teams);
                const teamArr = flatTeams.filter(
                    team => String(team.userId) === String(teamMemberUserId)
                );
                const checkCurrentViewer = teamArr.every(
                    data => data.role === 'Viewer'
                );
                let projectSeats = project.seats;

                if (typeof projectSeats === 'string') {
                    projectSeats = parseInt(projectSeats);
                }
                if (nextRole === 'Viewer' && checkCurrentViewer) {
                    projectSeats = projectSeats - 1;
                } else if (previousRole === 'Viewer' && checkPrevViewer) {
                    projectSeats = projectSeats + 1;
                }
                await PaymentService.changeSeats(
                    project.stripeSubscriptionId,
                    projectSeats
                );
                await ProjectService.updateOneBy(
                    { _id: project._id },
                    { seats: projectSeats.toString() }
                );
                return response;
            }
        }
    },
};

import ProjectService from '../services/projectService';
import UserService from '../services/userService';
import MailService from '../services/mailService';
import PaymentService from '../services/paymentService';
import NotificationService from '../services/notificationService';
import RealTimeService from '../services/realTimeService';
import ErrorService from 'common-server/utils/error';
import domains from '../config/domains';
import VerificationTokenModel from '../models/verificationToken';
import crypto from 'crypto';

import { IS_SAAS_SERVICE } from '../config/server';

import { emaildomains } from '../config/emaildomains';
import flatten from '../utils/flattenArray';

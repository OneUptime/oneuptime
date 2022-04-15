import Query from '../Types/DB/Query';
import BadDataException from 'Common/Types/Exception/BadDataException';
export default class Service {
    /*
     * Description: Get all team members of Project or Subproject.
     * Params:
     * Param 1: projectId: Project id.
     * Param 2: subProjectId: SubProject id
     * Returns: list of team members
     */
    public async getTeamMembersBy(query: Query): void {
        let projectMembers: $TSFixMe = [];

        const projects: $TSFixMe = await ProjectService.findBy({
            query,
            select: 'users parentProjectId',
        });
        if (projects && projects.length > 0) {
            // Check for parentProject and add parent project users
            if (query.parentProjectId && projects[0]) {
                const parentProject: $TSFixMe = await ProjectService.findOneBy({
                    query: {
                        _id: projects[0].parentProjectId,
                        deleted: { $ne: null },
                    },
                    select: 'users',
                });
                projectMembers = projectMembers.concat(parentProject.users);
            }
            const projectUsers: $TSFixMe = projects.map((project: $TSFixMe) => {
                return project.users;
            });
            projectUsers.forEach((users: $TSFixMe) => {
                projectMembers = projectMembers.concat(users);
            });
        }

        let usersId: $TSFixMe = [];

        // eslint-disable-next-line array-callback-return
        projectMembers.map((user: $TSFixMe) => {
            if (user.show) {
                usersId.push(user.userId.toString());
            }
        });

        usersId = [...new Set(usersId)];

        const users: $TSFixMe = await UserService.findBy({
            query: { _id: usersId },
            select: '_id email name lastActive',
        });

        const response: $TSFixMe = [];
        for (let i: $TSFixMe = 0; i < users.length; i++) {
            const memberDetail: $TSFixMe = projectMembers.filter(
                (member: $TSFixMe) => {
                    return member.userId === users[i]._id.toString();
                }
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
    }

    public async getTeamMemberBy(
        projectId: ObjectID,
        teamMemberUserId: ObjectID
    ): void {
        let index: $TSFixMe;
        let subProject: $TSFixMe = null;

        let project: $TSFixMe = await ProjectService.findOneBy({
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
            for (let i: $TSFixMe = 0; i < subProject.users.length; i++) {
                if (teamMemberUserId == subProject.users[i].userId) {
                    index = i;
                    break;
                } else {
                    index = -1;
                }
            }
        } else {
            for (let i: $TSFixMe = 0; i < project.users.length; i++) {
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
            throw new BadDataException('Member does not exist in project.');
        } else {
            const select: $TSFixMe =
                'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: teamMemberUserId },
                select,
            });
            return user;
        }
    }

    public async getSeats(members: $TSFixMe): void {
        let seats: $TSFixMe = members.filter(async (user: $TSFixMe) => {
            let count: $TSFixMe = 0;
            const user_member: $TSFixMe = await UserService.findOneBy({
                query: { _id: user.userId },
                select: 'email',
            });
            domains.domains.forEach((domain: $TSFixMe) => {
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
    }

    /*
     * Description: Invite new team members by Admin.
     * Params:
     * Param 1: projectId: Project id.
     * Param 2: emails: Emails of new user added by Admin.
     * Param 3: role: Role set by Admin.
     * Returns: promise
     */
    public async inviteTeamMembers(
        addedByUserId: ObjectID,
        projectId: ObjectID,
        emails: $TSFixMe,
        role: $TSFixMe
    ): void {
        const addedBy: $TSFixMe = await UserService.findOneBy({
            query: { _id: addedByUserId },
            select: 'name _id',
        });
        emails = emails.toLowerCase().split(',');

        let subProject: $TSFixMe = null;

        //Checks if users to be added to project are not duplicate.
        let duplicateEmail: $TSFixMe = false;
        emails.forEach((element: $TSFixMe, index: $TSFixMe): void => {
            // Find if there is a duplicate or not
            if (emails.indexOf(element, index + 1) > -1) {
                duplicateEmail = true;
            }
        });

        if (duplicateEmail) {
            throw new BadDataException(
                'Duplicate email present. Please check.'
            );
        } else {
            let project: $TSFixMe = await ProjectService.findOneBy({
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
            const teamMembers: $TSFixMe = await this.getTeamMembers(projectId);
            let projectSeats: $TSFixMe = project.seats;
            if (typeof projectSeats === 'string') {
                projectSeats = parseInt(projectSeats);
            }

            // Checks if users to be added as team members are already present or not.
            const isUserInProject: $TSFixMe = await this.checkUser(
                teamMembers,
                emails
            );
            if (isUserInProject) {
                const error: $TSFixMe = new Error(
                    'These users are already members of the project.'
                );

                error.code = 400;
                throw error;
            } else {
                // Remove hidden admin if on list
                const adminUser: $TSFixMe = await UserService.findOneBy({
                    query: { role: 'master-admin' },
                    select: '_id projects email',
                });

                if (adminUser && emails.includes(adminUser.email)) {
                    const isAdminInProject: $TSFixMe =
                        adminUser.projects.filter((proj: $TSFixMe) => {
                            return proj._id.toString() === projectId.toString();
                        });
                    let isHiddenAdminUser: $TSFixMe = false;

                    if (isAdminInProject) {
                        isHiddenAdminUser = isAdminInProject[0]?.users.filter(
                            (user: $TSFixMe) => {
                                return (
                                    user.show === false &&
                                    user.role === 'Administrator' &&
                                    user.userId === adminUser._id.toString()
                                );
                            }
                        );
                    }

                    if (isHiddenAdminUser && isHiddenAdminUser.length > 0) {
                        await this.removeTeamMember(
                            projectId,
                            addedBy._id,
                            adminUser._id
                        );
                    }
                }

                // Get no of users to be added
                const extraUsersToAdd: $TSFixMe = emails.length;
                const invite: $TSFixMe = await this.inviteTeamMembersMethod(
                    projectId,
                    emails,
                    role,
                    addedBy,
                    extraUsersToAdd
                );
                return invite;
            }
        }
    }

    /*
     * Description: Retrieve Members, Administrator and Owners of a Project or subProject
     * Params:
     * Param 1: projectId: Project id.
     * Returns: promise
     */
    public async getTeamMembers(projectId: ObjectID): void {
        const subProject: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'parentProjectId',
        });
        if (subProject && subProject.parentProjectId) {
            const project: $TSFixMe = await ProjectService.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: '_id',
            });
            return await this.getTeamMembersBy({
                _id: project._id,
            });
        }
        if (subProject) {
            return await this.getTeamMembersBy({
                _id: subProject._id,
            });
        }
        return [];
    }

    public isValidBusinessEmails(emails: $TSFixMe): void {
        let valid: $TSFixMe = true;
        if (emails && emails.length > 0) {
            for (let i: $TSFixMe = 0; i < emails.length; i++) {
                if (!emaildomains.test(emails[i])) {
                    valid = false;
                    break;
                }
            }
        }
        return valid;
    }

    public async checkUser(teamMembers: $TSFixMe, emails: $TSFixMe): void {
        const teamMembersEmail: $TSFixMe = [];

        for (let i: $TSFixMe = 0; i < teamMembers.length; i++) {
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: teamMembers[i].userId },
                select: 'email',
            });
            teamMembersEmail.push(user.email);
        }

        for (let i: $TSFixMe = 0; i < teamMembersEmail.length; i++) {
            if (
                emails.filter((email: $TSFixMe) => {
                    return email === teamMembersEmail[i];
                }).length > 0
            ) {
                return true;
            }
        }
        return false;
    }

    /*
     * Description: Invite new team members method.
     * Params:
     * Param 1: projectId: Project id.
     * Param 2: emails: Emails of new user added by Admin.
     * Param 3: role: Role set by Admin.
     * Param 4: addedBy: Admin who added the user.
     * Param 5: project: Project.
     * Returns: promise
     */
    public async inviteTeamMembersMethod(
        projectId: ObjectID,
        emails: $TSFixMe,
        role: $TSFixMe,
        addedBy: $TSFixMe,
        extraUsersToAdd: $TSFixMe
    ): void {
        const invitedTeamMembers: $TSFixMe = [];
        let projectUsers: $TSFixMe = [];

        let subProject: $TSFixMe = null;

        let project: $TSFixMe = await ProjectService.findOneBy({
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

        for (let i: $TSFixMe = 0; i < emails.length; i++) {
            const email: $TSFixMe = emails[i];
            if (!email) {
                continue;
            }
            // Finds registered users and new users that will be added as team members.
            const user: $TSFixMe = await UserService.findOneBy({
                query: { email },
                select: 'name email _id',
            });

            if (user) {
                invitedTeamMembers.push(user);
            } else {
                const newUser: $TSFixMe = await UserService.create({
                    email,
                });

                invitedTeamMembers.push(newUser);
            }
        }
        await Promise.all(invitedTeamMembers);
        let members: $TSFixMe = [];

        for (const member of invitedTeamMembers) {
            let registerUrl: string = `${global.accountsHost}/register`;
            if (member.name) {
                projectUsers = await this.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                const userInProject: $TSFixMe = projectUsers.find(
                    (user: $TSFixMe) => {
                        return user.userId === member._id;
                    }
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
                const verificationTokenModel: $TSFixMe =
                    new VerificationTokenModel({
                        userId: member._id,
                        token: crypto.randomBytes(16).toString('hex'),
                    });
                const verificationToken: $TSFixMe =
                    await verificationTokenModel.save();
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
        const existingUsers: $TSFixMe = await this.getTeamMembersBy({
            parentProjectId: project._id,
        });

        if (subProject) {
            members = members.concat(subProject.users);
            await ProjectService.updateOneBy(
                { _id: subProject._id },
                { users: members }
            );
        } else {
            const allProjectMembers: $TSFixMe = members.concat(project.users);
            const [, subProjects]: $TSFixMe = await Promise.all([
                ProjectService.updateOneBy(
                    { _id: projectId },
                    { users: allProjectMembers }
                ),

                ProjectService.findBy({
                    query: { parentProjectId: project._id },
                    select: 'users _id',
                }),
            ]);
            // Add user to all subProjects
            for (const subProject of subProjects) {
                const subProjectMembers: $TSFixMe = members
                    .map((user: $TSFixMe) => {
                        return { ...user, show: false };
                    })
                    .concat(subProject.users);
                await ProjectService.updateOneBy(
                    { _id: subProject._id },
                    { users: subProjectMembers }
                );
            }
        }
        projectUsers = await this.getTeamMembersBy({
            parentProjectId: project._id,
        });

        let projectSeats: $TSFixMe = project.seats;
        if (typeof projectSeats === 'string') {
            projectSeats = parseInt(projectSeats);
        }
        for (const email of emails) {
            const user: $TSFixMe = existingUsers.find((data: $TSFixMe) => {
                return String(data.email) === String(email);
            });
            if (user) {
                extraUsersToAdd = extraUsersToAdd - 1;
            }
        }
        let newProjectSeats: $TSFixMe = projectSeats;

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

        let response: $TSFixMe = [];
        let team: $TSFixMe = await this.getTeamMembersBy({ _id: project._id });
        let teamusers: $TSFixMe = {
            projectId: project._id,
            team: team,
        };
        response.push(teamusers);

        const subProjectTeams: $TSFixMe = await ProjectService.findBy({
            query: { parentProjectId: project._id },
            select: '_id',
        });
        if (subProjectTeams.length > 0) {
            const subProjectTeamsUsers: $TSFixMe = await Promise.all(
                subProjectTeams.map(async (subProject: $TSFixMe) => {
                    team = await this.getTeamMembersBy({
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
    }

    /*
     * Description: Remove Team Member  by Admin.
     * Params:
     * Param 1: projectId: Admin project id.
     * Param 2: userId: User id of admin.
     * Param 3: teamMemberUserId: Team Member Id of user to delete by Owner.
     * Returns: promise
     */
    public async removeTeamMember(
        projectId: ObjectID,
        userId: ObjectID,
        teamMemberUserId: ObjectID
    ): void {
        let index: $TSFixMe;
        let subProject: $TSFixMe = null;

        if (userId === teamMemberUserId) {
            throw new BadDataException('Admin User cannot delete himself');
        } else {
            let project: $TSFixMe = await ProjectService.findOneBy({
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
                for (let i: $TSFixMe = 0; i < subProject.users.length; i++) {
                    if (teamMemberUserId == subProject.users[i].userId) {
                        index = i;
                        break;
                    } else {
                        index = -1;
                    }
                }
            } else {
                for (let i: $TSFixMe = 0; i < project.users.length; i++) {
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
                const error: $TSFixMe = new Error(
                    'Member to be deleted from the project does not exist.'
                );

                error.code = 400;
                throw error;
            } else {
                if (subProject) {
                    // Removes team member from subProject

                    await ProjectService.exitProject(
                        subProject._id,
                        teamMemberUserId,
                        userId
                    );
                } else {
                    // Removes team member from project

                    await ProjectService.exitProject(
                        project._id,
                        teamMemberUserId,
                        userId
                    );
                    // Remove user from all subProjects.

                    const subProjects: $TSFixMe = await ProjectService.findBy({
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

                const [projectObj, user, member]: $TSFixMe = await Promise.all([
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
                let team: $TSFixMe = await this.getTeamMembersBy({
                    _id: project._id,
                });

                // Send response
                let response: $TSFixMe = [];
                let teamusers: $TSFixMe = {
                    projectId: project._id,
                    team: team,
                };
                response.push(teamusers);

                const subProjectTeams: $TSFixMe = await ProjectService.findBy({
                    query: { parentProjectId: project._id },
                    select: '_id',
                });
                if (subProjectTeams.length > 0) {
                    const subProjectTeamsUsers: $TSFixMe = await Promise.all(
                        subProjectTeams.map(async (subProject: $TSFixMe) => {
                            team = await this.getTeamMembersBy({
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
                team = await this.getTeamMembersBy({ _id: projectId });
                /*
                 * Run in the background
                 * RealTimeService.deleteTeamMember(project._id, {
                 *     Response,
                 *     TeamMembers: team,
                 *     ProjectId,
                 * });
                 */
                return response;
            }
        }
    }

    /*
     * Description: Change Team Member role by Admin.
     * Params:
     * Param 1: projectId: Project id.
     * Param 2: userId: User id.
     * Param 3: teamMemberUserId: id of Team Member.
     * Param 4: nextRole: Role of user to updated by Admin.
     * Returns: promise
     */
    public async updateTeamMemberRole(
        projectId: ObjectID,
        userId: ObjectID,
        teamMemberUserId: ObjectID,
        role: $TSFixMe
    ): void {
        let previousRole: $TSFixMe = '';
        const nextRole: $TSFixMe = role;
        let index: $TSFixMe;
        let subProject: $TSFixMe = null;
        let subProjects: $TSFixMe = null;

        let project: $TSFixMe = await ProjectService.findOneBy({
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
            index = subProject.users.findIndex((user: $TSFixMe) => {
                return user.userId === teamMemberUserId;
            });
        } else {
            index = project.users.findIndex((user: $TSFixMe) => {
                return user.userId === teamMemberUserId;
            });
        }

        subProjects = await ProjectService.findBy({
            query: { parentProjectId: project._id },
            select: 'users _id',
        });
        const prevTeams: $TSFixMe = subProjects
            .concat(project)
            .map((res: $TSFixMe) => {
                return res.users;
            });
        const prevFlatTeams: $TSFixMe = flatten(prevTeams);
        const prevTeamArr: $TSFixMe = prevFlatTeams.filter((user: $TSFixMe) => {
            return String(user.userId) === String(teamMemberUserId);
        });
        const checkPrevViewer: $TSFixMe = prevTeamArr.every(
            (data: $TSFixMe) => {
                return data.role === 'Viewer';
            }
        );

        // Checks if user to be updated is present in the project.
        if (index === -1) {
            const error: $TSFixMe = new Error(
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
                const error: $TSFixMe = new Error(
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
                    // Update user role for all subProjects.

                    await Promise.all(
                        subProjects.map(async (subProject: $TSFixMe) => {
                            index = subProject.users.findIndex(
                                (user: $TSFixMe) => {
                                    return user.userId === teamMemberUserId;
                                }
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
                const [user, member]: $TSFixMe = await Promise.all([
                    UserService.findOneBy({
                        query: { _id: userId },
                        select: 'name',
                    }),
                    UserService.findOneBy({
                        query: { _id: teamMemberUserId },
                        select: 'email',
                    }),
                ]);

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

                // Send response
                let response: $TSFixMe = [];
                let team: $TSFixMe = await this.getTeamMembersBy({
                    _id: project._id,
                });
                let teamusers: $TSFixMe = {
                    projectId: project._id,
                    team: team,
                };
                response.push(teamusers);

                const subProjectTeams: $TSFixMe = await ProjectService.findBy({
                    query: { parentProjectId: project._id },
                    select: '_id',
                });
                if (subProjectTeams.length > 0) {
                    const subProjectTeamsUsers: $TSFixMe = await Promise.all(
                        subProjectTeams.map(async (subProject: $TSFixMe) => {
                            team = await this.getTeamMembersBy({
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
                team = await this.getTeamMembersBy({ _id: projectId });

                // Run in the background
                RealTimeService.updateTeamMemberRole(project._id, {
                    response,
                    teamMembers: team,
                    projectId,
                });
                const teams: $TSFixMe = response.map((res: $TSFixMe) => {
                    return res.team;
                });
                const flatTeams: $TSFixMe = flatten(teams);
                const teamArr: $TSFixMe = flatTeams.filter((team: $TSFixMe) => {
                    return String(team.userId) === String(teamMemberUserId);
                });
                const checkCurrentViewer: $TSFixMe = teamArr.every(
                    (data: $TSFixMe) => {
                        return data.role === 'Viewer';
                    }
                );
                let projectSeats: $TSFixMe = project.seats;

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
    }
}

import ProjectService from './ProjectService';
import UserService from './UserService';
import MailService from '../../MailService/Services/MailService';
import PaymentService from './PaymentService';
import NotificationService from './NotificationService';
import RealTimeService from './realTimeService';
import ErrorService from '../Utils/error';
import domains from '../config/domains';
import VerificationTokenModel from '../Models/verificationToken';
import ObjectID from 'Common/Types/ObjectID';
import crypto from 'crypto';

import { IS_SAAS_SERVICE } from '../config/server';

import { emaildomains } from '../config/emaildomains';
import flatten from '../Utils/flattenArray';

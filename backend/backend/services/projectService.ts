export default {
    
    findBy: async function({ query, limit, skip, select, populate }) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let projectQuery = ProjectModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        projectQuery = handleSelect(select, projectQuery);
        projectQuery = handlePopulate(populate, projectQuery);

        const projects = await projectQuery;
        return projects;
    },

    
    create: async function(data) {
        const _this = this;
        const projectModel = new ProjectModel();
        const adminUser = await UserService.findOneBy({
            query: { role: 'master-admin' },
            select: '_id',
        });
        if (data.parentProjectId) {
            
            const parentProject = await _this.findOneBy({
                query: { _id: data.parentProjectId },
                select: 'users',
            });
            
            projectModel.users = parentProject.users.map(user => ({
                ...user,
                show: false,
            }));
        } else {
            if (
                adminUser?._id &&
                data.userId.toString() !== adminUser._id.toString()
            ) {
                
                projectModel.users = [
                    {
                        userId: data.userId,
                        role: 'Owner',
                    },
                    {
                        userId: adminUser._id,
                        role: 'Administrator',
                        show: false,
                    },
                ];
            } else {
                
                projectModel.users = [
                    {
                        userId: data.userId,
                        role: 'Owner',
                    },
                ];
            }
        }
        
        projectModel.name = data.name || null;
        if (data && data.name) {
            
            projectModel.slug = getSlug(data.name);
        }
        
        projectModel.apiKey = uuidv1();
        
        projectModel.stripePlanId = data.stripePlanId || null;
        
        projectModel.stripeSubscriptionId = data.stripeSubscriptionId || null;
        
        projectModel.parentProjectId = data.parentProjectId || null;
        
        projectModel.seats = '1';
        
        projectModel.isBlocked = data.isBlocked || false;
        
        projectModel.adminNotes = data.adminNotes || null;
        const project = await projectModel.save();

        const prioritiesData = {
            high: {
                projectId: project._id,
                name: 'High',
                color: {
                    r: 255,
                    g: 0,
                    b: 0,
                    a: 1,
                },
            },
            low: {
                projectId: project._id,
                name: 'Low',
                color: {
                    r: 255,
                    g: 211,
                    b: 0,
                    a: 1,
                },
            },
        };
        const [priority] = await Promise.all([
            IncidentPrioritiesService.create(prioritiesData.high),
            IncidentPrioritiesService.create(prioritiesData.low),
        ]);
        // create initial default incident template
        await IncidentSettingsService.create({
            name: 'Default',
            projectId: project._id,
            isDefault: true,
            incidentPriority: priority._id,
            title: '{{monitorName}} is {{incidentType}}.',
            description:
                '{{monitorName}} is {{incidentType}}. This incident is currently being investigated by our team and more information will be added soon.',
        });
        return project;
    },

    
    countBy: async function(query) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        const count = await ProjectModel.countDocuments(query);
        return count;
    },

    
    deleteBy: async function(query, userId, cancelSub = true) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        let project = await ProjectModel.findOne(query);
        if (project) {
            if (project.stripeSubscriptionId && cancelSub) {
                await PaymentService.removeSubscription(
                    project.stripeSubscriptionId
                );
            }
            const populateSchedule = [
                { path: 'userIds', select: 'name' },
                { path: 'createdById', select: 'name' },
                { path: 'monitorIds', select: 'name' },
                {
                    path: 'projectId',
                    select: '_id name slug',
                },
                {
                    path: 'escalationIds',
                    select: 'teams',
                    populate: {
                        path: 'teams.teamMembers.userId',
                        select: 'name email',
                    },
                },
            ];

            const selectSchedule =
                '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

            const populateComponent = [
                { path: 'projectId', select: 'name' },
                { path: 'componentCategoryId', select: 'name' },
            ];

            const selectComponent =
                '_id createdAt name createdById projectId slug componentCategoryId';

            const populateStatusPage = [
                {
                    path: 'projectId',
                    select: 'name parentProjectId',
                    populate: { path: 'parentProjectId', select: '_id' },
                },
                {
                    path: 'domains.domainVerificationToken',
                    select: 'domain verificationToken verified ',
                },
                {
                    path: 'monitors.monitor',
                    select: 'name',
                },
            ];

            const selectStatusPage =
                '_id projectId domains monitors links twitterHandle slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

            const populateDefaultRoleSso = [
                { path: 'domain', select: '_id domain' },
                { path: 'project', select: '_id name' },
            ];

            const selectDefaultRoleSso =
                '_id domain project role createdAt deleted deletedAt deletedById';
            const [
                monitors,
                schedules,
                domains,
                statusPages,
                components,
                ssoDefaultRoles,
            ] = await Promise.all([
                MonitorService.findBy({
                    query: { projectId: project._id },
                    select: '_id',
                }),
                ScheduleService.findBy({
                    query: { projectId: project._id },
                    select: selectSchedule,
                    populate: populateSchedule,
                }),
                DomainVerificationService.findBy({
                    query: { projectId: project._id },
                    select: '_id',
                }),
                StatusPageService.findBy({
                    query: { projectId: project._id },
                    select: selectStatusPage,
                    populate: populateStatusPage,
                }),
                componentService.findBy({
                    query: { projectId: project._id },
                    select: selectComponent,
                    populate: populateComponent,
                }),
                SsoDefaultRolesService.findBy({
                    query: { project: project._id },
                    select: selectDefaultRoleSso,
                    populate: populateDefaultRoleSso,
                }),
                integrationService.deleteBy({ projectId: project._id }, userId),
            ]);

            await Promise.all(
                
                monitors.map(async monitor => {
                    await MonitorService.deleteBy({ _id: monitor._id }, userId);
                })
            );

            await Promise.all(
                
                schedules.map(async schedule => {
                    
                    await ScheduleService.deleteBy({ _id: schedule._id });
                })
            );

            for (const domain of domains) {
                await DomainVerificationService.deleteBy({
                    _id: domain._id,
                });
            }

            await Promise.all(
                
                statusPages.map(async statusPage => {
                    
                    await StatusPageService.deleteBy({
                        _id: statusPage._id,
                    });
                })
            );

            await Promise.all(
                
                components.map(async component => {
                    await componentService.deleteBy(
                        { _id: component._id },
                        userId
                    );
                })
            );

            for (const ssoDefaultRole of ssoDefaultRoles) {
                const { _id } = ssoDefaultRole;
                await SsoDefaultRolesService.deleteBy({ _id });
            }

            project = await ProjectModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedById: userId,
                        deletedAt: Date.now(),
                    },
                },
                {
                    new: true,
                }
            );
        }
        return project;
    },
    
    findOneBy: async function({ query, select, populate }) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        let projectQuery = ProjectModel.findOne(query)
            .lean()
            .sort([['createdAt', -1]]);

        projectQuery = handleSelect(select, projectQuery);
        projectQuery = handlePopulate(populate, projectQuery);

        const project = await projectQuery;
        return project;
    },

    
    updateOneBy: async function(query, data) {
        const _this = this;
        if (!query) {
            query = {};
        }
        
        const oldProject = await _this.findOneBy({
            query: Object.assign({}, query, { deleted: { $ne: null } }),
            select: 'apiKey',
        });
        if (!data.apiKey && !oldProject.apiKey) {
            data.apiKey = uuidv1();
        }

        if (data && data.name) {
            data.slug = getSlug(data.name);
        }

        let updatedProject = await ProjectModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        const populate = [{ path: 'parentProjectId', select: 'name' }];
        const select = `_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes
            sendCreatedIncidentNotificationSms sendAcknowledgedIncidentNotificationSms sendResolvedIncidentNotificationSms
            sendCreatedIncidentNotificationEmail sendAcknowledgedIncidentNotificationEmail sendResolvedIncidentNotificationEmail
            sendCreatedIncidentNotificationEmail sendAcknowledgedIncidentNotificationEmail sendResolvedIncidentNotificationEmail
            enableInvestigationNoteNotificationSMS enableInvestigationNoteNotificationEmail sendAnnouncementNotificationSms
            sendAnnouncementNotificationEmail sendCreatedScheduledEventNotificationSms sendCreatedScheduledEventNotificationEmail
            sendScheduledEventResolvedNotificationSms sendScheduledEventResolvedNotificationEmail sendNewScheduledEventInvestigationNoteNotificationSms
            sendNewScheduledEventInvestigationNoteNotificationEmail sendScheduledEventCancelledNotificationSms sendScheduledEventCancelledNotificationEmail
            enableInvestigationNoteNotificationWebhook unpaidSubscriptionNotifications`; // All these are needed during state update
        updatedProject = await _this.findOneBy({
            query: Object.assign({}, query, { deleted: { $ne: null } }),
            select,
            populate,
        });
        return updatedProject;
    },

    
    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await ProjectModel.updateMany(query, {
            $set: data,
        });

        const populate = [{ path: 'parentProjectId', select: 'name' }];
        const select =
            '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

        
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    },

    
    updateAlertOptions: async function(data) {
        const projectId = data._id;
        const userId = data.userId;
        const project = await ProjectModel.findById(projectId).lean();
        const currentBalance = project.balance;
        const { minimumBalance, rechargeToBalance } = data.alertOptions;
        let updatedProject = {};

        if (!data.alertEnable) {
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        alertEnable: false,
                    },
                },
                { new: true }
            );
            return updatedProject;
        }

        if (currentBalance >= minimumBalance) {
            // update settings, the current balance satisfies incoming project's alert settings
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        alertEnable: data.alertEnable,
                        alertOptions: data.alertOptions,
                    },
                },
                { new: true }
            );
            return updatedProject;
        }
        const chargeForBalance = await StripeService.chargeCustomerForBalance(
            userId,
            rechargeToBalance,
            projectId,
            data.alertOptions
        );
        if (chargeForBalance) {
            const newBalance = rechargeToBalance + currentBalance;
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId,
                {
                    $set: {
                        balance: newBalance,
                        alertEnable: data.alertEnable,
                        alertOptions: data.alertOptions,
                    },
                },
                { new: true }
            );
            if (chargeForBalance.client_secret) {
                
                updatedProject.paymentIntent = chargeForBalance.client_secret;
            }
            return updatedProject;
        } else {
            const error = new Error('Cannot save project settings');
            
            error.code = 403;
            throw error;
        }
    },
    
    saveProject: async function(project) {
        project = await project.save();
        return project;
    },

    
    getProjectIdsBy: async function(query) {
        const _this = this;
        
        const projects = await _this.findBy({ query, select: '_id' });
        const projectsId = [];

        for (let i = 0; i < projects.length; i++) {
            projectsId.push(projects[i]._id);
        }
        return projectsId;
    },
    
    getBalance: async function(query) {
        const project = await ProjectModel.findOne(query).select('balance');
        return project;
    },
    
    resetApiKey: async function(projectId) {
        const _this = this;
        const apiKey = uuidv1();
        const project = await _this.updateOneBy(
            { _id: projectId },
            { apiKey: apiKey }
        );
        return project;
    },

    
    upgradeToEnterprise: async function(projectId) {
        const data = { stripePlanId: 'enterprise', stripeSubscriptionId: null };
        
        const project = await this.findOneBy({
            query: { _id: projectId },
            select: 'stripeSubscriptionId',
        });
        if (data.stripeSubscriptionId !== null) {
            await PaymentService.removeSubscription(
                project.stripeSubscriptionId
            );
        }
        const updatedProject = await this.updateOneBy({ _id: projectId }, data);
        return updatedProject;
    },

    
    changePlan: async function(projectId, userId, planId) {
        const _this = this;
        let project = await _this.updateOneBy(
            { _id: projectId },
            { stripePlanId: planId }
        );

        if (!project.stripeSubscriptionId) {
            //on enterprise plan stripeSubscriptionId is null
            //downgrading from enterprise plan
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'stripeCustomerId',
            });
            
            const { stripeSubscriptionId } = await PaymentService.subscribePlan(
                planId,
                user.stripeCustomerId
            );

            project = await _this.updateOneBy(
                { _id: project._id },
                { stripeSubscriptionId: stripeSubscriptionId }
            );
            return project;
        } else {
            const stripeSubscriptionId = await PaymentService.changePlan(
                project.stripeSubscriptionId,
                planId,
                project.users.length
            );

            project = await _this.updateOneBy(
                { _id: project._id },
                { stripeSubscriptionId: stripeSubscriptionId }
            );
            return project;
        }
    },

    
    findSubprojectId: async function(projectId) {
        const _this = this;
        
        const subProject = await _this.findBy({
            query: { parentProjectId: projectId },
            select: '_id',
        });
        
        const subProjectId = subProject.map(sub => String(sub._id));
        const projectIdArr = [projectId, ...subProjectId];
        return projectIdArr;
    },

    getUniqueMembersIndividualProject: async function({
        
        isFlatenArr,
        
        members,
    }) {
        
        let result = [];
        if (!isFlatenArr) {
            for (const member of members) {
                const track = {},
                    data = [];
                for (const user of member) {
                    
                    if (!track[user.userId]) {
                        
                        track[user.userId] = user.userId;
                        data.push(user);
                    }
                }
                
                result = [...result, data];
            }
        } else {
            const track = {};
            for (const member of members) {
                
                if (!track[member.userId]) {
                    
                    track[member.userId] = member.userId;
                    result.push(member);
                }
            }
        }
        return result;
    },

    
    exitProject: async function(projectId, userId, deletedById, saveUserSeat) {
        const _this = this,
            returnVal = 'User successfully exited the project';
        let teamMember = {};
        
        const userProject = await _this.findOneBy({
            query: { _id: projectId },
            select: 'users',
        });
        teamMember = userProject.users.find(
            
            user => String(user.userId) === String(userId)
        );
        let subProject = null;
        let subProjects = null;
        
        let project = await _this.findOneBy({
            query: { _id: projectId, 'users.userId': userId },
            select: 'parentProjectId users _id seats stripeSubscriptionId',
        });
        if (project?.parentProjectId) {
            subProject = project;
            
            project = await _this.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: '_id users seats stripeSubscriptionId',
            });
        }
        
        subProjects = await _this.findBy({
            query: { parentProjectId: project?._id },
            select: 'users _id seats',
        });
        const allMembers = subProjects.concat(project);
        
        let subMembers = subProjects.map(user => user.users);
        subMembers = await _this.getUniqueMembersIndividualProject({
            members: subMembers,
            isFlatenArr: false,
        });
        const projectMembers = await _this.getUniqueMembersIndividualProject({
            members: project?.users || [],
            isFlatenArr: true,
        });
        const flatSubMembers = flattenArray(subMembers);
        const teams = flatSubMembers.concat(projectMembers);
        const filteredTeam = teams.filter(
            user =>
                String(user.userId) === String(userId) &&
                
                String(user._id) !== String(teamMember?._id)
        );
        const teamByUserId = teams.filter(
            user => String(user.userId) === String(userId)
        );
        const isViewer = filteredTeam.every(data => data.role === 'Viewer');
        if (project) {
            const users = subProject ? subProject.users : project.users;
            projectId = subProject ? subProject._id : project._id;
            const remainingUsers = [];
            for (const user of users) {
                if (user.userId != userId) {
                    remainingUsers.push(user);
                }
            }
            await Promise.all([
                _this.updateOneBy(
                    { _id: projectId },
                    { users: remainingUsers }
                ),
                EscalationService.deleteEscalationMember(
                    projectId,
                    userId,
                    deletedById
                ),
            ]);
            
            const countUserInSubProjects = await _this.findBy({
                query: {
                    parentProjectId: project._id,
                    'users.userId': userId,
                },
                select: '_id',
            });
            if (!saveUserSeat) {
                let projectSeats = project.seats;
                if (typeof projectSeats === 'string') {
                    projectSeats = parseInt(projectSeats);
                }
                if (
                    countUserInSubProjects &&
                    countUserInSubProjects.length < 1
                ) {
                    let count = 0;
                    const user_member = await UserService.findOneBy({
                        query: { _id: userId },
                        select: 'email',
                    });
                    domains.domains.forEach(async domain => {
                        if (user_member.email.indexOf(domain) > -1) {
                            count++;
                        }
                    });
                    let subProjectIds = [];
                    if (subProjects && subProjects.length > 0) {
                        
                        subProjectIds = subProjects.map(project => project._id);
                    }
                    subProjectIds.push(project._id);
                    const countMonitor = await MonitorService.countBy({
                        projectId: { $in: subProjectIds },
                    });
                    // check if project seat after reduction still caters for monitors.
                    if (
                        !IS_SAAS_SERVICE ||
                        (count < 1 && countMonitor <= (projectSeats - 1) * 5)
                    ) {
                        // check if project seat after reduction still caters for monitors.
                    }
                }
                const confirmParentProject =
                    allMembers[allMembers.length - 1]._id === projectId;
                if (confirmParentProject) {
                    if (!teamByUserId.every(data => data.role === 'Viewer')) {
                        projectSeats = projectSeats - 1;
                        _this.updateSeatDetails(project, projectSeats);
                        return returnVal;
                    }
                    
                } else if (teamMember.role !== 'Viewer' && isViewer) {
                    projectSeats = projectSeats - 1;
                    _this.updateSeatDetails(project, projectSeats);
                    return returnVal;
                }
            }
        }
        return returnVal;
    },

    
    updateSeatDetails: async function(project, projectSeats) {
        const _this = this;
        if (IS_SAAS_SERVICE) {
            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                projectSeats
            );
        }
        await _this.updateOneBy(
            { _id: project._id },
            { seats: projectSeats.toString() }
        );
    },

    
    hardDeleteBy: async function(query) {
        await ProjectModel.deleteMany(query);
        return 'Project(s) Removed Successfully!';
    },

    
    getAllProjects: async function(skip, limit) {
        const _this = this;
        const populate = [{ path: 'parentProjectId', select: 'name' }];
        const select =
            '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

        let projects = await _this.findBy({
            query: { parentProjectId: null, deleted: { $ne: null } },
            limit,
            skip,
            populate,
            select,
        });

        projects = await Promise.all(
            
            projects.map(async project => {
                // get both sub-project users and project users
                let users = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                if (users.length < 1) {
                    users = await TeamService.getTeamMembersBy({
                        _id: project._id,
                    });
                }
                const projectObj = Object.assign({}, project._doc || project, {
                    users,
                });
                return projectObj;
            })
        );
        return projects;
    },

    
    getUserProjects: async function(userId, skip, limit) {
        const _this = this;
        // find user subprojects and parent projects
        
        const userProjects = await _this.findBy({
            query: { 'users.userId': userId, deleted: { $ne: null } },
            select: 'parentProjectId',
        });
        let parentProjectIds = [];
        let projectIds = [];
        if (userProjects.length > 0) {
            const subProjects = userProjects
                
                .map(project => (project.parentProjectId ? project : null))
                
                .filter(subProject => subProject !== null);
            parentProjectIds = subProjects.map(
                
                subProject =>
                    subProject.parentProjectId._id || subProject.parentProjectId
            );
            const projects = userProjects
                
                .map(project => (project.parentProjectId ? null : project))
                
                .filter(project => project !== null);
            
            projectIds = projects.map(project => project._id);
        }

        // query data
        const query = {
            $or: [
                { _id: { $in: parentProjectIds } },
                { _id: { $in: projectIds } },
            ],
            deleted: { $ne: null },
        };
        const populate = [{ path: 'parentProjectId', select: 'name' }];
        const select =
            '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes createdAt';

        const [allProjects, count] = await Promise.all([
            _this.findBy({
                query,
                limit: limit || 10,
                skip: skip || 0,
                select,
                populate,
            }),
            _this.countBy(query),
        ]);

        // add project monitors
        const projects = await Promise.all(
            
            allProjects.map(async project => {
                // get both sub-project users and project users
                let users = [];
                if (project.parentProjectId) {
                    users = await TeamService.getTeamMembersBy({
                        parentProjectId:
                            project.parentProjectId._id ||
                            project.parentProjectId,
                    });
                    project.users = users;
                } else {
                    const select =
                        'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
                    users = await Promise.all(
                        
                        project.users.map(async user => {
                            const foundUser = await UserService.findOneBy({
                                query: {
                                    _id: user.userId,
                                    deleted: { $ne: null },
                                },
                                select,
                            });

                            // append user's project role different from system role
                            return { ...foundUser, projectRole: user.role };
                        })
                    );
                    project.users = users;
                }
                return Object.assign({}, project._doc || project, {
                    users,
                });
            })
        );
        return { projects, count };
    },

    
    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;

        
        let project = await _this.findOneBy({
            query,
            select: '_id users stripeCustomerId',
        });

        if (!project) {
            const error = new Error('Project not found or no longer exist');
            
            error.code = 400;
            throw error;
        }

        const projectId = project._id;
        const projectOwners = project.users.filter(
            
            user => user.role === 'Owner'
        );
        let subscription;
        await Promise.all(
            
            projectOwners.map(async projectOwner => {
                const owner = await UserService.findOneBy({
                    query: { _id: projectOwner.userId },
                    select: 'stripeCustomerId',
                });
                if (IS_SAAS_SERVICE) {
                    
                    subscription = await PaymentService.subscribePlan(
                        project.stripePlanId,
                        owner.stripeCustomerId
                    );
                }
            })
        );

        project = await _this.updateOneBy(
            { _id: projectId },
            {
                deleted: false,
                deletedBy: null,
                deletedAt: null,
                stripeSubscriptionId: subscription
                    ? 
                      subscription.stripeSubscriptionId
                    : null,
            }
        );

        const projectSeats = project.seats;
        if (IS_SAAS_SERVICE) {
            await PaymentService.changeSeats(
                project.stripeSubscriptionId,
                projectSeats
            );
        }
        await Promise.all([
            ScheduleService.restoreBy({
                projectId,
                deleted: true,
            }),
            StatusPageService.restoreBy({
                projectId,
                deleted: true,
            }),
            integrationService.restoreBy({
                projectId,
                deleted: true,
            }),
            MonitorService.restoreBy({
                projectId,
                deleted: true,
            }),
            componentService.restoreBy({
                projectId: projectId,
                deleted: true,
            }),
        ]);
        return project;
    },

    
    addNotes: async function(projectId, notes) {
        const _this = this;
        const project = await _this.updateOneBy(
            { _id: projectId },
            {
                adminNotes: notes,
            }
        );
        return project;
    },

    
    searchProjects: async function(query, skip, limit) {
        const _this = this;
        const select = '_id slug name';
        
        let projects = await _this.findBy({ query, limit, skip, select });

        projects = await Promise.all(
            
            projects.map(async project => {
                // get both sub-project users and project users
                let users = await TeamService.getTeamMembersBy({
                    parentProjectId: project._id,
                });
                if (users.length < 1) {
                    users = await TeamService.getTeamMembersBy({
                        _id: project._id,
                    });
                }
                const projectObj = Object.assign({}, project._doc || project, {
                    users,
                });
                return projectObj;
            })
        );
        return projects;
    },
};

import ProjectModel from '../models/project';

import { v1 as uuidv1 } from 'uuid';
import MonitorService from '../services/monitorService';
import PaymentService from './paymentService';
import UserService from './userService';
import IncidentPrioritiesService from './incidentPrioritiesService';
import integrationService from './integrationService';
import ScheduleService from './scheduleService';
import domains from '../config/domains'; // removal of 'moment' due to declaration but not used.
import EscalationService from './escalationService';
import StripeService from './stripeService';
import TeamService from './teamService';
import StatusPageService from './statusPageService';

import { IS_SAAS_SERVICE } from '../config/server';
import componentService from './componentService';
import DomainVerificationService from './domainVerificationService';
import SsoDefaultRolesService from './ssoDefaultRolesService';
import getSlug from '../utils/getSlug';
import flattenArray from '../utils/flattenArray';
import IncidentSettingsService from './incidentSettingsService';
import handlePopulate from '../utils/populate';
import handleSelect from '../utils/select';

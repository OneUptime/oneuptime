export default {
    // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'query' implicitly has an 'any' ty... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
    create: async function(data) {
        const _this = this;
        const projectModel = new ProjectModel();
        const adminUser = await UserService.findOneBy({
            query: { role: 'master-admin' },
            select: '_id',
        });
        if (data.parentProjectId) {
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            const parentProject = await _this.findOneBy({
                query: { _id: data.parentProjectId },
                select: 'users',
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Document<... Remove this comment to see the full error message
            projectModel.users = parentProject.users.map(user => ({
                ...user,
                show: false,
            }));
        } else {
            if (
                adminUser?._id &&
                data.userId.toString() !== adminUser._id.toString()
            ) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Document<... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'users' does not exist on type 'Document<... Remove this comment to see the full error message
                projectModel.users = [
                    {
                        userId: data.userId,
                        role: 'Owner',
                    },
                ];
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        projectModel.name = data.name || null;
        if (data && data.name) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'slug' does not exist on type 'Document<a... Remove this comment to see the full error message
            projectModel.slug = getSlug(data.name);
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'apiKey' does not exist on type 'Document... Remove this comment to see the full error message
        projectModel.apiKey = uuidv1();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'stripePlanId' does not exist on type 'Do... Remove this comment to see the full error message
        projectModel.stripePlanId = data.stripePlanId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'stripeSubscriptionId' does not exist on ... Remove this comment to see the full error message
        projectModel.stripeSubscriptionId = data.stripeSubscriptionId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'parentProjectId' does not exist on type ... Remove this comment to see the full error message
        projectModel.parentProjectId = data.parentProjectId || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'seats' does not exist on type 'Document<... Remove this comment to see the full error message
        projectModel.seats = '1';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'isBlocked' does not exist on type 'Docum... Remove this comment to see the full error message
        projectModel.isBlocked = data.isBlocked || false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'adminNotes' does not exist on type 'Docu... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    countBy: async function(query) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        const count = await ProjectModel.countDocuments(query);
        return count;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
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
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'monitor' implicitly has an 'any' type.
                monitors.map(async monitor => {
                    await MonitorService.deleteBy({ _id: monitor._id }, userId);
                })
            );

            await Promise.all(
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'schedule' implicitly has an 'any' type.
                schedules.map(async schedule => {
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                    await ScheduleService.deleteBy({ _id: schedule._id });
                })
            );

            for (const domain of domains) {
                await DomainVerificationService.deleteBy({
                    _id: domain._id,
                });
            }

            await Promise.all(
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'map' does not exist on type '{}'.
                statusPages.map(async statusPage => {
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
                    await StatusPageService.deleteBy({
                        _id: statusPage._id,
                    });
                })
            );

            await Promise.all(
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'component' implicitly has an 'any' type... Remove this comment to see the full error message
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
    // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'query' implicitly has an 'any' ty... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    updateOneBy: async function(query, data) {
        const _this = this;
        if (!query) {
            query = {};
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: any; select: string; }'... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
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

        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: any; select: string; po... Remove this comment to see the full error message
        updatedData = await this.findBy({ query, select, populate });
        return updatedData;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'data' implicitly has an 'any' type.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntent' does not exist on type '{... Remove this comment to see the full error message
                updatedProject.paymentIntent = chargeForBalance.client_secret;
            }
            return updatedProject;
        } else {
            const error = new Error('Cannot save project settings');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 403;
            throw error;
        }
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
    saveProject: async function(project) {
        project = await project.save();
        return project;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    getProjectIdsBy: async function(query) {
        const _this = this;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: any; select: string; }'... Remove this comment to see the full error message
        const projects = await _this.findBy({ query, select: '_id' });
        const projectsId = [];

        for (let i = 0; i < projects.length; i++) {
            projectsId.push(projects[i]._id);
        }
        return projectsId;
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    getBalance: async function(query) {
        const project = await ProjectModel.findOne(query).select('balance');
        return project;
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
    resetApiKey: async function(projectId) {
        const _this = this;
        const apiKey = uuidv1();
        const project = await _this.updateOneBy(
            { _id: projectId },
            { apiKey: apiKey }
        );
        return project;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
    upgradeToEnterprise: async function(projectId) {
        const data = { stripePlanId: 'enterprise', stripeSubscriptionId: null };
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
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
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
    findSubprojectId: async function(projectId) {
        const _this = this;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { parentProjectId: any;... Remove this comment to see the full error message
        const subProject = await _this.findBy({
            query: { parentProjectId: projectId },
            select: '_id',
        });
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'sub' implicitly has an 'any' type.
        const subProjectId = subProject.map(sub => String(sub._id));
        const projectIdArr = [projectId, ...subProjectId];
        return projectIdArr;
    },

    getUniqueMembersIndividualProject: async function({
        // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'isFlatenArr' implicitly has an 'a... Remove this comment to see the full error message
        isFlatenArr,
        // @ts-expect-error ts-migrate(7031) FIXME: Binding element 'members' implicitly has an 'any' ... Remove this comment to see the full error message
        members,
    }) {
        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'result' implicitly has type 'any[]' in s... Remove this comment to see the full error message
        let result = [];
        if (!isFlatenArr) {
            for (const member of members) {
                const track = {},
                    data = [];
                for (const user of member) {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    if (!track[user.userId]) {
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        track[user.userId] = user.userId;
                        data.push(user);
                    }
                }
                // @ts-expect-error ts-migrate(7005) FIXME: Variable 'result' implicitly has an 'any[]' type.
                result = [...result, data];
            }
        } else {
            const track = {};
            for (const member of members) {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                if (!track[member.userId]) {
                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    track[member.userId] = member.userId;
                    result.push(member);
                }
            }
        }
        return result;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
    exitProject: async function(projectId, userId, deletedById, saveUserSeat) {
        const _this = this,
            returnVal = 'User successfully exited the project';
        let teamMember = {};
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
        const userProject = await _this.findOneBy({
            query: { _id: projectId },
            select: 'users',
        });
        teamMember = userProject.users.find(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'user' implicitly has an 'any' type.
            user => String(user.userId) === String(userId)
        );
        let subProject = null;
        let subProjects = null;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; 'users.user... Remove this comment to see the full error message
        let project = await _this.findOneBy({
            query: { _id: projectId, 'users.userId': userId },
            select: 'parentProjectId users _id seats stripeSubscriptionId',
        });
        if (project?.parentProjectId) {
            subProject = project;
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            project = await _this.findOneBy({
                query: { _id: subProject.parentProjectId },
                select: '_id users seats stripeSubscriptionId',
            });
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { parentProjectId: any;... Remove this comment to see the full error message
        subProjects = await _this.findBy({
            query: { parentProjectId: project?._id },
            select: 'users _id seats',
        });
        const allMembers = subProjects.concat(project);
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'user' implicitly has an 'any' type.
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
                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type '{}'.
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
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { parentProjectId: any;... Remove this comment to see the full error message
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
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'role' does not exist on type '{}'.
                } else if (teamMember.role !== 'Viewer' && isViewer) {
                    projectSeats = projectSeats - 1;
                    _this.updateSeatDetails(project, projectSeats);
                    return returnVal;
                }
            }
        }
        return returnVal;
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    hardDeleteBy: async function(query) {
        await ProjectModel.deleteMany(query);
        return 'Project(s) Removed Successfully!';
    },

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'skip' implicitly has an 'any' type.
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
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'userId' implicitly has an 'any' type.
    getUserProjects: async function(userId, skip, limit) {
        const _this = this;
        // find user subprojects and parent projects
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { 'users.userId': any; ... Remove this comment to see the full error message
        const userProjects = await _this.findBy({
            query: { 'users.userId': userId, deleted: { $ne: null } },
            select: 'parentProjectId',
        });
        let parentProjectIds = [];
        let projectIds = [];
        if (userProjects.length > 0) {
            const subProjects = userProjects
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
                .map(project => (project.parentProjectId ? project : null))
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'subProject' implicitly has an 'any' typ... Remove this comment to see the full error message
                .filter(subProject => subProject !== null);
            parentProjectIds = subProjects.map(
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'subProject' implicitly has an 'any' typ... Remove this comment to see the full error message
                subProject =>
                    subProject.parentProjectId._id || subProject.parentProjectId
            );
            const projects = userProjects
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
                .map(project => (project.parentProjectId ? null : project))
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
                .filter(project => project !== null);
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
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
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
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
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'user' implicitly has an 'any' type.
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;

        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: any; select: string; }'... Remove this comment to see the full error message
        let project = await _this.findOneBy({
            query,
            select: '_id users stripeCustomerId',
        });

        if (!project) {
            const error = new Error('Project not found or no longer exist');
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        const projectId = project._id;
        const projectOwners = project.users.filter(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'user' implicitly has an 'any' type.
            user => user.role === 'Owner'
        );
        let subscription;
        await Promise.all(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectOwner' implicitly has an 'any' t... Remove this comment to see the full error message
            projectOwners.map(async projectOwner => {
                const owner = await UserService.findOneBy({
                    query: { _id: projectOwner.userId },
                    select: 'stripeCustomerId',
                });
                if (IS_SAAS_SERVICE) {
                    // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
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
                    ? // @ts-expect-error ts-migrate(2339) FIXME: Property 'stripeSubscriptionId' does not exist on ... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
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

    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'query' implicitly has an 'any' type.
    searchProjects: async function(query, skip, limit) {
        const _this = this;
        const select = '_id slug name';
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: any; limit: any; skip: ... Remove this comment to see the full error message
        let projects = await _this.findBy({ query, limit, skip, select });

        projects = await Promise.all(
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'project' implicitly has an 'any' type.
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
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
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
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../config/server"' has no exported member... Remove this comment to see the full error message
import { IS_SAAS_SERVICE } from '../config/server';
import componentService from './componentService';
import DomainVerificationService from './domainVerificationService';
import SsoDefaultRolesService from './ssoDefaultRolesService';
import getSlug from '../utils/getSlug';
import flattenArray from '../utils/flattenArray';
import IncidentSettingsService from './incidentSettingsService';
import handlePopulate from '../utils/populate';
import handleSelect from '../utils/select';

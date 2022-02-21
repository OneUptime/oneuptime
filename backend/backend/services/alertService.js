module.exports = {
    /**
     * gets the schedules to use for alerts
     * @param {Object} incident the current incident
     * @returns {Object[]} list of schedules
     */
    getSchedulesForAlerts: async function(incident, monitor) {
        const monitorId = monitor._id;
        const projectId = incident.projectId._id || incident.projectId;

        const {
            lastMatchedCriterion: matchedCriterion,
        } = await MonitorService.findOneBy({
            query: { _id: monitorId },
            select: 'lastMatchedCriterion',
        });
        let schedules = [];
        const populate = [
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

        const select =
            '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

        // first, try to find schedules associated with the matched criterion of the monitor
        if (
            !incident.manuallyCreated &&
            matchedCriterion.scheduleIds &&
            matchedCriterion.scheduleIds.length
        ) {
            schedules = await ScheduleService.findBy({
                query: { _id: { $in: matchedCriterion.scheduleIds } },
                select,
                populate,
            });
        } else {
            // then, try to find schedules in the monitor
            schedules = await ScheduleService.findBy({
                query: { monitorIds: monitorId },
                select,
                populate,
            });
            // lastly, find default schedules for the project
            if (schedules.length === 0) {
                schedules = await ScheduleService.findBy({
                    query: { isDefault: true, projectId },
                    select,
                    populate,
                });
            }
        }
        return schedules;
    },

    doesPhoneNumberComplyWithHighRiskConfig: async function(
        projectId,
        alertPhoneNumber
    ) {
        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'alertOptions',
        });
        const alertOptions = project.alertOptions;
        let countryType = getCountryType(alertPhoneNumber);
        if (countryType === 'us') {
            countryType = 'billingUS';
        } else if (countryType === 'non-us') {
            countryType = 'billingNonUSCountries';
        } else if (countryType === 'risk') {
            countryType = 'billingRiskCountries';
        }
        if (alertOptions[countryType]) {
            return true;
        }
        return false;
    },
    findBy: async function({ query, skip, limit, sort, populate, select }) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (!sort) sort = { createdAt: -1 };

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let alertsQuery = AlertModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit)
            .skip(skip);

        alertsQuery = handleSelect(select, alertsQuery);
        alertsQuery = handlePopulate(populate, alertsQuery);
        const alerts = await alertsQuery;
        return alerts;
    },

    create: async function({
        projectId,
        monitorId,
        alertVia,
        userId,
        incidentId,
        onCallScheduleStatus,
        schedule,
        escalation,
        alertStatus,
        error,
        errorMessage,
        eventType,
        alertProgress,
    }) {
        const _this = this;
        alertProgress =
            alertProgress && `${alertProgress.current}/${alertProgress.total}`;
        const alert = new AlertModel();
        alert.projectId = projectId;
        alert.onCallScheduleStatus = onCallScheduleStatus;
        alert.schedule = schedule;
        alert.escalation = escalation;
        alert.monitorId = monitorId;
        alert.alertVia = alertVia;
        alert.userId = userId;
        alert.incidentId = incidentId;
        alert.alertStatus = alertStatus;
        alert.eventType = eventType;
        alert.alertProgress = alertProgress;

        if (error) {
            alert.error = error;
            alert.errorMessage = errorMessage;
        }

        const [savedAlert] = await Promise.all([
            alert.save(),
            _this.sendRealTimeUpdate({
                incidentId,
                projectId,
            }),
        ]);
        return savedAlert;
    },

    sendRealTimeUpdate: async function({ incidentId, projectId }) {
        const _this = this;

        const populateIncidentMessage = [
            {
                path: 'incidentId',
                select: 'idNumber name slug',
            },
            {
                path: 'createdById',
                select: 'name',
            },
        ];

        const selectIncidentMessage =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        const populateAlert = [
            { path: 'userId', select: 'name' },
            { path: 'monitorId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAlert =
            '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

        const populate = [
            { path: 'incidentId', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'subscriberId',
                select:
                    'name contactEmail contactPhone contactWebhook countryCode',
            },
        ];
        const select =
            'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
        const selectOnCallScheduleStatus =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const populateIncTimeline = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
            { path: 'incidentId', select: 'idNumber slug' },
        ];
        const selectIncTimeline =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        const [
            incidentMsgs,
            timeline,
            alerts,
            subscriberAlerts,
        ] = await Promise.all([
            IncidentMessageService.findBy({
                query: {
                    incidentId,
                    type: 'internal',
                },
                select: selectIncidentMessage,
                populate: populateIncidentMessage,
            }),
            IncidentTimelineService.findBy({
                query: { incidentId },
                select: selectIncTimeline,
                populate: populateIncTimeline,
            }),
            _this.findBy({
                query: {
                    incidentId,
                },
                select: selectAlert,
                populate: populateAlert,
            }),
            SubscriberAlertService.findBy({
                query: { incidentId, projectId },
                select,
                populate,
            }),
        ]);
        let incidentMessages = incidentMsgs;
        const [subAlerts, callStatus] = await Promise.all([
            Services.deduplicate(subscriberAlerts),
            OnCallScheduleStatusService.findBy({
                query: {
                    incident: incidentId,
                },
                select: selectOnCallScheduleStatus,
                populate: populateOnCallScheduleStatus,
            }),
        ]);
        const callScheduleStatus = await Services.checkCallSchedule(callStatus);
        const timelineAlerts = [
            ...timeline,
            ...alerts,
            ...incidentMessages,
        ].sort((a, b) => {
            return b.createdAt - a.createdAt;
        });
        incidentMessages = [
            ...timelineAlerts,
            ...subAlerts,
            ...callScheduleStatus,
        ];
        incidentMessages.sort(
            (a, b) =>
                typeof a.schedule !== 'object' && b.createdAt - a.createdAt
        );
        let filteredMsg = incidentMessages.filter(
            a =>
                a.status !== 'internal notes added' &&
                a.status !== 'internal notes updated'
        );
        filteredMsg = await Services.rearrangeDuty(filteredMsg);
        const result = {
            data: filteredMsg,
            incidentId,
            projectId,
        };
        // run in the background
        RealTimeService.sendIncidentTimeline(result);
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await AlertModel.countDocuments(query);
        return count;
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const updatedAlert = await AlertModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return updatedAlert;
    },

    updateBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await AlertModel.updateMany(query, {
            $set: data,
        });
        const populateAlert = [
            { path: 'userId', select: 'name' },
            { path: 'monitorId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAlert =
            'projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress ';

        updatedData = await this.findBy({
            query,
            populate: populateAlert,
            select: selectAlert,
        });
        return updatedData;
    },

    deleteBy: async function(query, userId) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const alerts = await AlertModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            {
                new: true,
            }
        );
        return alerts;
    },

    sendCreatedIncident: async function(incident, monitor) {
        if (incident) {
            const _this = this;

            const scheduleList = await this.getSchedulesForAlerts(
                incident,
                monitor
            );

            if (scheduleList.length > 0) {
                for (const schedule of scheduleList) {
                    _this.sendAlertsToTeamMembersInSchedule({
                        schedule,
                        incident,
                        monitorId: monitor._id,
                    });
                }
            } else {
                OnCallScheduleStatusService.create({
                    project: incident.projectId._id || incident.projectId,
                    incident: incident._id,
                    activeEscalation: null,
                    schedule: null,
                    incidentAcknowledged: false,
                    escalations: [],
                    isOnDuty: false,
                });
            }
        }
    },

    sendAlertsToTeamMembersInSchedule: async function({
        schedule,
        incident,
        monitorId,
    }) {
        const _this = this;
        const projectId = incident.projectId._id
            ? incident.projectId._id
            : incident.projectId;

        if (!schedule || !incident) {
            return;
        }

        //scheudle has no escalations. Skip.
        if (!schedule.escalationIds || schedule.escalationIds.length === 0) {
            return;
        }

        const monitorPopulate = [{ path: 'componentId', select: 'name' }];
        const monitorSelect = '_id name data method componentId';
        const selectOnCallScheduleStatus =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const [monitor, callScheduleStatuses] = await Promise.all([
            MonitorService.findOneBy({
                query: { _id: monitorId },
                populate: monitorPopulate,
                select: monitorSelect,
            }),
            OnCallScheduleStatusService.findBy({
                query: { incident: incident._id, schedule: schedule },
                select: selectOnCallScheduleStatus,
                populate: populateOnCallScheduleStatus,
            }),
        ]);

        let onCallScheduleStatus = null;
        let escalationId = null;
        let currentEscalationStatus = null;
        if (callScheduleStatuses.length === 0) {
            //start with first ecalation policy, and then escalationPolicy will take care of others in escalation policy.
            escalationId = schedule.escalationIds[0];

            if (escalationId && escalationId._id) {
                escalationId = escalationId._id;
            }

            currentEscalationStatus = {
                escalation: escalationId,
                callRemindersSent: 0,
                emailRemindersSent: 0,
                smsRemindersSent: 0,
                pushRemindersSent: 0,
            };

            //create new onCallScheduleStatus
            onCallScheduleStatus = await OnCallScheduleStatusService.create({
                project: projectId,
                incident: incident._id,
                activeEscalation: escalationId,
                schedule: schedule._id,
                incidentAcknowledged: false,
                escalations: [currentEscalationStatus],
            });
        } else {
            onCallScheduleStatus = callScheduleStatuses[0];
            currentEscalationStatus =
                onCallScheduleStatus.escalations[
                    onCallScheduleStatus.escalations.length - 1
                ];
            escalationId = currentEscalationStatus.escalation._id;
        }

        const selectEscalation =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        const populateEscalation = [
            { path: 'projectId', select: '_id name slug' },
            {
                path: 'scheduleId',
                select: 'name isDefault slug',
                populate: { path: 'monitorIds', select: 'name' },
            },
            {
                path: 'teams.teamMembers.user',
                select: 'name email',
            },
            {
                path: 'teams.teamMembers.groups',
                select: 'teams name',
            },
        ];
        const escalation = await EscalationService.findOneBy({
            query: { _id: escalationId },
            select: selectEscalation,
            populate: populateEscalation,
        });

        let shouldSendSMSReminder = false;
        let shouldSendCallReminder = false;
        let shouldSendEmailReminder = false;
        let shouldSendPushReminder = false;

        if (!escalation) {
            return;
        }

        const alertProgress = {
            emailProgress: null,
            smsProgress: null,
            callProgress: null,
            pushProgress: null,
        };
        const emailRem = currentEscalationStatus.emailRemindersSent + 1;
        const smsRem = currentEscalationStatus.smsRemindersSent + 1;
        const callRem = currentEscalationStatus.callRemindersSent + 1;
        const pushRem = currentEscalationStatus.pushRemindersSent + 1;

        if (emailRem > 1) {
            alertProgress.emailProgress = {
                current: emailRem,
                total: escalation.emailReminders,
            };
        }

        if (callRem > 1) {
            alertProgress.callProgress = {
                current: callRem,
                total: escalation.callReminders,
            };
        }

        if (smsRem > 1) {
            alertProgress.smsProgress = {
                current: smsRem,
                total: escalation.smsReminders,
            };
        }

        if (pushRem > 1) {
            alertProgress.pushProgress = {
                current: pushRem,
                total: escalation.pushReminders,
            };
        }

        shouldSendSMSReminder =
            escalation.smsReminders > currentEscalationStatus.smsRemindersSent;
        shouldSendCallReminder =
            escalation.callReminders >
            currentEscalationStatus.callRemindersSent;
        shouldSendEmailReminder =
            escalation.emailReminders >
            currentEscalationStatus.emailRemindersSent;
        shouldSendPushReminder =
            escalation.pushReminders >
            currentEscalationStatus.pushRemindersSent;

        if (
            !shouldSendSMSReminder &&
            !shouldSendEmailReminder &&
            !shouldSendCallReminder &&
            !shouldSendPushReminder
        ) {
            _this.escalate({ schedule, incident, alertProgress, monitor });
        } else {
            _this.sendAlertsToTeamMembersInEscalationPolicy({
                escalation,
                monitor,
                incident,
                schedule,
                onCallScheduleStatus,
                alertProgress,
            });
        }
    },

    escalate: async function({ schedule, incident, alertProgress, monitor }) {
        const _this = this;
        const selectOnCallScheduleStatus =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const callScheduleStatuses = await OnCallScheduleStatusService.findBy({
            query: { incident: incident._id, schedule: schedule._id },
            select: selectOnCallScheduleStatus,
            populate: populateOnCallScheduleStatus,
        });

        if (callScheduleStatuses.length === 0) {
            return;
        }

        const callScheduleStatus = callScheduleStatuses[0];

        const activeEscalation = callScheduleStatus.activeEscalation;

        if (!schedule.escalationIds || schedule.escalationIds.length === 0) {
            return;
        }

        let nextEscalationPolicy = null;

        //find next escalationPolicy.
        let found = false;
        for (let escalationId of schedule.escalationIds) {
            if (found) {
                nextEscalationPolicy = escalationId;
                break;
            }

            if (escalationId && escalationId._id) {
                escalationId = escalationId._id;
            }

            if (String(activeEscalation._id) === String(escalationId)) {
                found = true;
            }
        }

        if (
            !nextEscalationPolicy ||
            nextEscalationPolicy._id.toString() !==
                activeEscalation._id.toString()
        ) {
            const query = { _id: callScheduleStatus._id };
            const data = { alertedEveryone: true };
            await OnCallScheduleStatusService.updateOneBy({ query, data });
            return; //can't escalate anymore.
        }

        callScheduleStatus.escalations.push({
            escalation: nextEscalationPolicy,
            callRemindersSent: 0,
            emailRemindersSent: 0,
            smsRemindersSent: 0,
        });
        callScheduleStatus.activeEscalation = nextEscalationPolicy;

        const query = { _id: callScheduleStatus._id };
        const data = {
            escalations: callScheduleStatus.escalations,
            activeEscalation: callScheduleStatus.activeEscalation,
        };
        await OnCallScheduleStatusService.updateOneBy({ query, data });

        _this.sendAlertsToTeamMembersInEscalationPolicy({
            escalation: nextEscalationPolicy,
            monitor,
            incident,
            schedule,
            onCallScheduleStatus: callScheduleStatus,
            alertProgress,
        });
    },

    sendAlertsToTeamMembersInEscalationPolicy: async function({
        escalation,
        incident,
        monitor,
        schedule,
        onCallScheduleStatus,
        alertProgress,
    }) {
        const _this = this;
        const monitorId = monitor._id;

        const projectId = incident.projectId._id
            ? incident.projectId._id
            : incident.projectId;

        const selectEscalation =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        const populateEscalation = [
            { path: 'projectId', select: '_id name slug' },
            {
                path: 'scheduleId',
                select: 'name isDefault slug',
                populate: {
                    path: 'monitorIds',
                    select: 'name',
                },
            },
            {
                path: 'teams.teamMembers.user',
                select: 'name email',
            },
            {
                path: 'teams.teamMembers.groups',
                select: 'teams name',
            },
        ];

        const [project, ec] = await Promise.all([
            ProjectService.findOneBy({
                query: { _id: projectId },
                select: '_id alertEnable alertOptions slug name',
            }),
            EscalationService.findOneBy({
                query: { _id: escalation._id },
                select: selectEscalation,
                populate: populateEscalation,
            }),
        ]);
        escalation = ec;

        const activeTeam = escalation.activeTeam;
        const teamGroup = [];

        if (activeTeam && activeTeam.teamMembers) {
            activeTeam.teamMembers.forEach(team => {
                if (team.groups) {
                    teamGroup.push(team.groups);
                }
            });
        }

        const groupUsers = teamGroup.map(group => group.teams);
        const groupUserIds = [].concat
            .apply([], groupUsers)
            .map(id => ({ userId: id }));
        const filterdUserIds = groupUserIds.filter(user =>
            activeTeam.teamMembers.some(team => team.userId !== user.userId)
        );

        const currentEscalationStatus =
            onCallScheduleStatus.escalations[
                onCallScheduleStatus.escalations.length - 1
            ];

        const shouldSendSMSReminder =
            escalation.smsReminders > currentEscalationStatus.smsRemindersSent;
        const shouldSendCallReminder =
            escalation.callReminders >
            currentEscalationStatus.callRemindersSent;
        const shouldSendEmailReminder =
            escalation.emailReminders >
            currentEscalationStatus.emailRemindersSent;
        const shouldSendPushReminder =
            escalation.pushReminders >
            currentEscalationStatus.pushRemindersSent;

        if (shouldSendCallReminder) {
            currentEscalationStatus.callRemindersSent++;
        }

        if (shouldSendEmailReminder) {
            currentEscalationStatus.emailRemindersSent++;
        }

        if (shouldSendSMSReminder) {
            currentEscalationStatus.smsRemindersSent++;
        }

        if (shouldSendPushReminder) {
            currentEscalationStatus.pushRemindersSent++;
        }

        if (!activeTeam.teamMembers || activeTeam.teamMembers.length === 0) {
            return;
        }

        onCallScheduleStatus.escalations[
            onCallScheduleStatus.escalations.length - 1
        ] = currentEscalationStatus;
        await OnCallScheduleStatusService.updateOneBy({
            query: { _id: onCallScheduleStatus._id },
            data: {
                escalations: onCallScheduleStatus.escalations,
            },
        });

        const allUsers = [...activeTeam.teamMembers, ...filterdUserIds];
        for (const teamMember of allUsers) {
            const isOnDuty = await _this.checkIsOnDuty(
                teamMember.startTime,
                teamMember.endTime
            );

            if (
                (JSON.stringify(escalation.scheduleId._id) ==
                    JSON.stringify(onCallScheduleStatus.schedule._id) ||
                    JSON.stringify(escalation.scheduleId._id) ==
                        JSON.stringify(onCallScheduleStatus.schedule)) &&
                isOnDuty
            ) {
                await OnCallScheduleStatusService.updateOneBy({
                    query: { _id: onCallScheduleStatus._id },
                    data: {
                        isOnDuty: true,
                    },
                });
            }

            const user = await UserService.findOneBy({
                query: { _id: teamMember.userId },
                select: '_id alertPhoneNumber name email timezone',
            });

            if (!user) {
                continue;
            }

            if (!isOnDuty) {
                if (escalation.call && shouldSendCallReminder) {
                    await _this.create({
                        projectId: incident.projectId._id || incident.projectId,
                        monitorId,
                        alertVia: AlertType.Call,
                        userId: user._id,
                        incidentId: incident._id,
                        schedule: schedule,
                        escalation: escalation,
                        onCallScheduleStatus: onCallScheduleStatus,
                        alertStatus: 'Not on Duty',
                        eventType: 'identified',
                        alertProgress: alertProgress.callProgress,
                    });
                }
                if (escalation.email && shouldSendEmailReminder) {
                    await _this.create({
                        projectId: incident.projectId._id || incident.projectId,
                        monitorId,
                        alertVia: AlertType.Email,
                        userId: user._id,
                        incidentId: incident._id,
                        schedule: schedule,
                        escalation: escalation,
                        onCallScheduleStatus: onCallScheduleStatus,
                        alertStatus: 'Not on Duty',
                        eventType: 'identified',
                        alertProgress: alertProgress.emailProgress,
                    });
                }
                if (escalation.sms && shouldSendSMSReminder) {
                    await _this.create({
                        projectId: incident.projectId._id || incident.projectId,
                        monitorId,
                        alertVia: AlertType.SMS,
                        userId: user._id,
                        incidentId: incident._id,
                        schedule: schedule,
                        escalation: escalation,
                        onCallScheduleStatus: onCallScheduleStatus,
                        alertStatus: 'Not on Duty',
                        eventType: 'identified',
                        alertProgress: alertProgress.smsProgress,
                    });
                }
                if (escalation.push && shouldSendPushReminder) {
                    await _this.create({
                        projectId: incident.projectId._id || incident.projectId,
                        monitorId,
                        alertVia: AlertType.Push,
                        userId: user._id,
                        incidentId: incident._id,
                        schedule: schedule,
                        escalation: escalation,
                        onCallScheduleStatus: onCallScheduleStatus,
                        alertStatus: 'Not on Duty',
                        eventType: 'identified',
                    });
                }

                continue;
            } else {
                /**
                 *  sendSMSAlert & sendCallAlert should not run in parallel
                 *  otherwise we will have a wrong project balance in the end.
                 *
                 */

                if (escalation.sms && shouldSendSMSReminder) {
                    await _this.sendSMSAlert({
                        incident,
                        user,
                        project,
                        monitor,
                        schedule,
                        escalation,
                        onCallScheduleStatus,
                        eventType: 'identified',
                        smsProgress: alertProgress.smsProgress,
                    });
                }

                if (escalation.email && shouldSendEmailReminder) {
                    _this.sendEmailAlert({
                        incident,
                        user,
                        project,
                        monitor,
                        schedule,
                        escalation,
                        onCallScheduleStatus,
                        eventType: 'identified',
                        emailProgress: alertProgress.emailProgress,
                    });
                }

                if (escalation.call && shouldSendCallReminder) {
                    await _this.sendCallAlert({
                        incident,
                        user,
                        project,
                        monitor,
                        schedule,
                        escalation,
                        onCallScheduleStatus,
                        eventType: 'identified',
                        callProgress: alertProgress.callProgress,
                    });
                }

                if (escalation.push && shouldSendPushReminder) {
                    await _this.sendPushAlert({
                        incident,
                        user,
                        monitor,
                        schedule,
                        escalation,
                        onCallScheduleStatus,
                        eventType: 'identified',
                        pushProgress: alertProgress.pushProgress,
                    });
                }
            }
        }
    },

    sendPushAlert: async function({
        incident,
        user,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        pushProgress,
    }) {
        const _this = this;
        let pushMessage;
        const userData = await UserService.findOneBy({
            query: { _id: user._id },
            select: 'identification',
        });

        const identification = userData.identification;

        const options = {
            vapidDetails: {
                subject: process.env.PUSHNOTIFICATION_URL, // Address or URL for this application
                publicKey: process.env.PUSHNOTIFICATION_PUBLIC_KEY, // URL Safe Base64 Encoded Public Key
                privateKey: process.env.PUSHNOTIFICATION_PRIVATE_KEY, // URL Safe Base64 Encoded Private Key
            },
            headers: {
                'access-control-allow-headers':
                    'content-encoding,encryption,crypto-key,ttl,encryption-key,content-type,authorization',
                'access-control-allow-methods': 'POST',
                'access-control-allow-origin': '*',
                'access-control-expose-headers': 'location,www-authenticate',
                'cache-control': 'max-age=86400',
                'content-type': 'application/json',
                server: 'nginx',
                'strict-transport-security':
                    'max-age=31536000;includeSubDomains',
                'content-length': '179',
                connection: 'Close',
            },
        };

        if (pushProgress) {
            pushMessage = `Reminder ${pushProgress.current}/${pushProgress.total}: `;
        } else {
            pushMessage = '';
        }

        // Create payload
        const title = `${pushMessage}Incident #${incident.idNumber} is created`;
        const body = `Please acknowledge or resolve this incident on OneUptime Dashboard.`;
        const payload = JSON.stringify({ title, body });

        // Pass object into sendNotification
        if (identification.length > 0) {
            let promiseFuncs = [];
            for (const sub of identification) {
                promiseFuncs = [
                    ...promiseFuncs,
                    webpush.sendNotification(
                        sub.subscription,
                        payload,
                        options
                    ),
                ];
            }
            return Promise.all(promiseFuncs)
                .then(async () => {
                    return await _this.create({
                        projectId: incident.projectId._id || incident.projectId,
                        monitorId: monitor._id,
                        schedule: schedule._id,
                        escalation: escalation._id,
                        onCallScheduleStatus: onCallScheduleStatus._id,
                        alertVia: `${AlertType.Push} Notification`,
                        userId: user._id,
                        incidentId: incident._id,
                        eventType,
                        alertStatus: 'Success',
                        alertProgress: pushProgress,
                    });
                })
                .catch(async e => {
                    return await _this.create({
                        projectId: incident.projectId._id || incident.projectId,
                        monitorId: monitor._id,
                        schedule: schedule._id,
                        escalation: escalation._id,
                        onCallScheduleStatus: onCallScheduleStatus._id,
                        alertVia: `${AlertType.Push} Notification`,
                        userId: user._id,
                        incidentId: incident._id,
                        eventType,
                        alertStatus: 'Cannot Send',
                        error: true,
                        errorMessage: e.message,
                        alertProgress: pushProgress,
                    });
                });
        } else {
            return await _this.create({
                projectId: incident.projectId._id || incident.projectId,
                monitorId: monitor._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: `${AlertType.Push} Notification`,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Cannot Send',
                error: true,
                errorMessage:
                    'Push Notification not allowed in the user dashboard',
                alertProgress: pushProgress,
            });
        }
    },

    sendEmailAlert: async function({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        emailProgress,
    }) {
        const _this = this;
        const probeName =
            incident.probes.length > 0 && incident.probes[0].probeId.probeName;
        let date = new Date();
        const monitorId = monitor._id;
        try {
            const accessToken = UserService.getAccessToken({
                userId: user._id,
                expiresIn: 12 * 60 * 60 * 1000,
            });

            const projectId = incident.projectId._id || incident.projectId;
            const queryString = `projectId=${projectId}&userId=${user._id}&accessToken=${accessToken}`;
            const ack_url = `${global.apiHost}/incident/${projectId}/acknowledge/${incident._id}?${queryString}`;
            const resolve_url = `${global.apiHost}/incident/${projectId}/resolve/${incident._id}?${queryString}`;
            const view_url = `${global.dashboardHost}/project/${project.slug}/incidents/${incident.slug}?${queryString}`;
            const firstName = user.name;

            if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
                date = moment(incident.createdAt)
                    .tz(user.timezone)
                    .format('LLLL');
            }

            const [
                hasGlobalSmtpSettings,
                hasCustomSmtpSettings,
            ] = await Promise.all([
                GlobalConfigService.findOneBy({
                    query: { name: 'smtp' },
                    select: 'value',
                }),
                MailService.hasCustomSmtpSettings(projectId),
            ]);
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                let errorMessageText;
                if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                    errorMessageText =
                        'SMTP Settings not found on Admin Dashboard';
                } else if (
                    hasGlobalSmtpSettings &&
                    !areEmailAlertsEnabledInGlobalSettings
                ) {
                    errorMessageText = 'Alert Disabled on Admin Dashboard';
                }
                return await _this.create({
                    projectId: incident.projectId._id || incident.projectId,
                    monitorId,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.Email,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: errorMessageText,
                    alertProgress: emailProgress,
                });
            }
            const incidentcreatedBy =
                incident.createdById && incident.createdById.name
                    ? incident.createdById.name
                    : 'oneuptime';
            await MailService.sendIncidentCreatedMail({
                incidentTime: date,
                monitorName: monitor.name,
                monitorUrl:
                    monitor && monitor.data && monitor.data.url
                        ? monitor.data.url
                        : null,
                incidentId: `#${incident.idNumber}`,
                reason: incident.reason
                    ? incident.reason.split('\n')
                    : [`This incident was created by ${incidentcreatedBy}`],
                view_url,
                method:
                    monitor.data && monitor.data.url
                        ? monitor.method
                            ? monitor.method.toUpperCase()
                            : 'GET'
                        : null,
                componentName: monitor.componentId.name,
                email: user.email,
                userId: user._id,
                firstName: firstName.split(' ')[0],
                projectId: incident.projectId._id || incident.projectId,
                acknowledgeUrl: ack_url,
                resolveUrl: resolve_url,
                accessToken,
                incidentType: incident.incidentType,
                projectName: project.name,
                criterionName:
                    !incident.manuallyCreated && incident.criterionCause
                        ? incident.criterionCause.name
                        : '',
                probeName,
                emailProgress,
            });
            return await _this.create({
                projectId: incident.projectId._id || incident.projectId,
                monitorId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: AlertType.Email,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Success',
                alertProgress: emailProgress,
            });
        } catch (e) {
            return await _this.create({
                projectId: incident.projectId._id || incident.projectId,
                monitorId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: AlertType.Email,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Cannot Send',
                error: true,
                errorMessage: e.message,
                alertProgress: emailProgress,
            });
        }
    },

    sendSlaEmailToTeamMembers: async function(
        { projectId, incidentCommunicationSla, incident, alertTime },
        breached = false
    ) {
        const teamMembers = await TeamService.getTeamMembersBy({
            _id: projectId,
        });

        if (teamMembers && teamMembers.length > 0) {
            const [
                hasGlobalSmtpSettings,
                hasCustomSmtpSettings,
            ] = await Promise.all([
                GlobalConfigService.findOneBy({
                    query: { name: 'smtp' },
                    select: 'value',
                }),
                MailService.hasCustomSmtpSettings(projectId),
            ]);
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;

            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                return;
            }

            const incidentSla = incidentCommunicationSla.name;
            const projectName = incident.projectId.name;
            const projectSlug = incident.projectId.slug;
            // const monitorName = monitor.name;
            const incidentId = `#${incident.idNumber}`;
            const reason = incident.reason;
            // const componentSlug = monitor.componentId.slug;
            // const componentName = monitor.componentId.name;
            // const incidentUrl = `${global.dashboardHost}/project/${monitor.projectId.slug}/component/${componentSlug}/incidents/${incident.slug}`;
            const incidentUrl = `${global.dashboardHost}/project/${projectSlug}/incidents/${incident.slug}`;
            let incidentSlaTimeline = incidentCommunicationSla.duration * 60;
            incidentSlaTimeline = secondsToHms(incidentSlaTimeline);
            const incidentSlaRemaining = secondsToHms(alertTime);

            if (breached) {
                for (const member of teamMembers) {
                    await MailService.sendSlaBreachNotification({
                        userEmail: member.email,
                        name: member.name,
                        projectId,
                        incidentSla,
                        // monitorName,
                        incidentUrl,
                        projectName,
                        // componentName,
                        incidentId,
                        reason,
                        incidentSlaTimeline,
                        incidentSlug: incident.slug,
                    });
                }
            } else {
                for (const member of teamMembers) {
                    await MailService.sendSlaNotification({
                        userEmail: member.email,
                        name: member.name,
                        projectId,
                        incidentSla,
                        // monitorName,
                        incidentUrl,
                        projectName,
                        // componentName,
                        incidentId,
                        reason,
                        incidentSlaTimeline,
                        incidentSlaRemaining,
                    });
                }
            }
        }
    },

    sendCallAlert: async function({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        callProgress,
    }) {
        const _this = this;
        let alert;
        const date = new Date();
        const monitorId = monitor._id;
        const projectId = incident.projectId._id || incident.projectId;
        const accessToken = UserService.getAccessToken({
            userId: user._id,
            expiresIn: 12 * 60 * 60 * 1000,
        });
        if (!user.alertPhoneNumber) {
            return await _this.create({
                projectId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.Call,
                userId: user._id,
                incidentId: incident._id,
                alertStatus: null,
                error: true,
                eventType,
                errorMessage: 'No phone number',
                alertProgress: callProgress,
            });
        }

        const [
            hasGlobalTwilioSettings,
            hasCustomTwilioSettings,
        ] = await Promise.all([
            GlobalConfigService.findOneBy({
                query: { name: 'twilio' },
                select: 'value',
            }),
            TwilioService.hasCustomSettings(projectId),
        ]);
        const areAlertsEnabledGlobally =
            hasGlobalTwilioSettings &&
            hasGlobalTwilioSettings.value &&
            hasGlobalTwilioSettings.value['call-enabled']
                ? true
                : false;

        if (
            !hasCustomTwilioSettings &&
            ((IS_SAAS_SERVICE &&
                (!project.alertEnable || !areAlertsEnabledGlobally)) ||
                (!IS_SAAS_SERVICE && !areAlertsEnabledGlobally))
        ) {
            let errorMessageText;
            if (!hasGlobalTwilioSettings) {
                errorMessageText =
                    'Twilio Settings not found on Admin Dashboard';
            } else if (!areAlertsEnabledGlobally) {
                errorMessageText = 'Alert Disabled on Admin Dashboard';
            } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                errorMessageText = 'Alert Disabled for this project';
            }
            return await _this.create({
                projectId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.Call,
                userId: user._id,
                incidentId: incident._id,
                alertStatus: null,
                error: true,
                eventType,
                errorMessage: errorMessageText,
                alertProgress: callProgress,
            });
        }

        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
            const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                projectId,
                user.alertPhoneNumber
            );
            if (!doesPhoneNumberComplyWithHighRiskConfig) {
                const countryType = getCountryType(user.alertPhoneNumber);
                let errorMessageText;
                if (countryType === 'us') {
                    errorMessageText =
                        'Calls for numbers inside US not enabled for this project';
                } else if (countryType === 'non-us') {
                    errorMessageText =
                        'Calls for numbers outside US not enabled for this project';
                } else {
                    errorMessageText =
                        'Calls to High Risk country not enabled for this project';
                }
                return await _this.create({
                    projectId,
                    monitorId,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.Call,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: errorMessageText,
                    alertProgress: callProgress,
                });
            }

            const status = await PaymentService.checkAndRechargeProjectBalance(
                project,
                user._id,
                user.alertPhoneNumber,
                AlertType.Call
            );

            if (!status.success) {
                return await _this.create({
                    projectId,
                    monitorId,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.Call,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: status.message,
                    alertProgress: callProgress,
                });
            }
        }
        const alertStatus = await TwilioService.sendIncidentCreatedCall(
            date,
            monitor.name,
            user.alertPhoneNumber,
            accessToken,
            incident._id,
            projectId,
            incident.incidentType,
            callProgress
        );
        if (alertStatus && alertStatus.code && alertStatus.code === 400) {
            return await _this.create({
                projectId: project._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.Call,
                userId: user._id,
                incidentId: incident._id,
                alertStatus: null,
                error: true,
                eventType,
                errorMessage: alertStatus.message,
                alertProgress: callProgress,
            });
        } else if (alertStatus) {
            alert = await _this.create({
                projectId: project._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.Call,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Success',
                alertProgress: callProgress,
            });
            if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                const balanceStatus = await PaymentService.chargeAlertAndGetProjectBalance(
                    user._id,
                    project,
                    AlertType.Call,
                    user.alertPhoneNumber
                );

                if (!balanceStatus.error) {
                    await AlertChargeService.create(
                        projectId,
                        balanceStatus.chargeAmount,
                        balanceStatus.closingBalance,
                        alert._id,
                        monitorId,
                        incident._id,
                        user.alertPhoneNumber
                    );
                }
            }
        }
    },

    sendSMSAlert: async function({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        smsProgress,
    }) {
        const _this = this;
        let alert;
        const projectId = project._id;
        const date = new Date();
        const monitorId = monitor._id;
        if (!user.alertPhoneNumber) {
            return await _this.create({
                projectId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.SMS,
                userId: user._id,
                incidentId: incident._id,
                alertStatus: null,
                error: true,
                eventType,
                errorMessage: 'No phone number',
                alertProgress: smsProgress,
            });
        }

        const [
            hasGlobalTwilioSettings,
            hasCustomTwilioSettings,
        ] = await Promise.all([
            GlobalConfigService.findOneBy({
                query: { name: 'twilio' },
                select: 'value',
            }),
            TwilioService.hasCustomSettings(projectId),
        ]);
        const areAlertsEnabledGlobally =
            hasGlobalTwilioSettings &&
            hasGlobalTwilioSettings.value &&
            hasGlobalTwilioSettings.value['sms-enabled']
                ? true
                : false;

        if (
            !hasCustomTwilioSettings &&
            ((IS_SAAS_SERVICE &&
                (!project.alertEnable || !areAlertsEnabledGlobally)) ||
                (!IS_SAAS_SERVICE && !areAlertsEnabledGlobally))
        ) {
            let errorMessageText;
            if (!hasGlobalTwilioSettings) {
                errorMessageText =
                    'Twilio Settings not found on Admin Dashboard';
            } else if (!areAlertsEnabledGlobally) {
                errorMessageText = 'Alert Disabled on Admin Dashboard';
            } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                errorMessageText = 'Alert Disabled for this project';
            } else {
                errorMessageText = 'Error';
            }
            return await _this.create({
                projectId: incident.projectId._id || incident.projectId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.SMS,
                userId: user._id,
                incidentId: incident._id,
                alertStatus: null,
                error: true,
                eventType,
                errorMessage: errorMessageText,
                alertProgress: smsProgress,
            });
        }

        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
            const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                incident.projectId._id || incident.projectId,
                user.alertPhoneNumber
            );
            if (!doesPhoneNumberComplyWithHighRiskConfig) {
                const countryType = getCountryType(user.alertPhoneNumber);
                let errorMessageText;
                if (countryType === 'us') {
                    errorMessageText =
                        'SMS for numbers inside US not enabled for this project';
                } else if (countryType === 'non-us') {
                    errorMessageText =
                        'SMS for numbers outside US not enabled for this project';
                } else {
                    errorMessageText =
                        'SMS to High Risk country not enabled for this project';
                }
                return await _this.create({
                    projectId: incident.projectId._id || incident.projectId,
                    monitorId,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.SMS,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: errorMessageText,
                    alertProgress: smsProgress,
                });
            }

            const status = await PaymentService.checkAndRechargeProjectBalance(
                project,
                user._id,
                user.alertPhoneNumber,
                AlertType.SMS
            );

            if (!status.success) {
                return await _this.create({
                    projectId: incident.projectId._id || incident.projectId,
                    monitorId,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.SMS,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: status.message,
                    alertProgress: smsProgress,
                });
            }
        }

        const sendResult = await TwilioService.sendIncidentCreatedMessage(
            date,
            monitor.name,
            user.alertPhoneNumber,
            incident._id,
            user._id,
            user.name,
            incident.incidentType,
            projectId,
            smsProgress
        );

        if (sendResult && sendResult.code && sendResult.code === 400) {
            await _this.create({
                projectId: incident.projectId._id || incident.projectId,
                monitorId,
                alertVia: AlertType.SMS,
                userId: user._id,
                incidentId: incident._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertStatus: null,
                error: true,
                eventType,
                errorMessage: sendResult.message,
                alertProgress: smsProgress,
            });
        } else if (sendResult) {
            const alertStatus = 'Success';
            alert = await _this.create({
                projectId: incident.projectId._id || incident.projectId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.SMS,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus,
                alertProgress: smsProgress,
            });
            if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                // calculate charge per 160 chars
                const segments = calcSmsSegments(sendResult.body);
                const balanceStatus = await PaymentService.chargeAlertAndGetProjectBalance(
                    user._id,
                    project,
                    AlertType.SMS,
                    user.alertPhoneNumber,
                    segments
                );

                if (!balanceStatus.error) {
                    await AlertChargeService.create(
                        incident.projectId._id || incident.projectId,
                        balanceStatus.chargeAmount,
                        balanceStatus.closingBalance,
                        alert._id,
                        monitorId,
                        incident._id,
                        user.alertPhoneNumber
                    );
                }
            }
        }
    },

    sendStausPageNoteNotificationToProjectWebhooks: async function(
        projectId,
        incident,
        statusPageNoteData
    ) {
        const monitors = incident.monitors.map(monitor => monitor.monitorId);
        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';
        for (const monitor of monitors) {
            const component = await componentService.findOneBy({
                query: { _id: monitor.componentId },
                select: selectComponent,
                populate: populateComponent,
            });

            let incidentStatus;
            if (incident.resolved) {
                incidentStatus = INCIDENT_RESOLVED;
            } else if (incident.acknowledged) {
                incidentStatus = INCIDENT_ACKNOWLEDGED;
            } else {
                incidentStatus = INCIDENT_CREATED;
            }
            const downTimeString = calculateHumanReadableDownTime(
                incident.createdAt
            );

            WebHookService.sendIntegrationNotification(
                projectId,
                incident,
                monitor,
                incidentStatus,
                component,
                downTimeString,
                {
                    note: statusPageNoteData.content,
                    incidentState: statusPageNoteData.incident_state,
                    statusNoteStatus: statusPageNoteData.statusNoteStatus,
                }
            ).catch(error => {
                ErrorService.log(
                    'ApplicationScannerService.sendStatusPageNoteNotificationToProjectWebhooks > WebHookService.sendIntegrationNotification',
                    error
                );
            });
        }
    },

    sendInvestigationNoteToSubscribers: async function(
        incident,
        data,
        statusNoteStatus,
        projectId
    ) {
        const _this = this;
        const uuid = new Date().getTime();
        const track = {};

        const monitors = incident.monitors.map(monitor => monitor.monitorId);
        const monitorIds = monitors.map(monitor => monitor._id);
        const subscribers = await SubscriberService.subscribersForAlert({
            subscribed: true,
            $or: [{ monitorId: { $in: monitorIds } }, { monitorId: null }],
            projectId,
        });

        const sendSubscriberAlert = async ({
            subscriber,
            monitor,
            statusPageSlug,
            subscribers,
        }) => {
            await _this.sendSubscriberAlert(
                subscriber,
                incident,
                'Investigation note is created',
                null,
                {
                    note: data.content,
                    incidentState: data.incident_state,
                    noteType: data.incident_state,
                    statusNoteStatus,
                    statusPageSlug,
                },
                subscribers.length,
                uuid,
                monitor
            );
        };

        for (const monitor of monitors) {
            if (incident) {
                for (const subscriber of subscribers) {
                    let statusPageSlug = null;
                    if (subscriber.statusPageId) {
                        const statusPage = await StatusPageService.findOneBy({
                            query: {
                                _id: subscriber.statusPageId,
                            },
                            select: 'slug',
                        });
                        statusPageSlug = statusPage ? statusPage.slug : null;
                    }
                    if (subscriber.alertVia === AlertType.Email) {
                        if (!track[subscriber.contactEmail]) {
                            track[subscriber.contactEmail] =
                                subscriber.contactEmail;
                            sendSubscriberAlert({
                                subscriber,
                                monitor,
                                statusPageSlug,
                                subscribers,
                            });
                        }
                    } else {
                        sendSubscriberAlert({
                            subscriber,
                            monitor,
                            statusPageSlug,
                            subscribers,
                        });
                    }
                }
            }
        }
    },

    sendCreatedIncidentToSubscribers: async function(incident, monitors) {
        const _this = this;
        const uuid = new Date().getTime();

        const populateStatusPage = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage =
            'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const track = {};
        const sendSubscriberAlert = async ({
            subscriber,
            monitor,
            enabledStatusPage,
            subscribers,
        }) => {
            await _this.sendSubscriberAlert(
                subscriber,
                incident,
                'Subscriber Incident Created',
                enabledStatusPage,
                {},
                subscribers.length,
                uuid,
                monitor
            );
        };
        if (incident) {
            for (const monitor of monitors) {
                const monitorId = monitor && monitor._id;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitorId,
                        subscribed: true,
                    }
                );
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage = await StatusPageService.findOneBy(
                            {
                                query: {
                                    _id: subscriber.statusPageId,
                                    isSubscriberEnabled: true,
                                },
                                populate: populateStatusPage,
                                select: selectStatusPage,
                            }
                        );
                        if (enabledStatusPage) {
                            if (subscriber.alertVia === AlertType.Email) {
                                if (!track[subscriber.contactEmail]) {
                                    track[subscriber.contactEmail] =
                                        subscriber.contactEmail;
                                    sendSubscriberAlert({
                                        subscriber,
                                        monitor,
                                        enabledStatusPage,
                                        subscribers,
                                    });
                                }
                            } else {
                                sendSubscriberAlert({
                                    subscriber,
                                    monitor,
                                    enabledStatusPage,
                                    subscribers,
                                });
                            }
                        }
                    } else {
                        if (subscriber.alertVia === AlertType.Email) {
                            if (!track[subscriber.contactEmail]) {
                                track[subscriber.contactEmail] =
                                    subscriber.contactEmail;
                                sendSubscriberAlert({
                                    subscriber,
                                    monitor,
                                    enabledStatusPage: null,
                                    subscribers,
                                });
                            }
                        } else {
                            sendSubscriberAlert({
                                subscriber,
                                monitor,
                                enabledStatusPage: null,
                                subscribers,
                            });
                        }
                    }
                }
            }
        }
    },

    sendAcknowledgedIncidentMail: async function(incident, monitor) {
        const _this = this;
        if (incident) {
            const projectId = incident.projectId._id
                ? incident.projectId._id
                : incident.projectId;

            const monitorPopulate = [{ path: 'componentId', select: 'name' }];
            const monitorSelect = '_id name data method componentId';

            const selectOnCallScheduleStatus =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];

            const [schedules, mon, project] = await Promise.all([
                this.getSchedulesForAlerts(incident, monitor),
                MonitorService.findOneBy({
                    query: { _id: monitor._id },
                    populate: monitorPopulate,
                    select: monitorSelect,
                }),
                ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'slug name',
                }),
            ]);
            monitor = mon;

            for (const schedule of schedules) {
                if (!schedule || !incident) {
                    continue;
                }

                //scheudle has no escalations. Skip.
                if (
                    !schedule.escalationIds ||
                    schedule.escalationIds.length === 0
                ) {
                    continue;
                }

                const callScheduleStatuses = await OnCallScheduleStatusService.findBy(
                    {
                        query: {
                            incident: incident._id,
                            schedule: schedule,
                        },
                        select: selectOnCallScheduleStatus,
                        populate: populateOnCallScheduleStatus,
                    }
                );
                let onCallScheduleStatus = null;
                let escalationId = null;
                let currentEscalationStatus = null;

                if (callScheduleStatuses.length === 0) {
                    escalationId = schedule.escalationIds[0];

                    if (escalationId && escalationId._id) {
                        escalationId = escalationId._id;
                    }
                    currentEscalationStatus = {
                        escalation: escalationId,
                        callRemindersSent: 0,
                        emailRemindersSent: 0,
                        smsRemindersSent: 0,
                    };

                    //create new onCallScheduleStatus
                    onCallScheduleStatus = await OnCallScheduleStatusService.create(
                        {
                            project: projectId,
                            incident: incident._id,
                            activeEscalation: escalationId,
                            schedule: schedule._id,
                            incidentAcknowledged: false,
                            escalations: [currentEscalationStatus],
                        }
                    );
                } else {
                    onCallScheduleStatus = callScheduleStatuses[0];
                    escalationId =
                        callScheduleStatuses[0].escalations[
                            callScheduleStatuses[0].escalations.length - 1
                        ].escalation._id;
                }
                const selectEscalation =
                    'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

                const populateEscalation = [
                    {
                        path: 'projectId',
                        select: '_id name slug',
                    },
                    {
                        path: 'scheduleId',
                        select: 'name isDefault slug',
                        populate: {
                            path: 'monitorIds',
                            select: 'name',
                        },
                    },
                    {
                        path: 'teams.teamMembers.user',
                        select: 'name email',
                    },
                    {
                        path: 'teams.teamMembers.groups',
                        select: 'teams name',
                    },
                ];
                const escalation = await EscalationService.findOneBy({
                    query: { _id: escalationId },
                    select: selectEscalation,
                    populate: populateEscalation,
                });

                if (!escalation) {
                    continue;
                }
                const activeTeam = escalation.activeTeam;
                if (
                    !activeTeam.teamMembers ||
                    activeTeam.teamMembers.length === 0
                ) {
                    continue;
                }
                for (const teamMember of activeTeam.teamMembers) {
                    const isOnDuty = await _this.checkIsOnDuty(
                        teamMember.startTime,
                        teamMember.endTime
                    );
                    const user = await UserService.findOneBy({
                        query: { _id: teamMember.userId },
                        select: '_id timezone name email',
                    });

                    if (!user) {
                        continue;
                    }

                    if (!isOnDuty) {
                        if (escalation.email) {
                            await _this.create({
                                projectId,
                                monitorId: monitor._id,
                                alertVia: AlertType.Email,
                                userId: user._id,
                                incidentId: incident._id,
                                schedule,
                                escalation,
                                onCallScheduleStatus,
                                alertStatus: 'Not on Duty',
                                eventType: 'acknowledged',
                            });
                        }
                    } else {
                        if (escalation.email) {
                            await _this.sendAcknowledgeEmailAlert({
                                incident,
                                user,
                                project,
                                monitor,
                                schedule,
                                escalation,
                                onCallScheduleStatus,
                                eventType: 'acknowledged',
                            });
                        }
                    }
                }
            }
        }
    },

    sendAcknowledgeEmailAlert: async function({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
    }) {
        const _this = this;

        const projectId = incident.projectId._id || incident.projectId;
        try {
            let date = new Date();
            const accessToken = UserService.getAccessToken({
                userId: user._id,
                expiresIn: 12 * 60 * 60 * 1000,
            });

            const queryString = `projectId=${projectId}&userId=${user._id}&accessToken=${accessToken}`;
            const resolve_url = `${global.apiHost}/incident/${projectId}/resolve/${incident._id}?${queryString}`;
            const view_url = `${global.dashboardHost}/project/${project.slug}/incidents/${incident.slug}?${queryString}`;
            const firstName = user.name;

            if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
                date = moment(date)
                    .tz(user.timezone)
                    .format();
            }

            const [
                hasGlobalSmtpSettings,
                hasCustomSmtpSettings,
            ] = await Promise.all([
                GlobalConfigService.findOneBy({
                    query: { name: 'smtp' },
                    select: 'value',
                }),
                MailService.hasCustomSmtpSettings(projectId),
            ]);
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                let errorMessageText;
                if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                    errorMessageText =
                        'SMTP Settings not found on Admin Dashboard';
                } else if (
                    hasGlobalSmtpSettings &&
                    !areEmailAlertsEnabledInGlobalSettings
                ) {
                    errorMessageText = 'Alert Disabled on Admin Dashboard';
                }
                return await _this.create({
                    projectId,
                    monitorId: monitor._id,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.Email,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: errorMessageText,
                });
            }
            const incidentcreatedBy =
                incident.createdById && incident.createdById.name
                    ? incident.createdById.name
                    : 'oneuptime';
            const downtime = moment(incident.acknowledgedAt).diff(
                moment(incident.createdAt),
                'minutes'
            );
            let downtimestring = `${Math.ceil(downtime)} minutes`;
            if (downtime < 1) {
                downtimestring = 'less than a minute';
            } else if (downtime > 24 * 60) {
                downtimestring = `${Math.floor(
                    downtime / (24 * 60)
                )} days ${Math.floor(
                    (downtime % (24 * 60)) / 60
                )} hours ${Math.floor(downtime % 60)} minutes`;
            } else if (downtime > 60) {
                downtimestring = `${Math.floor(
                    downtime / 60
                )} hours ${Math.floor(downtime % 60)} minutes`;
            }

            await MailService.sendIncidentAcknowledgedMail({
                incidentTime: date,
                monitorName: monitor.name,
                monitorUrl:
                    monitor && monitor.data && monitor.data.url
                        ? monitor.data.url
                        : null,

                incidentId: `#${incident.idNumber}`,
                incidentSlug: incident.slug,
                reason: incident.reason
                    ? incident.reason.split('\n')
                    : [`This incident was created by ${incidentcreatedBy}`],
                view_url,
                method:
                    monitor.data && monitor.data.url
                        ? monitor.method
                            ? monitor.method.toUpperCase()
                            : 'GET'
                        : null,
                componentName: monitor.componentId.name,
                email: user.email,
                userId: user._id,
                firstName: firstName.split(' ')[0],
                projectId,
                resolveUrl: resolve_url,
                accessToken,
                incidentType: incident.incidentType,
                projectName: project.name,
                acknowledgeTime: incident.acknowledgedAt,
                length: downtimestring,
                criterionName:
                    !incident.manuallyCreated && incident.criterionCause
                        ? incident.criterionCause.name
                        : '',
                acknowledgedBy: incident.acknowledgedByZapier
                    ? 'Zapier'
                    : incident.acknowledgedByIncomingHttpRequest
                    ? 'Incoming HTTP Request'
                    : incident.acknowledgedBy && incident.acknowledgedBy.name
                    ? incident.acknowledgedBy.name
                    : 'Unknown User',
            });
            return await _this.create({
                projectId,
                monitorId: monitor._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: AlertType.Email,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Success',
            });
        } catch (e) {
            return await _this.create({
                projectId,
                monitorId: monitor._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: AlertType.Email,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Cannot Send',
                error: true,
                errorMessage: e.message,
            });
        }
    },

    sendResolveIncidentMail: async function(incident, monitor) {
        const _this = this;
        if (incident) {
            const projectId = incident.projectId._id
                ? incident.projectId._id
                : incident.projectId;

            const monitorPopulate = [{ path: 'componentId', select: 'name' }];
            const monitorSelect = '_id name data method componentId';
            const selectOnCallScheduleStatus =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];

            const [schedules, mon, project] = await Promise.all([
                this.getSchedulesForAlerts(incident, monitor),
                MonitorService.findOneBy({
                    query: { _id: monitor._id },
                    populate: monitorPopulate,
                    select: monitorSelect,
                }),
                ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'slug name',
                }),
            ]);
            monitor = mon;

            for (const schedule of schedules) {
                if (!schedule || !incident) {
                    continue;
                }

                //scheudle has no escalations. Skip.
                if (
                    !schedule.escalationIds ||
                    schedule.escalationIds.length === 0
                ) {
                    continue;
                }

                const callScheduleStatuses = await OnCallScheduleStatusService.findBy(
                    {
                        query: {
                            incident: incident._id,
                            schedule: schedule,
                        },
                        select: selectOnCallScheduleStatus,
                        populate: populateOnCallScheduleStatus,
                    }
                );
                let onCallScheduleStatus = null;
                let escalationId = null;
                let currentEscalationStatus = null;

                if (callScheduleStatuses.length === 0) {
                    escalationId = schedule.escalationIds[0];

                    if (escalationId && escalationId._id) {
                        escalationId = escalationId._id;
                    }
                    currentEscalationStatus = {
                        escalation: escalationId,
                        callRemindersSent: 0,
                        emailRemindersSent: 0,
                        smsRemindersSent: 0,
                    };

                    //create new onCallScheduleStatus
                    onCallScheduleStatus = await OnCallScheduleStatusService.create(
                        {
                            project: projectId,
                            incident: incident._id,
                            activeEscalation: escalationId,
                            schedule: schedule._id,
                            incidentAcknowledged: false,
                            escalations: [currentEscalationStatus],
                        }
                    );
                } else {
                    onCallScheduleStatus = callScheduleStatuses[0];
                    escalationId =
                        callScheduleStatuses[0].escalations[
                            callScheduleStatuses[0].escalations.length - 1
                        ].escalation._id;
                }

                const selectEscalation =
                    'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

                const populateEscalation = [
                    {
                        path: 'projectId',
                        select: '_id name slug',
                    },
                    {
                        path: 'scheduleId',
                        select: 'name isDefault slug',
                        populate: {
                            path: 'monitorIds',
                            select: 'name',
                        },
                    },
                    {
                        path: 'teams.teamMembers.user',
                        select: 'name email',
                    },
                    {
                        path: 'teams.teamMembers.groups',
                        select: 'teams name',
                    },
                ];
                const escalation = await EscalationService.findOneBy({
                    query: { _id: escalationId },
                    select: selectEscalation,
                    populate: populateEscalation,
                });

                if (!escalation) {
                    continue;
                }
                const activeTeam = escalation.activeTeam;
                if (
                    !activeTeam.teamMembers ||
                    activeTeam.teamMembers.length === 0
                ) {
                    continue;
                }
                for (const teamMember of activeTeam.teamMembers) {
                    const [isOnDuty, user] = await Promise.all([
                        _this.checkIsOnDuty(
                            teamMember.startTime,
                            teamMember.endTime
                        ),
                        UserService.findOneBy({
                            query: { _id: teamMember.userId },
                            select: '_id name timezone email',
                        }),
                    ]);

                    if (!user) {
                        continue;
                    }

                    if (!isOnDuty) {
                        if (escalation.email) {
                            await _this.create({
                                projectId,
                                monitorId: monitor._id,
                                alertVia: AlertType.Email,
                                userId: user._id,
                                incidentId: incident._id,
                                schedule,
                                escalation,
                                onCallScheduleStatus,
                                alertStatus: 'Not on Duty',
                                eventType: 'resolved',
                            });
                        }
                    } else {
                        if (escalation.email) {
                            await _this.sendResolveEmailAlert({
                                incident,
                                user,
                                project,
                                monitor,
                                schedule,
                                escalation,
                                onCallScheduleStatus,
                                eventType: 'resolved',
                            });
                        }
                    }
                }
            }
        }
    },

    sendResolveEmailAlert: async function({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
    }) {
        const _this = this;
        const projectId = incident.projectId._id || incident.projectId;

        try {
            let date = new Date();
            const accessToken = UserService.getAccessToken({
                userId: user._id,
                expiresIn: 12 * 60 * 60 * 1000,
            });

            const queryString = `projectId=${projectId}&userId=${user._id}&accessToken=${accessToken}`;
            const view_url = `${global.dashboardHost}/project/${project.slug}/component/${monitor.componentId.slug}/incidents/${incident.slug}?${queryString}`;
            const firstName = user.name;

            if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
                date = moment(date)
                    .tz(user.timezone)
                    .format();
            }

            const [
                hasGlobalSmtpSettings,
                hasCustomSmtpSettings,
            ] = await Promise.all([
                GlobalConfigService.findOneBy({
                    query: { name: 'smtp' },
                    select: 'value',
                }),
                MailService.hasCustomSmtpSettings(projectId),
            ]);
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                let errorMessageText;
                if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                    errorMessageText =
                        'SMTP Settings not found on Admin Dashboard';
                } else if (
                    hasGlobalSmtpSettings &&
                    !areEmailAlertsEnabledInGlobalSettings
                ) {
                    errorMessageText = 'Alert Disabled on Admin Dashboard';
                }
                return await _this.create({
                    projectId,
                    monitorId: monitor._id,
                    schedule: schedule._id,
                    escalation: escalation._id,
                    onCallScheduleStatus: onCallScheduleStatus._id,
                    alertVia: AlertType.Email,
                    userId: user._id,
                    incidentId: incident._id,
                    alertStatus: null,
                    error: true,
                    eventType,
                    errorMessage: errorMessageText,
                });
            }
            const incidentcreatedBy =
                incident.createdById && incident.createdById.name
                    ? incident.createdById.name
                    : 'oneuptime';
            const downtime = moment(incident.resolvedAt).diff(
                moment(incident.createdAt),
                'minutes'
            );
            let downtimestring = `${Math.ceil(downtime)} minutes`;
            if (downtime < 1) {
                downtimestring = 'less than a minute';
            } else if (downtime > 24 * 60) {
                downtimestring = `${Math.floor(
                    downtime / (24 * 60)
                )} days ${Math.floor(
                    (downtime % (24 * 60)) / 60
                )} hours ${Math.floor(downtime % 60)} minutes`;
            } else if (downtime > 60) {
                downtimestring = `${Math.floor(
                    downtime / 60
                )} hours ${Math.floor(downtime % 60)} minutes`;
            }
            await MailService.sendIncidentResolvedMail({
                incidentTime: date,
                monitorName: monitor.name,
                monitorUrl:
                    monitor && monitor.data && monitor.data.url
                        ? monitor.data.url
                        : null,
                incidentId: `#${incident.idNumber}`,
                incidentSlug: incident.slug,
                reason: incident.reason
                    ? incident.reason.split('\n')
                    : [`This incident was created by ${incidentcreatedBy}`],
                view_url,
                method:
                    monitor.data && monitor.data.url
                        ? monitor.method
                            ? monitor.method.toUpperCase()
                            : 'GET'
                        : null,
                componentName: monitor.componentId.name,
                email: user.email,
                userId: user._id,
                firstName: firstName.split(' ')[0],
                projectId,
                accessToken,
                incidentType: incident.incidentType,
                projectName: project.name,
                resolveTime: incident.resolvedAt,
                length: downtimestring,
                criterionName:
                    !incident.manuallyCreated && incident.criterionCause
                        ? incident.criterionCause.name
                        : '',
                resolvedBy: incident.resolvedByZapier
                    ? 'Zapier'
                    : incident.resolvedByIncomingHttpRequest
                    ? 'Incoming HTTP Request'
                    : incident.resolvedBy
                    ? incident.resolvedBy.name
                    : 'Unknown User',
            });
            return await _this.create({
                projectId,
                monitorId: monitor._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: AlertType.Email,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Success',
            });
        } catch (e) {
            return await _this.create({
                projectId,
                monitorId: monitor._id,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                alertVia: AlertType.Email,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus: 'Cannot Send',
                error: true,
                errorMessage: e.message,
            });
        }
    },

    sendAcknowledgedIncidentToSubscribers: async function(incident, monitors) {
        const _this = this;
        const uuid = new Date().getTime();
        const track = {};
        const populateStatusPage = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage =
            'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const sendSubscriberAlert = async ({
            subscriber,
            monitor,
            enabledStatusPage,
            subscribers,
        }) => {
            await _this.sendSubscriberAlert(
                subscriber,
                incident,
                'Subscriber Incident Acknowledged',
                enabledStatusPage,
                {},
                subscribers.length,
                uuid,
                monitor
            );
        };

        if (incident) {
            for (const monitor of monitors) {
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitor._id,
                        subscribed: true,
                    }
                );
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage = await StatusPageService.findOneBy(
                            {
                                query: {
                                    _id: subscriber.statusPageId,
                                    isSubscriberEnabled: true,
                                },
                                populate: populateStatusPage,
                                select: selectStatusPage,
                            }
                        );
                        if (enabledStatusPage) {
                            if (subscriber.alertVia === AlertType.Email) {
                                if (!track[subscriber.contactEmail]) {
                                    track[subscriber.contactEmail] =
                                        subscriber.contactEmail;
                                    await sendSubscriberAlert({
                                        subscriber,
                                        monitor,
                                        enabledStatusPage,
                                        subscribers,
                                    });
                                }
                            } else {
                                await sendSubscriberAlert({
                                    subscriber,
                                    monitor,
                                    enabledStatusPage,
                                    subscribers,
                                });
                            }
                        }
                    } else {
                        if (subscriber.alertVia === AlertType.Email) {
                            if (!track[subscriber.contactEmail]) {
                                track[subscriber.contactEmail] =
                                    subscriber.contactEmail;
                                await sendSubscriberAlert({
                                    subscriber,
                                    monitor,
                                    enabledStatusPage: null,
                                    subscribers,
                                });
                            }
                        } else {
                            await sendSubscriberAlert({
                                subscriber,
                                monitor,
                                enabledStatusPage: null,
                                subscribers,
                            });
                        }
                    }
                }
            }
        }
    },

    sendResolvedIncidentToSubscribers: async function(incident, monitors) {
        const _this = this;
        const uuid = new Date().getTime();
        const track = {};
        const populateStatusPage = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage =
            'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const sendSubscriberAlert = async ({
            subscriber,
            monitor,
            enabledStatusPage,
            subscribers,
        }) => {
            await _this.sendSubscriberAlert(
                subscriber,
                incident,
                'Subscriber Incident Resolved',
                enabledStatusPage,
                {},
                subscribers.length,
                uuid,
                monitor
            );
        };

        if (incident) {
            for (const monitor of monitors) {
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitor._id,
                        subscribed: true,
                    }
                );
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage = await StatusPageService.findOneBy(
                            {
                                query: {
                                    _id: subscriber.statusPageId,
                                    isSubscriberEnabled: true,
                                },
                                select: selectStatusPage,
                                populate: populateStatusPage,
                            }
                        );
                        if (enabledStatusPage) {
                            if (subscriber.alertVia === AlertType.Email) {
                                if (!track[subscriber.contactEmail]) {
                                    track[subscriber.contactEmail] =
                                        subscriber.contactEmail;
                                    sendSubscriberAlert({
                                        subscriber,
                                        monitor,
                                        enabledStatusPage,
                                        subscribers,
                                    });
                                }
                            } else {
                                sendSubscriberAlert({
                                    subscriber,
                                    monitor,
                                    enabledStatusPage,
                                    subscribers,
                                });
                            }
                        }
                    } else {
                        if (subscriber.alertVia === AlertType.Email) {
                            if (!track[subscriber.contactEmail]) {
                                track[subscriber.contactEmail] =
                                    subscriber.contactEmail;
                                sendSubscriberAlert({
                                    subscriber,
                                    monitor,
                                    enabledStatusPage: null,
                                    subscribers,
                                });
                            }
                        } else {
                            sendSubscriberAlert({
                                subscriber,
                                monitor,
                                enabledStatusPage: null,
                                subscribers,
                            });
                        }
                    }
                }
            }
        }
    },

    sendSubscriberAlert: async function(
        subscriber,
        incident,
        templateType = 'Subscriber Incident Created',
        statusPage,
        {
            note,
            incidentState,
            noteType,
            statusNoteStatus,
            statusPageSlug,
        } = {},
        totalSubscribers,
        id,
        monitor
    ) {
        const _this = this;
        const date = new Date();
        const isStatusPageNoteAlert = note && incidentState && statusNoteStatus;
        const statusPageNoteAlertEventType = `Investigation note ${statusNoteStatus}`;

        const projectId = incident.projectId._id || incident.projectId;
        const monitorPopulate = [
            { path: 'componentId', select: '_id' },
            { path: 'projectId', select: 'slug' },
        ];
        const monitorSelect = '_id customFields componentId projectId';
        const [project, mon] = await Promise.all([
            ProjectService.findOneBy({
                query: { _id: projectId },
                select:
                    'enableInvestigationNoteNotificationWebhook enableInvestigationNoteNotificationEmail name replyAddress sendAcknowledgedIncidentNotificationEmail sendResolvedIncidentNotificationEmail sendCreatedIncidentNotificationEmail enableInvestigationNoteNotificationSMS alertEnable users alertOptions slug sendAcknowledgedIncidentNotificationSms _id sendResolvedIncidentNotificationSms sendCreatedIncidentNotificationSms',
            }),
            MonitorService.findOneBy({
                query: { _id: monitor._id },
                populate: monitorPopulate,
                select: monitorSelect,
            }),
        ]);
        monitor = mon;
        // get the component
        const populateComponent = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent =
            '_id createdAt name createdById projectId slug componentCategoryId';
        const component = await ComponentService.findOneBy({
            query: {
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            },
            select: selectComponent,
            populate: populateComponent,
        });

        let statusPageUrl;
        if (statusPage) {
            statusPageUrl = `${global.statusHost}/status-page/${statusPage._id}`;
            if (statusPage.domains && statusPage.domains.length > 0) {
                const domains = statusPage.domains.filter(domainData => {
                    if (domainData.domainVerificationToken.verified) {
                        return true;
                    }
                    return false;
                });

                if (domains.length > 0) {
                    statusPageUrl = `${domains[0].domain}/status-page/${statusPage._id}`;
                }
            }
        }

        let statusUrl;
        if (statusPageSlug) {
            statusUrl = `${global.statusHost}/status-page/${statusPageSlug}/incident/${incident.slug}`;
        }

        const monitorCustomFields = {},
            incidentCustomFields = {};
        if (monitor && monitor.customFields) {
            monitor.customFields.forEach(
                field =>
                    (monitorCustomFields[field.fieldName] = field.fieldValue)
            );
        }
        if (incident && incident.customFields) {
            incident.customFields.forEach(
                field =>
                    (incidentCustomFields[field.fieldName] = field.fieldValue)
            );
        }
        const customFields = {
            monitor: { customFields: monitorCustomFields },
            incident: { customFields: incidentCustomFields },
        };

        let webhookNotificationSent = true;

        const sendAlerts = async () => {
            if (subscriber.alertVia === AlertType.Webhook) {
                const investigationNoteNotificationWebhookDisabled =
                    isStatusPageNoteAlert &&
                    !project.enableInvestigationNoteNotificationWebhook;

                let eventType;
                if (investigationNoteNotificationWebhookDisabled) {
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowledged'
                    ) {
                        eventType = 'acknowledged';
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        eventType = 'resolved';
                    } else {
                        eventType = 'identified';
                    }
                    return await SubscriberAlertService.create({
                        projectId,
                        incidentId: incident._id,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.Webhook,
                        eventType: eventType,
                        alertStatus: null,
                        error: true,
                        errorMessage:
                            'Investigation Note Webhook Notification Disabled',
                        totalSubscribers,
                        id,
                    });
                }
                const downTimeString = IncidentUtility.calculateHumanReadableDownTime(
                    incident.createdAt
                );

                let alertStatus = 'Pending';

                try {
                    webhookNotificationSent = await WebHookService.sendSubscriberNotification(
                        subscriber,
                        projectId,
                        incident,
                        monitor._id,
                        component,
                        downTimeString,
                        { note, incidentState, statusNoteStatus }
                    );
                    alertStatus = webhookNotificationSent ? 'Sent' : 'Not Sent';
                } catch (error) {
                    alertStatus = null;
                    throw error;
                } finally {
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowledged'
                    ) {
                        eventType = 'acknowledged';
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        eventType = 'resolved';
                    } else {
                        eventType = 'identified';
                    }
                    SubscriberAlertService.create({
                        projectId,
                        incidentId: incident._id,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.Webhook,
                        alertStatus: alertStatus,
                        eventType: eventType,
                        totalSubscribers,
                        id,
                    }).catch(error => {
                        ErrorService.log(
                            'AlertService.sendSubscriberAlert',
                            error
                        );
                    });
                }
            }

            let length = getIncidentLength(
                incident.createdAt,
                incident.acknowledgedAt
            );
            if (
                !webhookNotificationSent ||
                subscriber.alertVia === AlertType.Email
            ) {
                const [
                    hasGlobalSmtpSettings,
                    hasCustomSmtpSettings,
                ] = await Promise.all([
                    GlobalConfigService.findOneBy({
                        query: { name: 'smtp' },
                        select: 'value',
                    }),
                    MailService.hasCustomSmtpSettings(projectId),
                ]);
                const areEmailAlertsEnabledInGlobalSettings =
                    hasGlobalSmtpSettings &&
                    hasGlobalSmtpSettings.value &&
                    hasGlobalSmtpSettings.value['email-enabled']
                        ? true
                        : false;

                const investigationNoteNotificationEmailDisabled =
                    isStatusPageNoteAlert &&
                    !project.enableInvestigationNoteNotificationEmail;

                let errorMessageText, eventType;
                if (
                    (!areEmailAlertsEnabledInGlobalSettings &&
                        !hasCustomSmtpSettings) ||
                    investigationNoteNotificationEmailDisabled
                ) {
                    if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                        errorMessageText =
                            'SMTP Settings not found on Admin Dashboard';
                    } else if (
                        hasGlobalSmtpSettings &&
                        !areEmailAlertsEnabledInGlobalSettings
                    ) {
                        errorMessageText = 'Alert Disabled on Admin Dashboard';
                    } else if (investigationNoteNotificationEmailDisabled) {
                        errorMessageText =
                            'Investigation Note Email Notification Disabled';
                    }
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowledged'
                    ) {
                        eventType = 'acknowledged';
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        eventType = 'resolved';
                    } else {
                        eventType = 'identified';
                    }
                    return await SubscriberAlertService.create({
                        projectId,
                        incidentId: incident._id,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.Email,
                        eventType: eventType,
                        alertStatus: null,
                        error: true,
                        errorMessage: errorMessageText,
                        totalSubscribers,
                        id,
                    });
                }
                const select =
                    'projectId subject body emailType allowedVariables';
                const emailTemplate = await EmailTemplateService.findOneBy({
                    query: {
                        projectId,
                        emailType: templateType,
                    },
                    select,
                    populate: [{ path: 'projectId', select: 'nmae' }],
                });

                if (isStatusPageNoteAlert) {
                    eventType = statusPageNoteAlertEventType;
                } else if (
                    templateType === 'Subscriber Incident Acknowledged'
                ) {
                    eventType = 'acknowledged';
                } else if (templateType === 'Subscriber Incident Resolved') {
                    eventType = 'resolved';
                } else {
                    eventType = 'identified';
                }
                const subscriberAlert = await SubscriberAlertService.create({
                    projectId,
                    incidentId: incident._id,
                    subscriberId: subscriber._id,
                    alertVia: AlertType.Email,
                    alertStatus: 'Pending',
                    eventType: eventType,
                    totalSubscribers,
                    id,
                });
                const alertId = subscriberAlert._id;
                const trackEmailAsViewedUrl = `${global.apiHost}/subscriberAlert/${projectId}/${alertId}/viewed`;
                const unsubscribeUrl = `${global.homeHost}/unsubscribe/${monitor._id}/${subscriber._id}`;
                let alertStatus = null;
                try {
                    if (templateType === 'Subscriber Incident Acknowledged') {
                        if (project.sendAcknowledgedIncidentNotificationEmail) {
                            if (statusPage) {
                                await MailService.sendIncidentAcknowledgedMailToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    subscriber.contactEmail,
                                    subscriber._id,
                                    subscriber.contactEmail,
                                    incident,
                                    project.name,
                                    emailTemplate,
                                    trackEmailAsViewedUrl,
                                    component.name,
                                    statusPageUrl,
                                    project.replyAddress,
                                    customFields,
                                    length,
                                    unsubscribeUrl
                                );

                                alertStatus = 'Sent';
                            } else {
                                await MailService.sendIncidentAcknowledgedMailToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    subscriber.contactEmail,
                                    subscriber._id,
                                    subscriber.contactEmail,
                                    incident,
                                    project.name,
                                    emailTemplate,
                                    trackEmailAsViewedUrl,
                                    component.name,
                                    statusPageUrl,
                                    project.replyAddress,
                                    customFields,
                                    length,
                                    unsubscribeUrl
                                );

                                alertStatus = 'Sent';
                            }
                        } else {
                            alertStatus = 'Disabled';
                        }
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        length = getIncidentLength(
                            incident.createdAt,
                            incident.resolvedAt
                        );
                        if (project.sendResolvedIncidentNotificationEmail) {
                            if (statusPage) {
                                await MailService.sendIncidentResolvedMailToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    subscriber.contactEmail,
                                    subscriber._id,
                                    subscriber.contactEmail,
                                    incident,
                                    project.name,
                                    emailTemplate,
                                    trackEmailAsViewedUrl,
                                    component.name,
                                    statusPageUrl,
                                    project.replyAddress,
                                    customFields,
                                    length,
                                    unsubscribeUrl
                                );
                                alertStatus = 'Sent';
                            } else {
                                await MailService.sendIncidentResolvedMailToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    subscriber.contactEmail,
                                    subscriber._id,
                                    subscriber.contactEmail,
                                    incident,
                                    project.name,
                                    emailTemplate,
                                    trackEmailAsViewedUrl,
                                    component.name,
                                    statusPageUrl,
                                    project.replyAddress,
                                    customFields,
                                    length,
                                    unsubscribeUrl
                                );
                                alertStatus = 'Sent';
                            }
                        } else {
                            alertStatus = 'Disabled';
                        }
                    } else if (
                        templateType === 'Investigation note is created'
                    ) {
                        await MailService.sendInvestigationNoteToSubscribers(
                            date,
                            subscriber.monitorName,
                            subscriber.contactEmail,
                            subscriber._id,
                            subscriber.contactEmail,
                            incident,
                            project.name,
                            emailTemplate,
                            component.name,
                            note,
                            noteType,
                            statusUrl,
                            statusNoteStatus,
                            customFields,
                            unsubscribeUrl
                        );
                        alertStatus = 'Sent';
                    } else {
                        if (project.sendCreatedIncidentNotificationEmail) {
                            if (statusPage) {
                                await MailService.sendIncidentCreatedMailToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    subscriber.contactEmail,
                                    subscriber._id,
                                    subscriber.contactEmail,
                                    incident,
                                    project.name,
                                    emailTemplate,
                                    trackEmailAsViewedUrl,
                                    component.name,
                                    statusPageUrl,
                                    project.replyAddress,
                                    customFields,
                                    unsubscribeUrl
                                );
                                alertStatus = 'Sent';
                            } else {
                                await MailService.sendIncidentCreatedMailToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    subscriber.contactEmail,
                                    subscriber._id,
                                    subscriber.contactEmail,
                                    incident,
                                    project.name,
                                    emailTemplate,
                                    trackEmailAsViewedUrl,
                                    component.name,
                                    statusPageUrl,
                                    project.replyAddress,
                                    customFields,
                                    unsubscribeUrl
                                );
                                alertStatus = 'Sent';
                            }
                        } else {
                            alertStatus = 'Disabled';
                        }
                    }
                    await SubscriberAlertService.updateOneBy(
                        { _id: alertId },
                        { alertStatus }
                    );
                } catch (error) {
                    await SubscriberAlertService.updateOneBy(
                        { _id: alertId },
                        { alertStatus: null }
                    );
                    throw error;
                }
            } else if (subscriber.alertVia == AlertType.SMS) {
                let owner;
                const hasGlobalTwilioSettings = await GlobalConfigService.findOneBy(
                    {
                        query: { name: 'twilio' },
                        select: 'value',
                    }
                );
                const areAlertsEnabledGlobally =
                    hasGlobalTwilioSettings &&
                    hasGlobalTwilioSettings.value &&
                    hasGlobalTwilioSettings.value['sms-enabled']
                        ? true
                        : false;

                const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                    projectId
                );

                const investigationNoteNotificationSMSDisabled =
                    isStatusPageNoteAlert &&
                    !project.enableInvestigationNoteNotificationSMS;
                if (
                    (!hasCustomTwilioSettings &&
                        ((IS_SAAS_SERVICE &&
                            (!project.alertEnable ||
                                !areAlertsEnabledGlobally)) ||
                            (!IS_SAAS_SERVICE && !areAlertsEnabledGlobally))) ||
                    investigationNoteNotificationSMSDisabled
                ) {
                    let errorMessageText, eventType;
                    if (!hasGlobalTwilioSettings) {
                        errorMessageText =
                            'Twilio Settings not found on Admin Dashboard';
                    } else if (!areAlertsEnabledGlobally) {
                        errorMessageText = 'Alert Disabled on Admin Dashboard';
                    } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                        errorMessageText = 'Alert Disabled for this project';
                    } else if (investigationNoteNotificationSMSDisabled) {
                        errorMessageText =
                            'Investigation Note SMS Notification Disabled';
                    } else {
                        errorMessageText = 'Error';
                    }
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowledged'
                    ) {
                        eventType = 'acknowledged';
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        eventType = 'resolved';
                    } else {
                        eventType = 'identified';
                    }
                    return await SubscriberAlertService.create({
                        projectId,
                        incidentId: incident._id,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.SMS,
                        alertStatus: null,
                        error: true,
                        errorMessage: errorMessageText,
                        eventType: eventType,
                        totalSubscribers,
                        id,
                    });
                }
                const countryCode = await _this.mapCountryShortNameToCountryCode(
                    subscriber.countryCode
                );
                let contactPhone = subscriber.contactPhone;
                if (countryCode) {
                    contactPhone = countryCode + contactPhone;
                }

                if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                    owner = project.users.filter(
                        user => user.role === 'Owner'
                    )[0];
                    const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                        projectId,
                        contactPhone
                    );
                    if (!doesPhoneNumberComplyWithHighRiskConfig) {
                        const countryType = getCountryType(contactPhone);
                        let errorMessageText, eventType;
                        if (countryType === 'us') {
                            errorMessageText =
                                'SMS for numbers inside US not enabled for this project';
                        } else if (countryType === 'non-us') {
                            errorMessageText =
                                'SMS for numbers outside US not enabled for this project';
                        } else {
                            errorMessageText =
                                'SMS to High Risk country not enabled for this project';
                        }
                        if (isStatusPageNoteAlert) {
                            eventType = statusPageNoteAlertEventType;
                        } else if (
                            templateType === 'Subscriber Incident Acknowledged'
                        ) {
                            eventType = 'acknowledged';
                        } else if (
                            templateType === 'Subscriber Incident Resolved'
                        ) {
                            eventType = 'resolved';
                        } else {
                            eventType = 'identified';
                        }
                        return await SubscriberAlertService.create({
                            projectId,
                            incidentId: incident._id,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: null,
                            error: true,
                            errorMessage: errorMessageText,
                            eventType: eventType,
                            totalSubscribers,
                            id,
                        });
                    }

                    const status = await PaymentService.checkAndRechargeProjectBalance(
                        project,
                        owner.userId,
                        contactPhone,
                        AlertType.SMS
                    );
                    let eventType;
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowledged'
                    ) {
                        eventType = 'acknowledged';
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        eventType = 'resolved';
                    } else {
                        eventType = 'identified';
                    }

                    if (!status.success) {
                        return await SubscriberAlertService.create({
                            projectId,
                            incidentId: incident._id,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: null,
                            error: true,
                            errorMessage: status.message,
                            eventType: eventType,
                            totalSubscribers,
                            id,
                        });
                    }
                }

                let sendResult;
                const smsTemplate = await SmsTemplateService.findOneBy({
                    query: { projectId, smsType: templateType },
                    select: 'body',
                });
                let eventType;
                if (isStatusPageNoteAlert) {
                    eventType = statusPageNoteAlertEventType;
                } else if (
                    templateType === 'Subscriber Incident Acknowledged'
                ) {
                    eventType = 'acknowledged';
                } else if (templateType === 'Subscriber Incident Resolved') {
                    eventType = 'resolved';
                } else {
                    eventType = 'identified';
                }
                const subscriberAlert = await SubscriberAlertService.create({
                    projectId,
                    incidentId: incident._id,
                    subscriberId: subscriber._id,
                    alertVia: AlertType.SMS,
                    alertStatus: 'Pending',
                    eventType: eventType,
                    totalSubscribers,
                    id,
                });
                const alertId = subscriberAlert._id;

                let alertStatus = null;
                try {
                    if (templateType === 'Subscriber Incident Acknowledged') {
                        if (project.sendAcknowledgedIncidentNotificationSms) {
                            if (statusPage) {
                                sendResult = await TwilioService.sendIncidentAcknowledgedMessageToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    contactPhone,
                                    smsTemplate,
                                    incident,
                                    project.name,
                                    projectId,
                                    component.name,
                                    statusPageUrl,
                                    customFields,
                                    length
                                );
                                alertStatus = 'Success';
                            } else {
                                sendResult = await TwilioService.sendIncidentAcknowledgedMessageToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    contactPhone,
                                    smsTemplate,
                                    incident,
                                    project.name,
                                    projectId,
                                    component.name,
                                    statusPageUrl,
                                    customFields,
                                    length
                                );
                                alertStatus = 'Success';
                            }
                        } else {
                            alertStatus = 'Disabled';
                        }
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        length = getIncidentLength(
                            incident.createdAt,
                            incident.resolvedAt
                        );
                        if (project.sendResolvedIncidentNotificationSms) {
                            if (statusPage) {
                                sendResult = await TwilioService.sendIncidentResolvedMessageToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    contactPhone,
                                    smsTemplate,
                                    incident,
                                    project.name,
                                    projectId,
                                    component.name,
                                    statusPageUrl,
                                    customFields,
                                    length
                                );
                                alertStatus = 'Success';
                            } else {
                                sendResult = await TwilioService.sendIncidentResolvedMessageToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    contactPhone,
                                    smsTemplate,
                                    incident,
                                    project.name,
                                    projectId,
                                    component.name,
                                    statusPageUrl,
                                    customFields,
                                    length
                                );
                                alertStatus = 'Success';
                            }
                        } else {
                            alertStatus = 'Disabled';
                        }
                    } else if (
                        templateType == 'Investigation note is created'
                    ) {
                        sendResult = await TwilioService.sendInvestigationNoteToSubscribers(
                            date,
                            subscriber.monitorName,
                            contactPhone,
                            smsTemplate,
                            incident,
                            project.name,
                            projectId,
                            component.name,
                            statusUrl,
                            customFields,
                            note
                        );
                        alertStatus = 'Success';
                    } else {
                        if (project.sendCreatedIncidentNotificationSms) {
                            if (statusPage) {
                                sendResult = await TwilioService.sendIncidentCreatedMessageToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    contactPhone,
                                    smsTemplate,
                                    incident,
                                    project.name,
                                    projectId,
                                    component.name,
                                    statusPageUrl,
                                    customFields
                                );
                                alertStatus = 'Success';
                            } else {
                                sendResult = await TwilioService.sendIncidentCreatedMessageToSubscriber(
                                    date,
                                    subscriber.monitorName,
                                    contactPhone,
                                    smsTemplate,
                                    incident,
                                    project.name,
                                    projectId,
                                    component.name,
                                    statusPageUrl,
                                    customFields
                                );
                                alertStatus = 'Success';
                            }
                        } else {
                            alertStatus = 'Disabled';
                        }
                    }

                    if (
                        sendResult &&
                        sendResult.code &&
                        sendResult.code === 400
                    ) {
                        await SubscriberAlertService.updateBy(
                            { _id: alertId },
                            {
                                alertStatus: null,
                                error: true,
                                errorMessage: sendResult.message,
                            }
                        );
                    } else {
                        await SubscriberAlertService.updateBy(
                            { _id: alertId },
                            {
                                alertStatus,
                            }
                        );
                        if (
                            alertStatus === 'Success' &&
                            IS_SAAS_SERVICE &&
                            !hasCustomTwilioSettings
                        ) {
                            // charge sms per 160 chars
                            const segments = calcSmsSegments(sendResult.body);
                            const balanceStatus = await PaymentService.chargeAlertAndGetProjectBalance(
                                owner.userId,
                                project,
                                AlertType.SMS,
                                contactPhone,
                                segments
                            );

                            if (!balanceStatus.error) {
                                await AlertChargeService.create(
                                    projectId,
                                    balanceStatus.chargeAmount,
                                    balanceStatus.closingBalance,
                                    null,
                                    monitor._id,
                                    incident._id,
                                    contactPhone,
                                    alertId
                                );
                            }
                        }
                    }
                } catch (error) {
                    await SubscriberAlertService.updateBy(
                        { _id: alertId },
                        {
                            alertStatus: null,
                            error: true,
                            errorMessage: error.message,
                        }
                    );
                    throw error;
                }
            }
        };

        let incidentAlert = subscriber.notificationType?.incident;
        const statusPageId = subscriber?.statusPageId;

        // if there is no notification type, then set incidentAlert to true.
        if (!subscriber.notificationType) {
            incidentAlert = true;
        }

        if (!statusPageId) {
            sendAlerts();
        } else {
            if (incidentAlert) {
                sendAlerts();
            }
        }
    },

    mapCountryShortNameToCountryCode(shortName) {
        return countryCode[[shortName]];
    },

    isOnDuty(timezone, escalationStartTime, escalationEndTime) {
        if (!timezone || !escalationStartTime || !escalationEndTime) {
            return true;
        }

        const currentDate = new Date();
        escalationStartTime = DateTime.changeDateTimezone(
            escalationStartTime,
            timezone
        );
        escalationEndTime = DateTime.changeDateTimezone(
            escalationEndTime,
            timezone
        );
        return DateTime.isInBetween(
            currentDate,
            escalationStartTime,
            escalationEndTime
        );
    },

    checkIsOnDuty(startTime, endTime) {
        if (!startTime && !endTime) return true;
        const oncallstart = moment(startTime).format('HH:mm');
        const oncallend = moment(endTime).format('HH:mm');
        const currentTime = moment().format('HH:mm');
        const isUserActive =
            DateTime.compareDate(oncallstart, oncallend, currentTime) ||
            oncallstart === oncallend;
        if (isUserActive) return true;
        return false;
    },

    getSubProjectAlerts: async function(subProjectIds) {
        const _this = this;
        const populateAlert = [
            { path: 'userId', select: 'name email' },
            { path: 'monitorId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAlert =
            '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

        const subProjectAlerts = await Promise.all(
            subProjectIds.map(async id => {
                const alerts = await _this.findBy({
                    query: { projectId: id },
                    skip: 0,
                    limit: 10,
                    select: selectAlert,
                    populate: populateAlert,
                });
                const count = await _this.countBy({ projectId: id });
                return { alerts, count, _id: id, skip: 0, limit: 10 };
            })
        );
        return subProjectAlerts;
    },

    hardDeleteBy: async function(query) {
        await AlertModel.deleteMany(query);
        return 'Alert(s) removed successfully';
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let alert = await _this.findBy({ query, select: '_id' });
        if (alert && alert.length > 1) {
            const alerts = await Promise.all(
                alert.map(async alert => {
                    const alertId = alert._id;
                    alert = await _this.updateOneBy(
                        {
                            _id: alertId,
                        },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return alert;
                })
            );
            return alerts;
        } else {
            alert = alert[0];
            if (alert) {
                const alertId = alert._id;
                alert = await _this.updateOneBy(
                    {
                        _id: alertId,
                    },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return alert;
        }
    },

    //Return true, if the limit is not reached yet.
    checkPhoneAlertsLimit: async function(projectId) {
        const _this = this;
        const hasCustomSettings = await TwilioService.hasCustomSettings(
            projectId
        );
        if (hasCustomSettings) {
            return true;
        }
        const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
        const [alerts, smsCounts, project, twilioSettings] = await Promise.all([
            _this.countBy({
                projectId: projectId,
                alertVia: { $in: [AlertType.Call, AlertType.SMS] },
                error: { $in: [null, undefined, false] },
                createdAt: { $gte: yesterday },
            }),
            SmsCountService.countBy({
                projectId: projectId,
                createdAt: { $gte: yesterday },
            }),
            ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'alertLimit',
            }),
            TwilioService.getSettings(),
        ]);
        let limit =
            project && project.alertLimit
                ? project.alertLimit
                : twilioSettings['alert-limit'];
        if (limit && typeof limit === 'string') {
            limit = parseInt(limit, 10);
        }
        if (alerts + smsCounts <= limit) {
            return true;
        } else {
            await ProjectService.updateOneBy(
                { _id: projectId },
                { alertLimitReached: true }
            );
            return false;
        }
    },

    sendUnpaidSubscriptionEmail: async function(project, user) {
        const { name: userName, email: userEmail } = user;
        const { stripePlanId, name: projectName, slug: projectSlug } = project;
        const projectUrl = `${global.dashboardHost}/project/${projectSlug}`;
        const projectPlan = getPlanById(stripePlanId);

        await MailService.sendUnpaidSubscriptionReminder({
            projectName,
            projectPlan,
            name: userName,
            userEmail,
            projectUrl,
        });
    },

    sendProjectDeleteEmailForUnpaidSubscription: async function(project, user) {
        const { name: userName, email: userEmail } = user;
        const { stripePlanId, name: projectName } = project;
        const projectPlan =
            getPlanById(stripePlanId) || getPlanByExtraUserId(stripePlanId);

        await MailService.sendUnpaidSubscriptionReminder({
            projectName,
            projectPlan,
            name: userName,
            userEmail,
        });
    },
    sendCreatedScheduledEventToSubscribers: async function(schedule) {
        const _this = this;
        const uuid = new Date().getTime();
        if (schedule) {
            const track = {};
            const sendSubscribersAlert = async ({
                subscriber,
                component,
                subscribers,
            }) => {
                await _this.sendSubscriberScheduledEventAlert(
                    subscriber,
                    schedule,
                    'Subscriber Scheduled Maintenance Created',
                    component,
                    subscribers.length,
                    uuid
                );
            };
            for (const monitor of schedule.monitors) {
                const component = monitor.monitorId.componentId.name;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitor.monitorId._id,
                        subscribed: true,
                    }
                );

                for (const subscriber of subscribers) {
                    if (subscriber.alertVia === AlertType.Email) {
                        if (!track[subscriber.contactEmail]) {
                            track[subscriber.contactEmail] =
                                subscriber.contactEmail;
                            sendSubscribersAlert({
                                subscriber,
                                component,
                                subscribers,
                            });
                        }
                    } else {
                        sendSubscribersAlert({
                            subscriber,
                            component,
                            subscribers,
                        });
                    }
                }
            }
        }
    },
    sendResolvedScheduledEventToSubscribers: async function(schedule) {
        const _this = this;
        const uuid = new Date().getTime();
        if (schedule) {
            const track = {};
            const sendSubscribersAlert = async ({
                subscriber,
                component,
                subscribers,
            }) => {
                await _this.sendSubscriberScheduledEventAlert(
                    subscriber,
                    schedule,
                    'Subscriber Scheduled Maintenance Resolved',
                    component,
                    subscribers.length,
                    uuid
                );
            };
            for (const monitor of schedule.monitors) {
                const component = monitor.monitorId.componentId.name;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitor.monitorId._id,
                        subscribed: true,
                    }
                );

                for (const subscriber of subscribers) {
                    if (subscriber.alertVia === AlertType.Email) {
                        if (!track[subscriber.contactEmail]) {
                            track[subscriber.contactEmail] =
                                subscriber.contactEmail;
                            await sendSubscribersAlert({
                                subscriber,
                                component,
                                subscribers,
                            });
                        }
                    } else {
                        await sendSubscribersAlert({
                            subscriber,
                            component,
                            subscribers,
                        });
                    }
                }
            }
        }
    },

    sendCancelledScheduledEventToSubscribers: async function(schedule) {
        const _this = this;
        const uuid = new Date().getTime();
        if (schedule) {
            for (const monitor of schedule.monitors) {
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitor.monitorId._id,
                        subscribed: true,
                    }
                );

                for (const subscriber of subscribers) {
                    await _this.sendSubscriberScheduledEventAlert(
                        subscriber,
                        schedule,
                        'Subscriber Scheduled Maintenance Cancelled',
                        null,
                        subscribers.length,
                        uuid
                    );
                }
            }
        }
    },

    sendScheduledEventInvestigationNoteToSubscribers: async function(message) {
        const _this = this;
        const uuid = new Date().getTime();

        const monitorIds =
            message.scheduledEventId &&
            message.scheduledEventId.monitors.map(monitor => monitor.monitorId);

        const monitorsAffected = await MonitorService.findBy({
            query: { _id: { $in: monitorIds }, deleted: false },
            select: 'name',
        });

        if (message) {
            for (const monitor of message.scheduledEventId.monitors) {
                const monitorId = monitor.monitorId._id || monitor.monitorId;

                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId,
                        subscribed: true,
                    }
                );
                const totalSubscribers = subscribers.length;

                for (const subscriber of subscribers) {
                    const projectId = message.scheduledEventId.projectId._id;

                    const project = await ProjectService.findOneBy({
                        query: { _id: projectId },
                        select:
                            'sendNewScheduledEventInvestigationNoteNotificationEmail name alertEnable sendNewScheduledEventInvestigationNoteNotificationSms users _id alertOptions slug sendNewScheduledEventInvestigationNoteNotificationSms',
                    });

                    const unsubscribeUrl = `${global.homeHost}/unsubscribe/${subscriber.monitorId}/${subscriber._id}`;

                    if (subscriber.alertVia === AlertType.Email) {
                        const select =
                            'projectId subject body emailType allowedVariables';
                        const [
                            hasGlobalSmtpSettings,
                            hasCustomSmtpSettings,
                            emailTemplate,
                        ] = await Promise.all([
                            GlobalConfigService.findOneBy({
                                query: { name: 'smtp' },
                                select: 'value',
                            }),
                            MailService.hasCustomSmtpSettings(projectId),
                            EmailTemplateService.findOneBy({
                                query: {
                                    projectId,
                                    emailType:
                                        'Scheduled Maintenance Event Note',
                                },
                                select,
                                populate: [
                                    { path: 'projectId', select: 'nmae' },
                                ],
                            }),
                        ]);

                        const NotificationEmailDisabled = !project.sendNewScheduledEventInvestigationNoteNotificationEmail;

                        const areEmailAlertsEnabledInGlobalSettings =
                            hasGlobalSmtpSettings &&
                            hasGlobalSmtpSettings.value &&
                            hasGlobalSmtpSettings.value['email-enabled']
                                ? true
                                : false;

                        let errorMessageText = null;

                        if (
                            (!areEmailAlertsEnabledInGlobalSettings &&
                                !hasCustomSmtpSettings) ||
                            NotificationEmailDisabled
                        ) {
                            if (
                                !hasGlobalSmtpSettings &&
                                !hasCustomSmtpSettings
                            ) {
                                errorMessageText =
                                    'SMTP Settings not found on Admin Dashboard';
                            } else if (
                                hasGlobalSmtpSettings &&
                                !areEmailAlertsEnabledInGlobalSettings
                            ) {
                                errorMessageText =
                                    'Alert Disabled on Admin Dashboard';
                            } else if (NotificationEmailDisabled) {
                                errorMessageText =
                                    'Scheduled Maintenance Event Note Email Notification Disabled';
                            }
                            return await SubscriberAlertService.create({
                                projectId,
                                subscriberId: subscriber._id,
                                alertVia: AlertType.Email,
                                eventType: 'Scheduled maintenance note created',
                                alertStatus: null,
                                error: true,
                                errorMessage: errorMessageText,
                                totalSubscribers,
                                uuid,
                            });
                        }

                        const subscriberAlert = await SubscriberAlertService.create(
                            {
                                projectId,
                                subscriberId: subscriber._id,
                                alertVia: AlertType.Email,
                                alertStatus: 'Pending',
                                eventType: 'Scheduled maintenance note created',
                                totalSubscribers: subscribers.length,
                                uuid,
                            }
                        );
                        const alertId = subscriberAlert._id;

                        let alertStatus = null;
                        try {
                            const createdBy = message.createdById
                                ? message.createdById.name
                                : 'OneUptime';

                            const replyAddress = message.scheduledEventId
                                .projectId.replyAddress
                                ? message.scheduledEventId.projectId
                                      .replyAddress
                                : null;

                            await MailService.sendScheduledEventNoteMailToSubscriber(
                                message.scheduledEventId.name,
                                message.event_state,
                                message.content,
                                subscriber.contactEmail,
                                subscriber.contactEmail,
                                createdBy,
                                emailTemplate,
                                replyAddress,
                                project.name,
                                monitor.name,
                                projectId,
                                unsubscribeUrl,
                                monitorsAffected.filter(
                                    monitor =>
                                        String(monitor._id) ===
                                        String(monitorId)
                                )
                            );
                            alertStatus = 'Sent';
                            await SubscriberAlertService.updateOneBy(
                                { _id: alertId },
                                { alertStatus }
                            );
                        } catch (error) {
                            await SubscriberAlertService.updateOneBy(
                                { _id: alertId },
                                { alertStatus: null }
                            );
                            throw error;
                        }
                    } else if (subscriber.alertVia === AlertType.SMS) {
                        let owner;
                        const hasGlobalTwilioSettings = await GlobalConfigService.findOneBy(
                            {
                                query: { name: 'twilio' },
                                select: 'value',
                            }
                        );
                        const areAlertsEnabledGlobally =
                            hasGlobalTwilioSettings &&
                            hasGlobalTwilioSettings.value &&
                            hasGlobalTwilioSettings.value['sms-enabled']
                                ? true
                                : false;

                        const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                            projectId
                        );

                        const notificationSMSDisabled = !project.sendNewScheduledEventInvestigationNoteNotificationSms;

                        const eventType = 'Scheduled maintenance note created';
                        const templateType =
                            'Subscriber Scheduled Maintenance Note';

                        if (
                            (!hasCustomTwilioSettings &&
                                ((IS_SAAS_SERVICE &&
                                    (!project.alertEnable ||
                                        !areAlertsEnabledGlobally)) ||
                                    (!IS_SAAS_SERVICE &&
                                        !areAlertsEnabledGlobally))) ||
                            notificationSMSDisabled
                        ) {
                            let errorMessageText;
                            if (!hasGlobalTwilioSettings) {
                                errorMessageText =
                                    'Twilio Settings not found on Admin Dashboard';
                            } else if (!areAlertsEnabledGlobally) {
                                errorMessageText =
                                    'Alert Disabled on Admin Dashboard';
                            } else if (
                                IS_SAAS_SERVICE &&
                                !project.alertEnable
                            ) {
                                errorMessageText =
                                    'Alert Disabled for this project';
                            } else if (notificationSMSDisabled) {
                                errorMessageText = `${templateType} SMS Notification Disabled`;
                            } else {
                                errorMessageText = 'Error';
                            }

                            return await SubscriberAlertService.create({
                                projectId,
                                subscriberId: subscriber._id,
                                alertVia: AlertType.SMS,
                                alertStatus: null,
                                error: true,
                                errorMessage: errorMessageText,
                                eventType,
                                totalSubscribers,
                                uuid,
                            });
                        }
                        const countryCode = await _this.mapCountryShortNameToCountryCode(
                            subscriber.countryCode
                        );
                        let contactPhone = subscriber.contactPhone;
                        if (countryCode) {
                            contactPhone = countryCode + contactPhone;
                        }

                        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                            owner = project.users.filter(
                                user => user.role === 'Owner'
                            )[0];
                            const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                                projectId,
                                contactPhone
                            );
                            if (!doesPhoneNumberComplyWithHighRiskConfig) {
                                const countryType = getCountryType(
                                    contactPhone
                                );
                                let errorMessageText;
                                if (countryType === 'us') {
                                    errorMessageText =
                                        'SMS for numbers inside US not enabled for this project';
                                } else if (countryType === 'non-us') {
                                    errorMessageText =
                                        'SMS for numbers outside US not enabled for this project';
                                } else {
                                    errorMessageText =
                                        'SMS to High Risk country not enabled for this project';
                                }

                                return await SubscriberAlertService.create({
                                    projectId: projectId,
                                    subscriberId: subscriber._id,
                                    alertVia: AlertType.SMS,
                                    alertStatus: null,
                                    error: true,
                                    errorMessage: errorMessageText,
                                    eventType: eventType,
                                    totalSubscribers,
                                    uuid,
                                });
                            }

                            const status = await PaymentService.checkAndRechargeProjectBalance(
                                project,
                                owner.userId,
                                contactPhone,
                                AlertType.SMS
                            );

                            if (!status.success) {
                                return await SubscriberAlertService.create({
                                    projectId,
                                    subscriberId: subscriber._id,
                                    alertVia: AlertType.SMS,
                                    alertStatus: null,
                                    error: true,
                                    errorMessage: status.message,
                                    eventType: eventType,
                                    totalSubscribers,
                                    uuid,
                                });
                            }
                        }

                        let sendResult;
                        const smsTemplate = await SmsTemplateService.findOneBy({
                            query: {
                                projectId,
                                smsType: templateType,
                            },
                            select: 'body',
                        });
                        const subscriberAlert = await SubscriberAlertService.create(
                            {
                                projectId,
                                subscriberId: subscriber._id,
                                alertVia: AlertType.SMS,
                                alertStatus: 'Pending',
                                eventType: eventType,
                                totalSubscribers,
                                uuid,
                            }
                        );
                        const alertId = subscriberAlert._id;

                        let alertStatus = null;
                        try {
                            if (
                                project.sendNewScheduledEventInvestigationNoteNotificationSms
                            ) {
                                sendResult = await TwilioService.sendScheduledMaintenanceNoteCreatedToSubscriber(
                                    contactPhone,
                                    smsTemplate,
                                    message.scheduledEventId.name,
                                    message,
                                    project.name,
                                    projectId
                                );
                                alertStatus = 'Success';
                            } else {
                                alertStatus = 'Disabled';
                            }

                            if (
                                sendResult &&
                                sendResult.code &&
                                sendResult.code === 400
                            ) {
                                await SubscriberAlertService.updateBy(
                                    { _id: alertId },
                                    {
                                        alertStatus: null,
                                        error: true,
                                        errorMessage: sendResult.message,
                                    }
                                );
                            } else {
                                await SubscriberAlertService.updateBy(
                                    { _id: alertId },
                                    {
                                        alertStatus,
                                    }
                                );
                                if (
                                    alertStatus === 'Success' &&
                                    IS_SAAS_SERVICE &&
                                    !hasCustomTwilioSettings
                                ) {
                                    // charge sms per 160 chars
                                    const segments = calcSmsSegments(
                                        sendResult.body
                                    );
                                    const balanceStatus = await PaymentService.chargeAlertAndGetProjectBalance(
                                        owner.userId,
                                        project,
                                        AlertType.SMS,
                                        contactPhone,
                                        segments
                                    );

                                    if (!balanceStatus.error) {
                                        await AlertChargeService.create(
                                            projectId,
                                            balanceStatus.chargeAmount,
                                            balanceStatus.closingBalance,
                                            null,
                                            null,
                                            null,
                                            contactPhone,
                                            alertId
                                        );
                                    }
                                }
                            }
                        } catch (error) {
                            await SubscriberAlertService.updateBy(
                                { _id: alertId },
                                {
                                    alertStatus: null,
                                    error: true,
                                    errorMessage: error.message,
                                }
                            );
                            throw error;
                        }
                    }
                }
            }
        }
    },

    sendSubscriberScheduledEventAlert: async function(
        subscriber,
        schedule,
        templateType = 'Subscriber Scheduled Maintenance Created',
        componentName,
        totalSubscribers,
        id
    ) {
        const _this = this;
        const date = new Date();
        const projectName = schedule.projectId.name;
        const projectId = schedule.projectId._id;
        const project = await ProjectService.findOneBy({
            query: { _id: projectId },
            select:
                'sendCreatedScheduledEventNotificationEmail sendScheduledEventResolvedNotificationEmail sendScheduledEventCancelledNotificationEmail replyAddress sendCreatedScheduledEventNotificationSms sendScheduledEventResolvedNotificationSms sendScheduledEventCancelledNotificationSms alertEnable users alertOptions slug _id name',
        });

        const eventType =
            templateType === 'Subscriber Scheduled Maintenance Created'
                ? 'Scheduled maintenance created'
                : templateType === 'Subscriber Scheduled Maintenance Resolved'
                ? 'Scheduled maintenance resolved'
                : 'Scheduled maintenance cancelled';

        const sendAlerts = async () => {
            if (subscriber.alertVia === AlertType.Email) {
                const [
                    hasGlobalSmtpSettings,
                    hasCustomSmtpSettings,
                    emailTemplate,
                ] = await Promise.all([
                    GlobalConfigService.findOneBy({
                        query: { name: 'smtp' },
                        select: 'value',
                    }),
                    MailService.hasCustomSmtpSettings(projectId),
                    EmailTemplateService.findOneBy({
                        query: {
                            projectId,
                            emailType: templateType,
                        },
                        select:
                            'projectId subject body emailType allowedVariables',
                        populate: [{ path: 'projectId', select: 'nmae' }],
                    }),
                ]);
                const areEmailAlertsEnabledInGlobalSettings =
                    hasGlobalSmtpSettings &&
                    hasGlobalSmtpSettings.value &&
                    hasGlobalSmtpSettings.value['email-enabled']
                        ? true
                        : false;

                const notificationEmailDisabled =
                    templateType === 'Subscriber Scheduled Maintenance Created'
                        ? !project.sendCreatedScheduledEventNotificationEmail
                        : templateType ===
                          'Subscriber Scheduled Maintenance Resolved'
                        ? !project.sendScheduledEventResolvedNotificationEmail
                        : !project.sendScheduledEventCancelledNotificationEmail;

                let errorMessageText;
                if (
                    (!areEmailAlertsEnabledInGlobalSettings &&
                        !hasCustomSmtpSettings) ||
                    notificationEmailDisabled
                ) {
                    if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                        errorMessageText =
                            'SMTP Settings not found on Admin Dashboard';
                    } else if (
                        hasGlobalSmtpSettings &&
                        !areEmailAlertsEnabledInGlobalSettings
                    ) {
                        errorMessageText = 'Alert Disabled on Admin Dashboard';
                    } else if (notificationEmailDisabled) {
                        errorMessageText = `${templateType} Email Notification Disabled`;
                    }
                    return await SubscriberAlertService.create({
                        projectId,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.Email,
                        eventType,
                        alertStatus: null,
                        error: true,
                        errorMessage: errorMessageText,
                        totalSubscribers,
                        id,
                    });
                }

                const subscriberAlert = await SubscriberAlertService.create({
                    projectId,
                    subscriberId: subscriber._id,
                    alertVia: AlertType.Email,
                    alertStatus: 'Pending',
                    eventType,
                    totalSubscribers,
                    id,
                });
                const alertId = subscriberAlert._id;
                const unsubscribeUrl = `${global.homeHost}/unsubscribe/${subscriber.monitorId}/${subscriber._id}`;

                let alertStatus = null;
                try {
                    if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Created'
                    ) {
                        await MailService.sendScheduledEventMailToSubscriber(
                            date,
                            subscriber.monitorName,
                            subscriber.contactEmail,
                            subscriber._id,
                            subscriber.contactEmail,
                            schedule,
                            projectName,
                            emailTemplate,
                            componentName,
                            project.replyAddress,
                            unsubscribeUrl
                        );

                        alertStatus = 'Sent';
                    } else if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Resolved'
                    ) {
                        await MailService.sendResolvedScheduledEventMailToSubscriber(
                            date,
                            subscriber.monitorName,
                            subscriber.contactEmail,
                            subscriber._id,
                            subscriber.contactEmail,
                            schedule,
                            projectName,
                            emailTemplate,
                            componentName,
                            project.replyAddress,
                            unsubscribeUrl
                        );

                        alertStatus = 'Sent';
                    } else if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Cancelled'
                    ) {
                        await MailService.sendCancelledScheduledEventMailToSubscriber(
                            date,
                            subscriber.monitorName,
                            subscriber.contactEmail,
                            subscriber._id,
                            subscriber.contactEmail,
                            schedule,
                            projectName,
                            emailTemplate,
                            componentName,
                            project.replyAddress,
                            unsubscribeUrl
                        );

                        alertStatus = 'Sent';
                    }

                    await SubscriberAlertService.updateOneBy(
                        { _id: alertId },
                        { alertStatus }
                    );
                } catch (error) {
                    await SubscriberAlertService.updateOneBy(
                        { _id: alertId },
                        { alertStatus: null }
                    );
                    throw error;
                }
            } else if (subscriber.alertVia === AlertType.SMS) {
                let owner;
                const hasGlobalTwilioSettings = await GlobalConfigService.findOneBy(
                    {
                        query: { name: 'twilio' },
                        select: 'value',
                    }
                );
                const areAlertsEnabledGlobally =
                    hasGlobalTwilioSettings &&
                    hasGlobalTwilioSettings.value &&
                    hasGlobalTwilioSettings.value['sms-enabled']
                        ? true
                        : false;

                const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                    projectId
                );

                const notificationSmsDisabled =
                    templateType === 'Subscriber Scheduled Maintenance Created'
                        ? !project.sendCreatedScheduledEventNotificationSms
                        : templateType ===
                          'Subscriber Scheduled Maintenance Resolved'
                        ? !project.sendScheduledEventResolvedNotificationSms
                        : !project.sendScheduledEventCancelledNotificationSms;

                if (
                    (!hasCustomTwilioSettings &&
                        ((IS_SAAS_SERVICE &&
                            (!project.alertEnable ||
                                !areAlertsEnabledGlobally)) ||
                            (!IS_SAAS_SERVICE && !areAlertsEnabledGlobally))) ||
                    notificationSmsDisabled
                ) {
                    let errorMessageText;
                    if (!hasGlobalTwilioSettings) {
                        errorMessageText =
                            'Twilio Settings not found on Admin Dashboard';
                    } else if (!areAlertsEnabledGlobally) {
                        errorMessageText = 'Alert Disabled on Admin Dashboard';
                    } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                        errorMessageText = 'Alert Disabled for this project';
                    } else if (notificationSmsDisabled) {
                        errorMessageText = `${templateType} Investigation Note SMS Notification Disabled`;
                    } else {
                        errorMessageText = 'Error';
                    }

                    return await SubscriberAlertService.create({
                        projectId,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.SMS,
                        alertStatus: null,
                        error: true,
                        errorMessage: errorMessageText,
                        eventType,
                        totalSubscribers,
                        id,
                    });
                }
                const countryCode = await _this.mapCountryShortNameToCountryCode(
                    subscriber.countryCode
                );
                let contactPhone = subscriber.contactPhone;
                if (countryCode) {
                    contactPhone = countryCode + contactPhone;
                }

                if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                    owner = project.users.filter(
                        user => user.role === 'Owner'
                    )[0];
                    const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                        projectId,
                        contactPhone
                    );
                    if (!doesPhoneNumberComplyWithHighRiskConfig) {
                        const countryType = getCountryType(contactPhone);
                        let errorMessageText;
                        if (countryType === 'us') {
                            errorMessageText =
                                'SMS for numbers inside US not enabled for this project';
                        } else if (countryType === 'non-us') {
                            errorMessageText =
                                'SMS for numbers outside US not enabled for this project';
                        } else {
                            errorMessageText =
                                'SMS to High Risk country not enabled for this project';
                        }
                        return await SubscriberAlertService.create({
                            projectId: projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: null,
                            error: true,
                            errorMessage: errorMessageText,
                            eventType: eventType,
                            totalSubscribers,
                            id,
                        });
                    }

                    const status = await PaymentService.checkAndRechargeProjectBalance(
                        project,
                        owner.userId,
                        contactPhone,
                        AlertType.SMS
                    );

                    if (!status.success) {
                        return await SubscriberAlertService.create({
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: null,
                            error: true,
                            errorMessage: status.message,
                            eventType: eventType,
                            totalSubscribers,
                            id,
                        });
                    }
                }

                let sendResult;
                const smsTemplate = await SmsTemplateService.findOneBy({
                    query: { projectId, smsType: templateType },
                    select: 'body smsType allowedVariables projectId',
                });
                const subscriberAlert = await SubscriberAlertService.create({
                    projectId,
                    subscriberId: subscriber._id,
                    alertVia: AlertType.SMS,
                    alertStatus: 'Pending',
                    eventType,
                    totalSubscribers,
                    id,
                });
                const alertId = subscriberAlert._id;

                let alertStatus = null;
                try {
                    if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Created'
                    ) {
                        if (project.sendCreatedScheduledEventNotificationSms) {
                            sendResult = await TwilioService.sendScheduledMaintenanceCreatedToSubscriber(
                                date,
                                contactPhone,
                                smsTemplate,
                                schedule,
                                project.name,
                                projectId
                            );
                            alertStatus = 'Success';
                        } else {
                            alertStatus = 'Disabled';
                        }
                    } else if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Resolved'
                    ) {
                        if (project.sendScheduledEventResolvedNotificationSms) {
                            sendResult = await TwilioService.sendScheduledMaintenanceResolvedToSubscriber(
                                contactPhone,
                                smsTemplate,
                                schedule,
                                project.name,
                                projectId
                            );
                            alertStatus = 'Success';
                        } else {
                            alertStatus = 'Disabled';
                        }
                    } else if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Cancelled'
                    ) {
                        if (
                            project.sendScheduledEventCancelledNotificationSms
                        ) {
                            sendResult = await TwilioService.sendScheduledMaintenanceCancelledToSubscriber(
                                contactPhone,
                                smsTemplate,
                                schedule,
                                project.name,
                                projectId
                            );

                            alertStatus = 'Success';
                        } else {
                            alertStatus = 'Disabled';
                        }
                    }

                    if (
                        sendResult &&
                        sendResult.code &&
                        sendResult.code === 400
                    ) {
                        await SubscriberAlertService.updateBy(
                            { _id: alertId },
                            {
                                alertStatus: null,
                                error: true,
                                errorMessage: sendResult.message,
                            }
                        );
                    } else {
                        await SubscriberAlertService.updateBy(
                            { _id: alertId },
                            {
                                alertStatus,
                            }
                        );
                        if (
                            alertStatus === 'Success' &&
                            IS_SAAS_SERVICE &&
                            !hasCustomTwilioSettings
                        ) {
                            // charge sms per 160 chars
                            const segments = calcSmsSegments(sendResult.body);
                            const balanceStatus = await PaymentService.chargeAlertAndGetProjectBalance(
                                owner.userId,
                                project,
                                AlertType.SMS,
                                contactPhone,
                                segments
                            );

                            if (!balanceStatus.error) {
                                await AlertChargeService.create(
                                    projectId,
                                    balanceStatus.chargeAmount,
                                    balanceStatus.closingBalance,
                                    null,
                                    null,
                                    null,
                                    contactPhone,
                                    alertId
                                );
                            }
                        }
                    }
                } catch (error) {
                    await SubscriberAlertService.updateBy(
                        { _id: alertId },
                        {
                            alertStatus: null,
                            error: true,
                            errorMessage: error.message,
                        }
                    );
                    throw error;
                }
            }
        };

        let scheduledEventAlert = subscriber.notificationType?.scheduledEvent;
        const statusPageId = subscriber?.statusPageId;

        if (!subscriber.notificationType) {
            scheduledEventAlert = true;
        }

        if (!statusPageId) {
            sendAlerts();
        } else {
            if (scheduledEventAlert) {
                sendAlerts();
            }
        }
    },

    sendAnnouncementNotificationToSubscribers: async function(message) {
        const _this = this;
        const uuid = new Date().getTime();

        if (message) {
            const track = {};
            const sendAlerts = async ({
                project,
                subscriber,
                projectId,
                totalSubscribers,
                subscribers,
                unsubscribeUrl,
                monitorName,
            }) => {
                if (subscriber.alertVia === AlertType.Email) {
                    const [
                        hasGlobalSmtpSettings,
                        hasCustomSmtpSettings,
                        emailTemplate,
                    ] = await Promise.all([
                        GlobalConfigService.findOneBy({
                            query: { name: 'smtp' },
                            select: 'value',
                        }),
                        MailService.hasCustomSmtpSettings(projectId),
                        EmailTemplateService.findOneBy({
                            query: {
                                projectId,
                                emailType:
                                    'Subscriber Announcement Notification Created',
                            },
                            select:
                                'projectId subject body emailType allowedVariables',
                            populate: [
                                {
                                    path: 'projectId',
                                    select: 'nmae',
                                },
                            ],
                        }),
                    ]);

                    const NotificationEmailDisabled = !project.sendAnnouncementNotificationEmail;

                    const areEmailAlertsEnabledInGlobalSettings =
                        hasGlobalSmtpSettings &&
                        hasGlobalSmtpSettings.value &&
                        hasGlobalSmtpSettings.value['email-enabled']
                            ? true
                            : false;

                    let errorMessageText = null;

                    if (
                        (!areEmailAlertsEnabledInGlobalSettings &&
                            !hasCustomSmtpSettings) ||
                        NotificationEmailDisabled
                    ) {
                        if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                            errorMessageText =
                                'SMTP Settings not found on Admin Dashboard';
                        } else if (
                            hasGlobalSmtpSettings &&
                            !areEmailAlertsEnabledInGlobalSettings
                        ) {
                            errorMessageText =
                                'Alert Disabled on Admin Dashboard';
                        } else if (NotificationEmailDisabled) {
                            errorMessageText =
                                'Announcement Email Notification Disabled';
                        }
                        return await SubscriberAlertService.create({
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            eventType: 'Announcement notification created',
                            alertStatus: null,
                            error: true,
                            errorMessage: errorMessageText,
                            totalSubscribers,
                            uuid,
                        });
                    }

                    const subscriberAlert = await SubscriberAlertService.create(
                        {
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.Email,
                            alertStatus: 'Pending',
                            eventType: 'Announcement notification created',
                            totalSubscribers: subscribers.length,
                            uuid,
                        }
                    );
                    const alertId = subscriberAlert._id;

                    let alertStatus = null;
                    try {
                        const replyAddress = project.replyAddress
                            ? project.replyAddress
                            : null;

                        await MailService.sendAnnouncementToSubscriber(
                            message.name,
                            message.description,
                            subscriber.contactEmail,
                            emailTemplate,
                            replyAddress,
                            project.name,
                            projectId,
                            unsubscribeUrl,
                            monitorName
                        );
                        alertStatus = 'Sent';
                        await SubscriberAlertService.updateOneBy(
                            { _id: alertId },
                            { alertStatus }
                        );
                    } catch (error) {
                        await SubscriberAlertService.updateOneBy(
                            { _id: alertId },
                            { alertStatus: null }
                        );
                        throw error;
                    }
                } else if (subscriber.alertVia === AlertType.SMS) {
                    let owner;
                    const [
                        hasGlobalTwilioSettings,
                        hasCustomTwilioSettings,
                    ] = await Promise.all([
                        GlobalConfigService.findOneBy({
                            query: { name: 'twilio' },
                            select: 'value',
                        }),
                        TwilioService.hasCustomSettings(projectId),
                    ]);
                    const areAlertsEnabledGlobally =
                        hasGlobalTwilioSettings &&
                        hasGlobalTwilioSettings.value &&
                        hasGlobalTwilioSettings.value['sms-enabled']
                            ? true
                            : false;

                    const notificationSMSDisabled = !project.sendAnnouncementNotificationSms;

                    const eventType = 'Announcement notification created';
                    const templateType =
                        'Subscriber Announcement Notification Created';

                    if (
                        (!hasCustomTwilioSettings &&
                            ((IS_SAAS_SERVICE &&
                                (!project.alertEnable ||
                                    !areAlertsEnabledGlobally)) ||
                                (!IS_SAAS_SERVICE &&
                                    !areAlertsEnabledGlobally))) ||
                        notificationSMSDisabled
                    ) {
                        let errorMessageText;
                        if (!hasGlobalTwilioSettings) {
                            errorMessageText =
                                'Twilio Settings not found on Admin Dashboard';
                        } else if (!areAlertsEnabledGlobally) {
                            errorMessageText =
                                'Alert Disabled on Admin Dashboard';
                        } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                            errorMessageText =
                                'Alert Disabled for this project';
                        } else if (notificationSMSDisabled) {
                            errorMessageText = `${templateType} SMS Notification Disabled`;
                        } else {
                            errorMessageText = 'Error';
                        }

                        return await SubscriberAlertService.create({
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: null,
                            error: true,
                            errorMessage: errorMessageText,
                            eventType,
                            totalSubscribers,
                            uuid,
                        });
                    }
                    const countryCode = await _this.mapCountryShortNameToCountryCode(
                        subscriber.countryCode
                    );
                    let contactPhone = subscriber.contactPhone;
                    if (countryCode) {
                        contactPhone = countryCode + contactPhone;
                    }

                    if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                        owner = project.users.filter(
                            user => user.role === 'Owner'
                        )[0];
                        const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                            projectId,
                            contactPhone
                        );
                        if (!doesPhoneNumberComplyWithHighRiskConfig) {
                            const countryType = getCountryType(contactPhone);
                            let errorMessageText;
                            if (countryType === 'us') {
                                errorMessageText =
                                    'SMS for numbers inside US not enabled for this project';
                            } else if (countryType === 'non-us') {
                                errorMessageText =
                                    'SMS for numbers outside US not enabled for this project';
                            } else {
                                errorMessageText =
                                    'SMS to High Risk country not enabled for this project';
                            }

                            return await SubscriberAlertService.create({
                                projectId: projectId,
                                subscriberId: subscriber._id,
                                alertVia: AlertType.SMS,
                                alertStatus: null,
                                error: true,
                                errorMessage: errorMessageText,
                                eventType: eventType,
                                totalSubscribers,
                                uuid,
                            });
                        }

                        const status = await PaymentService.checkAndRechargeProjectBalance(
                            project,
                            owner.userId,
                            contactPhone,
                            AlertType.SMS
                        );

                        if (!status.success) {
                            return await SubscriberAlertService.create({
                                projectId,
                                subscriberId: subscriber._id,
                                alertVia: AlertType.SMS,
                                alertStatus: null,
                                error: true,
                                errorMessage: status.message,
                                eventType: eventType,
                                totalSubscribers,
                                uuid,
                            });
                        }
                    }

                    let sendResult;
                    const smsTemplate = await SmsTemplateService.findOneBy({
                        query: {
                            projectId,
                            smsType: templateType,
                        },
                        select: 'body allowedVariables projectId smsType',
                    });
                    const subscriberAlert = await SubscriberAlertService.create(
                        {
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: 'Pending',
                            eventType: eventType,
                            totalSubscribers,
                            uuid,
                        }
                    );
                    const alertId = subscriberAlert._id;

                    let alertStatus = null;
                    try {
                        if (project.sendAnnouncementNotificationSms) {
                            sendResult = await TwilioService.sendAnnouncementNotificationToSubscriber(
                                contactPhone,
                                smsTemplate,
                                message.name,
                                message.description,
                                project.name,
                                projectId
                            );
                            alertStatus = 'Success';
                        } else {
                            alertStatus = 'Disabled';
                        }

                        if (
                            sendResult &&
                            sendResult.code &&
                            sendResult.code === 400
                        ) {
                            await SubscriberAlertService.updateBy(
                                { _id: alertId },
                                {
                                    alertStatus: null,
                                    error: true,
                                    errorMessage: sendResult.message,
                                }
                            );
                        } else {
                            await SubscriberAlertService.updateBy(
                                { _id: alertId },
                                {
                                    alertStatus,
                                }
                            );
                            if (
                                alertStatus === 'Success' &&
                                IS_SAAS_SERVICE &&
                                !hasCustomTwilioSettings
                            ) {
                                // charge sms per 160 chars
                                const segments = calcSmsSegments(
                                    sendResult.body
                                );
                                const balanceStatus = await PaymentService.chargeAlertAndGetProjectBalance(
                                    owner.userId,
                                    project,
                                    AlertType.SMS,
                                    contactPhone,
                                    segments
                                );

                                if (!balanceStatus.error) {
                                    await AlertChargeService.create(
                                        projectId,
                                        balanceStatus.chargeAmount,
                                        balanceStatus.closingBalance,
                                        null,
                                        null,
                                        null,
                                        contactPhone,
                                        alertId
                                    );
                                }
                            }
                        }
                    } catch (error) {
                        await SubscriberAlertService.updateBy(
                            { _id: alertId },
                            {
                                alertStatus: null,
                                error: true,
                                errorMessage: error.message,
                            }
                        );
                        throw error;
                    }
                }
            };
            for (const monitor of message.monitors) {
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitor.monitorId,
                        subscribed: true,
                    }
                );
                const totalSubscribers = subscribers.length;

                for (const subscriber of subscribers) {
                    const projectId = message.projectId;
                    const monitorName = subscriber.monitorName;

                    const project = await ProjectService.findOneBy({
                        query: { _id: projectId },
                        select:
                            'sendAnnouncementNotificationEmail replyAddress name sendAnnouncementNotificationSms alertEnable users _id alertEnable alertOptions slug',
                    });

                    const unsubscribeUrl = `${global.homeHost}/unsubscribe/${subscriber.monitorId}/${subscriber._id}`;

                    let announcementAlert =
                        subscriber.notificationType?.announcement;
                    const statusPageId = subscriber?.statusPageId;

                    // if there is no notification type, then set incidentAlert to true.
                    if (!subscriber.notificationType) {
                        announcementAlert = true;
                    }

                    if (!statusPageId) {
                        await sendAlerts({
                            project,
                            subscriber,
                            projectId,
                            totalSubscribers,
                            subscribers,
                            unsubscribeUrl,
                            monitorName,
                        });
                    } else {
                        if (announcementAlert) {
                            if (subscriber.alertVia === AlertType.Email) {
                                if (!track[subscriber.contactEmail]) {
                                    track[subscriber.contactEmail] =
                                        subscriber.contactEmail;
                                    await sendAlerts({
                                        project,
                                        subscriber,
                                        projectId,
                                        totalSubscribers,
                                        subscribers,
                                        unsubscribeUrl,
                                        monitorName,
                                    });
                                }
                            } else {
                                await sendAlerts({
                                    project,
                                    subscriber,
                                    projectId,
                                    totalSubscribers,
                                    subscribers,
                                    unsubscribeUrl,
                                    monitorName,
                                });
                            }
                        }
                    }
                }
            }
        }
    },
};

/**
 * @description calculates the number of segments an sms is divided into
 * @param {string} sms the body of the sms sent
 * @returns an interger
 */
function calcSmsSegments(sms) {
    let smsLength = sms.length;
    smsLength = Number(smsLength);
    return Math.ceil(smsLength / 160);
}

const AlertModel = require('../models/alert');
const ProjectService = require('./projectService');
const PaymentService = require('./paymentService');
const AlertType = require('../config/alertType');
const ScheduleService = require('./scheduleService');
const SubscriberService = require('./subscriberService');
const SubscriberAlertService = require('./subscriberAlertService');
const EmailTemplateService = require('./emailTemplateService');
const SmsTemplateService = require('./smsTemplateService');
const EscalationService = require('./escalationService');
const MailService = require('./mailService');
const UserService = require('./userService');
const MonitorService = require('./monitorService');
const TwilioService = require('./twilioService');
const ErrorService = require('common-server/utils/error');
const StatusPageService = require('./statusPageService');
const AlertChargeService = require('./alertChargeService');
const countryCode = require('../config/countryCode');
const { getCountryType } = require('../config/alertType');
const SmsCountService = require('./smsCountService');
const DateTime = require('../utils/DateTime');
const moment = require('moment-timezone');
const TimeZoneNames = moment.tz.names();
const OnCallScheduleStatusService = require('./onCallScheduleStatusService');
const { IS_SAAS_SERVICE } = require('../config/server');
const ComponentService = require('./componentService');
const GlobalConfigService = require('./globalConfigService');
const WebHookService = require('../services/webHookService');
const IncidentUtility = require('../utils/incident');
const TeamService = require('./teamService');
const secondsToHms = require('../utils/secondsToHms');
const { getPlanById, getPlanByExtraUserId } = require('../config/plans');
const {
    INCIDENT_RESOLVED,
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
} = require('../constants/incidentEvents');
const componentService = require('./componentService');
const webpush = require('web-push');
const {
    calculateHumanReadableDownTime,
    getIncidentLength,
} = require('../utils/incident');
//  const IncidentService = require('./incidentService'); Declared but unused
const IncidentMessageService = require('./incidentMessageService');
const IncidentTimelineService = require('./incidentTimelineService');
const Services = require('../utils/services');
const RealTimeService = require('./realTimeService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

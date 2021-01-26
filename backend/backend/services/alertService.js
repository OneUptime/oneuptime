/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    /**
     * gets the schedules to use for alerts
     * @param {Object} incident the current incident
     * @returns {Object[]} list of schedules
     */
    getSchedulesForAlerts: async function(incident) {
        try {
            const monitorId = incident.monitorId._id || incident.monitorId;
            const projectId = incident.projectId._id || incident.projectId;

            const {
                lastMatchedCriterion: matchedCriterion,
            } = await MonitorService.findOneBy({
                _id: monitorId,
            });
            let schedules = [];

            // first, try to find schedules associated with the matched criterion of the monitor
            if (
                matchedCriterion.scheduleIds &&
                matchedCriterion.scheduleIds.length
            ) {
                schedules = await ScheduleService.findBy({
                    _id: { $in: matchedCriterion.scheduleIds },
                });
            } else {
                // then, try to find schedules in the monitor
                schedules = await ScheduleService.findBy({
                    monitorIds: monitorId,
                });
                // lastly, find default schedules for the project
                if (schedules.length === 0) {
                    schedules = await ScheduleService.findBy({
                        isDefault: true,
                        projectId,
                    });
                }
            }
            return schedules;
        } catch (error) {
            ErrorService.log('AlertService.getSchedulesForAlerts', error);
            return [];
        }
    },

    doesPhoneNumberComplyWithHighRiskConfig: async function(
        projectId,
        alertPhoneNumber
    ) {
        const project = await ProjectService.findOneBy({ _id: projectId });
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
    findBy: async function({ query, skip, limit, sort }) {
        try {
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
            const alerts = await AlertModel.find(query)
                .sort(sort)
                .limit(limit)
                .skip(skip)
                .populate('userId', 'name')
                .populate('monitorId', 'name')
                .populate('projectId', 'name');
            return alerts;
        } catch (error) {
            ErrorService.log('alertService.findBy`  ', error);
            throw error;
        }
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
    }) {
        try {
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

            if (error) {
                alert.error = error;
                alert.errorMessage = errorMessage;
            }

            const savedAlert = await alert.save();

            return savedAlert;
        } catch (error) {
            ErrorService.log('alertService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await AlertModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('alertService.countBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
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
        } catch (error) {
            ErrorService.log('AlertService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await AlertModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('alertService.updateMany', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
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
        } catch (error) {
            ErrorService.log('alertService.deleteBy', error);
            throw error;
        }
    },

    sendCreatedIncident: async function(incident) {
        try {
            if (incident) {
                const _this = this;

                const schedules = await this.getSchedulesForAlerts(incident);

                for (const schedule of schedules) {
                    _this.sendAlertsToTeamMembersInSchedule({
                        schedule,
                        incident,
                    });
                }
            }
        } catch (error) {
            ErrorService.log('alertService.sendCreatedIncident', error);
            throw error;
        }
    },

    sendAlertsToTeamMembersInSchedule: async function({ schedule, incident }) {
        const _this = this;
        const monitorId = incident.monitorId._id
            ? incident.monitorId._id
            : incident.monitorId;
        const projectId = incident.projectId._id
            ? incident.projectId._id
            : incident.projectId;
        const monitor = await MonitorService.findOneBy({ _id: monitorId });

        if (!schedule || !incident) {
            return;
        }

        //scheudle has no escalations. Skip.
        if (!schedule.escalationIds || schedule.escalationIds.length === 0) {
            return;
        }

        const callScheduleStatuses = await OnCallScheduleStatusService.findBy({
            query: { incident: incident._id, schedule: schedule },
        });
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

        let shouldSendSMSReminder = false;
        let shouldSendCallReminder = false;
        let shouldSendEmailReminder = false;

        //No escalation found in the database skip.
        const escalation = await EscalationService.findOneBy({
            _id: escalationId,
        });

        if (!escalation) {
            return;
        }

        shouldSendSMSReminder =
            escalation.smsReminders > currentEscalationStatus.smsRemindersSent;
        shouldSendCallReminder =
            escalation.callReminders >
            currentEscalationStatus.callRemindersSent;
        shouldSendEmailReminder =
            escalation.emailReminders >
            currentEscalationStatus.emailRemindersSent;

        if (
            !shouldSendSMSReminder &&
            !shouldSendEmailReminder &&
            !shouldSendCallReminder
        ) {
            _this.escalate({ schedule, incident });
        } else {
            _this.sendAlertsToTeamMembersInEscalationPolicy({
                escalation,
                monitor,
                incident,
                schedule,
                onCallScheduleStatus,
            });
        }
    },

    escalate: async function({ schedule, incident }) {
        const _this = this;
        const callScheduleStatuses = await OnCallScheduleStatusService.findBy({
            query: { incident: incident._id, schedule: schedule._id },
        });
        const monitorId = incident.monitorId._id
            ? incident.monitorId._id
            : incident.monitorId;
        const monitor = await MonitorService.findOneBy({ _id: monitorId });

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

            if (activeEscalation._id.toString() === escalationId.toString()) {
                found = true;
            }
        }

        if (
            !nextEscalationPolicy ||
            nextEscalationPolicy._id.toString() !==
                activeEscalation._id.toString()
        ) {
            callScheduleStatus.alertedEveryone = true;
            await callScheduleStatus.save();
            return; //can't escalate anymore.
        }

        callScheduleStatus.escalations.push({
            escalation: nextEscalationPolicy,
            callRemindersSent: 0,
            emailRemindersSent: 0,
            smsRemindersSent: 0,
        });
        callScheduleStatus.activeEscalation = nextEscalationPolicy;

        await callScheduleStatus.save();

        _this.sendAlertsToTeamMembersInEscalationPolicy({
            escalation: nextEscalationPolicy,
            monitor,
            incident,
            schedule,
            onCallScheduleStatus: callScheduleStatus,
        });
    },

    sendAlertsToTeamMembersInEscalationPolicy: async function({
        escalation,
        incident,
        monitor,
        schedule,
        onCallScheduleStatus,
    }) {
        const _this = this;
        const monitorId = monitor._id;

        const projectId = incident.projectId._id
            ? incident.projectId._id
            : incident.projectId;
        const project = await ProjectService.findOneBy({ _id: projectId });

        escalation = await EscalationService.findOneBy({ _id: escalation._id });

        const activeTeam = escalation.activeTeam;
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

        if (shouldSendCallReminder) {
            currentEscalationStatus.callRemindersSent++;
        }

        if (shouldSendEmailReminder) {
            currentEscalationStatus.emailRemindersSent++;
        }

        if (shouldSendSMSReminder) {
            currentEscalationStatus.smsRemindersSent++;
        }

        if (!activeTeam.teamMembers || activeTeam.teamMembers.length === 0) {
            return;
        }

        onCallScheduleStatus.escalations[
            onCallScheduleStatus.escalations.length - 1
        ] = currentEscalationStatus;
        await onCallScheduleStatus.save();

        for (const teamMember of activeTeam.teamMembers) {
            const isOnDuty = await _this.checkIsOnDuty(
                teamMember.startTime,
                teamMember.endTime
            );

            const user = await UserService.findOneBy({
                _id: teamMember.userId,
            });

            if (!user) {
                continue;
            }

            if (!isOnDuty) {
                if (escalation.call && shouldSendCallReminder) {
                    await _this.create({
                        projectId: incident.projectId,
                        monitorId,
                        alertVia: AlertType.Call,
                        userId: user._id,
                        incidentId: incident._id,
                        schedule: schedule,
                        escalation: escalation,
                        onCallScheduleStatus: onCallScheduleStatus,
                        alertStatus: 'Not on Duty',
                        eventType: 'identified',
                    });
                }
                if (escalation.email && shouldSendEmailReminder) {
                    await _this.create({
                        projectId: incident.projectId,
                        monitorId,
                        alertVia: AlertType.Email,
                        userId: user._id,
                        incidentId: incident._id,
                        schedule: schedule,
                        escalation: escalation,
                        onCallScheduleStatus: onCallScheduleStatus,
                        alertStatus: 'Not on Duty',
                        eventType: 'identified',
                    });
                }
                if (escalation.sms && shouldSendSMSReminder) {
                    await _this.create({
                        projectId: incident.projectId,
                        monitorId,
                        alertVia: AlertType.SMS,
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
                    });
                }
            }
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
    }) {
        const _this = this;

        let date = new Date();
        const monitorId = monitor._id;
        const accessToken = UserService.getAccessToken({
            userId: user._id,
            expiresIn: 12 * 60 * 60 * 1000,
        });

        const queryString = `projectId=${incident.projectId}&userId=${user._id}&accessToken=${accessToken}`;
        const ack_url = `${global.apiHost}/incident/${incident.projectId}/acknowledge/${incident._id}?${queryString}`;
        const resolve_url = `${global.apiHost}/incident/${incident.projectId}/resolve/${incident._id}?${queryString}`;
        const view_url = `${global.dashboardHost}/project/${incident.projectId}/${monitor.componentId._id}/incidents/${incident._id}?${queryString}`;
        const firstName = user.name;
        const projectId = incident.projectId;

        if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
            date = moment(incident.createdAt)
                .tz(user.timezone)
                .format('LLLL');
        }

        try {
            const hasGlobalSmtpSettings = await GlobalConfigService.findOneBy({
                name: 'smtp',
            });
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            const hasCustomSmtpSettings = await MailService.hasCustomSmtpSettings(
                projectId
            );
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
                    projectId: incident.projectId,
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
                });
            }
            const incidentcreatedBy =
                incident.createdById && incident.createdById.name
                    ? incident.createdById.name
                    : 'fyipe';
            await MailService.sendIncidentCreatedMail({
                incidentTime: date,
                monitorName: monitor.name,
                monitorUrl:
                    monitor && monitor.data && monitor.data.url
                        ? monitor.data.url
                        : null,
                incidentId: `#${incident.idNumber}`,
                reason: incident.reason
                    ? incident.reason
                    : `This incident was created by ${incidentcreatedBy}`,
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
                projectId: incident.projectId,
                acknowledgeUrl: ack_url,
                resolveUrl: resolve_url,
                accessToken,
                incidentType: incident.incidentType,
                projectName: project.name,
            });
            return await _this.create({
                projectId: incident.projectId,
                monitorId,
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
                projectId: incident.projectId,
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
            });
        }
    },

    sendSlaEmailToTeamMembers: async function(
        { projectId, monitor, incidentCommunicationSla, incident, alertTime },
        breached = false
    ) {
        try {
            const teamMembers = await TeamService.getTeamMembersBy({
                _id: projectId,
            });

            if (teamMembers && teamMembers.length > 0) {
                const hasGlobalSmtpSettings = await GlobalConfigService.findOneBy(
                    {
                        name: 'smtp',
                    }
                );
                const areEmailAlertsEnabledInGlobalSettings =
                    hasGlobalSmtpSettings &&
                    hasGlobalSmtpSettings.value &&
                    hasGlobalSmtpSettings.value['email-enabled']
                        ? true
                        : false;
                const hasCustomSmtpSettings = await MailService.hasCustomSmtpSettings(
                    projectId
                );

                if (
                    !areEmailAlertsEnabledInGlobalSettings &&
                    !hasCustomSmtpSettings
                ) {
                    return;
                }

                const incidentSla = incidentCommunicationSla.name;
                const projectName = monitor.projectId.name;
                const monitorName = monitor.name;
                const incidentId = `#${incident.idNumber}`;
                const reason = incident.reason;
                const componentId = incident.monitorId.componentId._id;
                const componentName = incident.monitorId.componentId.name;
                const incidentUrl = `${global.dashboardHost}/project/${projectId}/${componentId}/incidents/${incident._id}`;
                let incidentSlaTimeline =
                    incidentCommunicationSla.duration * 60;
                incidentSlaTimeline = secondsToHms(incidentSlaTimeline);
                const incidentSlaRemaining = secondsToHms(alertTime);

                if (breached) {
                    for (const member of teamMembers) {
                        await MailService.sendSlaBreachNotification({
                            userEmail: member.email,
                            name: member.name,
                            projectId,
                            incidentSla,
                            monitorName,
                            incidentUrl,
                            projectName,
                            componentName,
                            incidentId,
                            reason,
                            incidentSlaTimeline,
                        });
                    }
                } else {
                    for (const member of teamMembers) {
                        await MailService.sendSlaNotification({
                            userEmail: member.email,
                            name: member.name,
                            projectId,
                            incidentSla,
                            monitorName,
                            incidentUrl,
                            projectName,
                            componentName,
                            incidentId,
                            reason,
                            incidentSlaTimeline,
                            incidentSlaRemaining,
                        });
                    }
                }
            }
        } catch (error) {
            ErrorService.log('AlertService.updateOneBy', error);
            throw error;
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
    }) {
        const _this = this;
        let alert;
        const date = new Date();
        const monitorId = monitor._id;
        const accessToken = UserService.getAccessToken({
            userId: user._id,
            expiresIn: 12 * 60 * 60 * 1000,
        });
        if (!user.alertPhoneNumber) {
            return await _this.create({
                projectId: incident.projectId,
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
            });
        }

        const hasGlobalTwilioSettings = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        const areAlertsEnabledGlobally =
            hasGlobalTwilioSettings &&
            hasGlobalTwilioSettings.value &&
            hasGlobalTwilioSettings.value['call-enabled']
                ? true
                : false;
        const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
            incident.projectId
        );

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
                projectId: incident.projectId,
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
            });
        }

        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
            const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                incident.projectId,
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
                    projectId: incident.projectId,
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
                    projectId: incident.projectId,
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
                });
            }
        }
        const alertStatus = await TwilioService.sendIncidentCreatedCall(
            date,
            monitor.name,
            user.alertPhoneNumber,
            accessToken,
            incident._id,
            incident.projectId,
            incident.incidentType
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
                        incident.projectId,
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
            });
        }

        const hasGlobalTwilioSettings = await GlobalConfigService.findOneBy({
            name: 'twilio',
        });
        const areAlertsEnabledGlobally =
            hasGlobalTwilioSettings &&
            hasGlobalTwilioSettings.value &&
            hasGlobalTwilioSettings.value['sms-enabled']
                ? true
                : false;
        const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
            projectId
        );

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
                projectId: incident.projectId,
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
            });
        }

        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
            const doesPhoneNumberComplyWithHighRiskConfig = await _this.doesPhoneNumberComplyWithHighRiskConfig(
                incident.projectId,
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
                    projectId: incident.projectId,
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
                    projectId: incident.projectId,
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
            projectId
        );

        if (sendResult && sendResult.code && sendResult.code === 400) {
            await _this.create({
                projectId: incident.projectId,
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
            });
        } else if (sendResult) {
            const alertStatus = 'Success';
            alert = await _this.create({
                projectId: incident.projectId,
                schedule: schedule._id,
                escalation: escalation._id,
                onCallScheduleStatus: onCallScheduleStatus._id,
                monitorId,
                alertVia: AlertType.SMS,
                userId: user._id,
                incidentId: incident._id,
                eventType,
                alertStatus,
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
                        incident.projectId,
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
        try {
            const monitor = await MonitorService.findOneBy({
                _id: incident.monitorId,
            });
            const component = await componentService.findOneBy({
                _id: monitor.componentId,
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
                    'AlertService.sendInvestigationNoteToProjectWebhooks',
                    error
                );
            });
        } catch (error) {
            ErrorService.log(
                'AlertService.sendStatusPageNoteNotificationToProjectWebhooks',
                error
            );
            throw error;
        }
    },

    sendInvestigationNoteToSubscribers: async function(
        incident,
        data,
        statusNoteStatus
    ) {
        try {
            const _this = this;
            const uuid = new Date().getTime();
            const monitor = await MonitorService.findOneBy({
                _id: incident.monitorId._id,
            });
            // eslint-disable-next-line no-unused-vars
            const component = await ComponentService.findOneBy({
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            });
            if (incident) {
                const monitorId = incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitorId,
                    }
                );
                for (const subscriber of subscribers) {
                    await _this.sendSubscriberAlert(
                        subscriber,
                        incident,
                        'Investigation note is created',
                        null,
                        {
                            note: data.content,
                            incidentState: data.incident_state,
                            statusNoteStatus,
                        },
                        subscribers.length,
                        uuid
                    );
                }
            }
        } catch (error) {
            ErrorService.log('alertService.sendStatusPageToSubscribers', error);
            throw error;
        }
    },

    sendCreatedIncidentToSubscribers: async function(incident, component) {
        try {
            const _this = this;
            const uuid = new Date().getTime();
            if (incident) {
                const monitorId = incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitorId,
                    }
                );

                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage = await StatusPageService.findOneBy(
                            {
                                _id: subscriber.statusPageId,
                                isSubscriberEnabled: true,
                            }
                        );
                        if (enabledStatusPage) {
                            await _this.sendSubscriberAlert(
                                subscriber,
                                incident,
                                'Subscriber Incident Created',
                                enabledStatusPage,
                                null,
                                subscribers.length,
                                uuid
                            );
                        }
                    } else {
                        await _this.sendSubscriberAlert(
                            subscriber,
                            incident,
                            'Subscriber Incident Created',
                            null,
                            component,
                            subscribers.length,
                            uuid
                        );
                    }
                }
            }
        } catch (error) {
            ErrorService.log(
                'alertService.sendCreatedIncidentToSubscribers',
                error
            );
            throw error;
        }
    },

    sendAcknowledgedIncidentMail: async function(incident) {
        try {
            const _this = this;
            if (incident) {
                const monitorId = incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId;

                const projectId = incident.projectId._id
                    ? incident.projectId._id
                    : incident.projectId;

                const schedules = await this.getSchedulesForAlerts(incident);

                const monitor = await MonitorService.findOneBy({
                    _id: monitorId,
                });
                const project = await ProjectService.findOneBy({
                    _id: projectId,
                });
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
                    const escalation = await EscalationService.findOneBy({
                        _id: escalationId,
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
                            _id: teamMember.userId,
                        });

                        if (!user) {
                            continue;
                        }

                        if (!isOnDuty) {
                            if (escalation.email) {
                                await _this.create({
                                    projectId: incident.projectId,
                                    monitorId,
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
        } catch (error) {
            ErrorService.log(
                'alertService.sendAcknowledgedIncidentMail',
                error
            );
            throw error;
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

        let date = new Date();
        const accessToken = UserService.getAccessToken({
            userId: user._id,
            expiresIn: 12 * 60 * 60 * 1000,
        });

        const queryString = `projectId=${incident.projectId}&userId=${user._id}&accessToken=${accessToken}`;
        const resolve_url = `${global.apiHost}/incident/${incident.projectId}/resolve/${incident._id}?${queryString}`;
        const view_url = `${global.dashboardHost}/project/${incident.projectId}/${monitor.componentId._id}/incidents/${incident._id}?${queryString}`;
        const firstName = user.name;
        const projectId = incident.projectId;

        if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
            date = moment(date)
                .tz(user.timezone)
                .format();
        }

        try {
            const hasGlobalSmtpSettings = await GlobalConfigService.findOneBy({
                name: 'smtp',
            });
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            const hasCustomSmtpSettings = await MailService.hasCustomSmtpSettings(
                projectId
            );
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
                    projectId: incident.projectId,
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
                    : 'fyipe';
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
                reason: incident.reason
                    ? incident.reason
                    : `This incident was created by ${incidentcreatedBy}`,
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
                projectId: incident.projectId,
                resolveUrl: resolve_url,
                accessToken,
                incidentType: incident.incidentType,
                projectName: project.name,
                acknowledgeTime: incident.acknowledgedAt,
                length: downtimestring,
            });
            return await _this.create({
                projectId: incident.projectId,
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
                projectId: incident.projectId,
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

    sendResolveIncidentMail: async function(incident) {
        try {
            const _this = this;
            if (incident) {
                const monitorId = incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId;

                const projectId = incident.projectId._id
                    ? incident.projectId._id
                    : incident.projectId;

                const schedules = await this.getSchedulesForAlerts(incident);

                const monitor = await MonitorService.findOneBy({
                    _id: monitorId,
                });
                const project = await ProjectService.findOneBy({
                    _id: projectId,
                });
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
                    const escalation = await EscalationService.findOneBy({
                        _id: escalationId,
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
                            _id: teamMember.userId,
                        });

                        if (!user) {
                            continue;
                        }

                        if (!isOnDuty) {
                            if (escalation.email) {
                                await _this.create({
                                    projectId: incident.projectId,
                                    monitorId,
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
        } catch (error) {
            ErrorService.log('alertService.sendResolveIncidentMail', error);
            throw error;
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

        let date = new Date();
        const accessToken = UserService.getAccessToken({
            userId: user._id,
            expiresIn: 12 * 60 * 60 * 1000,
        });

        const queryString = `projectId=${incident.projectId}&userId=${user._id}&accessToken=${accessToken}`;
        const view_url = `${global.dashboardHost}/project/${incident.projectId}/${monitor.componentId._id}/incidents/${incident._id}?${queryString}`;
        const firstName = user.name;
        const projectId = incident.projectId;

        if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
            date = moment(date)
                .tz(user.timezone)
                .format();
        }

        try {
            const hasGlobalSmtpSettings = await GlobalConfigService.findOneBy({
                name: 'smtp',
            });
            const areEmailAlertsEnabledInGlobalSettings =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            const hasCustomSmtpSettings = await MailService.hasCustomSmtpSettings(
                projectId
            );
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
                    projectId: incident.projectId,
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
                    : 'fyipe';
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
                reason: incident.reason
                    ? incident.reason
                    : `This incident was created by ${incidentcreatedBy}`,
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
                projectId: incident.projectId,
                accessToken,
                incidentType: incident.incidentType,
                projectName: project.name,
                resolveTime: incident.resolvedAt,
                length: downtimestring,
            });
            return await _this.create({
                projectId: incident.projectId,
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
                projectId: incident.projectId,
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

    sendAcknowledgedIncidentToSubscribers: async function(incident) {
        try {
            const _this = this;
            const uuid = new Date().getTime();
            if (incident) {
                const monitorId = incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitorId,
                    }
                );
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage = await StatusPageService.findOneBy(
                            {
                                _id: subscriber.statusPageId,
                                isSubscriberEnabled: true,
                            }
                        );
                        if (enabledStatusPage) {
                            await _this.sendSubscriberAlert(
                                subscriber,
                                incident,
                                'Subscriber Incident Acknowldeged',
                                enabledStatusPage,
                                {},
                                subscribers.length,
                                uuid
                            );
                        }
                    } else {
                        await _this.sendSubscriberAlert(
                            subscriber,
                            incident,
                            'Subscriber Incident Acknowldeged',
                            null,
                            {},
                            subscribers.length,
                            uuid
                        );
                    }
                }
            }
        } catch (error) {
            ErrorService.log(
                'alertService.sendAcknowledgedIncidentToSubscribers',
                error
            );
            throw error;
        }
    },

    sendResolvedIncidentToSubscribers: async function(incident) {
        try {
            const _this = this;
            const uuid = new Date().getTime();
            if (incident) {
                const monitorId = incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId;
                const subscribers = await SubscriberService.subscribersForAlert(
                    {
                        monitorId: monitorId,
                    }
                );
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage = await StatusPageService.findOneBy(
                            {
                                _id: subscriber.statusPageId,
                                isSubscriberEnabled: true,
                            }
                        );
                        if (enabledStatusPage) {
                            await _this.sendSubscriberAlert(
                                subscriber,
                                incident,
                                'Subscriber Incident Resolved',
                                enabledStatusPage,
                                {},
                                subscribers.length,
                                uuid
                            );
                        }
                    } else {
                        await _this.sendSubscriberAlert(
                            subscriber,
                            incident,
                            'Subscriber Incident Resolved',
                            null,
                            {},
                            subscribers.length,
                            uuid
                        );
                    }
                }
            }
        } catch (error) {
            ErrorService.log(
                'alertService.sendResolvedIncidentToSubscribers',
                error
            );
            throw error;
        }
    },

    sendSubscriberAlert: async function(
        subscriber,
        incident,
        templateType = 'Subscriber Incident Created',
        statusPage,
        { note, incidentState, statusNoteStatus } = {},
        totalSubscribers,
        id
    ) {
        try {
            const _this = this;
            const date = new Date();
            const isStatusPageNoteAlert =
                note && incidentState && statusNoteStatus;
            const statusPageNoteAlertEventType = `Investigation note ${statusNoteStatus}`;

            const project = await ProjectService.findOneBy({
                _id: incident.projectId,
            });
            // get thee monitor
            const monitor = await MonitorService.findOneBy({
                _id: incident.monitorId._id
                    ? incident.monitorId._id
                    : incident.monitorId,
            });
            // get the component
            const component = await ComponentService.findOneBy({
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            });
            const statusUrl = `${global.dashboardHost}/project/${incident.projectId}/${component._id}/incidents/${incident._id}`;

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

            const monitorCustomFields = {},
                incidentCustomFields = {};
            monitor.customFields.forEach(
                field =>
                    (monitorCustomFields[field.fieldName] = field.fieldValue)
            );
            incident.customFields.forEach(
                field =>
                    (incidentCustomFields[field.fieldName] = field.fieldValue)
            );
            const customFields = {
                monitor: { customFields: monitorCustomFields },
                incident: { customFields: incidentCustomFields },
            };

            let webhookNotificationSent = true;

            if (subscriber.alertVia === AlertType.Webhook) {
                const investigationNoteNotificationWebhookDisabled =
                    isStatusPageNoteAlert &&
                    !project.enableInvestigationNoteNotificationWebhook;

                let eventType;
                if (investigationNoteNotificationWebhookDisabled) {
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowldeged'
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
                        projectId: incident.projectId,
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
                        incident.projectId,
                        incident,
                        incident.monitorId,
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
                        templateType === 'Subscriber Incident Acknowldeged'
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
                        projectId: incident.projectId,
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
                const hasGlobalSmtpSettings = await GlobalConfigService.findOneBy(
                    {
                        name: 'smtp',
                    }
                );
                const areEmailAlertsEnabledInGlobalSettings =
                    hasGlobalSmtpSettings &&
                    hasGlobalSmtpSettings.value &&
                    hasGlobalSmtpSettings.value['email-enabled']
                        ? true
                        : false;
                const hasCustomSmtpSettings = await MailService.hasCustomSmtpSettings(
                    incident.projectId
                );

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
                        templateType === 'Subscriber Incident Acknowldeged'
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
                        projectId: incident.projectId,
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
                const emailTemplate = await EmailTemplateService.findOneBy({
                    projectId: incident.projectId,
                    emailType: templateType,
                });
                if (isStatusPageNoteAlert) {
                    eventType = statusPageNoteAlertEventType;
                } else if (
                    templateType === 'Subscriber Incident Acknowldeged'
                ) {
                    eventType = 'acknowledged';
                } else if (templateType === 'Subscriber Incident Resolved') {
                    eventType = 'resolved';
                } else {
                    eventType = 'identified';
                }
                const subscriberAlert = await SubscriberAlertService.create({
                    projectId: incident.projectId,
                    incidentId: incident._id,
                    subscriberId: subscriber._id,
                    alertVia: AlertType.Email,
                    alertStatus: 'Pending',
                    eventType: eventType,
                    totalSubscribers,
                    id,
                });
                const alertId = subscriberAlert._id;
                const trackEmailAsViewedUrl = `${global.apiHost}/subscriberAlert/${incident.projectId}/${alertId}/viewed`;

                let alertStatus = null;
                try {
                    if (templateType === 'Subscriber Incident Acknowldeged') {
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
                                    length
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
                                    length
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
                                    length
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
                                    length
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
                            statusUrl,
                            statusNoteStatus,
                            customFields
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
                                    customFields
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
                                    customFields
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
                try {
                    let owner;
                    const hasGlobalTwilioSettings = await GlobalConfigService.findOneBy(
                        {
                            name: 'twilio',
                        }
                    );
                    const areAlertsEnabledGlobally =
                        hasGlobalTwilioSettings &&
                        hasGlobalTwilioSettings.value &&
                        hasGlobalTwilioSettings.value['sms-enabled']
                            ? true
                            : false;

                    const hasCustomTwilioSettings = await TwilioService.hasCustomSettings(
                        incident.projectId
                    );

                    const investigationNoteNotificationSMSDisabled =
                        isStatusPageNoteAlert &&
                        !project.enableInvestigationNoteNotificationSMS;
                    if (
                        (!hasCustomTwilioSettings &&
                            ((IS_SAAS_SERVICE &&
                                (!project.alertEnable ||
                                    !areAlertsEnabledGlobally)) ||
                                (!IS_SAAS_SERVICE &&
                                    !areAlertsEnabledGlobally))) ||
                        investigationNoteNotificationSMSDisabled
                    ) {
                        let errorMessageText, eventType;
                        if (!hasGlobalTwilioSettings) {
                            errorMessageText =
                                'Twilio Settings not found on Admin Dashboard';
                        } else if (!areAlertsEnabledGlobally) {
                            errorMessageText =
                                'Alert Disabled on Admin Dashboard';
                        } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                            errorMessageText =
                                'Alert Disabled for this project';
                        } else if (investigationNoteNotificationSMSDisabled) {
                            errorMessageText =
                                'Investigation Note SMS Notification Disabled';
                        } else {
                            errorMessageText = 'Error';
                        }
                        if (isStatusPageNoteAlert) {
                            eventType = statusPageNoteAlertEventType;
                        } else if (
                            templateType === 'Subscriber Incident Acknowldeged'
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
                            projectId: incident.projectId,
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
                            incident.projectId,
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
                                templateType ===
                                'Subscriber Incident Acknowldeged'
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
                                projectId: incident.projectId,
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
                            templateType === 'Subscriber Incident Acknowldeged'
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
                                projectId: incident.projectId,
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
                        projectId: incident.projectId,
                        smsType: templateType,
                    });
                    let eventType;
                    if (isStatusPageNoteAlert) {
                        eventType = statusPageNoteAlertEventType;
                    } else if (
                        templateType === 'Subscriber Incident Acknowldeged'
                    ) {
                        eventType = 'acknowledged';
                    } else if (
                        templateType === 'Subscriber Incident Resolved'
                    ) {
                        eventType = 'resolved';
                    } else {
                        eventType = 'identified';
                    }
                    const subscriberAlert = await SubscriberAlertService.create(
                        {
                            projectId: incident.projectId,
                            incidentId: incident._id,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: 'Pending',
                            eventType: eventType,
                            totalSubscribers,
                            id,
                        }
                    );
                    const alertId = subscriberAlert._id;

                    let alertStatus = null;
                    try {
                        if (
                            templateType === 'Subscriber Incident Acknowldeged'
                        ) {
                            if (
                                project.sendAcknowledgedIncidentNotificationSms
                            ) {
                                if (statusPage) {
                                    sendResult = await TwilioService.sendIncidentAcknowldegedMessageToSubscriber(
                                        date,
                                        subscriber.monitorName,
                                        contactPhone,
                                        smsTemplate,
                                        incident,
                                        project.name,
                                        incident.projectId,
                                        component.name,
                                        statusPageUrl,
                                        customFields,
                                        length
                                    );
                                    alertStatus = 'Success';
                                } else {
                                    sendResult = await TwilioService.sendIncidentAcknowldegedMessageToSubscriber(
                                        date,
                                        subscriber.monitorName,
                                        contactPhone,
                                        smsTemplate,
                                        incident,
                                        project.name,
                                        incident.projectId,
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
                                        incident.projectId,
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
                                        incident.projectId,
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
                                incident.projectId,
                                component.name,
                                statusUrl,
                                customFields
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
                                        incident.projectId,
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
                                        incident.projectId,
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
                                        incident.projectId,
                                        balanceStatus.chargeAmount,
                                        balanceStatus.closingBalance,
                                        null,
                                        incident.monitorId._id
                                            ? incident.monitorId._id
                                            : incident.monitorId,
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
                } catch (error) {
                    ErrorService.log('alertService.sendSubscriberAlert', error);
                }
            }
        } catch (error) {
            ErrorService.log('alertService.sendSubscriberAlert', error);
            throw error;
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
        const subProjectAlerts = await Promise.all(
            subProjectIds.map(async id => {
                const alerts = await _this.findBy({
                    query: { projectId: id },
                    skip: 0,
                    limit: 10,
                });
                const count = await _this.countBy({ projectId: id });
                return { alerts, count, _id: id, skip: 0, limit: 10 };
            })
        );
        return subProjectAlerts;
    },

    hardDeleteBy: async function(query) {
        try {
            await AlertModel.deleteMany(query);
            return 'Alert(s) removed successfully';
        } catch (error) {
            ErrorService.log('alertService.hardDeleteBy', error);
            throw error;
        }
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let alert = await _this.findBy({ query });
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
        const alerts = await _this.countBy({
            projectId: projectId,
            alertVia: { $in: [AlertType.Call, AlertType.SMS] },
            error: { $in: [null, undefined, false] },
            createdAt: { $gte: yesterday },
        });
        const smsCounts = await SmsCountService.countBy({
            projectId: projectId,
            createdAt: { $gte: yesterday },
        });
        const project = await ProjectService.findOneBy({ _id: projectId });
        const twilioSettings = await TwilioService.getSettings();
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
        try {
            const { name: userName, email: userEmail } = user;
            const { stripePlanId, _id: projectId, name: projectName } = project;
            const projectUrl = `${global.dashboardHost}/project/${projectId}`;
            const projectPlan = getPlanById(stripePlanId);

            await MailService.sendUnpaidSubscriptionReminder({
                projectName,
                projectPlan,
                name: userName,
                userEmail,
                projectUrl,
            });
        } catch (error) {
            ErrorService.log('AlertService.sendUnpaidSubscriptionEmail', error);
            throw error;
        }
    },

    sendProjectDeleteEmailForUnpaidSubscription: async function(project, user) {
        try {
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
        } catch (error) {
            ErrorService.log('AlertService.sendUnpaidSubscriptionEmail', error);
            throw error;
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
const ErrorService = require('./errorService');
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
const {
    calculateHumanReadableDownTime,
    getIncidentLength,
} = require('../utils/incident');

import AlertModel from '../Models/alert';
import ObjectID from 'Common/Types/ObjectID';
import ProjectService from './ProjectService';
import PaymentService from './PaymentService';
import AlertType from '../config/alertType';
import ScheduleService from './ScheduleService';
import SubscriberService from './SubscriberService';
import SubscriberAlertService from './SubscriberAlertService';
import EmailTemplateService from './EmailTemplateService';
import SmsTemplateService from './SmsTemplateService';
import EscalationService from './EscalationService';
import MailService from '../../MailService/Services/MailService';
import UserService from './UserService';
import MonitorService from './MonitorService';
import TwilioService from './TwilioService';
import ErrorService from '../Utils/error';
import StatusPageService from './StatusPageService';
import AlertChargeService from './AlertChargeService';
import countryCode from '../config/countryCode';

import { getCountryType } from '../config/alertType';
import SmsCountService from './SmsCountService';
import DateTime from '../Utils/DateTime';
import moment from 'moment-timezone';
const TimeZoneNames: $TSFixMe = moment.tz.names();
import OnCallScheduleStatusService from './OnCallScheduleStatusService';

import { IS_SAAS_SERVICE } from '../config/server';
import ComponentService from './ComponentService';
import GlobalConfigService from './GlobalConfigService';
import WebHookService from './WebHookService';
import IncidentUtility from '../Utils/incident';
import TeamService from './TeamService';
import secondsToHms from '../Utils/secondsToHms';

import { getPlanById, getPlanByExtraUserId } from '../config/plans';
import {
    INCIDENT_RESOLVED,
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
} from '../constants/incidentEvents';
import componentService from './ComponentService';

import webpush from 'web-push';
import {
    calculateHumanReadableDownTime,
    getIncidentLength,
} from '../Utils/incident';
//  Import IncidentService from './incidentService' Declared but unused
import IncidentMessageService from './IncidentMessageService';
import IncidentTimelineService from './IncidentTimelineService';
import Services from '../Utils/services';
import RealTimeService from './realTimeService';

import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    /**
     * Gets the schedules to use for alerts
     * @param {Object} incident the current incident
     * @returns {Object[]} list of schedules
     */
    public async getSchedulesForAlerts(
        incident: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const monitorId: $TSFixMe = monitor._id;
        const projectId: $TSFixMe =
            incident.projectId._id || incident.projectId;

        const { lastMatchedCriterion: matchedCriterion } =
            await MonitorService.findOneBy({
                query: { _id: monitorId },
                select: 'lastMatchedCriterion',
            });
        let schedules: $TSFixMe = [];
        const populate: $TSFixMe = [
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

        const select: $TSFixMe =
            '_id name slug projectId createdById monitorsIds escalationIds createdAt isDefault userIds';

        // First, try to find schedules associated with the matched criterion of the monitor
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
            // Then, try to find schedules in the monitor
            schedules = await ScheduleService.findBy({
                query: { monitorIds: monitorId },
                select,
                populate,
            });
            // Lastly, find default schedules for the project
            if (schedules.length === 0) {
                schedules = await ScheduleService.findBy({
                    query: { isDefault: true, projectId },
                    select,
                    populate,
                });
            }
        }
        return schedules;
    }

    public async doesPhoneNumberComplyWithHighRiskConfig(
        projectId: ObjectID,
        alertPhoneNumber: $TSFixMe
    ): void {
        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'alertOptions',
        });
        const alertOptions: $TSFixMe = project.alertOptions;
        let countryType: $TSFixMe = getCountryType(alertPhoneNumber);
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
    }

    public async findBy({
        query,
        skip,
        limit,
        sort,
        populate,
        select,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 10;
        }

        if (!sort) {
            sort = { createdAt: -1 };
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const alertsQuery: $TSFixMe = AlertModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        alertsQuery.select(select);
        alertsQuery.populate(populate);
        const alerts: $TSFixMe = await alertsQuery;
        return alerts;
    }

    public async create({
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
    }: $TSFixMe): void {
        alertProgress =
            alertProgress && `${alertProgress.current}/${alertProgress.total}`;
        const alert: $TSFixMe = new AlertModel();

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

        const [savedAlert]: $TSFixMe = await Promise.all([
            alert.save(),
            this.sendRealTimeUpdate({
                incidentId,
                projectId,
            }),
        ]);
        return savedAlert;
    }

    public async sendRealTimeUpdate({ incidentId, projectId }: $TSFixMe): void {
        const populateIncidentMessage: $TSFixMe = [
            {
                path: 'incidentId',
                select: 'idNumber name slug',
            },
            {
                path: 'createdById',
                select: 'name',
            },
        ];

        const selectIncidentMessage: $TSFixMe =
            '_id updated postOnStatusPage createdAt content incidentId createdById type incident_state';

        const populateAlert: $TSFixMe = [
            { path: 'userId', select: 'name' },
            { path: 'monitorId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAlert: $TSFixMe =
            '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

        const populate: $TSFixMe = [
            { path: 'incidentId', select: 'name' },
            { path: 'projectId', select: 'name' },
            {
                path: 'subscriberId',
                select: 'name contactEmail contactPhone contactWebhook countryCode',
            },
        ];
        const select: $TSFixMe =
            'incidentId projectId subscriberId alertVia alertStatus eventType error errorMessage totalSubscribers identification';
        const selectOnCallScheduleStatus: $TSFixMe =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus: $TSFixMe = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const populateIncTimeline: $TSFixMe = [
            { path: 'createdById', select: 'name' },
            {
                path: 'probeId',
                select: 'probeName probeImage',
            },
            { path: 'incidentId', select: 'idNumber slug' },
        ];
        const selectIncTimeline: $TSFixMe =
            'incidentId createdById probeId createdByZapier createdAt status incident_state';
        const [incidentMsgs, timeline, alerts, subscriberAlerts]: $TSFixMe =
            await Promise.all([
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
                this.findBy({
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
        let incidentMessages: $TSFixMe = incidentMsgs;
        const [subAlerts, callStatus]: $TSFixMe = await Promise.all([
            Services.deduplicate(subscriberAlerts),
            OnCallScheduleStatusService.findBy({
                query: {
                    incident: incidentId,
                },
                select: selectOnCallScheduleStatus,
                populate: populateOnCallScheduleStatus,
            }),
        ]);
        const callScheduleStatus: $TSFixMe = await Services.checkCallSchedule(
            callStatus
        );
        const timelineAlerts: $TSFixMe = [
            ...timeline,
            ...alerts,
            ...incidentMessages,
        ].sort((a: $TSFixMe, b: $TSFixMe) => {
            return b.createdAt - a.createdAt;
        });
        incidentMessages = [
            ...timelineAlerts,
            ...subAlerts,
            ...callScheduleStatus,
        ];
        incidentMessages.sort((a: $TSFixMe, b: $TSFixMe) => {
            return typeof a.schedule !== 'object' && b.createdAt - a.createdAt;
        });
        let filteredMsg: $TSFixMe = incidentMessages.filter((a: $TSFixMe) => {
            return (
                a.status !== 'internal notes added' &&
                a.status !== 'internal notes updated'
            );
        });
        filteredMsg = await Services.rearrangeDuty(filteredMsg);
        const result: $TSFixMe = {
            data: filteredMsg,
            incidentId,
            projectId,
        };
        // Run in the background
        RealTimeService.sendIncidentTimeline(result);
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const count: $TSFixMe = await AlertModel.countDocuments(query);
        return count;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const updatedAlert: $TSFixMe = await AlertModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return updatedAlert;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        let updatedData: $TSFixMe = await AlertModel.updateMany(query, {
            $set: data,
        });
        const populateAlert: $TSFixMe = [
            { path: 'userId', select: 'name' },
            { path: 'monitorId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAlert: $TSFixMe =
            'projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress ';

        updatedData = await this.findBy({
            query,
            populate: populateAlert,
            select: selectAlert,
        });
        return updatedData;
    }

    public async deleteBy(query: Query, userId: ObjectID): void {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const alerts: $TSFixMe = await AlertModel.findOneAndUpdate(
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
    }

    public async sendCreatedIncident(
        incident: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        if (incident) {
            const scheduleList: $TSFixMe = await this.getSchedulesForAlerts(
                incident,
                monitor
            );

            if (scheduleList.length > 0) {
                for (const schedule of scheduleList) {
                    this.sendAlertsToTeamMembersInSchedule({
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
    }

    public async sendAlertsToTeamMembersInSchedule({
        schedule,
        incident,
        monitorId,
    }: $TSFixMe): void {
        const projectId: $TSFixMe = incident.projectId._id
            ? incident.projectId._id
            : incident.projectId;

        if (!schedule || !incident) {
            return;
        }

        //Scheudle has no escalations. Skip.
        if (!schedule.escalationIds || schedule.escalationIds.length === 0) {
            return;
        }

        const monitorPopulate: $TSFixMe = [
            { path: 'componentId', select: 'name' },
        ];
        const monitorSelect: string = '_id name data method componentId';
        const selectOnCallScheduleStatus: $TSFixMe =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus: $TSFixMe = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const [monitor, callScheduleStatuses]: $TSFixMe = await Promise.all([
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

        let onCallScheduleStatus: $TSFixMe = null;
        let escalationId: $TSFixMe = null;
        let currentEscalationStatus: $TSFixMe = null;
        if (callScheduleStatuses.length === 0) {
            //Start with first ecalation policy, and then escalationPolicy will take care of others in escalation policy.
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

            //Create new onCallScheduleStatus
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

        const selectEscalation: $TSFixMe =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        const populateEscalation: $TSFixMe = [
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
        const escalation: $TSFixMe = await EscalationService.findOneBy({
            query: { _id: escalationId },
            select: selectEscalation,
            populate: populateEscalation,
        });

        let shouldSendSMSReminder: $TSFixMe = false;
        let shouldSendCallReminder: $TSFixMe = false;
        let shouldSendEmailReminder: $TSFixMe = false;
        let shouldSendPushReminder: $TSFixMe = false;

        if (!escalation) {
            return;
        }

        const alertProgress: $TSFixMe = {
            emailProgress: null,
            smsProgress: null,
            callProgress: null,
            pushProgress: null,
        };
        const emailRem: $TSFixMe =
            currentEscalationStatus.emailRemindersSent + 1;
        const smsRem: $TSFixMe = currentEscalationStatus.smsRemindersSent + 1;
        const callRem: $TSFixMe = currentEscalationStatus.callRemindersSent + 1;
        const pushRem: $TSFixMe = currentEscalationStatus.pushRemindersSent + 1;

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
            this.escalate({ schedule, incident, alertProgress, monitor });
        } else {
            this.sendAlertsToTeamMembersInEscalationPolicy({
                escalation,
                monitor,
                incident,
                schedule,
                onCallScheduleStatus,
                alertProgress,
            });
        }
    }

    public async escalate({
        schedule,
        incident,
        alertProgress,
        monitor,
    }: $TSFixMe): void {
        const selectOnCallScheduleStatus: $TSFixMe =
            'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

        const populateOnCallScheduleStatus: $TSFixMe = [
            { path: 'incidentId', select: 'name slug' },
            { path: 'project', select: 'name slug' },
            { path: 'scheduleId', select: 'name slug' },
            { path: 'schedule', select: '_id name slug' },
            {
                path: 'activeEscalationId',
                select: 'projectId teams scheduleId',
            },
        ];
        const callScheduleStatuses: $TSFixMe =
            await OnCallScheduleStatusService.findBy({
                query: { incident: incident._id, schedule: schedule._id },
                select: selectOnCallScheduleStatus,
                populate: populateOnCallScheduleStatus,
            });

        if (callScheduleStatuses.length === 0) {
            return;
        }

        const callScheduleStatus: $TSFixMe = callScheduleStatuses[0];

        const activeEscalation: $TSFixMe = callScheduleStatus.activeEscalation;

        if (!schedule.escalationIds || schedule.escalationIds.length === 0) {
            return;
        }

        let nextEscalationPolicy: $TSFixMe = null;

        //Find next escalationPolicy.
        let found: $TSFixMe = false;
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
            const query: $TSFixMe = { _id: callScheduleStatus._id };
            const data: $TSFixMe = { alertedEveryone: true };
            await OnCallScheduleStatusService.updateOneBy({ query, data });
            return; //Can't escalate anymore.
        }

        callScheduleStatus.escalations.push({
            escalation: nextEscalationPolicy,
            callRemindersSent: 0,
            emailRemindersSent: 0,
            smsRemindersSent: 0,
        });
        callScheduleStatus.activeEscalation = nextEscalationPolicy;

        const query: $TSFixMe = { _id: callScheduleStatus._id };
        const data: $TSFixMe = {
            escalations: callScheduleStatus.escalations,
            activeEscalation: callScheduleStatus.activeEscalation,
        };
        await OnCallScheduleStatusService.updateOneBy({ query, data });

        this.sendAlertsToTeamMembersInEscalationPolicy({
            escalation: nextEscalationPolicy,
            monitor,
            incident,
            schedule,
            onCallScheduleStatus: callScheduleStatus,
            alertProgress,
        });
    }

    public async sendAlertsToTeamMembersInEscalationPolicy({
        escalation,
        incident,
        monitor,
        schedule,
        onCallScheduleStatus,
        alertProgress,
    }: $TSFixMe): void {
        const monitorId: $TSFixMe = monitor._id;

        const projectId: $TSFixMe = incident.projectId._id
            ? incident.projectId._id
            : incident.projectId;

        const selectEscalation: $TSFixMe =
            'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

        const populateEscalation: $TSFixMe = [
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

        const [project, ec]: $TSFixMe = await Promise.all([
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

        const activeTeam: $TSFixMe = escalation.activeTeam;
        const teamGroup: $TSFixMe = [];

        if (activeTeam && activeTeam.teamMembers) {
            activeTeam.teamMembers.forEach((team: $TSFixMe) => {
                if (team.groups) {
                    teamGroup.push(team.groups);
                }
            });
        }

        const groupUsers: $TSFixMe = teamGroup.map((group: $TSFixMe) => {
            return group.teams;
        });
        const groupUserIds: $TSFixMe = [].concat
            .apply([], groupUsers)
            .map((id: $TSFixMe) => {
                return { userId: id };
            });
        const filterdUserIds: $TSFixMe = groupUserIds.filter(
            (user: $TSFixMe) => {
                return activeTeam.teamMembers.some((team: $TSFixMe) => {
                    return team.userId !== user.userId;
                });
            }
        );

        const currentEscalationStatus: $TSFixMe =
            onCallScheduleStatus.escalations[
                onCallScheduleStatus.escalations.length - 1
            ];

        const shouldSendSMSReminder: $TSFixMe =
            escalation.smsReminders > currentEscalationStatus.smsRemindersSent;
        const shouldSendCallReminder: $TSFixMe =
            escalation.callReminders >
            currentEscalationStatus.callRemindersSent;
        const shouldSendEmailReminder: $TSFixMe =
            escalation.emailReminders >
            currentEscalationStatus.emailRemindersSent;
        const shouldSendPushReminder: $TSFixMe =
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

        const allUsers: $TSFixMe = [
            ...activeTeam.teamMembers,
            ...filterdUserIds,
        ];
        for (const teamMember of allUsers) {
            const isOnDuty: $TSFixMe = await this.checkIsOnDuty(
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

            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: teamMember.userId },
                select: '_id alertPhoneNumber name email timezone',
            });

            if (!user) {
                continue;
            }

            if (!isOnDuty) {
                if (escalation.call && shouldSendCallReminder) {
                    await this.create({
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
                    await this.create({
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
                    await this.create({
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
                    await this.create({
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
                 *  SendSMSAlert & sendCallAlert should not run in parallel
                 *  otherwise we will have a wrong project balance in the end.
                 *
                 */

                if (escalation.sms && shouldSendSMSReminder) {
                    await this.sendSMSAlert({
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
                    this.sendEmailAlert({
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
                    await this.sendCallAlert({
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
                    await this.sendPushAlert({
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
    }

    public async sendPushAlert({
        incident,
        user,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        pushProgress,
    }: $TSFixMe): void {
        let pushMessage: $TSFixMe;
        const userData: $TSFixMe = await UserService.findOneBy({
            query: { _id: user._id },
            select: 'identification',
        });

        const identification: $TSFixMe = userData.identification;

        const options: $TSFixMe = {
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
        const title: string = `${pushMessage}Incident #${incident.idNumber} is created`;
        const body: string = `Please acknowledge or resolve this incident on OneUptime Dashboard.`;
        const payload: $TSFixMe = JSON.stringify({ title, body });

        // Pass object into sendNotification
        if (identification.length > 0) {
            let promiseFuncs: $TSFixMe = [];
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
                    return await this.create({
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
                .catch(async (e: $TSFixMe) => {
                    return await this.create({
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
        }
        return await this.create({
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
            errorMessage: 'Push Notification not allowed in the user dashboard',
            alertProgress: pushProgress,
        });
    }

    public async sendEmailAlert({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        emailProgress,
    }: $TSFixMe): void {
        const probeName: $TSFixMe =
            incident.probes.length > 0 && incident.probes[0].probeId.probeName;
        let date: $TSFixMe = new Date();
        const monitorId: $TSFixMe = monitor._id;
        try {
            const accessToken: $TSFixMe = UserService.getAccessToken({
                userId: user._id,
                expiresIn: 12 * 60 * 60 * 1000,
            });

            const projectId: $TSFixMe =
                incident.projectId._id || incident.projectId;
            const queryString: string = `projectId=${projectId}&userId=${user._id}&accessToken=${accessToken}`;

            const ack_url: string = `${global.apiHost}/incident/${projectId}/acknowledge/${incident._id}?${queryString}`;

            const resolve_url: string = `${global.apiHost}/incident/${projectId}/resolve/${incident._id}?${queryString}`;

            const view_url: string = `${global.dashboardHost}/project/${project.slug}/incidents/${incident.slug}?${queryString}`;
            const firstName: $TSFixMe = user.name;

            if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
                date = moment(incident.createdAt)
                    .tz(user.timezone)
                    .format('LLLL');
            }

            const [hasGlobalSmtpSettings, hasCustomSmtpSettings]: $TSFixMe =
                await Promise.all([
                    GlobalConfigService.findOneBy({
                        query: { name: 'smtp' },
                        select: 'value',
                    }),
                    MailService.hasCustomSmtpSettings(projectId),
                ]);
            const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                let errorMessageText: $TSFixMe;
                if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                    errorMessageText =
                        'SMTP Settings not found on Admin Dashboard';
                } else if (
                    hasGlobalSmtpSettings &&
                    !areEmailAlertsEnabledInGlobalSettings
                ) {
                    errorMessageText = 'Alert Disabled on Admin Dashboard';
                }
                return await this.create({
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
            const incidentcreatedBy: $TSFixMe =
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
            return await this.create({
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
            return await this.create({
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
    }

    public async sendSlaEmailToTeamMembers(
        { projectId, incidentCommunicationSla, incident, alertTime }: $TSFixMe,
        breached = false
    ): void {
        const teamMembers: $TSFixMe = await TeamService.getTeamMembersBy({
            _id: projectId,
        });

        if (teamMembers && teamMembers.length > 0) {
            const [hasGlobalSmtpSettings, hasCustomSmtpSettings]: $TSFixMe =
                await Promise.all([
                    GlobalConfigService.findOneBy({
                        query: { name: 'smtp' },
                        select: 'value',
                    }),
                    MailService.hasCustomSmtpSettings(projectId),
                ]);
            const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
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

            const incidentSla: $TSFixMe = incidentCommunicationSla.name;
            const projectName: $TSFixMe = incident.projectId.name;
            const projectSlug: $TSFixMe = incident.projectId.slug;
            // Const monitorName: $TSFixMe = monitor.name;
            const incidentId: string = `#${incident.idNumber}`;
            const reason: $TSFixMe = incident.reason;
            /*
             * Const componentSlug: $TSFixMe = monitor.componentId.slug;
             * Const componentName: $TSFixMe = monitor.componentId.name;
             * Const incidentUrl:string: $TSFixMe = `${global.dashboardHost}/project/${monitor.projectId.slug}/component/${componentSlug}/incidents/${incident.slug}`;
             */

            const incidentUrl: string = `${global.dashboardHost}/project/${projectSlug}/incidents/${incident.slug}`;
            let incidentSlaTimeline: $TSFixMe =
                incidentCommunicationSla.duration * 60;

            incidentSlaTimeline = secondsToHms(incidentSlaTimeline);
            const incidentSlaRemaining: $TSFixMe = secondsToHms(alertTime);

            if (breached) {
                for (const member of teamMembers) {
                    await MailService.sendSlaBreachNotification({
                        userEmail: member.email,
                        name: member.name,
                        projectId,
                        incidentSla,
                        // MonitorName,
                        incidentUrl,
                        projectName,
                        // ComponentName,
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
                        // MonitorName,
                        incidentUrl,
                        projectName,
                        // ComponentName,
                        incidentId,
                        reason,
                        incidentSlaTimeline,
                        incidentSlaRemaining,
                    });
                }
            }
        }
    }

    public async sendCallAlert({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        callProgress,
    }: $TSFixMe): void {
        let alert: $TSFixMe;
        const date: $TSFixMe = new Date();
        const monitorId: $TSFixMe = monitor._id;
        const projectId: $TSFixMe =
            incident.projectId._id || incident.projectId;
        const accessToken: $TSFixMe = UserService.getAccessToken({
            userId: user._id,
            expiresIn: 12 * 60 * 60 * 1000,
        });
        if (!user.alertPhoneNumber) {
            return await this.create({
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

        const [hasGlobalTwilioSettings, hasCustomTwilioSettings]: $TSFixMe =
            await Promise.all([
                GlobalConfigService.findOneBy({
                    query: { name: 'twilio' },
                    select: 'value',
                }),
                TwilioService.hasCustomSettings(projectId),
            ]);
        const areAlertsEnabledGlobally: $TSFixMe =
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
            let errorMessageText: $TSFixMe;
            if (!hasGlobalTwilioSettings) {
                errorMessageText =
                    'Twilio Settings not found on Admin Dashboard';
            } else if (!areAlertsEnabledGlobally) {
                errorMessageText = 'Alert Disabled on Admin Dashboard';
            } else if (IS_SAAS_SERVICE && !project.alertEnable) {
                errorMessageText = 'Alert Disabled for this project';
            }
            return await this.create({
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
            const doesPhoneNumberComplyWithHighRiskConfig: $TSFixMe =
                await this.doesPhoneNumberComplyWithHighRiskConfig(
                    projectId,
                    user.alertPhoneNumber
                );
            if (!doesPhoneNumberComplyWithHighRiskConfig) {
                const countryType: $TSFixMe = getCountryType(
                    user.alertPhoneNumber
                );
                let errorMessageText: $TSFixMe;
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
                return await this.create({
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

            const status: $TSFixMe =
                await PaymentService.checkAndRechargeProjectBalance(
                    project,
                    user._id,
                    user.alertPhoneNumber,
                    AlertType.Call
                );

            if (!status.success) {
                return await this.create({
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
        const alertStatus: $TSFixMe =
            await TwilioService.sendIncidentCreatedCall(
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
            return await this.create({
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
            alert = await this.create({
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
                const balanceStatus: $TSFixMe =
                    await PaymentService.chargeAlertAndGetProjectBalance(
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
    }

    public async sendSMSAlert({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
        smsProgress,
    }: $TSFixMe): void {
        let alert: $TSFixMe;
        const projectId: $TSFixMe = project._id;
        const date: $TSFixMe = new Date();
        const monitorId: $TSFixMe = monitor._id;
        if (!user.alertPhoneNumber) {
            return await this.create({
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

        const [hasGlobalTwilioSettings, hasCustomTwilioSettings]: $TSFixMe =
            await Promise.all([
                GlobalConfigService.findOneBy({
                    query: { name: 'twilio' },
                    select: 'value',
                }),
                TwilioService.hasCustomSettings(projectId),
            ]);
        const areAlertsEnabledGlobally: $TSFixMe =
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
            let errorMessageText: $TSFixMe;
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
            return await this.create({
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
            const doesPhoneNumberComplyWithHighRiskConfig: $TSFixMe =
                await this.doesPhoneNumberComplyWithHighRiskConfig(
                    incident.projectId._id || incident.projectId,
                    user.alertPhoneNumber
                );
            if (!doesPhoneNumberComplyWithHighRiskConfig) {
                const countryType: $TSFixMe = getCountryType(
                    user.alertPhoneNumber
                );
                let errorMessageText: $TSFixMe;
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
                return await this.create({
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

            const status: $TSFixMe =
                await PaymentService.checkAndRechargeProjectBalance(
                    project,
                    user._id,
                    user.alertPhoneNumber,
                    AlertType.SMS
                );

            if (!status.success) {
                return await this.create({
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

        const sendResult: $TSFixMe =
            await TwilioService.sendIncidentCreatedMessage(
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
            await this.create({
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
            const alertStatus: string = 'Success';
            alert = await this.create({
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
                // Calculate charge per 160 chars
                const segments: $TSFixMe = calcSmsSegments(sendResult.body);
                const balanceStatus: $TSFixMe =
                    await PaymentService.chargeAlertAndGetProjectBalance(
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
    }

    public async sendStausPageNoteNotificationToProjectWebhooks(
        projectId: ObjectID,
        incident: $TSFixMe,
        statusPageNoteData: $TSFixMe
    ): void {
        const monitors: $TSFixMe = incident.monitors.map(
            (monitor: $TSFixMe) => {
                return monitor.monitorId;
            }
        );
        const populateComponent: $TSFixMe = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent: $TSFixMe =
            '_id createdAt name createdById projectId slug componentCategoryId';
        for (const monitor of monitors) {
            const component: $TSFixMe = await componentService.findOneBy({
                query: { _id: monitor.componentId },
                select: selectComponent,
                populate: populateComponent,
            });

            let incidentStatus: $TSFixMe;
            if (incident.resolved) {
                incidentStatus = INCIDENT_RESOLVED;
            } else if (incident.acknowledged) {
                incidentStatus = INCIDENT_ACKNOWLEDGED;
            } else {
                incidentStatus = INCIDENT_CREATED;
            }
            const downTimeString: $TSFixMe = calculateHumanReadableDownTime(
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
            ).catch((error: Error) => {
                ErrorService.log(
                    'ApplicationScannerService.sendStatusPageNoteNotificationToProjectWebhooks > WebHookService.sendIntegrationNotification',
                    error
                );
            });
        }
    }

    public async sendInvestigationNoteToSubscribers(
        incident: $TSFixMe,
        data: $TSFixMe,
        statusNoteStatus: $TSFixMe,
        projectId: ObjectID
    ): void {
        const uuid: $TSFixMe = new Date().getTime();
        const track: $TSFixMe = {};

        const monitors: $TSFixMe = incident.monitors.map(
            (monitor: $TSFixMe) => {
                return monitor.monitorId;
            }
        );
        const monitorIds: $TSFixMe = monitors.map((monitor: $TSFixMe) => {
            return monitor._id;
        });
        const subscribers: $TSFixMe =
            await SubscriberService.subscribersForAlert({
                subscribed: true,
                $or: [{ monitorId: { $in: monitorIds } }, { monitorId: null }],
                projectId,
            });

        const sendSubscriberAlert: Function = async ({
            subscriber,
            monitor,
            statusPageSlug,
            subscribers,
        }: $TSFixMe): void => {
            await this.sendSubscriberAlert(
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
                    let statusPageSlug: $TSFixMe = null;

                    if (subscriber.statusPageId) {
                        const statusPage: $TSFixMe =
                            await StatusPageService.findOneBy({
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
    }

    public async sendCreatedIncidentToSubscribers(
        incident: $TSFixMe,
        monitors: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();

        const populateStatusPage: $TSFixMe = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage: $TSFixMe =
            'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const track: $TSFixMe = {};
        const sendSubscriberAlert: Function = async ({
            subscriber,
            monitor,
            enabledStatusPage,
            subscribers,
        }: $TSFixMe): void => {
            await this.sendSubscriberAlert(
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
                const monitorId: $TSFixMe = monitor && monitor._id;
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitorId,
                        subscribed: true,
                    });
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage: $TSFixMe =
                            await StatusPageService.findOneBy({
                                query: {
                                    _id: subscriber.statusPageId,
                                    isSubscriberEnabled: true,
                                },
                                populate: populateStatusPage,
                                select: selectStatusPage,
                            });
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
    }

    public async sendAcknowledgedIncidentMail(
        incident: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        if (incident) {
            const projectId: $TSFixMe = incident.projectId._id
                ? incident.projectId._id
                : incident.projectId;

            const monitorPopulate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
            ];
            const monitorSelect: string = '_id name data method componentId';

            const selectOnCallScheduleStatus: $TSFixMe =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus: $TSFixMe = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];

            const [schedules, mon, project]: $TSFixMe = await Promise.all([
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

                //Scheudle has no escalations. Skip.
                if (
                    !schedule.escalationIds ||
                    schedule.escalationIds.length === 0
                ) {
                    continue;
                }

                const callScheduleStatuses: $TSFixMe =
                    await OnCallScheduleStatusService.findBy({
                        query: {
                            incident: incident._id,
                            schedule: schedule,
                        },
                        select: selectOnCallScheduleStatus,
                        populate: populateOnCallScheduleStatus,
                    });
                let onCallScheduleStatus: $TSFixMe = null;
                let escalationId: $TSFixMe = null;
                let currentEscalationStatus: $TSFixMe = null;

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

                    //Create new onCallScheduleStatus
                    onCallScheduleStatus =
                        await OnCallScheduleStatusService.create({
                            project: projectId,
                            incident: incident._id,
                            activeEscalation: escalationId,
                            schedule: schedule._id,
                            incidentAcknowledged: false,
                            escalations: [currentEscalationStatus],
                        });
                } else {
                    onCallScheduleStatus = callScheduleStatuses[0];
                    escalationId =
                        callScheduleStatuses[0].escalations[
                            callScheduleStatuses[0].escalations.length - 1
                        ].escalation._id;
                }
                const selectEscalation: $TSFixMe =
                    'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

                const populateEscalation: $TSFixMe = [
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
                const escalation: $TSFixMe = await EscalationService.findOneBy({
                    query: { _id: escalationId },
                    select: selectEscalation,
                    populate: populateEscalation,
                });

                if (!escalation) {
                    continue;
                }
                const activeTeam: $TSFixMe = escalation.activeTeam;
                if (
                    !activeTeam.teamMembers ||
                    activeTeam.teamMembers.length === 0
                ) {
                    continue;
                }
                for (const teamMember of activeTeam.teamMembers) {
                    const isOnDuty: $TSFixMe = await this.checkIsOnDuty(
                        teamMember.startTime,
                        teamMember.endTime
                    );
                    const user: $TSFixMe = await UserService.findOneBy({
                        query: { _id: teamMember.userId },
                        select: '_id timezone name email',
                    });

                    if (!user) {
                        continue;
                    }

                    if (!isOnDuty) {
                        if (escalation.email) {
                            await this.create({
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
                            await this.sendAcknowledgeEmailAlert({
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
    }

    public async sendAcknowledgeEmailAlert({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
    }: $TSFixMe): void {
        const projectId: $TSFixMe =
            incident.projectId._id || incident.projectId;
        try {
            let date: $TSFixMe = new Date();
            const accessToken: $TSFixMe = UserService.getAccessToken({
                userId: user._id,
                expiresIn: 12 * 60 * 60 * 1000,
            });

            const queryString: string = `projectId=${projectId}&userId=${user._id}&accessToken=${accessToken}`;

            const resolve_url: string = `${global.apiHost}/incident/${projectId}/resolve/${incident._id}?${queryString}`;

            const view_url: string = `${global.dashboardHost}/project/${project.slug}/incidents/${incident.slug}?${queryString}`;
            const firstName: $TSFixMe = user.name;

            if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
                date = moment(date).tz(user.timezone).format();
            }

            const [hasGlobalSmtpSettings, hasCustomSmtpSettings]: $TSFixMe =
                await Promise.all([
                    GlobalConfigService.findOneBy({
                        query: { name: 'smtp' },
                        select: 'value',
                    }),
                    MailService.hasCustomSmtpSettings(projectId),
                ]);
            const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                let errorMessageText: $TSFixMe;
                if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                    errorMessageText =
                        'SMTP Settings not found on Admin Dashboard';
                } else if (
                    hasGlobalSmtpSettings &&
                    !areEmailAlertsEnabledInGlobalSettings
                ) {
                    errorMessageText = 'Alert Disabled on Admin Dashboard';
                }
                return await this.create({
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
            const incidentcreatedBy: $TSFixMe =
                incident.createdById && incident.createdById.name
                    ? incident.createdById.name
                    : 'oneuptime';
            const downtime: $TSFixMe = moment(incident.acknowledgedAt).diff(
                moment(incident.createdAt),
                'minutes'
            );
            let downtimestring: string = `${Math.ceil(downtime)} minutes`;
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
            return await this.create({
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
            return await this.create({
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
    }

    public async sendResolveIncidentMail(
        incident: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        if (incident) {
            const projectId: $TSFixMe = incident.projectId._id
                ? incident.projectId._id
                : incident.projectId;

            const monitorPopulate: $TSFixMe = [
                { path: 'componentId', select: 'name' },
            ];
            const monitorSelect: string = '_id name data method componentId';
            const selectOnCallScheduleStatus: $TSFixMe =
                'escalations createdAt project schedule activeEscalation activeEscalation incident incidentAcknowledged alertedEveryone isOnDuty deleted deletedAt deletedById';

            const populateOnCallScheduleStatus: $TSFixMe = [
                { path: 'incidentId', select: 'name slug' },
                { path: 'project', select: 'name slug' },
                { path: 'scheduleId', select: 'name slug' },
                { path: 'schedule', select: '_id name slug' },
                {
                    path: 'activeEscalationId',
                    select: 'projectId teams scheduleId',
                },
            ];

            const [schedules, mon, project]: $TSFixMe = await Promise.all([
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

                //Scheudle has no escalations. Skip.
                if (
                    !schedule.escalationIds ||
                    schedule.escalationIds.length === 0
                ) {
                    continue;
                }

                const callScheduleStatuses: $TSFixMe =
                    await OnCallScheduleStatusService.findBy({
                        query: {
                            incident: incident._id,
                            schedule: schedule,
                        },
                        select: selectOnCallScheduleStatus,
                        populate: populateOnCallScheduleStatus,
                    });
                let onCallScheduleStatus: $TSFixMe = null;
                let escalationId: $TSFixMe = null;
                let currentEscalationStatus: $TSFixMe = null;

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

                    //Create new onCallScheduleStatus
                    onCallScheduleStatus =
                        await OnCallScheduleStatusService.create({
                            project: projectId,
                            incident: incident._id,
                            activeEscalation: escalationId,
                            schedule: schedule._id,
                            incidentAcknowledged: false,
                            escalations: [currentEscalationStatus],
                        });
                } else {
                    onCallScheduleStatus = callScheduleStatuses[0];
                    escalationId =
                        callScheduleStatuses[0].escalations[
                            callScheduleStatuses[0].escalations.length - 1
                        ].escalation._id;
                }

                const selectEscalation: $TSFixMe =
                    'projectId callReminders emailReminders smsReminders pushReminders rotateBy rotationInterval firstRotationOn rotationTimezone call email sms push createdById scheduleId teams createdAt deleted deletedAt';

                const populateEscalation: $TSFixMe = [
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
                const escalation: $TSFixMe = await EscalationService.findOneBy({
                    query: { _id: escalationId },
                    select: selectEscalation,
                    populate: populateEscalation,
                });

                if (!escalation) {
                    continue;
                }
                const activeTeam: $TSFixMe = escalation.activeTeam;
                if (
                    !activeTeam.teamMembers ||
                    activeTeam.teamMembers.length === 0
                ) {
                    continue;
                }
                for (const teamMember of activeTeam.teamMembers) {
                    const [isOnDuty, user]: $TSFixMe = await Promise.all([
                        this.checkIsOnDuty(
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
                            await this.create({
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
                            await this.sendResolveEmailAlert({
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
    }

    public async sendResolveEmailAlert({
        incident,
        user,
        project,
        monitor,
        schedule,
        escalation,
        onCallScheduleStatus,
        eventType,
    }: $TSFixMe): void {
        const projectId: $TSFixMe =
            incident.projectId._id || incident.projectId;

        try {
            let date: $TSFixMe = new Date();
            const accessToken: $TSFixMe = UserService.getAccessToken({
                userId: user._id,
                expiresIn: 12 * 60 * 60 * 1000,
            });

            const queryString: string = `projectId=${projectId}&userId=${user._id}&accessToken=${accessToken}`;

            const view_url: string = `${global.dashboardHost}/project/${project.slug}/component/${monitor.componentId.slug}/incidents/${incident.slug}?${queryString}`;
            const firstName: $TSFixMe = user.name;

            if (user.timezone && TimeZoneNames.indexOf(user.timezone) > -1) {
                date = moment(date).tz(user.timezone).format();
            }

            const [hasGlobalSmtpSettings, hasCustomSmtpSettings]: $TSFixMe =
                await Promise.all([
                    GlobalConfigService.findOneBy({
                        query: { name: 'smtp' },
                        select: 'value',
                    }),
                    MailService.hasCustomSmtpSettings(projectId),
                ]);
            const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                hasGlobalSmtpSettings &&
                hasGlobalSmtpSettings.value &&
                hasGlobalSmtpSettings.value['email-enabled']
                    ? true
                    : false;
            if (
                !areEmailAlertsEnabledInGlobalSettings &&
                !hasCustomSmtpSettings
            ) {
                let errorMessageText: $TSFixMe;
                if (!hasGlobalSmtpSettings && !hasCustomSmtpSettings) {
                    errorMessageText =
                        'SMTP Settings not found on Admin Dashboard';
                } else if (
                    hasGlobalSmtpSettings &&
                    !areEmailAlertsEnabledInGlobalSettings
                ) {
                    errorMessageText = 'Alert Disabled on Admin Dashboard';
                }
                return await this.create({
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
            const incidentcreatedBy: $TSFixMe =
                incident.createdById && incident.createdById.name
                    ? incident.createdById.name
                    : 'oneuptime';
            const downtime: $TSFixMe = moment(incident.resolvedAt).diff(
                moment(incident.createdAt),
                'minutes'
            );
            let downtimestring: string = `${Math.ceil(downtime)} minutes`;
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
            return await this.create({
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
            return await this.create({
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
    }

    public async sendAcknowledgedIncidentToSubscribers(
        incident: $TSFixMe,
        monitors: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();
        const track: $TSFixMe = {};
        const populateStatusPage: $TSFixMe = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage: $TSFixMe =
            'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const sendSubscriberAlert: Function = async ({
            subscriber,
            monitor,
            enabledStatusPage,
            subscribers,
        }: $TSFixMe): void => {
            await this.sendSubscriberAlert(
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
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitor._id,
                        subscribed: true,
                    });
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage: $TSFixMe =
                            await StatusPageService.findOneBy({
                                query: {
                                    _id: subscriber.statusPageId,
                                    isSubscriberEnabled: true,
                                },
                                populate: populateStatusPage,
                                select: selectStatusPage,
                            });
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
    }

    public async sendResolvedIncidentToSubscribers(
        incident: $TSFixMe,
        monitors: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();
        const track: $TSFixMe = {};
        const populateStatusPage: $TSFixMe = [
            { path: 'projectId', select: 'parentProjectId' },
            { path: 'monitorIds', select: 'name' },
            { path: 'monitors.monitor', select: 'name' },
            {
                path: 'domains.domainVerificationToken',
                select: 'domain verificationToken verified ',
            },
        ];

        const selectStatusPage: $TSFixMe =
            'domains projectId monitors links slug title name isPrivate isSubscriberEnabled isGroupedByMonitorCategory showScheduledEvents moveIncidentToTheTop hideProbeBar hideUptime multipleNotifications hideResolvedIncident description copyright faviconPath logoPath bannerPath colors layout headerHTML footerHTML customCSS customJS statusBubbleId embeddedCss createdAt enableRSSFeed emailNotification smsNotification webhookNotification selectIndividualMonitors enableIpWhitelist ipWhitelist incidentHistoryDays scheduleHistoryDays announcementLogsHistory theme';

        const sendSubscriberAlert: Function = async ({
            subscriber,
            monitor,
            enabledStatusPage,
            subscribers,
        }: $TSFixMe): void => {
            await this.sendSubscriberAlert(
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
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitor._id,
                        subscribed: true,
                    });
                for (const subscriber of subscribers) {
                    if (subscriber.statusPageId) {
                        const enabledStatusPage: $TSFixMe =
                            await StatusPageService.findOneBy({
                                query: {
                                    _id: subscriber.statusPageId,
                                    isSubscriberEnabled: true,
                                },
                                select: selectStatusPage,
                                populate: populateStatusPage,
                            });
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
    }

    public async sendSubscriberAlert(
        subscriber: $TSFixMe,
        incident: $TSFixMe,
        templateType = 'Subscriber Incident Created',
        statusPage: $TSFixMe,
        {
            note,
            incidentState,
            noteType,
            statusNoteStatus,
            statusPageSlug,
        }: $TSFixMe = {},
        totalSubscribers: $TSFixMe,
        id: $TSFixMe,
        monitor: $TSFixMe
    ): void {
        const date: $TSFixMe = new Date();
        const isStatusPageNoteAlert: $TSFixMe =
            note && incidentState && statusNoteStatus;
        const statusPageNoteAlertEventType: string = `Investigation note ${statusNoteStatus}`;

        const projectId: $TSFixMe =
            incident.projectId._id || incident.projectId;
        const monitorPopulate: $TSFixMe = [
            { path: 'componentId', select: '_id' },
            { path: 'projectId', select: 'slug' },
        ];
        const monitorSelect: string = '_id customFields componentId projectId';
        const [project, mon]: $TSFixMe = await Promise.all([
            ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'enableInvestigationNoteNotificationWebhook enableInvestigationNoteNotificationEmail name replyAddress sendAcknowledgedIncidentNotificationEmail sendResolvedIncidentNotificationEmail sendCreatedIncidentNotificationEmail enableInvestigationNoteNotificationSMS alertEnable users alertOptions slug sendAcknowledgedIncidentNotificationSms _id sendResolvedIncidentNotificationSms sendCreatedIncidentNotificationSms',
            }),
            MonitorService.findOneBy({
                query: { _id: monitor._id },
                populate: monitorPopulate,
                select: monitorSelect,
            }),
        ]);
        monitor = mon;
        // Get the component
        const populateComponent: $TSFixMe = [
            { path: 'projectId', select: 'name' },
            { path: 'componentCategoryId', select: 'name' },
        ];

        const selectComponent: $TSFixMe =
            '_id createdAt name createdById projectId slug componentCategoryId';
        const component: $TSFixMe = await ComponentService.findOneBy({
            query: {
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            },
            select: selectComponent,
            populate: populateComponent,
        });

        let statusPageUrl: URL;
        if (statusPage) {
            statusPageUrl = `${global.statusHost}/StatusPage/${statusPage._id}`;
            if (statusPage.domains && statusPage.domains.length > 0) {
                const domains: $TSFixMe = statusPage.domains.filter(
                    (domainData: $TSFixMe) => {
                        if (domainData.domainVerificationToken.verified) {
                            return true;
                        }
                        return false;
                    }
                );

                if (domains.length > 0) {
                    statusPageUrl = `${domains[0].domain}/StatusPage/${statusPage._id}`;
                }
            }
        }

        let statusUrl: URL;
        if (statusPageSlug) {
            statusUrl = `${global.statusHost}/StatusPage/${statusPageSlug}/incident/${incident.slug}`;
        }

        const monitorCustomFields: $TSFixMe = {},
            incidentCustomFields: $TSFixMe = {};
        if (monitor && monitor.customFields) {
            monitor.customFields.forEach((field: $TSFixMe) => {
                return (monitorCustomFields[field.fieldName] =
                    field.fieldValue);
            });
        }
        if (incident && incident.customFields) {
            incident.customFields.forEach((field: $TSFixMe) => {
                return (incidentCustomFields[field.fieldName] =
                    field.fieldValue);
            });
        }
        const customFields: $TSFixMe = {
            monitor: { customFields: monitorCustomFields },
            incident: { customFields: incidentCustomFields },
        };

        let webhookNotificationSent: $TSFixMe = true;

        const sendAlerts: Function = async (): void => {
            if (subscriber.alertVia === AlertType.Webhook) {
                const investigationNoteNotificationWebhookDisabled: $TSFixMe =
                    isStatusPageNoteAlert &&
                    !project.enableInvestigationNoteNotificationWebhook;

                let eventType: $TSFixMe;
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
                const downTimeString: $TSFixMe =
                    IncidentUtility.calculateHumanReadableDownTime(
                        incident.createdAt
                    );

                let alertStatus: $TSFixMe = 'Pending';

                try {
                    webhookNotificationSent =
                        await WebHookService.sendSubscriberNotification(
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
                    }).catch((error: Error) => {
                        ErrorService.log(
                            'AlertService.sendSubscriberAlert',
                            error
                        );
                    });
                }
            }

            let length: $TSFixMe = getIncidentLength(
                incident.createdAt,
                incident.acknowledgedAt
            );
            if (
                !webhookNotificationSent ||
                subscriber.alertVia === AlertType.Email
            ) {
                const [hasGlobalSmtpSettings, hasCustomSmtpSettings]: $TSFixMe =
                    await Promise.all([
                        GlobalConfigService.findOneBy({
                            query: { name: 'smtp' },
                            select: 'value',
                        }),
                        MailService.hasCustomSmtpSettings(projectId),
                    ]);
                const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                    hasGlobalSmtpSettings &&
                    hasGlobalSmtpSettings.value &&
                    hasGlobalSmtpSettings.value['email-enabled']
                        ? true
                        : false;

                const investigationNoteNotificationEmailDisabled: $TSFixMe =
                    isStatusPageNoteAlert &&
                    !project.enableInvestigationNoteNotificationEmail;

                let errorMessageText: $TSFixMe, eventType: $TSFixMe;
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
                const select: $TSFixMe =
                    'projectId subject body emailType allowedVariables';
                const emailTemplate: $TSFixMe =
                    await EmailTemplateService.findOneBy({
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
                const subscriberAlert: $TSFixMe =
                    await SubscriberAlertService.create({
                        projectId,
                        incidentId: incident._id,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.Email,
                        alertStatus: 'Pending',
                        eventType: eventType,
                        totalSubscribers,
                        id,
                    });
                const alertId: $TSFixMe = subscriberAlert._id;

                const trackEmailAsViewedUrl: string = `${global.apiHost}/subscriberAlert/${projectId}/${alertId}/viewed`;

                const unsubscribeUrl: string = `${global.homeHost}/unsubscribe/${monitor._id}/${subscriber._id}`;
                let alertStatus: $TSFixMe = null;
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
                let owner: $TSFixMe;
                const hasGlobalTwilioSettings: $TSFixMe =
                    await GlobalConfigService.findOneBy({
                        query: { name: 'twilio' },
                        select: 'value',
                    });
                const areAlertsEnabledGlobally: $TSFixMe =
                    hasGlobalTwilioSettings &&
                    hasGlobalTwilioSettings.value &&
                    hasGlobalTwilioSettings.value['sms-enabled']
                        ? true
                        : false;

                const hasCustomTwilioSettings: $TSFixMe =
                    await TwilioService.hasCustomSettings(projectId);

                const investigationNoteNotificationSMSDisabled: $TSFixMe =
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
                    let errorMessageText: $TSFixMe, eventType: $TSFixMe;
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
                const countryCode: $TSFixMe =
                    await this.mapCountryShortNameToCountryCode(
                        subscriber.countryCode
                    );
                let contactPhone: $TSFixMe = subscriber.contactPhone;
                if (countryCode) {
                    contactPhone = countryCode + contactPhone;
                }

                if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                    owner = project.users.filter((user: $TSFixMe) => {
                        return user.role === 'Owner';
                    })[0];
                    const doesPhoneNumberComplyWithHighRiskConfig: $TSFixMe =
                        await this.doesPhoneNumberComplyWithHighRiskConfig(
                            projectId,
                            contactPhone
                        );
                    if (!doesPhoneNumberComplyWithHighRiskConfig) {
                        const countryType: $TSFixMe =
                            getCountryType(contactPhone);
                        let errorMessageText: $TSFixMe, eventType: $TSFixMe;
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

                    const status: $TSFixMe =
                        await PaymentService.checkAndRechargeProjectBalance(
                            project,
                            owner.userId,
                            contactPhone,
                            AlertType.SMS
                        );
                    let eventType: $TSFixMe;
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

                let sendResult: $TSFixMe;
                const smsTemplate: $TSFixMe =
                    await SmsTemplateService.findOneBy({
                        query: { projectId, smsType: templateType },
                        select: 'body',
                    });
                let eventType: $TSFixMe;
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
                const subscriberAlert: $TSFixMe =
                    await SubscriberAlertService.create({
                        projectId,
                        incidentId: incident._id,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.SMS,
                        alertStatus: 'Pending',
                        eventType: eventType,
                        totalSubscribers,
                        id,
                    });
                const alertId: $TSFixMe = subscriberAlert._id;

                let alertStatus: $TSFixMe = null;
                try {
                    if (templateType === 'Subscriber Incident Acknowledged') {
                        if (project.sendAcknowledgedIncidentNotificationSms) {
                            if (statusPage) {
                                sendResult =
                                    await TwilioService.sendIncidentAcknowledgedMessageToSubscriber(
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
                                sendResult =
                                    await TwilioService.sendIncidentAcknowledgedMessageToSubscriber(
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
                                sendResult =
                                    await TwilioService.sendIncidentResolvedMessageToSubscriber(
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
                                sendResult =
                                    await TwilioService.sendIncidentResolvedMessageToSubscriber(
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
                        sendResult =
                            await TwilioService.sendInvestigationNoteToSubscribers(
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
                                sendResult =
                                    await TwilioService.sendIncidentCreatedMessageToSubscriber(
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
                                sendResult =
                                    await TwilioService.sendIncidentCreatedMessageToSubscriber(
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
                            // Charge sms per 160 chars
                            const segments: $TSFixMe = calcSmsSegments(
                                sendResult.body
                            );
                            const balanceStatus: $TSFixMe =
                                await PaymentService.chargeAlertAndGetProjectBalance(
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

        let incidentAlert: $TSFixMe = subscriber.notificationType?.incident;
        const statusPageId: $TSFixMe = subscriber?.statusPageId;

        // If there is no notification type, then set incidentAlert to true.
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
    }

    public mapCountryShortNameToCountryCode(shortName: $TSFixMe): void {
        return countryCode[[shortName]];
    }

    public isOnDuty(
        timezone: $TSFixMe,
        escalationStartTime: $TSFixMe,
        escalationEndTime: $TSFixMe
    ): void {
        if (!timezone || !escalationStartTime || !escalationEndTime) {
            return true;
        }

        const currentDate: $TSFixMe = new Date();
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
    }

    public checkIsOnDuty(startTime: $TSFixMe, endTime: $TSFixMe): void {
        if (!startTime && !endTime) {
            return true;
        }
        const oncallstart: $TSFixMe = moment(startTime).format('HH:mm');
        const oncallend: $TSFixMe = moment(endTime).format('HH:mm');
        const currentTime: $TSFixMe = moment().format('HH:mm');
        const isUserActive: $TSFixMe =
            DateTime.compareDate(oncallstart, oncallend, currentTime) ||
            oncallstart === oncallend;
        if (isUserActive) {
            return true;
        }
        return false;
    }

    public async getSubProjectAlerts(subProjectIds: $TSFixMe): void {
        const populateAlert: $TSFixMe = [
            { path: 'userId', select: 'name email' },
            { path: 'monitorId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAlert: $TSFixMe =
            '_id projectId userId alertVia alertStatus eventType monitorId createdAt incidentId onCallScheduleStatus schedule escalation error errorMessage alertProgress deleted deletedAt deletedById';

        const subProjectAlerts: $TSFixMe = await Promise.all(
            subProjectIds.map(async (id: $TSFixMe) => {
                const alerts: $TSFixMe = await this.findBy({
                    query: { projectId: id },
                    skip: 0,
                    limit: 10,
                    select: selectAlert,
                    populate: populateAlert,
                });
                const count: $TSFixMe = await this.countBy({ projectId: id });
                return { alerts, count, _id: id, skip: 0, limit: 10 };
            })
        );
        return subProjectAlerts;
    }

    public async restoreBy(query: Query): void {
        query.deleted = true;
        let alert: $TSFixMe = await this.findBy({ query, select: '_id' });
        if (alert && alert.length > 1) {
            const alerts: $TSFixMe = await Promise.all(
                alert.map(async (alert: $TSFixMe) => {
                    const alertId: $TSFixMe = alert._id;
                    alert = await this.updateOneBy(
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
        }
        alert = alert[0];
        if (alert) {
            const alertId: $TSFixMe = alert._id;
            alert = await this.updateOneBy(
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

    //Return true, if the limit is not reached yet.
    public async checkPhoneAlertsLimit(projectId: ObjectID): void {
        const hasCustomSettings: $TSFixMe =
            await TwilioService.hasCustomSettings(projectId);
        if (hasCustomSettings) {
            return true;
        }
        const yesterday: $TSFixMe = new Date(
            new Date().getTime() - 24 * 60 * 60 * 1000
        );
        const [alerts, smsCounts, project, twilioSettings]: $TSFixMe =
            await Promise.all([
                this.countBy({
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
        let limit: $TSFixMe =
            project && project.alertLimit
                ? project.alertLimit
                : twilioSettings['alert-limit'];
        if (limit && typeof limit === 'string') {
            limit = parseInt(limit, 10);
        }
        if (alerts + smsCounts <= limit) {
            return true;
        }
        await ProjectService.updateOneBy(
            { _id: projectId },
            { alertLimitReached: true }
        );
        return false;
    }

    public async sendUnpaidSubscriptionEmail(
        project: $TSFixMe,
        user: $TSFixMe
    ): void {
        const { name: userName, email: userEmail } = user;
        const { stripePlanId, name: projectName, slug: projectSlug } = project;

        const projectUrl: string = `${global.dashboardHost}/project/${projectSlug}`;
        const projectPlan: $TSFixMe = getPlanById(stripePlanId);

        await MailService.sendUnpaidSubscriptionReminder({
            projectName,
            projectPlan,
            name: userName,
            userEmail,
            projectUrl,
        });
    }

    public async sendProjectDeleteEmailForUnpaidSubscription(
        project: $TSFixMe,
        user: $TSFixMe
    ): void {
        const { name: userName, email: userEmail } = user;
        const { stripePlanId, name: projectName } = project;
        const projectPlan: $TSFixMe =
            getPlanById(stripePlanId) || getPlanByExtraUserId(stripePlanId);

        await MailService.sendUnpaidSubscriptionReminder({
            projectName,
            projectPlan,
            name: userName,
            userEmail,
        });
    }

    public async sendCreatedScheduledEventToSubscribers(
        schedule: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();
        if (schedule) {
            const track: $TSFixMe = {};
            const sendSubscribersAlert: Function = async ({
                subscriber,
                component,
                subscribers,
            }: $TSFixMe): void => {
                await this.sendSubscriberScheduledEventAlert(
                    subscriber,
                    schedule,
                    'Subscriber Scheduled Maintenance Created',
                    component,
                    subscribers.length,
                    uuid
                );
            };
            for (const monitor of schedule.monitors) {
                const component: $TSFixMe = monitor.monitorId.componentId.name;
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitor.monitorId._id,
                        subscribed: true,
                    });

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
    }

    public async sendResolvedScheduledEventToSubscribers(
        schedule: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();
        if (schedule) {
            const track: $TSFixMe = {};
            const sendSubscribersAlert: Function = async ({
                subscriber,
                component,
                subscribers,
            }: $TSFixMe): void => {
                await this.sendSubscriberScheduledEventAlert(
                    subscriber,
                    schedule,
                    'Subscriber Scheduled Maintenance Resolved',
                    component,
                    subscribers.length,
                    uuid
                );
            };
            for (const monitor of schedule.monitors) {
                const component: $TSFixMe = monitor.monitorId.componentId.name;
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitor.monitorId._id,
                        subscribed: true,
                    });

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
    }

    public async sendCancelledScheduledEventToSubscribers(
        schedule: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();
        if (schedule) {
            for (const monitor of schedule.monitors) {
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitor.monitorId._id,
                        subscribed: true,
                    });

                for (const subscriber of subscribers) {
                    await this.sendSubscriberScheduledEventAlert(
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
    }

    public async sendScheduledEventInvestigationNoteToSubscribers(
        message: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();

        const monitorIds: $TSFixMe =
            message.scheduledEventId &&
            message.scheduledEventId.monitors.map((monitor: $TSFixMe) => {
                return monitor.monitorId;
            });

        const monitorsAffected: $TSFixMe = await MonitorService.findBy({
            query: { _id: { $in: monitorIds }, deleted: false },
            select: 'name',
        });

        if (message) {
            for (const monitor of message.scheduledEventId.monitors) {
                const monitorId: $TSFixMe =
                    monitor.monitorId._id || monitor.monitorId;

                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId,
                        subscribed: true,
                    });
                const totalSubscribers: $TSFixMe = subscribers.length;

                for (const subscriber of subscribers) {
                    const projectId: $TSFixMe =
                        message.scheduledEventId.projectId._id;

                    const project: $TSFixMe = await ProjectService.findOneBy({
                        query: { _id: projectId },
                        select: 'sendNewScheduledEventInvestigationNoteNotificationEmail name alertEnable sendNewScheduledEventInvestigationNoteNotificationSms users _id alertOptions slug sendNewScheduledEventInvestigationNoteNotificationSms',
                    });

                    const unsubscribeUrl: string = `${global.homeHost}/unsubscribe/${subscriber.monitorId}/${subscriber._id}`;

                    if (subscriber.alertVia === AlertType.Email) {
                        const select: $TSFixMe =
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

                        const NotificationEmailDisabled: $TSFixMe =
                            !project.sendNewScheduledEventInvestigationNoteNotificationEmail;

                        const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                            hasGlobalSmtpSettings &&
                            hasGlobalSmtpSettings.value &&
                            hasGlobalSmtpSettings.value['email-enabled']
                                ? true
                                : false;

                        let errorMessageText: $TSFixMe = null;

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

                        const subscriberAlert: $TSFixMe =
                            await SubscriberAlertService.create({
                                projectId,

                                subscriberId: subscriber._id,
                                alertVia: AlertType.Email,
                                alertStatus: 'Pending',
                                eventType: 'Scheduled maintenance note created',
                                totalSubscribers: subscribers.length,
                                uuid,
                            });
                        const alertId: $TSFixMe = subscriberAlert._id;

                        let alertStatus: $TSFixMe = null;
                        try {
                            const createdBy: $TSFixMe = message.createdById
                                ? message.createdById.name
                                : 'OneUptime';

                            const replyAddress: $TSFixMe = message
                                .scheduledEventId.projectId.replyAddress
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
                                monitorsAffected.filter((monitor: $TSFixMe) => {
                                    return (
                                        String(monitor._id) ===
                                        String(monitorId)
                                    );
                                })
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
                        let owner: $TSFixMe;
                        const hasGlobalTwilioSettings: $TSFixMe =
                            await GlobalConfigService.findOneBy({
                                query: { name: 'twilio' },
                                select: 'value',
                            });
                        const areAlertsEnabledGlobally: $TSFixMe =
                            hasGlobalTwilioSettings &&
                            hasGlobalTwilioSettings.value &&
                            hasGlobalTwilioSettings.value['sms-enabled']
                                ? true
                                : false;

                        const hasCustomTwilioSettings: $TSFixMe =
                            await TwilioService.hasCustomSettings(projectId);

                        const notificationSMSDisabled: $TSFixMe =
                            !project.sendNewScheduledEventInvestigationNoteNotificationSms;

                        const eventType: string =
                            'Scheduled maintenance note created';
                        const templateType: $TSFixMe =
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
                            let errorMessageText: $TSFixMe;
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
                        const countryCode: $TSFixMe =
                            await this.mapCountryShortNameToCountryCode(
                                subscriber.countryCode
                            );

                        let contactPhone: $TSFixMe = subscriber.contactPhone;
                        if (countryCode) {
                            contactPhone = countryCode + contactPhone;
                        }

                        if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                            owner = project.users.filter((user: $TSFixMe) => {
                                return user.role === 'Owner';
                            })[0];
                            const doesPhoneNumberComplyWithHighRiskConfig: $TSFixMe =
                                await this.doesPhoneNumberComplyWithHighRiskConfig(
                                    projectId,
                                    contactPhone
                                );
                            if (!doesPhoneNumberComplyWithHighRiskConfig) {
                                const countryType: $TSFixMe =
                                    getCountryType(contactPhone);
                                let errorMessageText: $TSFixMe;
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

                            const status: $TSFixMe =
                                await PaymentService.checkAndRechargeProjectBalance(
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

                        let sendResult: $TSFixMe;
                        const smsTemplate: $TSFixMe =
                            await SmsTemplateService.findOneBy({
                                query: {
                                    projectId,
                                    smsType: templateType,
                                },
                                select: 'body',
                            });
                        const subscriberAlert: $TSFixMe =
                            await SubscriberAlertService.create({
                                projectId,

                                subscriberId: subscriber._id,
                                alertVia: AlertType.SMS,
                                alertStatus: 'Pending',
                                eventType: eventType,
                                totalSubscribers,
                                uuid,
                            });
                        const alertId: $TSFixMe = subscriberAlert._id;

                        let alertStatus: $TSFixMe = null;
                        try {
                            if (
                                project.sendNewScheduledEventInvestigationNoteNotificationSms
                            ) {
                                sendResult =
                                    await TwilioService.sendScheduledMaintenanceNoteCreatedToSubscriber(
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
                                    // Charge sms per 160 chars
                                    const segments: $TSFixMe = calcSmsSegments(
                                        sendResult.body
                                    );
                                    const balanceStatus: $TSFixMe =
                                        await PaymentService.chargeAlertAndGetProjectBalance(
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
    }

    public async sendSubscriberScheduledEventAlert(
        subscriber: $TSFixMe,
        schedule: $TSFixMe,
        templateType = 'Subscriber Scheduled Maintenance Created',
        componentName: $TSFixMe,
        totalSubscribers: $TSFixMe,
        id: $TSFixMe
    ): void {
        const date: $TSFixMe = new Date();
        const projectName: $TSFixMe = schedule.projectId.name;
        const projectId: $TSFixMe = schedule.projectId._id;

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: 'sendCreatedScheduledEventNotificationEmail sendScheduledEventResolvedNotificationEmail sendScheduledEventCancelledNotificationEmail replyAddress sendCreatedScheduledEventNotificationSms sendScheduledEventResolvedNotificationSms sendScheduledEventCancelledNotificationSms alertEnable users alertOptions slug _id name',
        });

        const eventType: $TSFixMe =
            templateType === 'Subscriber Scheduled Maintenance Created'
                ? 'Scheduled maintenance created'
                : templateType === 'Subscriber Scheduled Maintenance Resolved'
                ? 'Scheduled maintenance resolved'
                : 'Scheduled maintenance cancelled';

        const sendAlerts: Function = async (): void => {
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
                        select: 'projectId subject body emailType allowedVariables',
                        populate: [{ path: 'projectId', select: 'nmae' }],
                    }),
                ]);
                const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                    hasGlobalSmtpSettings &&
                    hasGlobalSmtpSettings.value &&
                    hasGlobalSmtpSettings.value['email-enabled']
                        ? true
                        : false;

                const notificationEmailDisabled: $TSFixMe =
                    templateType === 'Subscriber Scheduled Maintenance Created'
                        ? !project.sendCreatedScheduledEventNotificationEmail
                        : templateType ===
                          'Subscriber Scheduled Maintenance Resolved'
                        ? !project.sendScheduledEventResolvedNotificationEmail
                        : !project.sendScheduledEventCancelledNotificationEmail;

                let errorMessageText: $TSFixMe;
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

                const subscriberAlert: $TSFixMe =
                    await SubscriberAlertService.create({
                        projectId,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.Email,
                        alertStatus: 'Pending',
                        eventType,
                        totalSubscribers,
                        id,
                    });
                const alertId: $TSFixMe = subscriberAlert._id;

                const unsubscribeUrl: string = `${global.homeHost}/unsubscribe/${subscriber.monitorId}/${subscriber._id}`;

                let alertStatus: $TSFixMe = null;
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
                let owner: $TSFixMe;
                const hasGlobalTwilioSettings: $TSFixMe =
                    await GlobalConfigService.findOneBy({
                        query: { name: 'twilio' },
                        select: 'value',
                    });
                const areAlertsEnabledGlobally: $TSFixMe =
                    hasGlobalTwilioSettings &&
                    hasGlobalTwilioSettings.value &&
                    hasGlobalTwilioSettings.value['sms-enabled']
                        ? true
                        : false;

                const hasCustomTwilioSettings: $TSFixMe =
                    await TwilioService.hasCustomSettings(projectId);

                const notificationSmsDisabled: $TSFixMe =
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
                    let errorMessageText: $TSFixMe;
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
                const countryCode: $TSFixMe =
                    await this.mapCountryShortNameToCountryCode(
                        subscriber.countryCode
                    );
                let contactPhone: $TSFixMe = subscriber.contactPhone;
                if (countryCode) {
                    contactPhone = countryCode + contactPhone;
                }

                if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                    owner = project.users.filter((user: $TSFixMe) => {
                        return user.role === 'Owner';
                    })[0];
                    const doesPhoneNumberComplyWithHighRiskConfig: $TSFixMe =
                        await this.doesPhoneNumberComplyWithHighRiskConfig(
                            projectId,
                            contactPhone
                        );
                    if (!doesPhoneNumberComplyWithHighRiskConfig) {
                        const countryType: $TSFixMe =
                            getCountryType(contactPhone);
                        let errorMessageText: $TSFixMe;
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

                    const status: $TSFixMe =
                        await PaymentService.checkAndRechargeProjectBalance(
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

                let sendResult: $TSFixMe;
                const smsTemplate: $TSFixMe =
                    await SmsTemplateService.findOneBy({
                        query: { projectId, smsType: templateType },
                        select: 'body smsType allowedVariables projectId',
                    });
                const subscriberAlert: $TSFixMe =
                    await SubscriberAlertService.create({
                        projectId,
                        subscriberId: subscriber._id,
                        alertVia: AlertType.SMS,
                        alertStatus: 'Pending',
                        eventType,
                        totalSubscribers,
                        id,
                    });
                const alertId: $TSFixMe = subscriberAlert._id;

                let alertStatus: $TSFixMe = null;
                try {
                    if (
                        templateType ===
                        'Subscriber Scheduled Maintenance Created'
                    ) {
                        if (project.sendCreatedScheduledEventNotificationSms) {
                            sendResult =
                                await TwilioService.sendScheduledMaintenanceCreatedToSubscriber(
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
                            sendResult =
                                await TwilioService.sendScheduledMaintenanceResolvedToSubscriber(
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
                            sendResult =
                                await TwilioService.sendScheduledMaintenanceCancelledToSubscriber(
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
                            // Charge sms per 160 chars
                            const segments: $TSFixMe = calcSmsSegments(
                                sendResult.body
                            );
                            const balanceStatus: $TSFixMe =
                                await PaymentService.chargeAlertAndGetProjectBalance(
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

        let scheduledEventAlert: $TSFixMe =
            subscriber.notificationType?.scheduledEvent;
        const statusPageId: $TSFixMe = subscriber?.statusPageId;

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
    }

    public async sendAnnouncementNotificationToSubscribers(
        message: $TSFixMe
    ): void {
        const uuid: $TSFixMe = new Date().getTime();

        if (message) {
            const track: $TSFixMe = {};
            const sendAlerts: Function = async ({
                project,
                subscriber,
                projectId,
                totalSubscribers,
                subscribers,
                unsubscribeUrl,
                monitorName,
            }: $TSFixMe): void => {
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
                            select: 'projectId subject body emailType allowedVariables',
                            populate: [
                                {
                                    path: 'projectId',
                                    select: 'nmae',
                                },
                            ],
                        }),
                    ]);

                    const NotificationEmailDisabled: $TSFixMe =
                        !project.sendAnnouncementNotificationEmail;

                    const areEmailAlertsEnabledInGlobalSettings: $TSFixMe =
                        hasGlobalSmtpSettings &&
                        hasGlobalSmtpSettings.value &&
                        hasGlobalSmtpSettings.value['email-enabled']
                            ? true
                            : false;

                    let errorMessageText: $TSFixMe = null;

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

                    const subscriberAlert: $TSFixMe =
                        await SubscriberAlertService.create({
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.Email,
                            alertStatus: 'Pending',
                            eventType: 'Announcement notification created',
                            totalSubscribers: subscribers.length,
                            uuid,
                        });
                    const alertId: $TSFixMe = subscriberAlert._id;

                    let alertStatus: $TSFixMe = null;
                    try {
                        const replyAddress: $TSFixMe = project.replyAddress
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
                    let owner: $TSFixMe;
                    const [
                        hasGlobalTwilioSettings,
                        hasCustomTwilioSettings,
                    ]: $TSFixMe = await Promise.all([
                        GlobalConfigService.findOneBy({
                            query: { name: 'twilio' },
                            select: 'value',
                        }),
                        TwilioService.hasCustomSettings(projectId),
                    ]);
                    const areAlertsEnabledGlobally: $TSFixMe =
                        hasGlobalTwilioSettings &&
                        hasGlobalTwilioSettings.value &&
                        hasGlobalTwilioSettings.value['sms-enabled']
                            ? true
                            : false;

                    const notificationSMSDisabled: $TSFixMe =
                        !project.sendAnnouncementNotificationSms;

                    const eventType: string =
                        'Announcement notification created';
                    const templateType: $TSFixMe =
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
                        let errorMessageText: $TSFixMe;
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
                    const countryCode: $TSFixMe =
                        await this.mapCountryShortNameToCountryCode(
                            subscriber.countryCode
                        );
                    let contactPhone: $TSFixMe = subscriber.contactPhone;
                    if (countryCode) {
                        contactPhone = countryCode + contactPhone;
                    }

                    if (IS_SAAS_SERVICE && !hasCustomTwilioSettings) {
                        owner = project.users.filter((user: $TSFixMe) => {
                            return user.role === 'Owner';
                        })[0];
                        const doesPhoneNumberComplyWithHighRiskConfig: $TSFixMe =
                            await this.doesPhoneNumberComplyWithHighRiskConfig(
                                projectId,
                                contactPhone
                            );
                        if (!doesPhoneNumberComplyWithHighRiskConfig) {
                            const countryType: $TSFixMe =
                                getCountryType(contactPhone);
                            let errorMessageText: $TSFixMe;
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

                        const status: $TSFixMe =
                            await PaymentService.checkAndRechargeProjectBalance(
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

                    let sendResult: $TSFixMe;
                    const smsTemplate: $TSFixMe =
                        await SmsTemplateService.findOneBy({
                            query: {
                                projectId,
                                smsType: templateType,
                            },
                            select: 'body allowedVariables projectId smsType',
                        });
                    const subscriberAlert: $TSFixMe =
                        await SubscriberAlertService.create({
                            projectId,
                            subscriberId: subscriber._id,
                            alertVia: AlertType.SMS,
                            alertStatus: 'Pending',
                            eventType: eventType,
                            totalSubscribers,
                            uuid,
                        });
                    const alertId: $TSFixMe = subscriberAlert._id;

                    let alertStatus: $TSFixMe = null;
                    try {
                        if (project.sendAnnouncementNotificationSms) {
                            sendResult =
                                await TwilioService.sendAnnouncementNotificationToSubscriber(
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
                                // Charge sms per 160 chars
                                const segments: $TSFixMe = calcSmsSegments(
                                    sendResult.body
                                );
                                const balanceStatus: $TSFixMe =
                                    await PaymentService.chargeAlertAndGetProjectBalance(
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
                const subscribers: $TSFixMe =
                    await SubscriberService.subscribersForAlert({
                        monitorId: monitor.monitorId,
                        subscribed: true,
                    });
                const totalSubscribers: $TSFixMe = subscribers.length;

                for (const subscriber of subscribers) {
                    const projectId: $TSFixMe = message.projectId;

                    const monitorName: $TSFixMe = subscriber.monitorName;

                    const project: $TSFixMe = await ProjectService.findOneBy({
                        query: { _id: projectId },
                        select: 'sendAnnouncementNotificationEmail replyAddress name sendAnnouncementNotificationSms alertEnable users _id alertEnable alertOptions slug',
                    });

                    const unsubscribeUrl: string = `${global.homeHost}/unsubscribe/${subscriber.monitorId}/${subscriber._id}`;

                    let announcementAlert: $TSFixMe =
                        subscriber.notificationType?.announcement;

                    const statusPageId: $TSFixMe = subscriber?.statusPageId;

                    // If there is no notification type, then set incidentAlert to true.

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
    }
}

/**
 * @description calculates the number of segments an sms is divided into
 * @param {string} sms the body of the sms sent
 * @returns an interger
 */
function calcSmsSegments(sms: $TSFixMe): void {
    let smsLength: $TSFixMe = sms.length;
    smsLength = Number(smsLength);
    return Math.ceil(smsLength / 160);
}

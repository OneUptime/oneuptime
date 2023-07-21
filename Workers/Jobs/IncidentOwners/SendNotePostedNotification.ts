import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import Incident from 'Model/Models/Incident';
import IncidentService from 'CommonServer/Services/IncidentService';
import User from 'Model/Models/User';
import ProjectService from 'CommonServer/Services/ProjectService';
import Markdown from 'CommonServer/Types/Markdown';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import IncidentPublicNoteService from 'CommonServer/Services/IncidentPublicNoteService';
import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import IncidentInternalNote from 'Model/Models/IncidentInternalNote';
import IncidentInternalNoteService from 'CommonServer/Services/IncidentInternalNoteService';
import { EmailEnvelope } from 'Common/Types/Email/EmailMessage';
import { SMSMessage } from 'Common/Types/SMS/SMS';
import { CallRequestMessage } from 'Common/Types/Call/CallRequest';
import UserNotificationSettingService from 'CommonServer/Services/UserNotificationSettingService';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';

RunCron(
    'IncidentOwner:SendsNotePostedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const publicNotes: Array<IncidentPublicNote> =
            await IncidentPublicNoteService.findBy({
                query: {
                    isOwnerNotified: false,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                    note: true,
                    incidentId: true,
                    projectId: true,
                },
            });

        const privateNotes: Array<IncidentInternalNote> =
            await IncidentInternalNoteService.findBy({
                query: {
                    isOwnerNotified: false,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                    note: true,
                    incidentId: true,
                    projectId: true,
                },
            });

        const privateNoteIds: Array<string> = privateNotes.map(
            (note: IncidentInternalNote) => {
                return note._id!;
            }
        );

        for (const note of publicNotes) {
            await IncidentPublicNoteService.updateOneById({
                id: note.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        for (const note of privateNotes) {
            await IncidentInternalNoteService.updateOneById({
                id: note.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });
        }

        const notes: Array<BaseModel> = [...publicNotes, ...privateNotes];

        for (const noteObject of notes) {
            const note: BaseModel = noteObject as BaseModel;

            // get all scheduled events of all the projects.
            const incident: Incident | null = await IncidentService.findOneById(
                {
                    id: note.getColumnValue('incidentId')! as ObjectID,
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                        title: true,
                        description: true,
                        projectId: true,
                        project: {
                            name: true,
                        },
                        currentIncidentState: {
                            name: true,
                        },
                        incidentSeverity: {
                            name: true,
                        },
                    },
                }
            );

            if (!incident) {
                continue;
            }

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> = await IncidentService.findOwners(
                note.getColumnValue('incidentId')! as ObjectID
            );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(
                    note.getColumnValue('projectId') as ObjectID
                );
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                incidentTitle: incident.title!,
                projectName: incident.project!.name!,
                currentState: incident.currentIncidentState!.name!,
                note: Markdown.convertToHTML(
                    (note.getColumnValue('note')! as string) || ''
                ),
                incidentSeverity: incident.incidentSeverity!.name!,
                incidentViewLink: IncidentService.getIncidentLinkInDashboard(
                    incident.projectId!,
                    incident.id!
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            if (privateNoteIds.includes(note._id!)) {
                vars['isPrivateNote'] = 'true';
            }

            for (const user of owners) {
                const emailMessage: EmailEnvelope = {
                    templateType: EmailTemplateType.IncidentOwnerNotePosted,
                    vars: vars,
                    subject: 'New note posted on incident - ' + incident.title,
                };

                const sms: SMSMessage = {
                    message: `This is a message from OneUptime. New note posted on incident: ${incident.title}. To unsubscribe go to User Settings in OneUptime Dashboard.`,
                };

                const callMessage: CallRequestMessage = {
                    data: [
                        {
                            sayMessage: `This is a message from OneUptime. New note posted on incident ${incident.title}. To see the note, go to OneUptime Dashboard. To unsubscribe go to User Settings in OneUptime Dashboard. Good bye.`,
                        },
                    ],
                };

                await UserNotificationSettingService.sendUserNotification({
                    userId: user.id!,
                    projectId: incident.projectId!,
                    emailEnvelope: emailMessage,
                    smsMessage: sms,
                    callRequestMessage: callMessage,
                    eventType:
                        NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION,
                });
            }
        }
    }
);

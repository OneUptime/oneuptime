import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
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
                    },
                    populate: {
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
                owners = await ProjectService.getOwners(incident.projectId!);
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
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.IncidentOwnerNotePosted,
                    vars: vars,
                    subject: 'New note posted on incident - ' + incident.title,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);

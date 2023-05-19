import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import Dictionary from 'Common/Types/Dictionary';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceService from 'CommonServer/Services/ScheduledMaintenanceService';
import User from 'Model/Models/User';
import ProjectService from 'CommonServer/Services/ProjectService';
import Markdown from 'CommonServer/Types/Markdown';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import ScheduledMaintenancePublicNoteService from 'CommonServer/Services/ScheduledMaintenancePublicNoteService';
import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenanceInternalNote from 'Model/Models/ScheduledMaintenanceInternalNote';
import ScheduledMaintenanceInternalNoteService from 'CommonServer/Services/ScheduledMaintenanceInternalNoteService';

RunCron(
    'ScheduledMaintenanceOwner:SendsNotePostedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const publicNotes: Array<ScheduledMaintenancePublicNote> =
            await ScheduledMaintenancePublicNoteService.findBy({
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
                    scheduledMaintenanceId: true,
                    projectId: true,
                },
            });

        const privateNotes: Array<ScheduledMaintenanceInternalNote> =
            await ScheduledMaintenanceInternalNoteService.findBy({
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
                    scheduledMaintenanceId: true,
                    projectId: true,
                },
            });

        const privateNoteIds: Array<string> = privateNotes.map(
            (note: ScheduledMaintenancePublicNote) => {
                return note._id!;
            }
        );

        for (const note of publicNotes) {
            await ScheduledMaintenancePublicNoteService.updateOneById({
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
            await ScheduledMaintenancePublicNoteService.updateOneById({
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
            const scheduledMaintenance: ScheduledMaintenance | null =
                await ScheduledMaintenanceService.findOneById({
                    id: note.getColumnValue(
                        'scheduledMaintenanceId'
                    )! as ObjectID,
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
                        currentScheduledMaintenanceState: {
                            name: true,
                        },
                    },
                });

            if (!scheduledMaintenance) {
                continue;
            }

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> =
                await ScheduledMaintenanceService.findOwners(
                    note.getColumnValue('scheduledMaintenanceId')! as ObjectID
                );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(
                    scheduledMaintenance.projectId!
                );
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                scheduledMaintenanceTitle: scheduledMaintenance.title!,
                projectName: scheduledMaintenance.project!.name!,
                currentState:
                    scheduledMaintenance.currentScheduledMaintenanceState!
                        .name!,
                note: Markdown.convertToHTML(
                    (note.getColumnValue('note')! as string) || ''
                ),
                scheduledMaintenanceViewLink:
                    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                        scheduledMaintenance.projectId!,
                        scheduledMaintenance.id!
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
                    templateType:
                        EmailTemplateType.ScheduledMaintenanceOwnerNotePosted,
                    vars: vars,
                    subject:
                        'New note posted on scheduled maintenance event - ' +
                        scheduledMaintenance.title,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);

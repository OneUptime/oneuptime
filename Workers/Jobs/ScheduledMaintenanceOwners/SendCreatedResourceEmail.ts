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

RunCron(
    'ScheduledMaintenanceOwner:SendCreatedResourceEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.
        const scheduledMaintenances: Array<ScheduledMaintenance> = await ScheduledMaintenanceService.findBy({
            query: {
                isOwnerNotifiedOfResourceCreation: false,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
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

        for (const scheduledMaintenance of scheduledMaintenances) {
            await ScheduledMaintenanceService.updateOneById({
                id: scheduledMaintenance.id!,
                data: {
                    isOwnerNotifiedOfResourceCreation: true,
                },
                props: {
                    isRoot: true,
                },
            });

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> = await ScheduledMaintenanceService.findOwners(
                scheduledMaintenance.id!
            );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(scheduledMaintenance.projectId!);
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                scheduledMaintenanceTitle: scheduledMaintenance.title!,
                projectName: scheduledMaintenance.project!.name!,
                currentState: scheduledMaintenance.currentScheduledMaintenanceState!.name!,
                scheduledMaintenanceDescription: Markdown.convertToHTML(
                    scheduledMaintenance.description! || ''
                ),
                scheduledMaintenanceViewLink: ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                    scheduledMaintenance.projectId!,
                    scheduledMaintenance.id!
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.ScheduledMaintenanceOwnerResourceCreated,
                    vars: vars,
                    subject: 'New scheduled maintenance created - ' + scheduledMaintenance.title!,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);

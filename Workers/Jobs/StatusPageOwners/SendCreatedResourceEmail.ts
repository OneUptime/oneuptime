import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import Dictionary from 'Common/Types/Dictionary';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageService from 'CommonServer/Services/StatusPageService';
import User from 'Model/Models/User';
import ProjectService from 'CommonServer/Services/ProjectService';
import Markdown from 'CommonServer/Types/Markdown';

RunCron(
    'StatusPageOwner:SendCreatedResourceEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.
        const statusPages: Array<StatusPage> = await StatusPageService.findBy({
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
                name: true,
                description: true,
                projectId: true,
            },
            populate: {
                project: {
                    name: true,
                },
            },
        });

        for (const statusPage of statusPages) {
            await StatusPageService.updateOneById({
                id: statusPage.id!,
                data: {
                    isOwnerNotifiedOfResourceCreation: true,
                },
                props: {
                    isRoot: true,
                },
            });

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> = await StatusPageService.findOwners(
                statusPage.id!
            );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(statusPage.projectId!);
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                statusPageName: statusPage.name!,
                projectName: statusPage.project!.name!,
                statusPageDescription: Markdown.convertToHTML(
                    statusPage.description! || ''
                ),
                statusPageViewLink: StatusPageService.getStatusPageLinkInDashboard(
                    statusPage.projectId!,
                    statusPage.id!
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.StatusPageOwnerResourceCreated,
                    vars: vars,
                    subject: 'New Status Page created - ' + statusPage.name!,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);

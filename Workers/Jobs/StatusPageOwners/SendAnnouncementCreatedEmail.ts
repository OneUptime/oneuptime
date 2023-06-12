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
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import StatusPageAnnouncementService from 'CommonServer/Services/StatusPageAnnouncementService';

RunCron(
    'StatusPageOwner:SendAnnouncementCreatedEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const announcements: Array<StatusPageAnnouncement> =
            await StatusPageAnnouncementService.findBy({
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
                    title: true,
                    description: true,
                    statusPages: true,
                    projectId: true,
                    statusPages: {
                        _id: true,
                        name: true,
                    },
                },
            });

        for (const announcement of announcements) {
            await StatusPageAnnouncementService.updateOneById({
                id: announcement.id!,
                data: {
                    isOwnerNotified: true,
                },
                props: {
                    isRoot: true,
                },
            });

            const statusPages: Array<StatusPage> =
                announcement.statusPages || [];

            for (const statusPage of statusPages) {
                // now find owners.

                let doesResourceHasOwners: boolean = true;

                let owners: Array<User> = await StatusPageService.findOwners(
                    statusPage.id!
                );

                if (owners.length === 0) {
                    doesResourceHasOwners = false;

                    // find project owners.
                    owners = await ProjectService.getOwners(
                        announcement.projectId!
                    );
                }

                if (owners.length === 0) {
                    continue;
                }

                const vars: Dictionary<string> = {
                    statusPageName: statusPage.name!,
                    announcementTitle: announcement.title!,
                    announcementDescription: Markdown.convertToHTML(
                        announcement.description!
                    ),
                };

                if (doesResourceHasOwners === true) {
                    vars['isOwner'] = 'true';
                }

                for (const user of owners) {
                    MailService.sendMail({
                        toEmail: user.email!,
                        templateType:
                            EmailTemplateType.StatusPageOwnerAnnouncementPosted,
                        vars: vars,
                        subject:
                            'New announcement posted - ' + announcement.title!,
                    }).catch((err: Error) => {
                        logger.error(err);
                    });
                }
            }
        }
    }
);

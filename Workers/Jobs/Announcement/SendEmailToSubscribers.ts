import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import StatusPageSubscriberService from 'CommonServer/Services/StatusPageSubscriberService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';
import LIMIT_MAX, { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import StatusPageAnnouncementService from 'CommonServer/Services/StatusPageAnnouncementService';
import RunCron from '../../Utils/Cron';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';
import { Domain, FileRoute, HttpProtocol } from 'CommonServer/Config';
import URL from 'Common/Types/API/URL';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import StatusPageService from 'CommonServer/Services/StatusPageService';
import StatusPage from 'Model/Models/StatusPage';
import ProjectSMTPConfigService from 'CommonServer/Services/ProjectSmtpConfigService';
import Markdown from 'CommonServer/Types/Markdown';

RunCron(
    'Announcement:SendEmailToSubscribers',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.
        const announcements: Array<StatusPageAnnouncement> =
            await StatusPageAnnouncementService.findBy({
                query: {
                    isStatusPageSubscribersNotified: false,
                    showAnnouncementAt: QueryHelper.lessThan(
                        OneUptimeDate.getCurrentDate()
                    ),
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
                },
                populate: {
                    statusPages: {
                        _id: true,
                    },
                },
            });

        // change their state to Ongoing.

        for (const announcement of announcements) {
            if (!announcement.statusPages) {
                continue;
            }

            const statusPages: Array<StatusPage> =
                await StatusPageService.findBy({
                    query: {
                        _id: QueryHelper.in(
                            announcement.statusPages.map((sp: StatusPage) => {
                                return sp.id!;
                            })
                        ),
                    },
                    props: {
                        isRoot: true,
                        ignoreHooks: true,
                    },
                    skip: 0,
                    limit: LIMIT_PER_PROJECT,
                    select: {
                        _id: true,
                        name: true,
                        pageTitle: true,
                        isPublicStatusPage: true,
                        logoFileId: true,
                    },
                    populate: {
                        smtpConfig: {
                            _id: true,
                            hostname: true,
                            port: true,
                            username: true,
                            password: true,
                            fromEmail: true,
                            fromName: true,
                            secure: true,
                        },
                    },
                });

            await StatusPageAnnouncementService.updateOneById({
                id: announcement.id!,
                data: {
                    isStatusPageSubscribersNotified: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

            for (const statuspage of statusPages) {
                if (!statuspage.id) {
                    continue;
                }

                const subscribers: Array<StatusPageSubscriber> =
                    await StatusPageSubscriberService.getSubscribersByStatusPage(
                        statuspage.id!,
                        {
                            isRoot: true,
                            ignoreHooks: true,
                        }
                    );

                const statusPageURL: string =
                    await StatusPageService.getStatusPageURL(statuspage.id);
                const statusPageName: string =
                    statuspage.pageTitle || statuspage.name || 'Status Page';

                // Send email to Email subscribers.

                for (const subscriber of subscribers) {
                    if (!subscriber._id) {
                        continue;
                    }

                    if (subscriber.subscriberEmail) {
                        // send email here.

                        MailService.sendMail(
                            {
                                toEmail: subscriber.subscriberEmail,
                                templateType:
                                    EmailTemplateType.SubscriberAnnouncementCreated,
                                vars: {
                                    statusPageName: statusPageName,
                                    statusPageUrl: statusPageURL,
                                    logoUrl: statuspage.logoFileId
                                        ? new URL(HttpProtocol, Domain)
                                              .addRoute(FileRoute)
                                              .addRoute(
                                                  '/image/' +
                                                      statuspage.logoFileId
                                              )
                                              .toString()
                                        : '',
                                    isPublicStatusPage:
                                        statuspage.isPublicStatusPage
                                            ? 'true'
                                            : 'false',
                                    announcementTitle: announcement.title || '',
                                    announcementDescription:
                                        Markdown.convertToHTMML(
                                            announcement.description || ''
                                        ),
                                    unsubscribeUrl: new URL(
                                        HttpProtocol,
                                        Domain
                                    )
                                        .addRoute(
                                            '/api/status-page-subscriber/unsubscribe/' +
                                                subscriber._id.toString()
                                        )
                                        .toString(),
                                },
                                subject: statusPageName + ' - New Announcement',
                            },
                            ProjectSMTPConfigService.toEmailServer(
                                statuspage.smtpConfig
                            )
                        ).catch((err: Error) => {
                            logger.error(err);
                        });
                    }
                }
            }
        }
    }
);

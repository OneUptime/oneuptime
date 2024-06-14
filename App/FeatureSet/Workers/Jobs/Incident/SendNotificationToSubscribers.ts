import RunCron from '../../Utils/Cron';
import { FileRoute } from 'Common/ServiceRoute';
import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import URL from 'Common/Types/API/URL';
import LIMIT_MAX, { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import ObjectID from 'Common/Types/ObjectID';
import SMS from 'Common/Types/SMS/SMS';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import DatabaseConfig from 'CommonServer/DatabaseConfig';
import IncidentService from 'CommonServer/Services/IncidentService';
import MailService from 'CommonServer/Services/MailService';
import ProjectCallSMSConfigService from 'CommonServer/Services/ProjectCallSMSConfigService';
import ProjectSMTPConfigService from 'CommonServer/Services/ProjectSmtpConfigService';
import SmsService from 'CommonServer/Services/SmsService';
import StatusPageResourceService from 'CommonServer/Services/StatusPageResourceService';
import StatusPageService from 'CommonServer/Services/StatusPageService';
import StatusPageSubscriberService from 'CommonServer/Services/StatusPageSubscriberService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import Markdown, { MarkdownContentType } from 'CommonServer/Types/Markdown';
import logger from 'CommonServer/Utils/Logger';
import Incident from 'Model/Models/Incident';
import Monitor from 'Model/Models/Monitor';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageResource from 'Model/Models/StatusPageResource';
import StatusPageSubscriber from 'Model/Models/StatusPageSubscriber';

RunCron(
    'Incident:SendNotificationToSubscribers',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.
        const incidents: Array<Incident> = await IncidentService.findBy({
            query: {
                isStatusPageSubscribersNotifiedOnIncidentCreated: false,
                shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
                createdAt: QueryHelper.lessThan(OneUptimeDate.getCurrentDate()),
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
                monitors: {
                    _id: true,
                },
                incidentSeverity: {
                    name: true,
                },
            },
        });

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        for (const incident of incidents) {
            if (!incident.monitors || incident.monitors.length === 0) {
                continue;
            }

            await IncidentService.updateOneById({
                id: incident.id!,
                data: {
                    isStatusPageSubscribersNotifiedOnIncidentCreated: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

            // get status page resources from monitors.

            const statusPageResources: Array<StatusPageResource> =
                await StatusPageResourceService.findBy({
                    query: {
                        monitorId: QueryHelper.any(
                            incident.monitors
                                .filter((m: Monitor) => {
                                    return m._id;
                                })
                                .map((m: Monitor) => {
                                    return new ObjectID(m._id!);
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
                        displayName: true,
                        statusPageId: true,
                    },
                });

            const statusPageToResources: Dictionary<Array<StatusPageResource>> =
                {};

            for (const resource of statusPageResources) {
                if (!resource.statusPageId) {
                    continue;
                }

                if (!statusPageToResources[resource.statusPageId?.toString()]) {
                    statusPageToResources[resource.statusPageId?.toString()] =
                        [];
                }

                statusPageToResources[resource.statusPageId?.toString()]?.push(
                    resource
                );
            }

            const statusPages: Array<StatusPage> =
                await StatusPageSubscriberService.getStatusPagesToSendNotification(
                    Object.keys(statusPageToResources).map((i: string) => {
                        return new ObjectID(i);
                    })
                );

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

                const resourcesAffectedString: string =
                    statusPageToResources[statuspage._id!]
                        ?.map((r: StatusPageResource) => {
                            return r.displayName;
                        })
                        .join(', ') || 'None';

                for (const subscriber of subscribers) {
                    if (!subscriber._id) {
                        continue;
                    }

                    const shouldNotifySubscriber: boolean =
                        StatusPageSubscriberService.shouldSendNotification({
                            subscriber: subscriber,
                            statusPageResources:
                                statusPageToResources[statuspage._id!] || [],
                            statusPage: statuspage,
                        });

                    if (!shouldNotifySubscriber) {
                        continue;
                    }

                    const unsubscribeUrl: string =
                        StatusPageSubscriberService.getUnsubscribeLink(
                            URL.fromString(statusPageURL),
                            subscriber.id!
                        ).toString();

                    if (subscriber.subscriberEmail) {
                        // send email here.

                        MailService.sendMail(
                            {
                                toEmail: subscriber.subscriberEmail,
                                templateType:
                                    EmailTemplateType.SubscriberIncidentCreated,
                                vars: {
                                    statusPageName: statusPageName,
                                    statusPageUrl: statusPageURL,
                                    logoUrl: statuspage.logoFileId
                                        ? new URL(httpProtocol, host)
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
                                    resourcesAffected: resourcesAffectedString,
                                    incidentSeverity:
                                        incident.incidentSeverity?.name ||
                                        ' - ',
                                    incidentTitle: incident.title || '',
                                    incidentDescription:
                                        await Markdown.convertToHTML(
                                            incident.description || '',
                                            MarkdownContentType.Email
                                        ),
                                    unsubscribeUrl: unsubscribeUrl,
                                },
                                subject: '[Incident] '+statusPageName,
                            },
                            {
                                mailServer:
                                    ProjectSMTPConfigService.toEmailServer(
                                        statuspage.smtpConfig
                                    ),
                                projectId: statuspage.projectId,
                            }
                        ).catch((err: Error) => {
                            logger.error(err);
                        });
                    }

                    if (subscriber.subscriberPhone) {
                        const sms: SMS = {
                            message: `
                            Incident - ${statusPageName}

                            Title: ${incident.title || ''}

                            Severity: ${
                                incident.incidentSeverity?.name || ' - '
                            } 

                            Resources Affected: ${resourcesAffectedString} 

                            To view this incident, visit ${statusPageURL}

                            To update notification preferences or unsubscribe, visit ${unsubscribeUrl}
                            `,
                            to: subscriber.subscriberPhone,
                        };

                        // send sms here.
                        SmsService.sendSms(sms, {
                            projectId: statuspage.projectId,
                            customTwilioConfig:
                                ProjectCallSMSConfigService.toTwilioConfig(
                                    statuspage.callSmsConfig
                                ),
                        }).catch((err: Error) => {
                            logger.error(err);
                        });
                    }
                }
            }
        }
    }
);

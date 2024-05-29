import DatabaseConfig from '../DatabaseConfig';
import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import ProjectSMTPConfigService from '../Services/ProjectSmtpConfigService';
import CreateBy from '../Types/Database/CreateBy';
import { OnCreate } from '../Types/Database/Hooks';
import QueryHelper from '../Types/Database/QueryHelper';
import logger from '../Utils/Logger';
import DatabaseService from './DatabaseService';
import MailService from './MailService';
import ProjectService from './ProjectService';
import StatusPageService from './StatusPageService';
import { FileRoute } from 'Common/ServiceRoute';
import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import URL from 'Common/Types/API/URL';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import LIMIT_MAX, { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageResource from 'Model/Models/StatusPageResource';
import Model from 'Model/Models/StatusPageSubscriber';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        data: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!data.data.statusPageId) {
            throw new BadDataException('Status Page ID is required.');
        }

        if (!data.data.projectId) {
            throw new BadDataException('Project ID is required.');
        }

        const projectId: ObjectID = data.data.projectId;

        let subscriber: Model | null = null;

        if (data.data.subscriberEmail) {
            subscriber = await this.findOneBy({
                query: {
                    statusPageId: data.data.statusPageId,
                    subscriberEmail: data.data.subscriberEmail,
                },
                select: {
                    _id: true,
                    isUnsubscribed: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });
        }

        if (data.data.subscriberPhone) {
            // check if this project has SMS enabled.

            const isSMSEnabled: boolean =
                await ProjectService.isSMSNotificationsEnabled(projectId);

            if (!isSMSEnabled) {
                throw new BadDataException(
                    'SMS notifications are not enabled for this project. Please enable SMS notifications in the Project Settings > Notifications Settings.'
                );
            }

            subscriber = await this.findOneBy({
                query: {
                    statusPageId: data.data.statusPageId,
                    subscriberPhone: data.data.subscriberPhone,
                },
                select: {
                    _id: true,
                    isUnsubscribed: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });
        }

        if (subscriber && !subscriber.isUnsubscribed) {
            throw new BadDataException(
                'You are already subscribed to this status page.'
            );
        }

        // if the user is unsubscribed, delete this record and it'll create a new one.
        if (subscriber) {
            await this.deleteOneBy({
                query: {
                    _id: subscriber?._id as string,
                },
                props: {
                    ignoreHooks: true,
                    isRoot: true,
                },
            });
        }

        const statuspages: Array<StatusPage> =
            await this.getStatusPagesToSendNotification([
                data.data.statusPageId,
            ]);

        const statuspage: StatusPage | undefined = statuspages.find(
            (statuspage: StatusPage) => {
                return (
                    statuspage._id?.toString() ===
                    data.data.statusPageId?.toString()
                );
            }
        );

        if (statuspage && !statuspage.allowSubscribersToChooseResources) {
            data.data.isSubscribedToAllResources = true;
        } else if (
            !data.data.statusPageResources ||
            data.data.statusPageResources.length === 0
        ) {
            if (!data.data.isSubscribedToAllResources) {
                throw new BadDataException('Select resources to subscribe to.');
            }
        }

        if (!statuspage || !statuspage.projectId) {
            throw new BadDataException('Status Page not found');
        }

        data.data.projectId = statuspage.projectId;

        return { createBy: data, carryForward: statuspage };
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (
            createdItem.statusPageId &&
            createdItem.subscriberEmail &&
            createdItem._id
        ) {
            // Call mail service and send an email.

            // get status page domain for this status page.
            // if the domain is not found, use the internal status page preview link.

            const statusPageURL: string =
                await StatusPageService.getStatusPageURL(
                    createdItem.statusPageId
                );

            const statusPageName: string =
                onCreate.carryForward.pageTitle ||
                onCreate.carryForward.name ||
                'Status Page';

            const host: Hostname = await DatabaseConfig.getHost();

            const httpProtocol: Protocol =
                await DatabaseConfig.getHttpProtocol();

            MailService.sendMail(
                {
                    toEmail: createdItem.subscriberEmail,
                    templateType: EmailTemplateType.SubscribedToStatusPage,
                    vars: {
                        statusPageName: statusPageName,
                        logoUrl: onCreate.carryForward.logoFileId
                            ? new URL(httpProtocol, host)
                                  .addRoute(FileRoute)
                                  .addRoute(
                                      '/image/' +
                                          onCreate.carryForward.logoFileId
                                  )
                                  .toString()
                            : '',
                        statusPageUrl: statusPageURL,
                        isPublicStatusPage: onCreate.carryForward
                            .isPublicStatusPage
                            ? 'true'
                            : 'false',
                        unsubscribeUrl: this.getUnsubscribeLink(
                            URL.fromString(statusPageURL),
                            createdItem.id!
                        ).toString(),
                    },
                    subject: 'You have been subscribed to ' + statusPageName,
                },
                {
                    projectId: createdItem.projectId,
                    mailServer: ProjectSMTPConfigService.toEmailServer(
                        onCreate.carryForward.smtpConfig
                    ),
                }
            ).catch((err: Error) => {
                logger.error(err);
            });
        }

        return createdItem;
    }

    public async getSubscribersByStatusPage(
        statusPageId: ObjectID,
        props: DatabaseCommonInteractionProps
    ): Promise<Array<Model>> {
        return await this.findBy({
            query: {
                statusPageId: statusPageId,
                isUnsubscribed: false,
            },
            select: {
                _id: true,
                subscriberEmail: true,
                subscriberPhone: true,
                subscriberWebhook: true,
                isSubscribedToAllResources: true,
                statusPageResources: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: props,
        });
    }

    public getUnsubscribeLink(
        statusPageUrl: URL,
        statusPageSubscriberId: ObjectID
    ): URL {
        return URL.fromString(statusPageUrl.toString()).addRoute(
            '/update-subscription/' + statusPageSubscriberId.toString()
        );
    }

    public shouldSendNotification(data: {
        subscriber: Model;
        statusPageResources: Array<StatusPageResource>;
        statusPage: StatusPage;
    }): boolean {
        if (data.subscriber.isUnsubscribed) {
            return false;
        }

        if (!data.statusPage.allowSubscribersToChooseResources) {
            return true;
        }

        if (data.subscriber.isSubscribedToAllResources) {
            return true;
        }

        const subscriberResourceIds: Array<string> =
            data.subscriber.statusPageResources?.map(
                (resource: StatusPageResource) => {
                    return resource.id?.toString() as string;
                }
            ) || [];

        for (const resource of data.statusPageResources) {
            if (
                subscriberResourceIds.includes(
                    resource.id?.toString() as string
                )
            ) {
                return true;
            }
        }

        return false;
    }

    public async getStatusPagesToSendNotification(
        statusPageIds: Array<ObjectID>
    ): Promise<Array<StatusPage>> {
        return await StatusPageService.findBy({
            query: {
                _id: QueryHelper.in(statusPageIds),
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
                projectId: true,
                isPublicStatusPage: true,
                logoFileId: true,
                allowSubscribersToChooseResources: true,
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
                callSmsConfig: {
                    _id: true,
                    twilioAccountSID: true,
                    twilioAuthToken: true,
                    twilioPhoneNumber: true,
                },
            },
        });
    }
}
export default new Service();

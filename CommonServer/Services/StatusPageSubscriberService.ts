import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPageSubscriber';
import DatabaseService from './DatabaseService';
import { OnCreate } from '../Types/Database/Hooks';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageService from './StatusPageService';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import { FileRoute } from 'Common/ServiceRoute';
import DatabaseConfig from '../DatabaseConfig';
import logger from '../Utils/Logger';
import StatusPage from 'Model/Models/StatusPage';
import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';

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

        if (data.data.subscriberEmail) {
            const subscriber: Model | null = await this.findOneBy({
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
        }

        const statuspage: StatusPage | null =
            await StatusPageService.findOneById({
                id: data.data.statusPageId,
                select: {
                    projectId: true,
                    pageTitle: true,
                    name: true,
                    isPublicStatusPage: true,
                    logoFileId: true,
                },
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

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
                        unsubscribeUrl: new URL(httpProtocol, host)
                            .addRoute(
                                '/api/status-page-subscriber/unsubscribe/' +
                                    createdItem._id.toString()
                            )
                            .toString(),
                    },
                    subject: 'You have been subscribed to ' + statusPageName,
                },
                {
                    projectId: createdItem.projectId,
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
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: props,
        });
    }
}
export default new Service();

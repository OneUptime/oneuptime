import type PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPageSubscriber';
import type { OnCreate } from './DatabaseService';
import DatabaseService from './DatabaseService';
import type CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageService from './StatusPageService';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import { Domain, FileRoute, HttpProtocol } from '../Config';
import logger from '../Utils/Logger';
import type StatusPage from 'Model/Models/StatusPage';
import type ObjectID from 'Common/Types/ObjectID';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

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

            await this.deleteOneBy({
                query: {
                    _id: subscriber?._id!,
                },
                props: {
                    ignoreHooks: true,
                    isRoot: true,
                },
            });
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
            // if the domain is not found, use the internal sttaus page preview link.

            const statusPageURL: string =
                await StatusPageService.getStatusPageURL(
                    createdItem.statusPageId
                );

            const statusPageName: string =
                onCreate.carryForward.pageTitle ||
                onCreate.carryForward.name ||
                'Status Page';

            MailService.sendMail({
                toEmail: createdItem.subscriberEmail,
                templateType: EmailTemplateType.SubscribedToStatusPage,
                vars: {
                    statusPageName: statusPageName,
                    logoUrl: onCreate.carryForward.logoFileId
                        ? new URL(HttpProtocol, Domain)
                              .addRoute(FileRoute)
                              .addRoute(
                                  '/image/' + onCreate.carryForward.logoFileId
                              )
                              .toString()
                        : '',
                    statusPageUrl: statusPageURL,
                    isPublicStatusPage: onCreate.carryForward.isPublicStatusPage
                        ? 'true'
                        : 'false',
                    unsubscribeUrl: new URL(HttpProtocol, Domain)
                        .addRoute(
                            '/api/status-page-subscriber/unsubscribe/' +
                                createdItem._id.toString()
                        )
                        .toString(),
                },
                subject: 'You have been subscribed to ' + statusPageName,
            }).catch((err: Error) => {
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
            limit: LIMIT_PER_PROJECT,
            props: props,
        });
    }
}
export default new Service();

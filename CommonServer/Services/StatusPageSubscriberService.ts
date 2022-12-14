import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPageSubscriber';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageService from './StatusPageService';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import StatusPageDomainService from './StatusPageDomainService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import URL from 'Common/Types/API/URL';
import { Domain, HttpProtocol } from '../Config';
import logger from '../Utils/Logger';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        data: CreateBy<Model>
    ): Promise<OnCreate<Model>> {

        if (!data.data.statusPageId) {
            throw new BadDataException("Status Page ID is required.")
        }

        const statuspage = await StatusPageService.findOneById({
            id: data.data.statusPageId,
            select: {
                projectId: true,
                pageTitle: true,
                name: true,
                isPublicStatusPage: true
            },
            props: {
                isRoot: true,
                ignoreHooks: true,
            }
        });

        if (!statuspage || !statuspage.projectId) {
            throw new BadDataException("Status Page not found");
        }

        data.data.projectId = statuspage.projectId;

        return { createBy: data, carryForward: statuspage };

    }


    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {

        if (createdItem.statusPageId && createdItem.subscriberEmail && createdItem._id) {
            // Call mail service and send an email. 


            // get status page domain for this status page.
            // if the domain is not found, use the internal sttaus page preview link.

            const domains = await StatusPageDomainService.findBy({
                query: {
                    statusPageId: createdItem.statusPageId,
                    isSslProvisioned: true
                },
                select: {
                    fullDomain: true
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                }
            });


            let statusPageURL: string = domains.map((d) => d.fullDomain).join(", ");

            if (domains.length === 0) {
                // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
                statusPageURL = new URL(HttpProtocol, Domain).addRoute("/status-page/" + createdItem.statusPageId.toString()).toString();
            }

            const statusPageName: string = onCreate.carryForward.pageTitle || onCreate.carryForward.name || 'Status Page';

            MailService.sendMail({
                toEmail: createdItem.subscriberEmail,
                templateType: EmailTemplateType.SubscribedToStatusPage,
                vars: {
                    statusPageName: statusPageName,
                    statusPageUrl: statusPageURL,
                    isPublicStatusPage: onCreate.carryForward.isPublicStatusPage,
                    unsubscribeUrl: new URL(HttpProtocol, Domain).addRoute("/api/status-page-subscriber/unsubscribe/" + createdItem._id.toString()).toString() 
                },
                subject: 'You have been subscribed to ' + statusPageName,
            }).catch((err: Error) => {
                logger.error(err);
            });
        }

        return createdItem;
    }
}
export default new Service();

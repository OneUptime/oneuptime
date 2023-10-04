import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPagePrivateUser';
import DatabaseService from './DatabaseService';
import { OnCreate } from '../Types/Database/Hooks';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageService from './StatusPageService';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import URL from 'Common/Types/API/URL';
import logger from '../Utils/Logger';
import { FileRoute } from 'Common/ServiceRoute';
import DatabaseConfig from '../DatabaseConfig';
import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import CreateBy from '../Types/Database/CreateBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        // check if this user is already invited.
        if (createBy.data.statusPageId && createBy.data.email) {
            const statusPageUser: Model | null = await this.findOneBy({
                query: {
                    email: createBy.data.email,
                    statusPageId: createBy.data.statusPageId,
                },
                props: {
                    isRoot: true,
                },
                select: {
                    _id: true,
                },
            });

            if (statusPageUser) {
                throw new BadDataException(
                    'This user is already invited to this status page.'
                );
            }
        }

        return {
            createBy: createBy,
            carryForward: null,
        };
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        // send email to the user.
        const token: string = ObjectID.generate().toString();
        await this.updateOneById({
            id: createdItem.id!,
            data: {
                resetPasswordToken: token,
                resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
            },
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        if (createdItem.isSsoUser) {
            return createdItem;
        }

        const statusPage: StatusPage | null =
            await StatusPageService.findOneById({
                id: createdItem.statusPageId!,
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
                select: {
                    _id: true,
                    name: true,
                    pageTitle: true,
                    logoFileId: true,
                    projectId: true,
                },
            });

        if (!statusPage) {
            throw new BadDataException('Status Page not found');
        }

        const statusPageName: string | undefined =
            statusPage.pageTitle || statusPage.name;

        const statusPageURL: string = await StatusPageService.getStatusPageURL(
            statusPage.id!
        );

        const host: Hostname = await DatabaseConfig.getHost();

        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        MailService.sendMail(
            {
                toEmail: createdItem.email!,
                subject: 'You have been invited to ' + statusPageName,
                templateType: EmailTemplateType.StatusPageWelcomeEmail,
                vars: {
                    statusPageName: statusPageName!,
                    statusPageUrl: statusPageURL,
                    logoUrl: statusPage.logoFileId
                        ? new URL(httpProtocol, host)
                              .addRoute(FileRoute)
                              .addRoute('/image/' + statusPage.logoFileId)
                              .toString()
                        : '',
                    homeURL: statusPageURL,
                    tokenVerifyUrl: URL.fromString(statusPageURL)
                        .addRoute('/reset-password/' + token)
                        .toString(),
                },
            },
            {
                projectId: statusPage.projectId,
            }
        ).catch((err: Error) => {
            logger.error(err);
        });

        return createdItem;
    }
}
export default new Service();

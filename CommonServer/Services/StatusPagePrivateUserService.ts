import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPagePrivateUser';
import DatabaseService, { OnCreate } from './DatabaseService';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageService from './StatusPageService';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import OneUptimeDate from 'Common/Types/Date';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import URL from 'Common/Types/API/URL';
import logger from '../Utils/Logger';
import { Domain, FileRoute, HttpProtocol } from '../Config';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
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

        MailService.sendMail(
            {
                toEmail: createdItem.email!,
                subject: 'You have been invited to ' + statusPageName,
                templateType: EmailTemplateType.StatusPageWelcomeEmail,
                vars: {
                    statusPageName: statusPageName!,
                    statusPageUrl: statusPageURL,
                    logoUrl: statusPage.logoFileId
                        ? new URL(HttpProtocol, Domain)
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

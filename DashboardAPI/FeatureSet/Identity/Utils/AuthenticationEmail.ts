import { AccountsRoute } from 'Common/ServiceRoute';

import EmailVerificationTokenService from 'CommonServer/Services/EmailVerificationTokenService';

import ObjectID from 'Common/Types/ObjectID';
import EmailVerificationToken from 'Model/Models/EmailVerificationToken';

import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import URL from 'Common/Types/API/URL';

import OneUptimeDate from 'Common/Types/Date';

import Route from 'Common/Types/API/Route';
import logger from 'CommonServer/Utils/Logger';
import User from 'Model/Models/User';
import Hostname from 'Common/Types/API/Hostname';
import Protocol from 'Common/Types/API/Protocol';
import Email from 'Common/Types/Email';
import DatabaseConfig from 'CommonServer/DatabaseConfig';

export default class AuthenticationEmail {
    public static async sendVerificationEmail(user: User): Promise<void> {
        const generatedToken: ObjectID = ObjectID.generate();

        const emailVerificationToken: EmailVerificationToken =
            new EmailVerificationToken();
        emailVerificationToken.userId = user?.id as ObjectID;
        emailVerificationToken.email = user?.email as Email;
        emailVerificationToken.token = generatedToken;
        emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

        await EmailVerificationTokenService.create({
            data: emailVerificationToken,
            props: {
                isRoot: true,
            },
        });

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        MailService.sendMail({
            toEmail: user.email!,
            subject: 'Please verify email.',
            templateType: EmailTemplateType.SignupWelcomeEmail,
            vars: {
                name: user.name?.toString() || '',
                tokenVerifyUrl: new URL(
                    httpProtocol,
                    host,
                    new Route(AccountsRoute.toString()).addRoute(
                        '/verify-email/' + generatedToken.toString()
                    )
                ).toString(),
                homeUrl: new URL(httpProtocol, host).toString(),
            },
        }).catch((err: Error) => {
            logger.error(err);
        });
    }
}

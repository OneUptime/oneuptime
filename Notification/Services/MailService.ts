import nodemailer, { Transporter } from 'nodemailer';
import Handlebars from 'handlebars';
import fsp from 'fs/promises';
import EmailMessage from 'Common/Types/Email/EmailMessage';
import Path from 'path';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import EmailServer from 'Common/Types/Email/EmailServer';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import OneUptimeDate from 'Common/Types/Date';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import Hostname from 'Common/Types/API/Hostname';
import Port from 'Common/Types/Port';
import { JSONObject } from 'Common/Types/JSON';
import logger from 'CommonServer/Utils/Logger';
import { IsDevelopment } from 'CommonServer/Config';
import { SendGridApiKey } from '../Config';
import SendgridMail, { MailDataRequired } from '@sendgrid/mail';
import ObjectID from 'Common/Types/ObjectID';
import UserOnCallLogTimelineService from 'CommonServer/Services/UserOnCallLogTimelineService';
import UserNotificationStatus from 'Common/Types/UserNotification/UserNotificationStatus';
import EmailLog from 'Model/Models/EmailLog';
import MailStatus from 'Common/Types/Mail/MailStatus';
import EmailLogService from 'CommonServer/Services/EmailLogService';

export default class MailService {
    public static isSMTPConfigValid(obj: JSONObject): boolean {
        if (!obj['SMTP_USERNAME']) {
            logger.error('SMTP_USERNAME env var not found');
            return false;
        }

        if (!obj['SMTP_EMAIL']) {
            logger.error('SMTP_EMAIL env var not found');
            return false;
        }

        if (!Email.isValid(obj['SMTP_EMAIL'].toString())) {
            logger.error(
                'SMTP_EMAIL env var ' +
                    obj['SMTP_EMAIL'] +
                    ' is not a valid email'
            );
            return false;
        }

        if (!obj['SMTP_FROM_NAME']) {
            logger.error('SMTP_FROM_NAME env var not found');
            return false;
        }

        if (!obj['SMTP_IS_SECURE']) {
            logger.error('SMTP_IS_SECURE env var not found');
            return false;
        }

        if (!obj['SMTP_PORT']) {
            logger.error('SMTP_PORT env var not found');
            return false;
        }

        if (!Port.isValid(obj['SMTP_PORT'].toString())) {
            logger.error(
                'SMTP_PORT ' + obj['SMTP_HOST'] + ' env var not valid'
            );
            return false;
        }

        if (!obj['SMTP_HOST']) {
            logger.error('SMTP_HOST env var not found');
            return false;
        }

        if (!Hostname.isValid(obj['SMTP_HOST'].toString())) {
            logger.error(
                'SMTP_HOST env var ' + obj['SMTP_HOST'] + '  not valid'
            );
            return false;
        }

        if (!obj['SMTP_PASSWORD']) {
            logger.error('SMTP_PASSWORD env var not found');
            return false;
        }

        return true;
    }

    public static getEmailServer(obj: JSONObject): EmailServer {
        if (!this.isSMTPConfigValid(obj)) {
            throw new BadDataException('SMTP Config is not valid');
        }

        return {
            id:
                obj && obj['SMTP_ID']
                    ? new ObjectID(obj['SMTP_ID'].toString())
                    : undefined,
            username: obj['SMTP_USERNAME']?.toString()!,
            password: obj['SMTP_PASSWORD']?.toString()!,
            host: new Hostname(obj['SMTP_HOST']?.toString()!),
            port: new Port(obj['SMTP_PORT']?.toString()!),
            fromEmail: new Email(obj['SMTP_EMAIL']?.toString()!),
            fromName: obj['SMTP_FROM_NAME']?.toString()!,
            secure:
                obj['SMTP_IS_SECURE'] === 'true' ||
                obj['SMTP_IS_SECURE'] === true,
        };
    }

    public static getGlobalFromEmail(): Email {
        const emailServer: EmailServer = this.getGlobalSmtpSettings();
        return emailServer.fromEmail;
    }

    private static getGlobalSmtpSettings(): EmailServer {
        return this.getEmailServer(process.env);
    }

    private static async updateUserNotificationLogTimelineAsSent(
        timelineId: ObjectID
    ): Promise<void> {
        if (timelineId) {
            await UserOnCallLogTimelineService.updateOneById({
                data: {
                    status: UserNotificationStatus.Sent,
                    statusMessage:
                        'Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.',
                },
                id: timelineId,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    private static async compileEmailBody(
        emailTemplateType: EmailTemplateType,
        vars: Dictionary<string>
    ): Promise<string> {
        // Localcache templates, so we don't read from disk all the time.

        let templateData: string;
        if (
            LocalCache.hasValue('email-templates', emailTemplateType) &&
            !IsDevelopment
        ) {
            templateData = LocalCache.getString(
                'email-templates',
                emailTemplateType
            );
        } else {
            templateData = await fsp.readFile(
                Path.resolve(
                    process.cwd(),
                    'Templates',
                    `${emailTemplateType}`
                ),
                { encoding: 'utf8', flag: 'r' }
            );
            LocalCache.setString(
                'email-templates',
                emailTemplateType,
                templateData as string
            );
        }

        const emailBody: Handlebars.TemplateDelegate =
            Handlebars.compile(templateData);
        return emailBody(vars).toString();
    }

    private static compileText(
        subject: string,
        vars: Dictionary<string>
    ): string {
        const subjectHandlebars: Handlebars.TemplateDelegate =
            Handlebars.compile(subject);
        return subjectHandlebars(vars).toString();
    }

    private static createMailer(emailServer: EmailServer): Transporter {
        const privateMailer: Transporter = nodemailer.createTransport({
            host: emailServer.host.toString(),
            port: emailServer.port.toNumber(),
            secure: emailServer.secure,
            auth: {
                user: emailServer.username,
                pass: emailServer.password,
            },
        });

        return privateMailer;
    }

    private static async transportMail(
        mail: EmailMessage,
        options: {
            emailServer: EmailServer;
            projectId?: ObjectID | undefined;
        }
    ): Promise<void> {
        const mailer: Transporter = this.createMailer(options.emailServer);
        await mailer.sendMail({
            from: `${options.emailServer.fromName.toString()} <${options.emailServer.fromEmail.toString()}>`,
            to: mail.toEmail.toString(),
            subject: mail.subject,
            html: mail.body,
        });
    }

    public static async send(
        mail: EmailMessage,
        options?:
            | {
                  projectId?: ObjectID | undefined;
                  emailServer?: EmailServer | undefined;
                  userOnCallLogTimelineId?: ObjectID | undefined;
              }
            | undefined
    ): Promise<void> {
        let emailLog: EmailLog | undefined = undefined;

        if (options && options.projectId) {
            emailLog = new EmailLog();
            emailLog.projectId = options.projectId;
            emailLog.toEmail = mail.toEmail;
            emailLog.subject = mail.subject;

            if (options.emailServer?.id) {
                emailLog.projectSmtpConfigId = options.emailServer?.id;
            }
        }

        // default vars.
        if (!mail.vars) {
            mail.vars = {};
        }

        if (!mail.vars['year']) {
            mail.vars['year'] = OneUptimeDate.getCurrentYear().toString();
        }

        mail.body = mail.templateType
            ? await this.compileEmailBody(mail.templateType, mail.vars)
            : this.compileText(mail.body || '', mail.vars);
        mail.subject = this.compileText(mail.subject, mail.vars);
        try {
            if ((!options || !options.emailServer) && SendGridApiKey) {
                SendgridMail.setApiKey(SendGridApiKey);

                const msg: MailDataRequired = {
                    to: mail.toEmail.toString(),
                    from: this.getGlobalFromEmail().toString(),
                    subject: mail.subject,
                    html: mail.body,
                };

                if (emailLog) {
                    emailLog.fromEmail = this.getGlobalFromEmail();
                }

                await SendgridMail.send(msg);

                if (emailLog) {
                    emailLog.status = MailStatus.Success;
                    emailLog.statusMessage =
                        'Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.';

                    await EmailLogService.create({
                        data: emailLog,
                        props: {
                            isRoot: true,
                        },
                    });
                }

                if (options?.userOnCallLogTimelineId) {
                    await this.updateUserNotificationLogTimelineAsSent(
                        options?.userOnCallLogTimelineId
                    );
                }
                return;
            }

            if (!options || !options.emailServer) {
                if (!options) {
                    options = {};
                }
                options.emailServer = this.getGlobalSmtpSettings();
            }

            if (options.emailServer && emailLog) {
                emailLog.fromEmail = options.emailServer.fromEmail;
            }

            await this.transportMail(mail, {
                emailServer: options.emailServer,
                projectId: options.projectId,
            });

            if (emailLog) {
                emailLog.status = MailStatus.Success;
                emailLog.statusMessage =
                    'Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.';

                await EmailLogService.create({
                    data: emailLog,
                    props: {
                        isRoot: true,
                    },
                });
            }

            if (options?.userOnCallLogTimelineId) {
                await this.updateUserNotificationLogTimelineAsSent(
                    options?.userOnCallLogTimelineId
                );
            }
        } catch (err: any) {
            let message: string | undefined = err.message;

            if (message === 'Unexpected socket close') {
                message =
                    'Email failed to send. Unexpected socket close. This could mean various things, such as your SMTP server is unreachble, username and password is incorrect, your SMTP server is not configured to accept connections from this IP address, or TLS/SSL is not configured correctly, or ports are not configured correctly.';
            }

            if (!message) {
                message = 'Email failed to send. Unknown error.';
            }

            logger.error(err);
            if (options?.userOnCallLogTimelineId) {
                await UserOnCallLogTimelineService.updateOneById({
                    data: {
                        status: UserNotificationStatus.Error,
                        statusMessage: message,
                    },
                    id: options.userOnCallLogTimelineId,
                    props: {
                        isRoot: true,
                    },
                });
            }

            if (emailLog) {
                emailLog.status = MailStatus.Error;
                emailLog.statusMessage = message;

                await EmailLogService.create({
                    data: emailLog,
                    props: {
                        isRoot: true,
                    },
                });
            }

            throw err;
        }
    }
}

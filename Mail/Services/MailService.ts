import nodemailer, { Transporter } from 'nodemailer';
import ObjectID from 'Common/Types/ObjectID';
import hbs from 'nodemailer-express-handlebars';
import Handlebars from 'handlebars';
import fsp from 'fs/promises';
import Mail from '../Types/Mail';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';
import EmailSmtpService from 'CommonServer/Services/SmtpService';
import EmailStatusService from 'CommonServer/Services/EmailStatusService';
import Path from 'path';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import * as Config from '../Config';
import { MailServer } from '../Types/MailServer';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import OneUptimeDate from 'Common/Types/Date';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import TaskStatus from 'Common/Types/TaskStatus';
import Hostname from 'Common/Types/API/Hostname';
import Exception from 'Common/Types/Exception/Exception';

export default class MailService {
    private static async getGlobalSmtpSettings(): Promise<MailServer> {
        const document: $TSFixMe = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: ['value'],
            populate: [],
            sort: [],
        });

        if (
            document &&
            document.get('value') &&
            !document.get('value').internalSmtp
        ) {
            return {
                username: document.get('value').email,
                password: document.get('value').password,
                host: document.get('value')['smtp-server'],
                port: document.get('value')['smtp-port'],
                fromEmail: document.get('value')['from'],
                fromName: document.get('value')['from-name'] || 'OneUptime',
                secure: document.get('value')['smtp-secure'],
                enabled: document.get('value')['email-enabled'],
            };
        } else if (
            document &&
            document.get('value') &&
            document.get('value').internalSmtp &&
            document.get('value').customSmtp
        ) {
            return {
                username: Config.InternalSmtpUser,
                password: Config.InternalSmtpPassword,
                host: Config.InternalSmtpHost,
                port: Config.InternalSmtpPort,
                fromEmail: Config.InternalSmtpFromEmail,
                fromName: Config.InternalSmtpFromName,
                enabled: document.get('value')['email-enabled'],
                secure: Config.InternalSmtpSecure,
                backupMailServer: {
                    username: document.get('value').email,
                    password: document.get('value').password,
                    host: document.get('value')['smtp-server'],
                    port: document.get('value')['smtp-port'],
                    fromEmail: document.get('value')['from'],
                    fromName: document.get('value')['from-name'] || 'OneUptime',
                    secure: document.get('value')['smtp-secure'],
                    enabled: document.get('value')['email-enabled'],
                },
            };
        } else if (
            document &&
            document.get('value') &&
            document.get('value').internalSmtp
        ) {
            return {
                username: Config.InternalSmtpUser,
                password: Config.InternalSmtpPassword,
                host: Config.InternalSmtpHost,
                port: Config.InternalSmtpPort,
                fromEmail: Config.InternalSmtpFromEmail,
                fromName: Config.InternalSmtpFromName,
                enabled: document.get('value')['email-enabled'],
                secure: Config.InternalSmtpSecure,
            };
        }

        throw new BadDataException('No Global Settings for Email SMTP found');
    }

    private static async getProjectSmtpSettings(
        projectId: ObjectID
    ): Promise<MailServer> {
        const select: $TSFixMe = [
            'user',
            'pass',
            'host',
            'port',
            'from',
            'name',
            'secure',
        ];

        const projectSmtp: $TSFixMe = await EmailSmtpService.findOneBy({
            query: { projectId, enabled: true },
            select,
            populate: [],
            sort: [],
        });

        if (projectSmtp) {
            return {
                username: projectSmtp.get('user'),
                password: projectSmtp.get('pass'),
                host: projectSmtp.get('host'),
                port: projectSmtp.get('port'),
                fromName: projectSmtp.get('name') || 'OneUptime',
                fromEmail: projectSmtp.get('from'),
                secure: projectSmtp.get('secure'),
                enabled: true,
            };
        } else {
            return await this.getGlobalSmtpSettings();
        }
    }

    private static async compileEmailBody(
        emailTemplateType: EmailTemplateType,
        vars: Dictionary<string>
    ): Promise<string> {
        // Localcache templates, so we dont read from disk all the time.

        let templateData;
        if (LocalCache.hasValue(emailTemplateType)) {
            templateData = LocalCache.get(emailTemplateType);
        } else {
            templateData = await fsp.readFile(
                Path.resolve(
                    process.cwd(),
                    'Templates',
                    `${emailTemplateType}.hbs`
                ),
                { encoding: 'utf8', flag: 'r' }
            );
            LocalCache.set(emailTemplateType, templateData);
        }

        const emailBody: $TSFixMe = Handlebars.compile(templateData);
        return emailBody(vars).toString();
    }

    private static compileSubject(
        subject: string,
        vars: Dictionary<string>
    ): string {
        const subjectHandlebars: $TSFixMe = Handlebars.compile(subject);
        return subjectHandlebars(vars).toString();
    }

    private static createMailer(mailServer: MailServer): Transporter {
        const helpers: $TSFixMe = {
            year: OneUptimeDate.getCurrentYear(),
        };

        const options: $TSFixMe = {
            viewEngine: {
                extname: '.hbs',
                layoutsDir: 'Templates',
                defaultLayout: 'template',
                partialsDir: 'Templates/Partials/',
                helpers,
            },
            viewPath: 'Templates/Partials/',
            extName: '.hbs',
        };

        let privateMailer;

        privateMailer = nodemailer.createTransport({
            host: mailServer.host.toString(),
            port: mailServer.port.toNumber(),
            secure: mailServer.secure,
            auth: {
                user: mailServer.username,
                pass: mailServer.password,
            },
        });

        privateMailer.use('compile', hbs(options));

        return privateMailer;
    }

    private static async createEmailStatus(data: {
        fromEmail?: Email;
        fromName?: string;
        toEmail: Email;
        subject: string;
        body?: string;
        templateType?: EmailTemplateType;
        status: TaskStatus;
        smtpHost?: Hostname;
        projectId?: ObjectID;
        errorDescription?: string;
    }): Promise<void> {
        await EmailStatusService.create({
            data: {
                fromEmail: data.fromEmail?.toString() || null,
                fromName: data.fromName || null,
                toEmail: data.toEmail.toString(),
                subject: data.subject,
                body: data.body || null,
                templateType: data.templateType || null,
                status: data.status,
                smtpHost: data.smtpHost?.toString() || null,
                projectId: data.projectId || null,
                errorDescription: data.errorDescription || null,
            },
        });
    }

    private static async transportMail(
        mail: Mail,
        mailServer: MailServer
    ): Promise<void> {
        const mailer: Transporter = this.createMailer(mailServer);

        try {
            await mailer.sendMail(mail);

            await this.createEmailStatus({
                fromEmail: mailServer.fromEmail,
                fromName: mailServer.fromName,
                smtpHost: mailServer.host,
                toEmail: mail.toEmail,
                subject: mail.subject,
                templateType: mail.templateType,
                body: mail.body,
                status: TaskStatus.SUCCESS,
            });
        } catch (error) {
            if (mailServer.backupMailServer) {
                return await this.transportMail(
                    mail,
                    mailServer.backupMailServer
                );
            }

            const exception: $TSFixMe = error as Exception;

            await this.createEmailStatus({
                fromEmail: mailServer.fromEmail,
                fromName: mailServer.fromName,
                smtpHost: mailServer.host,
                toEmail: mail.toEmail,
                subject: mail.subject,
                templateType: mail.templateType,
                body: mail.body,
                status: TaskStatus.ERROR,
                errorDescription: exception.message,
            });
        }
    }

    public static async send(
        mail: Mail,
        projectId?: ObjectID,
        forceSendFromGlobalMailServer?: boolean
    ): Promise<void> {
        let mailServer: MailServer | null = null;

        if (forceSendFromGlobalMailServer) {
            mailServer = await this.getGlobalSmtpSettings();
        }

        if (projectId && !forceSendFromGlobalMailServer) {
            mailServer = await this.getProjectSmtpSettings(projectId);
        }

        if (!mailServer) {
            await this.createEmailStatus({
                toEmail: mail.toEmail,
                subject: mail.subject,
                templateType: mail.templateType,
                status: TaskStatus.ERROR,
                errorDescription: 'SMTP settings not found',
            });

            throw new BadDataException('SMTP settings not found');
        }

        mail.body = await this.compileEmailBody(mail.templateType, mail.vars);
        mail.subject = this.compileSubject(mail.subject, mail.vars);

        try {
            await this.transportMail(mail, mailServer);
        } catch (error) {
            if (mailServer.backupMailServer) {
            }
        }
    }
}

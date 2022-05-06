import nodemailer, { Transporter } from 'nodemailer';
import ObjectID from 'Common/Types/ObjectID';
import hbs from 'nodemailer-express-handlebars';
import Handlebars from 'handlebars';
import fsp from 'fs/promises';
import Mail from '../Types/Mail';
import Services from 'CommonServer/Services/Index';
import GlobalConfigServiceClass from 'CommonServer/Services/GlobalConfigService';
import ProjectSmtpServiceClass from 'CommonServer/Services/ProjectSmtpConfigService';
import EmailLogServiceClass from 'CommonServer/Services/EmailLogService';
import Path from 'path';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import * as Config from '../Config';
import { MailServer } from '../Types/MailServer';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import OneUptimeDate from 'Common/Types/Date';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import OperationResult from 'Common/Types/Operation/OperationResult';
import Hostname from 'Common/Types/API/Hostname';
import Exception from 'Common/Types/Exception/Exception';
import GlobalConfig from 'Common/Models/GlobalConfig';
import Port from 'Common/Types/Port';
import ProjectSmtpConfig from 'Common/Models/ProjectSmtpConfig';
import EmailLog from 'Common/Models/EmailLog';
import Project from 'Common/Models/Project';

const GlobalConfigService: GlobalConfigServiceClass =
    Services.GlobalConfigService;
const EmailLogService: EmailLogServiceClass = Services.EmailLogService;
const ProjectSmtpConfigService: ProjectSmtpServiceClass =
    Services.ProjectSmtpConfigService;

export default class MailService {
    private static async getGlobalSmtpSettings(): Promise<MailServer> {
        const document: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
                query: {
                    name: 'smtp',
                },
                select: {
                    value: true,
                },
            });

        if (document && document.value && !document.value['internalSmtp']) {
            return {
                username: document.value['email'] as string,
                password: document.value['password'] as string,
                host: new Hostname(document.value['smtp-server'] as string),
                port: new Port(document.value['smtp-port'] as string),
                fromEmail: new Email(document.value['from'] as string),
                fromName:
                    (document.value['from-name'] as string) || 'OneUptime',
                secure: Boolean(document.value['smtp-secure']),
                enabled: Boolean(document.value['email-enabled']),
            };
        } else if (
            document &&
            document.value &&
            document.value['internalSmtp'] &&
            document.value['customSmtp']
        ) {
            return {
                username: Config.InternalSmtpUser,
                password: Config.InternalSmtpPassword,
                host: Config.InternalSmtpHost,
                port: Config.InternalSmtpPort,
                fromEmail: Config.InternalSmtpFromEmail,
                fromName: Config.InternalSmtpFromName,
                enabled: Boolean(document.value['email-enabled']),
                secure: Config.InternalSmtpSecure,
                backupMailServer: {
                    username: document.value['email'] as string,
                    password: document.value['password'] as string,
                    host: new Hostname(document.value['smtp-server'] as string),
                    port: new Port(document.value['smtp-port'] as string),
                    fromEmail: new Email(document.value['from'] as string),
                    fromName:
                        (document.value['from-name'] as string) || 'OneUptime',
                    secure: Boolean(document.value['smtp-secure']),
                    enabled: Boolean(document.value['email-enabled']),
                },
            };
        } else if (
            document &&
            document.value &&
            document.value['internalSmtp']
        ) {
            return {
                username: Config.InternalSmtpUser,
                password: Config.InternalSmtpPassword,
                host: Config.InternalSmtpHost,
                port: Config.InternalSmtpPort,
                fromEmail: Config.InternalSmtpFromEmail,
                fromName: Config.InternalSmtpFromName,
                enabled: Boolean(document.value['email-enabled']),
                secure: Config.InternalSmtpSecure,
            };
        }

        throw new BadDataException('No Global Settings for Email SMTP found');
    }

    private static async getProjectSmtpSettings(
        projectId: ObjectID
    ): Promise<MailServer> {
        const projectSmtp: ProjectSmtpConfig | null =
            await ProjectSmtpConfigService.findOneBy({
                query: {
                    project: new Project(projectId),
                    enabled: true,
                },
                select: {
                    useranme: true,
                    password: true,
                    host: true,
                    port: true,
                    fromName: true,
                    fromEmail: true,
                    secure: true,
                },
            });

        if (projectSmtp) {
            return {
                username: projectSmtp.useranme,
                password: projectSmtp.password,
                host: projectSmtp.host,
                port: projectSmtp.port,
                fromName: projectSmtp.fromName || 'OneUptime',
                fromEmail: projectSmtp.fromEmail,
                secure: projectSmtp.secure,
                enabled: true,
            };
        }
        return await this.getGlobalSmtpSettings();
    }

    private static async compileEmailBody(
        emailTemplateType: EmailTemplateType,
        vars: Dictionary<string>
    ): Promise<string> {
        // Localcache templates, so we dont read from disk all the time.

        let templateData: string;
        if (LocalCache.hasValue('email-templates', emailTemplateType)) {
            templateData = LocalCache.getString(
                'email-templates',
                emailTemplateType
            );
        } else {
            templateData = await fsp.readFile(
                Path.resolve(
                    process.cwd(),
                    'Templates',
                    `${emailTemplateType}.hbs`
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

    private static compileSubject(
        subject: string,
        vars: Dictionary<string>
    ): string {
        const subjectHandlebars: Handlebars.TemplateDelegate =
            Handlebars.compile(subject);
        return subjectHandlebars(vars).toString();
    }

    private static createMailer(mailServer: MailServer): Transporter {
        const helpers: Dictionary<string> = {
            year: OneUptimeDate.getCurrentYear().toString(),
        };

        const options: hbs.NodemailerExpressHandlebarsOptions = {
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

        const privateMailer: Transporter = nodemailer.createTransport({
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
        status: OperationResult;
        smtpHost?: Hostname;
        projectId?: ObjectID;
        errorDescription?: string;
    }): Promise<void> {
        const log: EmailLog = new EmailLog();
        if (data.fromEmail) {
            log.fromEmail = data.fromEmail;
        }

        if (data.fromName) {
            log.fromName = data.fromName;
        }

        log.toEmail = data.toEmail;
        log.subject = data.subject;

        if (data.body) {
            log.body = data.body;
        }

        if (data.templateType) {
            log.templateType = data.templateType;
        }

        log.status = data.status;
        if (data.smtpHost) {
            log.smtpHost = data.smtpHost;
        }

        if (data.errorDescription) {
            log.errorDescription = data.errorDescription;
        }

        if (data.projectId) {
            log.project = new Project(data.projectId);
        }

        await EmailLogService.create({ data: log });
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
                status: OperationResult.Success,
            });
        } catch (error) {
            if (mailServer.backupMailServer) {
                return await this.transportMail(
                    mail,
                    mailServer.backupMailServer
                );
            }

            const exception: Exception = error as Exception;

            await this.createEmailStatus({
                fromEmail: mailServer.fromEmail,
                fromName: mailServer.fromName,
                smtpHost: mailServer.host,
                toEmail: mail.toEmail,
                subject: mail.subject,
                templateType: mail.templateType,
                body: mail.body,
                status: OperationResult.Error,
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
                status: OperationResult.Error,
                errorDescription: 'SMTP settings not found',
            });

            throw new BadDataException('SMTP settings not found');
        }

        mail.body = await this.compileEmailBody(mail.templateType, mail.vars);
        mail.subject = this.compileSubject(mail.subject, mail.vars);

        await this.transportMail(mail, mailServer);
    }
}

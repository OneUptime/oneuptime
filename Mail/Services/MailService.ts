import nodemailer, { Transporter } from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import Handlebars from 'handlebars';
import fsp from 'fs/promises';
import Mail from 'Common/Types/Mail/Mail';
import Path from 'path';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MailServer from 'Common/Types/Mail/MailServer';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import OneUptimeDate from 'Common/Types/Date';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import Dictionary from 'Common/Types/Dictionary';
import Hostname from 'Common/Types/API/Hostname';
import Port from 'Common/Types/Port';
import { JSONObject } from 'Common/Types/JSON';
import logger from 'CommonServer/Utils/Logger';

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
            logger.error('SMTP_EMAIL env var ' + obj['SMTP_EMAIL'] + ' is not a valid email');
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
            logger.error('SMTP_PORT ' + obj['SMTP_HOST'] + ' env var not valid');
            return false; 
        }

        if (!obj['SMTP_HOST']) {
            logger.error('SMTP_HOST env var not found');
            return false; 
        }

        if (!Hostname.isValid(obj['SMTP_HOST'].toString())) {
            logger.error('SMTP_HOST env var ' + obj['SMTP_HOST'] + '  not valid');
            return false; 
        }

        if (!obj['SMTP_PASSWORD']) {
            logger.error('SMTP_PASSWORD env var not found');
            return false; 
        }

        return true; 
    }

    public static getMailServer(obj : JSONObject): MailServer { 
        if (!this.isSMTPConfigValid(obj)) {
            throw new BadDataException("SMTP Config is not valid");
        }


        return {
            username: obj['SMTP_USERNAME']?.toString()!,
            password:  obj['SMTP_PASSWORD']?.toString()!,
            host:  new Hostname(obj['SMTP_HOST']?.toString()!),
            port:  new Port(obj['SMTP_PORT']?.toString()!),
            fromEmail:  new Email(obj['SMTP_EMAIL']?.toString()!),
            fromName:  obj['SMTP_FROM_NAME']?.toString()!,
            secure:  obj['SMTP_IS_SECURE'] === "true",
        };
    }

    private static getGlobalSmtpSettings(): MailServer {
        return this.getMailServer(process.env);
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

    private static compileText(
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

    private static async transportMail(
        mail: Mail,
        mailServer: MailServer
    ): Promise<void> {
        const mailer: Transporter = this.createMailer(mailServer);
        await mailer.sendMail(mail);
    }

    public static async send(
        mail: Mail,
        mailServer?: MailServer
    ): Promise<void> {
        if (!mailServer) {
            mailServer = this.getGlobalSmtpSettings();
        }

        mail.body = mail.templateType ? await this.compileEmailBody(mail.templateType, mail.vars) : this.compileText(mail.body, mail.vars);
        mail.subject = this.compileText(mail.subject, mail.vars);

        await this.transportMail(mail, mailServer);
    }
}

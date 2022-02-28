
import nodemailer from 'nodemailer';

import hbs from 'nodemailer-express-handlebars';
import Handlebars from 'handlebars';
import Whitepapers from '../config/whitepaper';
import ErrorService from 'common-server/utils/error';
import defaultEmailTemplates from '../config/emailTemplate';
import GlobalConfigService from './globalConfigService';
import EmailSmtpService from './emailSmtpService';
import EmailStatusService from './emailStatusService';
import DateTime from '../utils/DateTime';
import Path from 'path';
import fsp from 'fs/promises';
import moment from 'moment';

import { isEmpty } from 'lodash';
const helpers = {
    year: DateTime.getCurrentYear,
};

import UppercaseFirstLetter from '../utils/UppercaseFirstLetter';

const options = {
    viewEngine: {
        extname: '.hbs',
        layoutsDir: 'views/email/',
        defaultLayout: 'template',
        partialsDir: 'views/partials/',
        helpers,
    },
    viewPath: 'views/email/',
    extName: '.hbs',
};

// handlebars helper function
// checks for equality
Handlebars.registerHelper('if_eq', function(this: $TSFixMe, a, b, opts) {
    if (a == b) {
        return opts.fn(this);
    } else {
        return opts.inverse(this);
    }
});

const _this = {
    getProjectSmtpSettings: async (projectId: $TSFixMe) => {
        let user,
            pass,
            host,
            port,
            from,
            name,
            secure,
            internalSmtp,
            customSmtp,
            backupConfig;
        const select =
            'projectId user pass host port from name iv secure enabled createdAt';

        const smtpDb = await EmailSmtpService.findOneBy({
            query: { projectId, enabled: true },
            select,
            populate: [{ path: 'projectId', select: 'name' }],
        });
        if (
            smtpDb &&
            smtpDb.user &&
            smtpDb.user !== null &&
            smtpDb.user !== undefined
        ) {
            user = smtpDb.user;
            pass = smtpDb.pass;
            host = smtpDb.host;
            port = smtpDb.port;
            from = smtpDb.from;
            name = smtpDb.name || 'OneUptime';
            secure = smtpDb.secure;
        } else {
            const globalSettings = await _this.getSmtpSettings();
            if (!isEmpty(globalSettings)) {
                user = globalSettings.user;
                pass = globalSettings.pass;
                host = globalSettings.host;
                port = globalSettings.port;
                from = globalSettings.from;
                name = globalSettings.name;
                secure = globalSettings.secure;
                internalSmtp = globalSettings.internalSmtp;
                customSmtp = globalSettings.customSmtp;
                backupConfig = globalSettings.backupConfig;
            } else {
                return {};
            }
        }

        return {
            user,
            pass,
            host,
            port,
            from,
            name,
            secure,
            internalSmtp,
            customSmtp,
            backupConfig,
        };
    },

    getEmailBody: async function(mailOptions: $TSFixMe) {
        const data = await fsp.readFile(
            Path.resolve(
                process.cwd(),
                'views',
                'email',
                `${mailOptions.template}.hbs`
            ),
            { encoding: 'utf8', flag: 'r' }
        );
        let emailBody = Handlebars.compile(data);
        
        emailBody = emailBody(mailOptions.context);
        return emailBody;
    },

    createMailer: async function({
        host,
        port,
        user,
        pass,
        secure,
        internalSmtp,
    }: $TSFixMe) {
        let settings = {};
        if (!host || !user || !pass) {
            settings = await _this.getSmtpSettings();
            if (!isEmpty(settings)) {
                
                host = settings.host;
                
                port = settings.port;
                
                user = settings.user;
                
                pass = settings.pass;
                
                secure = settings.secure;

                
                if (!settings['email-enabled']) {
                    return null;
                }
            }
        }

        
        internalSmtp = internalSmtp || settings.internalSmtp;
        let privateMailer;

        if (host && user && pass) {
            if (internalSmtp) {
                privateMailer = nodemailer.createTransport({
                    host: host,
                    port: port,
                    secure: secure,
                    auth: {
                        user: user,
                        pass: pass,
                    },
                    tls: {
                        // do not fail on invalid certs
                        // also allow self signed certs
                        rejectUnauthorized: false,
                    },
                });
            } else {
                privateMailer = nodemailer.createTransport({
                    host: host,
                    port: port,
                    secure: secure,
                    auth: {
                        user: user,
                        pass: pass,
                    },
                });
            }

            privateMailer.use('compile', hbs(options));
        }
        return privateMailer;
    },

    getSmtpSettings: async () => {
        const document = await GlobalConfigService.findOneBy({
            query: { name: 'smtp' },
            select: 'value name',
        });
        if (document && document.value && !document.value.internalSmtp) {
            return {
                user: document.value.email,
                pass: document.value.password,
                host: document.value['smtp-server'],
                port: document.value['smtp-port'],
                from: document.value['from'],
                name: document.value['from-name'] || 'OneUptime',
                secure: document.value['smtp-secure'],
                'email-enabled': document.value['email-enabled'],
            };
        } else if (
            document &&
            document.value &&
            document.value.internalSmtp &&
            document.value.customSmtp
        ) {
            return {
                user: process.env.INTERNAL_SMTP_USER,
                pass: process.env.INTERNAL_SMTP_PASSWORD,
                host: process.env.INTERNAL_SMTP_SERVER,
                port: process.env.INTERNAL_SMTP_PORT,
                from: process.env.INTERNAL_SMTP_FROM,
                name: process.env.INTERNAL_SMTP_NAME,
                'email-enabled': document.value['email-enabled'],
                internalSmtp: document.value.internalSmtp,
                customSmtp: document.value.customSmtp,
                backupConfig: {
                    user: document.value.email,
                    pass: document.value.password,
                    host: document.value['smtp-server'],
                    port: document.value['smtp-port'],
                    from: document.value['from'],
                    name: document.value['from-name'] || 'OneUptime',
                    secure: document.value['smtp-secure'],
                    'email-enabled': document.value['email-enabled'],
                },
            };
        } else if (document && document.value && document.value.internalSmtp) {
            return {
                user: process.env.INTERNAL_SMTP_USER,
                pass: process.env.INTERNAL_SMTP_PASSWORD,
                host: process.env.INTERNAL_SMTP_SERVER,
                port: process.env.INTERNAL_SMTP_PORT,
                from: process.env.INTERNAL_SMTP_FROM,
                name: process.env.INTERNAL_SMTP_NAME,
                'email-enabled': document.value['email-enabled'],
                internalSmtp: document.value.internalSmtp,
            };
        }

        // this should be handled gracefully
        // if there's no settings, no email should be sent
        // throwing error here is not needed
        const error = new Error('SMTP settings not found.');
        ErrorService.log('mailService.getSmtpSettings', error);
        return {};
    },

    getTemplates: async (emailTemplate: $TSFixMe, emailType: $TSFixMe) => {
        const defaultTemplate = defaultEmailTemplates.filter(
            template => template.emailType === emailType
        );
        let emailContent = defaultTemplate[0].body;
        let emailSubject = defaultTemplate[0].subject;

        if (
            emailTemplate != null &&
            emailTemplate != undefined &&
            emailTemplate.body
        ) {
            emailContent = emailTemplate.body;
        }
        if (
            emailTemplate != null &&
            emailTemplate != undefined &&
            emailTemplate.subject
        ) {
            emailSubject = emailTemplate.subject;
        }
        const template = Handlebars.compile(emailContent);
        const subject = Handlebars.compile(emailSubject);
        return { template, subject };
    },
    // Description: Mails to user if they have successfully signed up.
    // Params:
    // Param 1: userEmail: Email of user
    // Returns: promise
    sendSignupMail: async function(userEmail: $TSFixMe, name: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            smtpServer = 'internal';

            if (!isEmpty(accountMail)) {
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: userEmail,
                    subject: 'Welcome to OneUptime.',
                    template: 'sign_up_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        name: name.split(' ')[0].toString(),
                        
                        dashboardURL: global.dashboardHost,
                    },
                };

                const [mailer, mailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = mailBody;

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = {
                                ...accountMail.backupConfig,
                            };
                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: userEmail,
                                subject: 'Welcome to OneUptime.',
                                template: 'sign_up_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    name: name.split(' ')[0].toString(),
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };

                            const [mailer, mailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = mailBody;

                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendLoginEmail: async function(
        userEmail: $TSFixMe,
        location: $TSFixMe,
        deviceObj: $TSFixMe,
        twoFactorEnabled: $TSFixMe,
        status: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        let locations;
        let device;
        let statusMessage;
        const os = deviceObj && deviceObj.os && deviceObj.os.name;
        const browser = deviceObj && deviceObj.client && deviceObj.client.name;
        if (location.city && location.country) {
            locations = `${location.city}, ${location.country}.`;
        } else if (!location.city && location.country) {
            locations = `${location.country}.`;
        } else if (location.city && !location.country) {
            locations = `${location.city}.`;
        } else {
            locations = 'Unknown Location';
        }

        if (os && browser) {
            device = `${browser} on ${os}.`;
        } else if (!os && browser) {
            device = `${browser} on an Unknown Device.`;
        } else if (os && !browser) {
            device = `unknown browser on ${os}`;
        } else {
            device = 'Unknown Device';
        }
        if (status === 'successful') {
            statusMessage = 'a successful';
        } else {
            statusMessage = 'an unsuccessful';
        }

        try {
            let accountMail = await _this.getSmtpSettings();
            smtpServer = 'internal';
            if (!isEmpty(accountMail)) {
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: userEmail,
                    subject: `New login to OneUptime from ${device}`,
                    template: 'user_login_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        userEmail,
                        
                        dashboardURL: global.dashboardHost,
                        ip: location.ip,
                        locations,
                        device,
                        twoFactorEnabled,
                        statusMessage,
                    },
                };

                const [mailer, mailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = mailBody;

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = {
                                ...accountMail.backupConfig,
                            };
                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: userEmail,
                                subject: `New login to OneUptime from ${device}`,
                                template: 'user_login_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    userEmail,
                                    
                                    dashboardURL: global.dashboardHost,
                                    ip: location.ip,
                                    locations,
                                    device,
                                    twoFactorEnabled,
                                    statusMessage,
                                },
                            };

                            const [mailer, mailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = mailBody;

                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    // Automated email sent when a user deletes a project
    sendDeleteProjectEmail: async function({
        userEmail,
        name,
        projectName,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                accountMail.name = 'OneUptime Support';
                accountMail.from = 'support@oneuptime.com';
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: userEmail,
                    replyTo: accountMail.from,
                    cc: accountMail.from,
                    subject: 'We need your feedback',
                    template: 'delete_project',
                    context: {
                        projectName,
                        name: name.split(' ')[0].toString(),
                        currentYear: new Date().getFullYear(),
                    },
                };

                const [mailer, mailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = mailBody;

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = {
                                ...accountMail.backupConfig,
                            };
                            
                            accountMail.name = 'OneUptime Support';
                            
                            accountMail.from = 'support@oneuptime.com';

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: userEmail,
                                replyTo: accountMail.from,
                                cc: accountMail.from,
                                subject: 'We need your feedback',
                                template: 'delete_project',
                                context: {
                                    projectName,
                                    name: name.split(' ')[0].toString(),
                                    currentYear: new Date().getFullYear(),
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;

                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendDeleteProjectEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: error.message,
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendVerifyEmail: async function(
        tokenVerifyURL: $TSFixMe,
        name: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: '[OneUptime] Verify your Email',
                    template: 'send_verification_email',
                    context: {
                        
                        homeURL: global.homeHost,
                        tokenVerifyURL,
                        name: name.split(' ')[0].toString(),
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = {
                                ...accountMail.backupConfig,
                            };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: '[OneUptime] Verify your Email',
                                template: 'send_verification_email',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    tokenVerifyURL,
                                    name: name.split(' ')[0].toString(),
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;

                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendVerifyEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendLeadEmailToOneUptimeTeam: async function(lead: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer = 'internal';
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: 'support@oneuptime.com',
                    subject: 'New Lead Added',
                    template: 'lead_to_oneuptime_team',
                    context: {
                        templateName: lead.templateName,
                        airtableId: lead.airtableId,
                        page: lead.page,
                        projectId: lead.projectId,
                        createdById: lead.createdById,
                        
                        homeURL: global.homeHost,
                        _id: lead._id,
                        message: lead.message,
                        createdAt: moment(lead.createdAt).format('LLLL'),
                        projectName:
                            lead.project && lead.project.name
                                ? lead.project.name
                                : '',
                        userName: lead.userName
                            ? lead.userName
                            : lead.name
                            ? lead.name
                            : '',
                        userPhone: lead.phone,
                        userEmail: lead.email,
                        type: lead.type,
                        country: lead.country,
                        website: lead.website,
                        companySize: lead.companySize,
                        whitepaperName: lead.whitepaperName,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = {
                                ...accountMail.backupConfig,
                            };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: 'support@oneuptime.com',
                                subject: 'New Lead Added',
                                template: 'lead_to_oneuptime_team',
                                context: {
                                    templateName: lead.templateName,
                                    airtableId: lead.airtableId,
                                    page: lead.page,
                                    projectId: lead.projectId,
                                    createdById: lead.createdById,
                                    
                                    homeURL: global.homeHost,
                                    _id: lead._id,
                                    message: lead.message,
                                    createdAt: moment(lead.createdAt).format(
                                        'LLLL'
                                    ),
                                    projectName:
                                        lead.project && lead.project.name
                                            ? lead.project.name
                                            : '',
                                    userName: lead.userName
                                        ? lead.userName
                                        : lead.name
                                        ? lead.name
                                        : '',
                                    userPhone: lead.phone,
                                    userEmail: lead.email,
                                    type: lead.type,
                                    country: lead.country,
                                    website: lead.website,
                                    companySize: lead.companySize,
                                    whitepaperName: lead.whitepaperName,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;

                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendLeadEmailToOneUptimeTeam', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendUserFeedbackResponse: async function(
        userEmail: $TSFixMe,
        name: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer = 'internal';
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: userEmail,
                    subject: 'Thank you for your feedback!',
                    template: 'feedback_response',
                    context: {
                        
                        homeURL: global.homeHost,
                        name: name.split(' ')[0].toString(),
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = {
                                ...accountMail.backupConfig,
                            };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: userEmail,
                                subject: 'Thank you for your feedback!',
                                template: 'feedback_response',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    name: name.split(' ')[0].toString(),
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendUserFeedbackResponse', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendRequestDemoEmail: async function(to: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            if (!to) {
                const error = new Error('Email not found');
                
                error.code = 400;
                throw error;
            } else {
                let accountMail = await _this.getSmtpSettings();
                if (!isEmpty(accountMail)) {
                    smtpServer = 'internal';
                    if (!accountMail.internalSmtp) {
                        smtpServer = accountMail.host;
                    }
                    mailOptions = {
                        from: `"${accountMail.name}" <${accountMail.from}>`,
                        cc: 'noreply@oneuptime.com',
                        to: to,
                        subject: 'Thank you for your demo request.',
                        template: 'request_demo_body',
                    };

                    const [mailer, emailBody] = await Promise.all([
                        _this.createMailer({}),
                        _this.getEmailBody(mailOptions),
                    ]);
                    EmailBody = emailBody;

                    if (!mailer) {
                        await EmailStatusService.create({
                            
                            from: mailOptions.from,
                            
                            to: mailOptions.to,
                            
                            subject: mailOptions.subject,
                            
                            template: mailOptions.template,
                            status: 'Email not enabled.',
                            content: EmailBody,
                            error: 'Email not enabled.',
                            smtpServer,
                        });
                        return;
                    }

                    let info = {};
                    try {
                        info = await mailer.sendMail(mailOptions);

                        await EmailStatusService.create({
                            
                            from: mailOptions.from,
                            
                            to: mailOptions.to,
                            
                            subject: mailOptions.subject,
                            
                            template: mailOptions.template,
                            status: 'Success',
                            content: EmailBody,
                            smtpServer,
                        });
                    } catch (error) {
                        if (error.code === 'ECONNECTION') {
                            if (
                                accountMail.internalSmtp &&
                                accountMail.customSmtp &&
                                !isEmpty(accountMail.backupConfig)
                            ) {
                                
                                smtpServer = accountMail.backupConfig.host;
                                accountMail = { ...accountMail.backupConfig };

                                mailOptions = {
                                    from: `"${accountMail.name}" <${accountMail.from}>`,
                                    cc: 'noreply@oneuptime.com',
                                    to: to,
                                    subject: 'Thank you for your demo request.',
                                    template: 'request_demo_body',
                                };

                                const [mailer, emailBody] = await Promise.all([
                                    _this.createMailer(accountMail),
                                    _this.getEmailBody(mailOptions),
                                ]);
                                EmailBody = emailBody;

                                if (!mailer) {
                                    await EmailStatusService.create({
                                        
                                        from: mailOptions.from,
                                        
                                        to: mailOptions.to,
                                        
                                        subject: mailOptions.subject,
                                        
                                        template: mailOptions.template,
                                        status: 'Email not enabled.',
                                        content: EmailBody,
                                        error: 'Email not enabled.',
                                        smtpServer,
                                    });
                                    return;
                                }

                                info = await mailer.sendMail(mailOptions);

                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Success',
                                    content: EmailBody,
                                    smtpServer,
                                });
                            } else {
                                throw error;
                            }
                        } else {
                            throw error;
                        }
                    }

                    return info;
                }
            }
        } catch (error) {
            ErrorService.log('mailService.sendRequestDemoEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendWhitepaperEmail: async function(
        to: $TSFixMe,
        whitepaperName: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            if (!to || whitepaperName) {
                const error = new Error('Email or Whitepaper found');
                
                error.code = 400;
                ErrorService.log('mailService.sendWhitepaperEmail', error);
                throw error;
            } else {
                let link = null;

                for (let i = 0; i < Whitepapers.length; i++) {
                    if (Whitepapers[i].name === whitepaperName) {
                        link = Whitepapers[i].link;
                    }
                }

                if (!link) {
                    const error = new Error('Whitepaper not found');
                    
                    error.code = 400;
                    ErrorService.log('mailService.sendWhitepaperEmail', error);
                    throw error;
                } else {
                    let accountMail = await _this.getSmtpSettings();
                    if (!isEmpty(accountMail)) {
                        smtpServer = 'internal';
                        if (!accountMail.internalSmtp) {
                            smtpServer = accountMail.host;
                        }
                        mailOptions = {
                            from: `"${accountMail.name}" <${accountMail.from}>`,
                            cc: 'noreply@oneuptime.com',
                            to: to,
                            subject: "Here's your Whitepaper",
                            template: 'whitepaper_body',
                            context: {
                                
                                homeURL: global.homeHost,
                                link: link,
                            },
                        };

                        const [mailer, emailBody] = await Promise.all([
                            _this.createMailer({}),
                            _this.getEmailBody(mailOptions),
                        ]);
                        EmailBody = emailBody;

                        if (!mailer) {
                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Email not enabled.',
                                content: EmailBody,
                                error: 'Email not enabled.',
                                smtpServer,
                            });
                            return;
                        }

                        let info = {};
                        try {
                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } catch (error) {
                            if (error.code === 'ECONNECTION') {
                                if (
                                    accountMail.internalSmtp &&
                                    accountMail.customSmtp &&
                                    !isEmpty(accountMail.backupConfig)
                                ) {
                                    
                                    smtpServer = accountMail.backupConfig.host;
                                    accountMail = {
                                        ...accountMail.backupConfig,
                                    };

                                    mailOptions = {
                                        from: `"${accountMail.name}" <${accountMail.from}>`,
                                        cc: 'noreply@oneuptime.com',
                                        to: to,
                                        subject: "Here's your Whitepaper",
                                        template: 'whitepaper_body',
                                        context: {
                                            
                                            homeURL: global.homeHost,
                                            link: link,
                                        },
                                    };

                                    const [
                                        mailer,
                                        emailBody,
                                    ] = await Promise.all([
                                        _this.createMailer(accountMail),
                                        _this.getEmailBody(mailOptions),
                                    ]);
                                    EmailBody = emailBody;

                                    if (!mailer) {
                                        await EmailStatusService.create({
                                            
                                            from: mailOptions.from,
                                            
                                            to: mailOptions.to,
                                            
                                            subject: mailOptions.subject,
                                            
                                            template: mailOptions.template,
                                            status: 'Email not enabled.',
                                            content: EmailBody,
                                            error: 'Email not enabled.',
                                            smtpServer,
                                        });
                                        return;
                                    }

                                    info = await mailer.sendMail(mailOptions);

                                    await EmailStatusService.create({
                                        
                                        from: mailOptions.from,
                                        
                                        to: mailOptions.to,
                                        
                                        subject: mailOptions.subject,
                                        
                                        template: mailOptions.template,
                                        status: 'Success',
                                        content: EmailBody,
                                        smtpServer,
                                    });
                                } else {
                                    throw error;
                                }
                            } else {
                                throw error;
                            }
                        }

                        return info;
                    }
                }
            }
        } catch (error) {
            ErrorService.log('mailService.sendWhitepaperEmail', error);
            if (mailOptions) {
                await EmailStatusService.create({
                    
                    from: mailOptions.from,
                    
                    to: mailOptions.to,
                    
                    subject: mailOptions.subject,
                    
                    template: mailOptions.template,
                    status: 'Error',
                    content: EmailBody,
                    error: error.message,
                    smtpServer,
                });
            }
            throw error;
        }
    },

    // Description: Mails to user if they have requested for password reset
    // Params:
    // Param 1: host: url
    // Param 2: email: Email of user
    // Param 3: token: Password reset token
    // Returns: promise
    sendForgotPasswordMail: async function(
        forgotPasswordURL: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: 'Password Reset for OneUptime',
                    template: 'forgot_password_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        forgotPasswordURL,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: 'Password Reset for OneUptime',
                                template: 'forgot_password_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    forgotPasswordURL,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendForgotPasswordMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    // Description: Mails to user after their password has been successfully set.
    // Params:
    // Param 1: email: Email of user
    // Returns: promise
    sendResetPasswordConfirmMail: async function(email: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: 'Your password has been changed.',
                    template: 'reset_password_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        
                        accountsURL: global.homeHost + '/accounts',
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: 'Your password has been changed.',
                                template: 'reset_password_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    
                                    accountsURL: global.homeHost + '/accounts',
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendResetPasswordConfirmMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    // Description: Mail to users for registering  after they have been added by Admin to Project.
    // Params:
    // Param 1: userEmail: Email of users
    // Returns: promise
    sendNewUserAddedToProjectMail: async function(
        project: $TSFixMe,
        addedByUser: $TSFixMe,
        email: $TSFixMe,
        registerUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been added to a project on OneUptime",
                    template: 'new_user_added_to_project_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: project.name,
                        userName: addedByUser.name,
                        registerUrl,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been added to a project on OneUptime",
                                template: 'new_user_added_to_project_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: project.name,
                                    userName: addedByUser.name,
                                    registerUrl,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendNewUserAddedToProjectMail',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendExistingUserAddedToProjectMail: async function(
        project: $TSFixMe,
        addedByUser: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been added to a project on OneUptime",
                    template: 'existing_user_added_to_project_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: project.name,
                        userName: addedByUser.name,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been added to a project on OneUptime",
                                template: 'existing_user_added_to_project_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: project.name,
                                    userName: addedByUser.name,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendExistingUserAddedToProjectMail',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendLighthouseEmail: async function(project: $TSFixMe, user: $TSFixMe) {
        let mailOptions;
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!accountMail.internalSmtp) {
                smtpServer = accountMail.host;
            }
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: user.email,
                subject: 'Lighthouse Runner',
                template: 'lighthouse_runner',
                context: {
                    
                    homeURL: global.homeHost,
                    projectName: project.name,
                    monitorName: project.monitor,
                    userName: user.name,
                    performance: project.performance,
                    accessibility: project.accessibility,
                    bestPractices: project.bestPractices,
                    seo: project.seo,
                    pwa: project.pwa,
                    performanceIssues: project.performanceIssues,
                    accessibilityIssues: project.accessibilityIssues,
                    bestPracticesIssues: project.bestPracticesIssues,
                    seoIssues: project.seoIssues,
                    pwaIssues: project.pwaIssues,
                    
                    dashboardURL: global.dashboardHost,
                },
            };
            const [mailer, emailBody] = await Promise.all([
                _this.createMailer({}),
                _this.getEmailBody(mailOptions),
            ]);
            EmailBody = emailBody;
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
                    content: EmailBody,
                    error: 'Email not enabled.',
                    smtpServer,
                });
                return;
            }
            let info = {};
            try {
                info = await mailer.sendMail(mailOptions);

                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Success',
                    content: EmailBody,
                    smtpServer,
                });
            } catch (error) {
                if (error.code === 'ECONNECTION') {
                    if (
                        accountMail.internalSmtp &&
                        accountMail.customSmtp &&
                        !isEmpty(accountMail.backupConfig)
                    ) {
                        
                        smtpServer = accountMail.backupConfig.host;
                        accountMail = { ...accountMail.backupConfig };

                        mailOptions = {
                            from: `"${accountMail.name}" <${accountMail.from}>`,
                            to: user.email,
                            subject: 'Application Security',
                            template: 'application_security',
                            context: {
                                
                                homeURL: global.homeHost,
                                projectName: project.name,
                                monitorName: project.monitor,
                                userName: user.name,
                                performance: project.performance,
                                accessibilty: project.accessibilty,
                                bestPractices: project.bestPractices,
                                seo: project.seo,
                                pwa: project.pwa,
                                performanceIssues: project.performanceIssues,
                                accessibilityIssues:
                                    project.accessibilityIssues,
                                bestPracticesIssues:
                                    project.bestPracticesIssues,
                                seoIssues: project.seoIssues,
                                pwaIssues: project.pwaIssues,
                                
                                dashboardURL: global.dashboardHost,
                            },
                        };
                        const [mailer, emailBody] = await Promise.all([
                            _this.createMailer(accountMail),
                            _this.getEmailBody(mailOptions),
                        ]);
                        EmailBody = emailBody;
                        if (!mailer) {
                            await EmailStatusService.create({
                                from: mailOptions.from,
                                to: mailOptions.to,
                                subject: mailOptions.subject,
                                template: mailOptions.template,
                                status: 'Email not enabled.',
                                content: EmailBody,
                                error: 'Email not enabled.',
                                smtpServer,
                            });
                            return;
                        }

                        info = await mailer.sendMail(mailOptions);

                        await EmailStatusService.create({
                            from: mailOptions.from,
                            to: mailOptions.to,
                            subject: mailOptions.subject,
                            template: mailOptions.template,
                            status: 'Success',
                            content: EmailBody,
                            smtpServer,
                        });
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendContainerEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendApplicationEmail: async function(project: $TSFixMe, user: $TSFixMe) {
        let mailOptions;
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!accountMail.internalSmtp) {
                smtpServer = accountMail.host;
            }
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: user.email,
                subject: 'Application Security',
                template: 'application_security',
                context: {
                    
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: user.name,
                    critical: project.critical,
                    high: project.high,
                    moderate: project.moderate,
                    low: project.low,
                    criticalIssues: project.criticalIssues,
                    highIssues: project.highIssues,
                    moderateIssues: project.moderateIssues,
                    lowIssues: project.lowIssues,
                    
                    dashboardURL: global.dashboardHost,
                },
            };
            const [mailer, emailBody] = await Promise.all([
                _this.createMailer({}),
                _this.getEmailBody(mailOptions),
            ]);
            EmailBody = emailBody;
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
                    content: EmailBody,
                    error: 'Email not enabled.',
                    smtpServer,
                });
                return;
            }
            let info = {};
            try {
                info = await mailer.sendMail(mailOptions);

                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Success',
                    content: EmailBody,
                    smtpServer,
                });
            } catch (error) {
                if (error.code === 'ECONNECTION') {
                    if (
                        accountMail.internalSmtp &&
                        accountMail.customSmtp &&
                        !isEmpty(accountMail.backupConfig)
                    ) {
                        
                        smtpServer = accountMail.backupConfig.host;
                        accountMail = { ...accountMail.backupConfig };

                        mailOptions = {
                            from: `"${accountMail.name}" <${accountMail.from}>`,
                            to: user.email,
                            subject: 'Application Security',
                            template: 'application_security',
                            context: {
                                
                                homeURL: global.homeHost,
                                projectName: project.name,
                                userName: user.name,
                                critical: project.critical,
                                high: project.high,
                                moderate: project.moderate,
                                low: project.low,
                                criticalIssues: project.criticalIssues,
                                highIssues: project.highIssues,
                                moderateIssues: project.moderateIssues,
                                lowIssues: project.lowIssues,
                                
                                dashboardURL: global.dashboardHost,
                            },
                        };
                        const [mailer, emailBody] = await Promise.all([
                            _this.createMailer(accountMail),
                            _this.getEmailBody(mailOptions),
                        ]);
                        EmailBody = emailBody;
                        if (!mailer) {
                            await EmailStatusService.create({
                                from: mailOptions.from,
                                to: mailOptions.to,
                                subject: mailOptions.subject,
                                template: mailOptions.template,
                                status: 'Email not enabled.',
                                content: EmailBody,
                                error: 'Email not enabled.',
                                smtpServer,
                            });
                            return;
                        }

                        info = await mailer.sendMail(mailOptions);

                        await EmailStatusService.create({
                            from: mailOptions.from,
                            to: mailOptions.to,
                            subject: mailOptions.subject,
                            template: mailOptions.template,
                            status: 'Success',
                            content: EmailBody,
                            smtpServer,
                        });
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendContainerEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendContainerEmail: async function(project: $TSFixMe, user: $TSFixMe) {
        let mailOptions;
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!accountMail.internalSmtp) {
                smtpServer = accountMail.host;
            }
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: user.email,
                subject: 'Container Security',
                template: 'container_security',
                context: {
                    
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: user.name,
                    
                    dashboardURL: global.dashboardHost,
                    critical: project.critical,
                    high: project.high,
                    moderate: project.moderate,
                    low: project.low,
                    criticalIssues: project.criticalIssues,
                    highIssues: project.highIssues,
                    moderateIssues: project.moderateIssues,
                    lowIssues: project.lowIssues,
                },
            };
            const [mailer, emailBody] = await Promise.all([
                _this.createMailer({}),
                _this.getEmailBody(mailOptions),
            ]);
            EmailBody = emailBody;
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
                    content: EmailBody,
                    error: 'Email not enabled.',
                    smtpServer,
                });
                return;
            }
            let info = {};
            try {
                info = await mailer.sendMail(mailOptions);

                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Success',
                    content: EmailBody,
                    smtpServer,
                });
            } catch (error) {
                if (error.code === 'ECONNECTION') {
                    if (
                        accountMail.internalSmtp &&
                        accountMail.customSmtp &&
                        !isEmpty(accountMail.backupConfig)
                    ) {
                        
                        smtpServer = accountMail.backupConfig.host;
                        accountMail = { ...accountMail.backupConfig };

                        mailOptions = {
                            from: `"${accountMail.name}" <${accountMail.from}>`,
                            to: user.email,
                            subject: 'Container Security',
                            template: 'container_security',
                            context: {
                                
                                homeURL: global.homeHost,
                                projectName: project.name,
                                userName: user.name,
                                
                                dashboardURL: global.dashboardHost,
                            },
                        };
                        const [mailer, emailBody] = await Promise.all([
                            _this.createMailer(accountMail),
                            _this.getEmailBody(mailOptions),
                        ]);
                        EmailBody = emailBody;
                        if (!mailer) {
                            await EmailStatusService.create({
                                from: mailOptions.from,
                                to: mailOptions.to,
                                subject: mailOptions.subject,
                                template: mailOptions.template,
                                status: 'Email not enabled.',
                                content: EmailBody,
                                error: 'Email not enabled.',
                                smtpServer,
                            });
                            return;
                        }

                        info = await mailer.sendMail(mailOptions);

                        await EmailStatusService.create({
                            from: mailOptions.from,
                            to: mailOptions.to,
                            subject: mailOptions.subject,
                            template: mailOptions.template,
                            status: 'Success',
                            content: EmailBody,
                            smtpServer,
                        });
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendContainerEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendExistingStatusPageViewerMail: async function(
        subProject: $TSFixMe,
        addedByUser: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been added to a sub-project on OneUptime",
                    template: 'existing_viewer_added_to_project_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        subProjectName: subProject.name,
                        userName: addedByUser.name,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been added to a sub-project on OneUptime",
                                template:
                                    'existing_viewer_added_to_project_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    subProjectName: subProject.name,
                                    userName: addedByUser.name,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendExistingStatusPageViewerMail',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendExistingUserAddedToSubProjectMail: async function(
        project: $TSFixMe,
        addedByUser: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been added to a subproject on OneUptime",
                    template: 'existing_user_added_to_subproject_body',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: project.name,
                        userName: addedByUser.name,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been added to a subproject on OneUptime",
                                template:
                                    'existing_user_added_to_subproject_body',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: project.name,
                                    userName: addedByUser.name,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendExistingUserAddedToSubProjectMail',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendNewStatusPageViewerMail: async function(
        project: $TSFixMe,
        addedByUser: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been added to a project on OneUptime",
                    template: 'new_viewer_added_to_project',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: project.name,
                        userName: addedByUser.name,
                        
                        accountsURL: global.homeHost + '/accounts',
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been added to a project on OneUptime",
                                template: 'new_viewer_added_to_project',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: project.name,
                                    userName: addedByUser.name,
                                    
                                    accountsURL: global.homeHost + '/accounts',
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendNewStatusPageViewerMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendChangeRoleEmailToUser: async function(
        project: $TSFixMe,
        addedByUser: $TSFixMe,
        email: $TSFixMe,
        role: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been assigned a new role",
                    template: 'change_role',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: project.name,
                        userName: addedByUser.name,
                        role: role,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: "You've been assigned a new role",
                                template: 'change_role',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: project.name,
                                    userName: addedByUser.name,
                                    role: role,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendChangeRoleEmailToUser', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendRemoveFromProjectEmailToUser: async function(
        project: $TSFixMe,
        removedByUser: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: "You've been removed from a project on OneUptime",
                    template: 'removed_from_project',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: project.name,
                        userName: removedByUser.name,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been removed from a project on OneUptime",
                                template: 'removed_from_project',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: project.name,
                                    userName: removedByUser.name,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendRemoveFromProjectEmailToUser',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendRemoveFromSubProjectEmailToUser: async function(
        subProject: $TSFixMe,
        removedByUser: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject:
                        "You've been removed from a subproject on OneUptime",
                    template: 'removed_from_subproject',
                    context: {
                        
                        homeURL: global.homeHost,
                        subProjectName: subProject.name,
                        userName: removedByUser.name,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject:
                                    "You've been removed from a subproject on OneUptime",
                                template: 'removed_from_subproject',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    subProjectName: subProject.name,
                                    userName: removedByUser.name,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendRemoveFromSubProjectEmailToUser',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} acknowledgeUrl API link that has requirements for acknowledging incident.
     * @param {string} resolveUrl API link that has requirements for resolving incident.
     * @param {string} accessToken An access token to be used used to access API from email.
     */
    sendIncidentCreatedMail: async function({
        incidentTime,
        monitorName,
        monitorUrl,
        incidentId,
        reason,
        view_url,
        method,
        componentName,
        email,
        userId,
        firstName,
        projectId,
        acknowledgeUrl,
        resolveUrl,
        accessToken,
        incidentType,
        projectName,
        criterionName,
        probeName,
        emailProgress,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                let iconColor = '#94c800';
                let incidentShow = 'Offline';
                let subject;
                if (incidentType && incidentType === 'online') {
                    iconColor = '#75d380';
                    incidentShow = 'Online';
                } else if (incidentType && incidentType === 'offline') {
                    iconColor = '#e25950';
                    incidentShow = 'Offline';
                } else if (incidentType && incidentType === 'degraded') {
                    iconColor = '#ffde24';
                    incidentShow = 'Degraded';
                }
                if (emailProgress) {
                    subject = `Reminder ${emailProgress.current}/${emailProgress.total}: Incident ${incidentId} - ${componentName}/${monitorName} is ${incidentShow}`;
                } else {
                    subject = `Incident ${incidentId} - ${componentName}/${monitorName} is ${incidentShow}`;
                }
                const iconStyle = `display:inline-block;width:16px;height:16px;background:${iconColor};border-radius:16px`;
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: subject,
                    template: 'new_incident_created',
                    context: {
                        
                        homeURL: global.homeHost,
                        incidentTime: incidentTime,
                        monitorName: monitorName,
                        monitorUrl,
                        incidentId,
                        reason,
                        view_url,
                        method,
                        iconStyle,
                        componentName,
                        accessToken,
                        firstName,
                        userId,
                        projectId,
                        ack_url: acknowledgeUrl,
                        resolve_url: resolveUrl,
                        acknowledgeUrl,
                        resolveUrl,
                        incidentType,
                        projectName,
                        
                        dashboardURL: global.dashboardHost,
                        criterionName,
                        probeName,
                    },
                };
                EmailBody = await _this.getEmailBody(mailOptions);
                const mailer = await _this.createMailer(accountMail);
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: subject,
                                template: 'new_incident_created',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    incidentTime: incidentTime,
                                    monitorName: monitorName,
                                    monitorUrl,
                                    incidentId,
                                    reason,
                                    view_url,
                                    method,
                                    iconStyle,
                                    componentName,
                                    accessToken,
                                    firstName,
                                    userId,
                                    projectId,
                                    ack_url: acknowledgeUrl,
                                    resolve_url: resolveUrl,
                                    acknowledgeUrl,
                                    resolveUrl,
                                    incidentType,
                                    projectName,
                                    
                                    dashboardURL: global.dashboardHost,
                                    criterionName,
                                    probeName,
                                },
                            };
                            EmailBody = await _this.getEmailBody(mailOptions);
                            const mailer = await _this.createMailer(
                                accountMail
                            );
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendIncidentCreatedMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     */
    sendIncidentCreatedMailToSubscriber: async function(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        trackEmailAsViewedUrl: $TSFixMe,
        componentName: $TSFixMe,
        statusPageUrl: $TSFixMe,
        replyAddress: $TSFixMe,
        customFields: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Incident Created'
            );
            const projectId = incident.projectId._id || incident.projectId;
            const data = {
                incidentTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                trackEmailAsViewedUrl,
                projectId,
                incidentType: UppercaseFirstLetter(incident.incidentType),
                incidentDescription: incident.description,
                componentName: UppercaseFirstLetter(componentName),
                statusPageUrl,
                unsubscribeUrl,
                year: DateTime.getCurrentYear,
                ...customFields,
            };
            
            template = template(data);
            
            subject = subject(data);
            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };
                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendIncidentCreatedMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendIncidentAcknowledgedMail: async function({
        incidentTime,
        monitorName,
        monitorUrl,
        incidentId,
        reason,
        view_url,
        method,
        componentName,
        email,
        userId,
        firstName,
        projectId,
        resolveUrl,
        accessToken,
        incidentType,
        projectName,
        acknowledgeTime,
        length,
        criterionName,
        acknowledgedBy,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: `Incident ${incidentId} - ${componentName}/${monitorName} was acknowledged`,
                    template: 'incident_acknowledged',
                    context: {
                        
                        homeURL: global.homeHost,
                        incidentTime: incidentTime,
                        monitorName: monitorName,
                        length,
                        acknowledgeTime,
                        monitorUrl,
                        incidentId,
                        reason,
                        view_url,
                        method,
                        componentName,
                        accessToken,
                        firstName,
                        userId,
                        projectId,
                        resolve_url: resolveUrl,
                        incidentType,
                        projectName,
                        
                        dashboardURL: global.dashboardHost,
                        criterionName,
                        acknowledgedBy,
                    },
                };
                const mailer = await _this.createMailer(accountMail);
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: `Incident ${incidentId} - ${componentName}/${monitorName} was acknowledged`,
                                template: 'incident_acknowledged',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    incidentTime: incidentTime,
                                    monitorName: monitorName,
                                    length,
                                    acknowledgeTime,
                                    monitorUrl,
                                    incidentId,
                                    reason,
                                    view_url,
                                    method,
                                    componentName,
                                    accessToken,
                                    firstName,
                                    userId,
                                    projectId,
                                    resolve_url: resolveUrl,
                                    incidentType,
                                    projectName,
                                    
                                    dashboardURL: global.dashboardHost,
                                    criterionName,
                                    acknowledgedBy,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendIncidentAcknowledgedMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendIncidentResolvedMail: async function({
        incidentTime,
        monitorName,
        monitorUrl,
        incidentId,
        reason,
        view_url,
        method,
        componentName,
        email,
        userId,
        firstName,
        projectId,
        accessToken,
        incidentType,
        projectName,
        resolveTime,
        length,
        criterionName,
        resolvedBy,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: `Incident ${incidentId} - ${componentName}/${monitorName} was resolved`,
                    template: 'incident_resolved',
                    context: {
                        
                        homeURL: global.homeHost,
                        incidentTime: incidentTime,
                        monitorName: monitorName,
                        length,
                        resolveTime,
                        monitorUrl,
                        incidentId,
                        reason,
                        view_url,
                        method,
                        componentName,
                        accessToken,
                        firstName,
                        userId,
                        projectId,
                        incidentType,
                        projectName,
                        
                        dashboardURL: global.dashboardHost,
                        criterionName,
                        resolvedBy,
                    },
                };
                const mailer = await _this.createMailer(accountMail);
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: `Incident ${incidentId} - ${componentName}/${monitorName} was resolved`,
                                template: 'incident_resolved',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    incidentTime: incidentTime,
                                    monitorName: monitorName,
                                    length,
                                    resolveTime,
                                    monitorUrl,
                                    incidentId,
                                    reason,
                                    view_url,
                                    method,
                                    componentName,
                                    accessToken,
                                    firstName,
                                    userId,
                                    projectId,
                                    incidentType,
                                    projectName,
                                    
                                    dashboardURL: global.dashboardHost,
                                    criterionName,
                                    resolvedBy,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendIncidentResolvedMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     */
    sendIncidentAcknowledgedMailToSubscriber: async function(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        trackEmailAsViewedUrl: $TSFixMe,
        componentName: $TSFixMe,
        statusPageUrl: $TSFixMe,
        replyAddress: $TSFixMe,
        customFields: $TSFixMe,
        length: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Incident Acknowledged'
            );
            const projectId = incident.projectId._id || incident.projectId;
            const data = {
                incidentTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                trackEmailAsViewedUrl,
                projectId,
                incidentType: UppercaseFirstLetter(incident.incidentType),
                componentName: UppercaseFirstLetter(componentName),
                statusPageUrl,
                unsubscribeUrl,
                year: DateTime.getCurrentYear,
                ...customFields,
                length,
            };
            
            template = template(data);
            
            subject = subject(data);
            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendIncidentCreatedMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     */

    sendInvestigationNoteToSubscribers: async function(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        componentName: $TSFixMe,
        incidentNote: $TSFixMe,
        noteType: $TSFixMe,
        statusPageUrl: $TSFixMe,
        statusNoteStatus: $TSFixMe,
        customFields: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Investigation note is created'
            );

            const projectId = incident.projectId._id || incident.projectId;
            const data = {
                incidentTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                projectId,
                incidentType: incident.incidentType,
                incidentId: incident.idNumber,
                incidentSlug: incident.slug,
                componentName: UppercaseFirstLetter(componentName),
                incidentNote,
                noteType: UppercaseFirstLetter(noteType),
                statusPageUrl,
                statusNoteStatus,
                unsubscribeUrl,
                ...customFields,
            };
            
            template = template(data);
            
            subject = subject(data);
            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                mailOptions = {
                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                    to: email,
                    subject: subject,
                    template: 'template',
                    context: {
                        body: template,
                    },
                };
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);
                    EmailBody = await _this.getEmailBody(mailOptions);
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            mailOptions = {
                                from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                to: email,
                                subject: subject,
                                template: 'template',
                                context: {
                                    body: template,
                                },
                            };
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);
                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendInvestigationNoteToSubscribers',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {js date object} scheduledTime JS date of the event as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     *
     */
    sendScheduledEventMailToSubscriber: async function(
        scheduledTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        schedule: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        componentName: $TSFixMe,
        replyAddress: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;

        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Scheduled Maintenance Created'
            );

            const resourcesAffected: $TSFixMe = [];
            schedule.monitors.map((monitor: $TSFixMe) => {
                return resourcesAffected.push(monitor.monitorId.name);
            });

            const data = {
                scheduledTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                projectId: schedule.projectId,
                componentName: UppercaseFirstLetter(componentName),
                eventName: UppercaseFirstLetter(schedule.name),
                eventDescription: schedule.description,
                eventCreateTime: schedule.createdAt,
                eventStartTime: schedule.startDate,
                eventEndTime: schedule.endDate,
                resourcesAffected: resourcesAffected.toString(),
                unsubscribeUrl,
                year: DateTime.getCurrentYear,
            };
            
            template = template(data);
            
            subject = subject(data);

            let smtpSettings = await _this.getProjectSmtpSettings(
                schedule.projectId._id
            );
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendScheduledEventMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    /**
     * @param {js date object} scheduledTime JS date of the event as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     *
     */
    sendResolvedScheduledEventMailToSubscriber: async function(
        scheduledTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        schedule: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        componentName: $TSFixMe,
        replyAddress: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;

        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Scheduled Maintenance Resolved'
            );

            const resourcesAffected: $TSFixMe = [];
            schedule.monitors.map((monitor: $TSFixMe) => {
                return resourcesAffected.push(monitor.monitorId.name);
            });
            //project name
            const data = {
                scheduledTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                projectId: schedule.projectId,
                componentName: UppercaseFirstLetter(componentName),
                eventName: UppercaseFirstLetter(schedule.name),
                eventResolveTime: schedule.resolvedAt,
                unsubscribeUrl,
                resourcesAffected: resourcesAffected.toString(),
                year: DateTime.getCurrentYear,
            };
            
            template = template(data);
            
            subject = subject(data);

            let smtpSettings = await _this.getProjectSmtpSettings(
                schedule.projectId._id
            );
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendScheduledEventMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {js date object} scheduledTime JS date of the event as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     */

    sendCancelledScheduledEventMailToSubscriber: async function(
        scheduledTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        schedule: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        componentName: $TSFixMe,
        replyAddress: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;

        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Scheduled Maintenance Cancelled'
            );

            const resourcesAffected: $TSFixMe = [];
            schedule.monitors.map((monitor: $TSFixMe) => {
                return resourcesAffected.push(monitor.monitorId.name);
            });
            //project name
            const data = {
                scheduledTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                projectId: schedule.projectId,
                componentName: UppercaseFirstLetter(componentName),
                eventName: UppercaseFirstLetter(schedule.name),
                eventCancelTime: schedule.cancelledAt,
                unsubscribeUrl,
                resourcesAffected: resourcesAffected.toString(),
                year: DateTime.getCurrentYear,
            };
            
            template = template(data);
            
            subject = subject(data);

            let smtpSettings = await _this.getProjectSmtpSettings(
                schedule.projectId._id
            );
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendCancelledScheduledEventMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    /**
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     *
     */
    sendScheduledEventNoteMailToSubscriber: async function(
        eventName: $TSFixMe,
        status: $TSFixMe,
        content: $TSFixMe,
        email: $TSFixMe,
        userName: $TSFixMe,
        createdBy: $TSFixMe,
        emailTemplate: $TSFixMe,
        replyAddress: $TSFixMe,
        projectName: $TSFixMe,
        monitorName: $TSFixMe,
        projectId: $TSFixMe,
        unsubscribeUrl: $TSFixMe,
        monitorsAffected: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;

        const resourcesAffected: $TSFixMe = [];
        monitorsAffected.map((monitor: $TSFixMe) => {
            return resourcesAffected.push(monitor.name);
        });

        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Scheduled Maintenance Note'
            );

            //project name
            const data = {
                userName,
                eventName: UppercaseFirstLetter(eventName),
                status: UppercaseFirstLetter(status),
                createdBy,
                content,
                projectName: UppercaseFirstLetter(projectName),
                monitorName: UppercaseFirstLetter(monitorName),
                unsubscribeUrl,
                resourcesAffected: resourcesAffected.toString(),
                year: DateTime.getCurrentYear,
            };
            
            template = template(data);
            
            subject = subject(data);

            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendScheduledEventNoteMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    /**
     * @param {string} announcementTitle Title of created announcement.
     * @param {string} announcementDescription Description of created announcement.
     * @param {string} projectId Id of the project whose monitor has announcement.
     * @param {string} statusPageUrl status page url
     *
     */
    sendAnnouncementToSubscriber: async function(
        announcementTitle: $TSFixMe,
        announcementDescription: $TSFixMe,
        email: $TSFixMe,
        emailTemplate: $TSFixMe,
        replyAddress: $TSFixMe,
        projectName: $TSFixMe,
        projectId: $TSFixMe,
        unsubscribeUrl: $TSFixMe,
        monitorName: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;

        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Announcement Notification Created'
            );

            //project name
            const data = {
                announcementTitle: UppercaseFirstLetter(announcementTitle),
                announcementDescription,
                projectName: UppercaseFirstLetter(projectName),
                unsubscribeUrl,
                year: DateTime.getCurrentYear,
                monitorName,
            };
            
            template = template(data);
            
            subject = subject(data);

            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }
                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendAnnouncementToSubscriber', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} componentName Name of the component whose monitor has incident.
     * @param {string} statusPageUrl status page url
     */
    sendIncidentResolvedMailToSubscriber: async function(
        incidentTime: $TSFixMe,
        monitorName: $TSFixMe,
        email: $TSFixMe,
        userId: $TSFixMe,
        userName: $TSFixMe,
        incident: $TSFixMe,
        projectName: $TSFixMe,
        emailTemplate: $TSFixMe,
        trackEmailAsViewedUrl: $TSFixMe,
        componentName: $TSFixMe,
        statusPageUrl: $TSFixMe,
        replyAddress: $TSFixMe,
        customFields: $TSFixMe,
        length: $TSFixMe,
        unsubscribeUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Incident Resolved'
            );
            const projectId = incident.projectId._id || incident.projectId;
            const data = {
                incidentTime,
                monitorName: UppercaseFirstLetter(monitorName),
                userName,
                userId,
                projectName: UppercaseFirstLetter(projectName),
                trackEmailAsViewedUrl,
                projectId,
                incidentType: UppercaseFirstLetter(incident.incidentType),
                componentName: UppercaseFirstLetter(componentName),
                statusPageUrl,
                unsubscribeUrl,
                year: DateTime.getCurrentYear,
                ...customFields,
                length,
            };
            
            template = template(data);
            
            subject = subject(data);
            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                const privateMailer = await _this.createMailer(smtpSettings);
                if (replyAddress) {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        replyTo: replyAddress,
                        subject: subject,
                        template: 'template',
                        context: {
                            
                            homeURL: global.homeHost,
                            body: template,
                        },
                    };
                } else {
                    mailOptions = {
                        from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                        to: email,
                        subject: subject,
                        template: 'template',
                        context: {
                            
                            homeURL: global.homeHost,
                            body: template,
                        },
                    };
                }
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!privateMailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await privateMailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        
                        ...(mailOptions.replyTo && {
                            
                            replyTo: mailOptions.replyTo,
                        }),
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            const privateMailer = await _this.createMailer(
                                smtpSettings
                            );
                            if (replyAddress) {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    replyTo: replyAddress,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        
                                        homeURL: global.homeHost,
                                        body: template,
                                    },
                                };
                            } else {
                                mailOptions = {
                                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                    to: email,
                                    subject: subject,
                                    template: 'template',
                                    context: {
                                        
                                        homeURL: global.homeHost,
                                        body: template,
                                    },
                                };
                            }
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!privateMailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    
                                    ...(mailOptions.replyTo && {
                                        
                                        replyTo: mailOptions.replyTo,
                                    }),
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await privateMailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                
                                ...(mailOptions.replyTo && {
                                    
                                    replyTo: mailOptions.replyTo,
                                }),
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendIncidentResolvedMailToSubscriber',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    testSmtpConfig: async function(data: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer = 'internal';
        if (!data.internalSmtp) {
            smtpServer = data.host;
        }
        try {
            const privateMailer = await _this.createMailer(data);
            mailOptions = {
                from: `"${data.name}" <${data.from}>`,
                to: data.email,
                subject: 'Email Smtp Settings Test',
                template: 'smtp_test',
                context: {
                    
                    homeURL: global.homeHost,
                    smtpServer,
                    ...data,
                },
            };
            EmailBody = await _this.getEmailBody(mailOptions);
            if (!privateMailer) {
                await EmailStatusService.create({
                    
                    from: mailOptions.from,
                    
                    to: mailOptions.to,
                    
                    subject: mailOptions.subject,
                    
                    template: mailOptions.template,
                    status: 'Email not enabled.',
                    content: EmailBody,
                    error: 'Email not enabled.',
                    smtpServer,
                });
                return;
            }
            const info = await privateMailer.sendMail(mailOptions);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
                smtpServer,
            });

            return info;
        } catch (error) {
            let err;
            if (error.code === 'EAUTH') {
                err = new Error('Username and Password not accepted.');
                await EmailStatusService.create({
                    
                    from: mailOptions.from,
                    
                    to: mailOptions.to,
                    
                    subject: mailOptions.subject,
                    
                    template: mailOptions.template,
                    status: 'Error',
                    content: EmailBody,
                    err: err.message,
                    smtpServer,
                });
                
                err.code = 400;
            } else if (error.code === 'ECONNECTION') {
                err = new Error(
                    'Please check your host and port settings again.'
                );
                await EmailStatusService.create({
                    
                    from: mailOptions.from,
                    
                    to: mailOptions.to,
                    
                    subject: mailOptions.subject,
                    
                    template: mailOptions.template,
                    status: 'Error',
                    content: EmailBody,
                    err: err.message,
                    smtpServer,
                });
                
                err.code = 400;
            } else {
                err = new Error('Please check your settings again.');
                await EmailStatusService.create({
                    
                    from: mailOptions.from,
                    
                    to: mailOptions.to,
                    
                    subject: mailOptions.subject,
                    
                    template: mailOptions.template,
                    status: 'Error',
                    content: EmailBody,
                    err: err.message,
                    smtpServer,
                });
                
                err.code = 400;
            }
            ErrorService.log('mailService.testSmtpConfig', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw err;
        }
    },

    sendChangePlanMail: async function(
        projectName: $TSFixMe,
        oldPlan: $TSFixMe,
        newPlan: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: 'Change of Subscription Plan',
                    template: 'changed_subscription_plan',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: projectName,
                        oldPlan: oldPlan,
                        newPlan: newPlan,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: 'Change of Subscription Plan',
                                template: 'changed_subscription_plan',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: projectName,
                                    oldPlan: oldPlan,
                                    newPlan: newPlan,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendChangePlanMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendCreateProjectMail: async function(
        projectName: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }

                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: 'New Project',
                    template: 'create_project',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: projectName,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: 'New Project',
                                template: 'create_project',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: projectName,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendCreateProjectMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendCreateSubProjectMail: async function(
        subProjectName: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: 'New Sub-Project',
                    template: 'create_subproject',
                    context: {
                        
                        homeURL: global.homeHost,
                        subProjectName: subProjectName,
                        
                        dashboardURL: global.dashboardHost,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: 'New Sub-Project',
                                template: 'create_subproject',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    subProjectName: subProjectName,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendCreateSubProjectMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendUpgradeToEnterpriseMail: async function(
        projectName: $TSFixMe,
        projectId: $TSFixMe,
        oldPlan: $TSFixMe,
        email: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: 'support@oneuptime.com',
                    subject: 'Upgrade to enterprise plan request from ' + email,
                    template: 'enterprise_upgrade',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName: projectName,
                        projectId: projectId,
                        oldPlan: oldPlan,
                        email: email,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: 'support@oneuptime.com',
                                subject:
                                    'Upgrade to enterprise plan request from ' +
                                    email,
                                template: 'enterprise_upgrade',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName: projectName,
                                    projectId: projectId,
                                    oldPlan: oldPlan,
                                    email: email,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendUpgradeToEnterpriseMail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },

    sendPaymentFailedEmail: async function(
        projectName: $TSFixMe,
        email: $TSFixMe,
        name: $TSFixMe,
        chargeAttemptStage: $TSFixMe,
        invoiceUrl: $TSFixMe
    ) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: email,
                    subject: 'Subscription Payment Failed',
                    template: 'subscription_payment_failed',
                    context: {
                        
                        homeURL: global.homeHost,
                        projectName,
                        name,
                        chargeAttemptStage,
                        
                        dashboardURL: global.dashboardHost,
                        invoiceUrl,
                    },
                };
                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: email,
                                subject: 'Subscription Payment Failed',
                                template: 'subscription_payment_failed',
                                context: {
                                    
                                    homeURL: global.homeHost,
                                    projectName,
                                    name,
                                    chargeAttemptStage,
                                    
                                    dashboardURL: global.dashboardHost,
                                },
                            };
                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendPaymentFailedEmail', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    hasCustomSmtpSettings: async (projectId: $TSFixMe) => {
        const select =
            'projectId user pass host port from name iv secure enabled createdAt';
        const smtpConfigurations = await EmailSmtpService.findOneBy({
            query: { projectId, enabled: true },
            select,
            populate: [{ path: 'projectId', select: 'name' }],
        });
        return Object.keys(smtpConfigurations).length
            ? smtpConfigurations
            : false;
    },

    sendSlaNotification: async function({
        userEmail,
        name,
        projectId,
        incidentSla,
        monitorName,
        incidentUrl,
        projectName,
        componentName,
        incidentId,
        reason,
        incidentSlaTimeline,
        incidentSlaRemaining,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                mailOptions = {
                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                    to: userEmail,
                    subject: `About to Breach Incident SLA`,
                    template: 'sla_notification',
                    context: {
                        name: name ? name.split(' ')[0].toString() : '',
                        currentYear: new Date().getFullYear(),
                        incidentSla,
                        monitorName,
                        incidentUrl,
                        projectName,
                        componentName,
                        incidentId,
                        reason,
                        incidentSlaTimeline,
                        incidentSlaRemaining,
                    },
                };

                const mailer = await _this.createMailer(smtpSettings);
                EmailBody = await _this.getEmailBody(mailOptions);

                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            mailOptions = {
                                from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                to: userEmail,
                                subject: `About to Breach Incident SLA`,
                                template: 'sla_notification',
                                context: {
                                    name: name
                                        ? name.split(' ')[0].toString()
                                        : '',
                                    currentYear: new Date().getFullYear(),
                                    incidentSla,
                                    monitorName,
                                    incidentUrl,
                                    projectName,
                                    componentName,
                                    incidentId,
                                    reason,
                                    incidentSlaTimeline,
                                    incidentSlaRemaining,
                                },
                            };

                            const mailer = await _this.createMailer(
                                smtpSettings
                            );
                            EmailBody = await _this.getEmailBody(mailOptions);

                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);
                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendSlaNotification', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendSlaBreachNotification: async function({
        userEmail,
        name,
        projectId,
        incidentSla,
        monitorName,
        incidentUrl,
        projectName,
        componentName,
        incidentId,
        reason,
        incidentSlaTimeline,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let smtpSettings = await _this.getProjectSmtpSettings(projectId);
            if (!isEmpty(smtpSettings)) {
                smtpServer = 'internal';
                if (!smtpSettings.internalSmtp) {
                    smtpServer = smtpSettings.host;
                }
                mailOptions = {
                    from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                    to: userEmail,
                    subject: `Breached Incident SLA`,
                    template: 'breach_sla_notification',
                    context: {
                        name: name ? name.split(' ')[0].toString() : '',
                        currentYear: new Date().getFullYear(),
                        incidentSla,
                        monitorName,
                        incidentUrl,
                        projectName,
                        componentName,
                        incidentId,
                        reason,
                        incidentSlaTimeline,
                    },
                };

                const mailer = await _this.createMailer(smtpSettings);
                EmailBody = await _this.getEmailBody(mailOptions);
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            smtpSettings.internalSmtp &&
                            smtpSettings.customSmtp &&
                            !isEmpty(smtpSettings.backupConfig)
                        ) {
                            
                            smtpServer = smtpSettings.backupConfig.host;
                            smtpSettings = { ...smtpSettings.backupConfig };

                            mailOptions = {
                                from: `"${smtpSettings.name}" <${smtpSettings.from}>`,
                                to: userEmail,
                                subject: `Breached Incident SLA`,
                                template: 'breach_sla_notification',
                                context: {
                                    name: name
                                        ? name.split(' ')[0].toString()
                                        : '',
                                    currentYear: new Date().getFullYear(),
                                    incidentSla,
                                    monitorName,
                                    incidentUrl,
                                    projectName,
                                    componentName,
                                    incidentId,
                                    reason,
                                    incidentSlaTimeline,
                                },
                            };

                            const mailer = await _this.createMailer(
                                smtpSettings
                            );
                            EmailBody = await _this.getEmailBody(mailOptions);
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendSlaBreachNotification', error);
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendUnpaidSubscriptionReminder: async function({
        projectName,
        projectPlan,
        name,
        userEmail,
        projectUrl,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                accountMail.name = 'OneUptime Support';
                accountMail.from = 'support@oneuptime.com';
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: userEmail,
                    replyTo: accountMail.from,
                    cc: accountMail.from,
                    subject: 'Unpaid Project Subscription',
                    template: 'unpaid_sub_notification',
                    context: {
                        projectName,
                        name: name.split(' ')[0].toString(),
                        currentYear: new Date().getFullYear(),
                        projectPlan: projectPlan.details,
                        projectUrl,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };
                            
                            accountMail.name = 'OneUptime Support';
                            
                            accountMail.from = 'support@oneuptime.com';

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: userEmail,
                                replyTo: accountMail.from,
                                cc: accountMail.from,
                                subject: 'Unpaid Project Subscription',
                                template: 'unpaid_sub_notification',
                                context: {
                                    projectName,
                                    name: name.split(' ')[0].toString(),
                                    currentYear: new Date().getFullYear(),
                                    projectPlan: projectPlan.details,
                                    projectUrl,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendUnpaidSubscriptionReminder',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
    sendUnpaidSubscriptionProjectDelete: async function({
        projectName,
        projectPlan,
        name,
        userEmail,
    }: $TSFixMe) {
        let mailOptions = {};
        let EmailBody;
        let smtpServer;
        try {
            let accountMail = await _this.getSmtpSettings();
            if (!isEmpty(accountMail)) {
                accountMail.name = 'OneUptime Support';
                accountMail.from = 'support@oneuptime.com';
                smtpServer = 'internal';
                if (!accountMail.internalSmtp) {
                    smtpServer = accountMail.host;
                }
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    to: userEmail,
                    replyTo: accountMail.from,
                    cc: accountMail.from,
                    subject:
                        'Unpaid Project Subscription - Project Deactivated',
                    template: 'unpaid_sub_delete_project',
                    context: {
                        projectName,
                        name: name.split(' ')[0].toString(),
                        currentYear: new Date().getFullYear(),
                        projectPlan: projectPlan.details,
                    },
                };

                const [mailer, emailBody] = await Promise.all([
                    _this.createMailer({}),
                    _this.getEmailBody(mailOptions),
                ]);
                EmailBody = emailBody;
                if (!mailer) {
                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                        smtpServer,
                    });
                    return;
                }

                let info = {};
                try {
                    info = await mailer.sendMail(mailOptions);

                    await EmailStatusService.create({
                        
                        from: mailOptions.from,
                        
                        to: mailOptions.to,
                        
                        subject: mailOptions.subject,
                        
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                        smtpServer,
                    });
                } catch (error) {
                    if (error.code === 'ECONNECTION') {
                        if (
                            accountMail.internalSmtp &&
                            accountMail.customSmtp &&
                            !isEmpty(accountMail.backupConfig)
                        ) {
                            
                            smtpServer = accountMail.backupConfig.host;
                            accountMail = { ...accountMail.backupConfig };
                            
                            accountMail.name = 'OneUptime Support';
                            
                            accountMail.from = 'support@oneuptime.com';

                            mailOptions = {
                                from: `"${accountMail.name}" <${accountMail.from}>`,
                                to: userEmail,
                                replyTo: accountMail.from,
                                cc: accountMail.from,
                                subject:
                                    'Unpaid Project Subscription - Project Deactivated',
                                template: 'unpaid_sub_delete_project',
                                context: {
                                    projectName,
                                    name: name.split(' ')[0].toString(),
                                    currentYear: new Date().getFullYear(),
                                    projectPlan: projectPlan.details,
                                },
                            };

                            const [mailer, emailBody] = await Promise.all([
                                _this.createMailer(accountMail),
                                _this.getEmailBody(mailOptions),
                            ]);
                            EmailBody = emailBody;
                            if (!mailer) {
                                await EmailStatusService.create({
                                    
                                    from: mailOptions.from,
                                    
                                    to: mailOptions.to,
                                    
                                    subject: mailOptions.subject,
                                    
                                    template: mailOptions.template,
                                    status: 'Email not enabled.',
                                    content: EmailBody,
                                    error: 'Email not enabled.',
                                    smtpServer,
                                });
                                return;
                            }

                            info = await mailer.sendMail(mailOptions);

                            await EmailStatusService.create({
                                
                                from: mailOptions.from,
                                
                                to: mailOptions.to,
                                
                                subject: mailOptions.subject,
                                
                                template: mailOptions.template,
                                status: 'Success',
                                content: EmailBody,
                                smtpServer,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                }

                return info;
            }
        } catch (error) {
            ErrorService.log(
                'mailService.sendUnpaidSubscriptionProjectDelete',
                error
            );
            await EmailStatusService.create({
                
                from: mailOptions.from,
                
                to: mailOptions.to,
                
                subject: mailOptions.subject,
                
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
                smtpServer,
            });
            throw error;
        }
    },
};

export default _this;

const nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars');
const Handlebars = require('handlebars');
const Whitepapers = require('../config/whitepaper');
const ErrorService = require('./errorService');
const defaultEmailTemplates = require('../config/emailTemplate');
const GlobalConfigService = require('./globalConfigService');
const EmailSmtpService = require('./emailSmtpService');
const EmailStatusService = require('./emailStatusService');
const DateTime = require('../utils/DateTime');
const Path = require('path');
const fsp = require('fs/promises');

const helpers = {
    year: DateTime.getCurrentYear,
};

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

const _this = {
    getProjectSmtpSettings: async projectId => {
        let user, pass, host, port, from, name, secure;
        const smtpDb = await EmailSmtpService.findOneBy({
            projectId,
            enabled: true,
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
            name = smtpDb.name || 'Fyipe';
            secure = smtpDb.secure;
        } else {
            const globalSettings = await _this.getSmtpSettings();
            user = globalSettings.user;
            pass = globalSettings.pass;
            host = globalSettings.host;
            port = globalSettings.port;
            from = globalSettings.from;
            name = globalSettings.name;
            secure = globalSettings.secure;
        }

        return { user, pass, host, port, from, name, secure };
    },

    getEmailBody: async function(mailOptions) {
        try {
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
        } catch (error) {
            ErrorService.log('mailService.getEmailBody', error);
        }
    },
    createMailer: async function({ host, port, user, pass, secure }) {
        if (!host || !user || !pass) {
            const settings = await _this.getSmtpSettings();
            host = settings.host;
            port = settings.port;
            user = settings.user;
            pass = settings.pass;
            secure = settings.secure;

            if (!settings['email-enabled']) {
                return null;
            }
        }

        const privateMailer = nodemailer.createTransport({
            host: host,
            port: port,
            secure: secure,
            auth: {
                user: user,
                pass: pass,
            },
        });

        privateMailer.use('compile', hbs(options));
        return privateMailer;
    },

    getSmtpSettings: async () => {
        const document = await GlobalConfigService.findOneBy({ name: 'smtp' });
        if (document && document.value) {
            return {
                user: document.value.email,
                pass: document.value.password,
                host: document.value['smtp-server'],
                port: document.value['smtp-port'],
                from: document.value['from'],
                name: document.value['from-name'] || 'Fyipe',
                secure: document.value['smtp-secure'],
                'email-enabled': document.value['email-enabled'],
            };
        }

        const error = new Error('SMTP settings not found.');
        ErrorService.log('mailService.getSmtpSettings', error);
        throw error;
    },

    getTemplates: async (emailTemplate, emailType) => {
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
    sendSignupMail: async function(userEmail, name) {
        const accountMail = await _this.getSmtpSettings();
        let mailOptions = {};
        let EmailBody;
        try {
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: userEmail,
                subject: 'Welcome to Fyipe.',
                template: 'sign_up_body',
                context: {
                    homeURL: global.homeHost,
                    name: name.split(' ')[0].toString(),
                    dashboardURL: global.dashboardHost,
                },
            };

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });

            return info;
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
            });
            throw error;
        }
    },
    // Automated email sent when a user deletes a project
    sendDeleteProjectEmail: async function({ userEmail, name, projectName }) {
        const accountMail = await _this.getSmtpSettings();
        accountMail.name = 'Fyipe Support';
        accountMail.from = 'support@fyipe.com';
        let mailOptions = {};
        let EmailBody;
        try {
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

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);

            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });

            return info;
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
            });
            throw error;
        }
    },
    sendVerifyEmail: async function(tokenVerifyURL, name, email) {
        let mailOptions = {};
        let EmailBody;
        const accountMail = await _this.getSmtpSettings();
        try {
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: '[Fyipe] Verify your Email',
                template: 'send_verification_email',
                context: {
                    homeURL: global.homeHost,
                    tokenVerifyURL,
                    name: name.split(' ')[0].toString(),
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },
    sendLeadEmailToFyipeTeam: async function(lead) {
        let mailOptions = {};
        let EmailBody;
        const accountMail = await _this.getSmtpSettings();
        try {
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: 'noreply@fyipe.com',
                subject: 'New Lead Added',
                template: 'lead_to_fyipe_team',
                context: {
                    homeURL: global.homeHost,
                    text: JSON.stringify(lead, null, 2),
                },
            };

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);

            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendLeadEmailToFyipeTeam', error);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Error',
                content: EmailBody,
                error: error.message,
            });
            throw error;
        }
    },

    sendUserFeedbackResponse: async function(userEmail, name) {
        let mailOptions = {};
        let EmailBody;
        const accountMail = await _this.getSmtpSettings();
        try {
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

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendRequestDemoEmail: async function(to) {
        let mailOptions = {};
        let EmailBody;
        try {
            if (!to) {
                const error = new Error('Email not found');
                error.code = 400;
                throw error;
            } else {
                const accountMail = await _this.getSmtpSettings();
                mailOptions = {
                    from: `"${accountMail.name}" <${accountMail.from}>`,
                    cc: 'noreply@fyipe.com',
                    to: to,
                    subject: 'Thank you for your demo request.',
                    template: 'request_demo_body',
                };
                EmailBody = await _this.getEmailBody(mailOptions);
                const mailer = await _this.createMailer({});

                if (!mailer) {
                    await EmailStatusService.create({
                        from: mailOptions.from,
                        to: mailOptions.to,
                        subject: mailOptions.subject,
                        template: mailOptions.template,
                        status: 'Email not enabled.',
                        content: EmailBody,
                        error: 'Email not enabled.',
                    });
                    return;
                }

                const info = await mailer.sendMail(mailOptions);
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Success',
                    content: EmailBody,
                });
                return info;
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
            });
            throw error;
        }
    },

    sendWhitepaperEmail: async function(to, whitepaperName) {
        let mailOptions = {};
        let EmailBody;
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
                    const accountMail = await _this.getSmtpSettings();
                    mailOptions = {
                        from: `"${accountMail.name}" <${accountMail.from}>`,
                        cc: 'noreply@fyipe.com',
                        to: to,
                        subject: "Here's your Whitepaper",
                        template: 'whitepaper_body',
                        context: {
                            homeURL: global.homeHost,
                            link: link,
                        },
                    };

                    const mailer = await _this.createMailer({});
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
                        });
                        return;
                    }

                    const info = await mailer.sendMail(mailOptions);
                    await EmailStatusService.create({
                        from: mailOptions.from,
                        to: mailOptions.to,
                        subject: mailOptions.subject,
                        template: mailOptions.template,
                        status: 'Success',
                        content: EmailBody,
                    });
                    return info;
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
    sendForgotPasswordMail: async function(forgotPasswordURL, email) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: 'Password Reset for Fyipe',
                template: 'forgot_password_body',
                context: {
                    homeURL: global.homeHost,
                    forgotPasswordURL,
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    // Description: Mails to user after their password has been successfully set.
    // Params:
    // Param 1: email: Email of user
    // Returns: promise
    sendResetPasswordConfirmMail: async function(email) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
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
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    // Description: Mail to users for registering  after they have been added by Admin to Project.
    // Params:
    // Param 1: userEmail: Email of users
    // Returns: promise
    sendNewUserAddedToProjectMail: async function(
        project,
        addedByUser,
        email,
        registerUrl
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been added to a project on Fyipe",
                template: 'new_user_added_to_project_body',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    registerUrl,
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendExistingUserAddedToProjectMail: async function(
        project,
        addedByUser,
        email
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been added to a project on Fyipe",
                template: 'existing_user_added_to_project_body',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    dashboardURL: global.dashboardHost,
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendExistingStatusPageViewerMail: async function(
        subProject,
        addedByUser,
        email
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been added to a sub-project on Fyipe",
                template: 'existing_viewer_added_to_project_body',
                context: {
                    homeURL: global.homeHost,
                    subProjectName: subProject.name,
                    userName: addedByUser.name,
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendExistingUserAddedToSubProjectMail: async function(
        project,
        addedByUser,
        email
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been added to a subproject on Fyipe",
                template: 'existing_user_added_to_subproject_body',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    dashboardURL: global.dashboardHost,
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendNewStatusPageViewerMail: async function(project, addedByUser, email) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been added to a project on Fyipe",
                template: 'new_viewer_added_to_project',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    accountsURL: global.homeHost + '/accounts',
                },
            };
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendChangeRoleEmailToUser: async function(
        project,
        addedByUser,
        email,
        role
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
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

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendRemoveFromProjectEmailToUser: async function(
        project,
        removedByUser,
        email
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been removed from a project on Fyipe",
                template: 'removed_from_project',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: removedByUser.name,
                    dashboardURL: global.dashboardHost,
                },
            };

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendRemoveFromSubProjectEmailToUser: async function(
        subProject,
        removedByUser,
        email
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: "You've been removed from a subproject on Fyipe",
                template: 'removed_from_subproject',
                context: {
                    homeURL: global.homeHost,
                    subProjectName: subProject.name,
                    userName: removedByUser.name,
                    dashboardURL: global.dashboardHost,
                },
            };

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
    }) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getProjectSmtpSettings(projectId);
            let iconColor = '#94c800';
            let incidentShow = 'Offline';
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
            const iconStyle = `display:inline-block;width:16px;height:16px;background:${iconColor};border-radius:16px`;
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: email,
                subject: `Incident ${incidentId} - ${componentName}/${monitorName} is ${incidentShow}`,
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
        incidentTime,
        monitorName,
        email,
        userId,
        userName,
        incident,
        projectName,
        emailTemplate,
        trackEmailAsViewedUrl,
        componentName,
        statusPageUrl,
        replyAddress,
        customFields
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Incident Created'
            );
            const data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                trackEmailAsViewedUrl,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
                componentName,
                statusPageUrl,
                year: DateTime.getCurrentYear,
                ...customFields,
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
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
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
            });
            return info;
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
    }) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getProjectSmtpSettings(projectId);
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
    }) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getProjectSmtpSettings(projectId);
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
        incidentTime,
        monitorName,
        email,
        userId,
        userName,
        incident,
        projectName,
        emailTemplate,
        trackEmailAsViewedUrl,
        componentName,
        statusPageUrl,
        replyAddress,
        customFields
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Incident Acknowldeged'
            );
            const data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                trackEmailAsViewedUrl,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
                componentName,
                statusPageUrl,
                year: DateTime.getCurrentYear,
                ...customFields,
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
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
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
            });
            return info;
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
        incidentTime,
        monitorName,
        email,
        userId,
        userName,
        incident,
        projectName,
        emailTemplate,
        componentName,
        incidentNote,
        statusPageUrl,
        statusNoteStatus,
        customFields
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Investigation note is created'
            );
            const data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
                componentName,
                incidentNote,
                statusPageUrl,
                statusNoteStatus,
                ...customFields,
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
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
            const info = await privateMailer.sendMail(mailOptions);
            EmailBody = await _this.getEmailBody(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
            });
            return info;
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
        incidentTime,
        monitorName,
        email,
        userId,
        userName,
        incident,
        projectName,
        emailTemplate,
        trackEmailAsViewedUrl,
        componentName,
        statusPageUrl,
        replyAddress,
        customFields
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            let { template, subject } = await _this.getTemplates(
                emailTemplate,
                'Subscriber Incident Resolved'
            );
            const data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                trackEmailAsViewedUrl,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
                componentName,
                statusPageUrl,
                year: DateTime.getCurrentYear,
                ...customFields,
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
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
                ...(mailOptions.replyTo && { replyTo: mailOptions.replyTo }),
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    testSmtpConfig: async function(data) {
        let mailOptions = {};
        let EmailBody;
        try {
            const privateMailer = await _this.createMailer(data);
            mailOptions = {
                from: `"${data.name}" <${data.from}>`,
                to: data.email,
                subject: 'Email Smtp Settings Test',
                template: 'smtp_test',
                context: {
                    homeURL: global.homeHost,
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
            });
            throw err;
        }
    },

    sendChangePlanMail: async function(projectName, oldPlan, newPlan, email) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
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

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendCreateProjectMail: async function(projectName, email) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();

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

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendCreateSubProjectMail: async function(subProjectName, email) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
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
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendUpgradeToEnterpriseMail: async function(
        projectName,
        projectId,
        oldPlan,
        email
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: 'support@fyipe.com',
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
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },

    sendPaymentFailedEmail: async function(
        projectName,
        email,
        name,
        chargeAttemptStage
    ) {
        let mailOptions = {};
        let EmailBody;
        try {
            const accountMail = await _this.getSmtpSettings();
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
            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });
            return info;
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
            });
            throw error;
        }
    },
    hasCustomSmtpSettings: async projectId => {
        const smtpConfigurations = await EmailSmtpService.findOneBy({
            projectId,
            enabled: true,
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
    }) {
        const smtpSettings = await _this.getProjectSmtpSettings(projectId);
        let mailOptions = {};
        let EmailBody;
        try {
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);

            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });

            return info;
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
    }) {
        const smtpSettings = await _this.getProjectSmtpSettings(projectId);
        let mailOptions = {};
        let EmailBody;
        try {
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);

            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });

            return info;
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
    }) {
        const accountMail = await _this.getSmtpSettings();
        accountMail.name = 'Fyipe Support';
        accountMail.from = 'support@fyipe.com';
        let mailOptions = {};
        let EmailBody;
        try {
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

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);

            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });

            return info;
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
            });
            throw error;
        }
    },
    sendUnpaidSubscriptionProjectDelete: async function({
        projectName,
        projectPlan,
        name,
        userEmail,
    }) {
        const accountMail = await _this.getSmtpSettings();
        accountMail.name = 'Fyipe Support';
        accountMail.from = 'support@fyipe.com';
        let mailOptions = {};
        let EmailBody;
        try {
            mailOptions = {
                from: `"${accountMail.name}" <${accountMail.from}>`,
                to: userEmail,
                replyTo: accountMail.from,
                cc: accountMail.from,
                subject: 'Unpaid Project Subscription - Project Deactivated',
                template: 'unpaid_sub_delete_project',
                context: {
                    projectName,
                    name: name.split(' ')[0].toString(),
                    currentYear: new Date().getFullYear(),
                    projectPlan: projectPlan.details,
                },
            };

            const mailer = await _this.createMailer({});
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
                });
                return;
            }

            const info = await mailer.sendMail(mailOptions);

            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
                content: EmailBody,
            });

            return info;
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
            });
            throw error;
        }
    },
};

module.exports = _this;

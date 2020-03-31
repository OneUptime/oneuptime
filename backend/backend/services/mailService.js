const nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars');
const Handlebars = require('handlebars');
const Whitepapers = require('../config/whitepaper');
const ErrorService = require('./errorService');
const defaultEmailTemplates = require('../config/emailTemplate');
const GlobalConfigService = require('./globalConfigService');
const EmailSmtpService = require('./emailSmtpService');
const EmailStatusService = require('./emailStatusService');

const options = {
    viewEngine: {
        extname: '.hbs',
        layoutsDir: 'views/email/',
        defaultLayout: 'template',
        partialsDir: 'views/partials/',
    },
    viewPath: 'views/email/',
    extName: '.hbs',
};

const _this = {
    getProjectSmtpSettings: async projectId => {
        let {
            user,
            pass,
            host,
            port,
            from,
            secure,
        } = await _this.getSmtpSettings();
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
            secure = smtpDb.secure;
        } else {
            const globalSettings = await _this.getSmtpSettings();
            user = globalSettings.user;
            pass = globalSettings.pass;
            host = globalSettings.host;
            port = globalSettings.port;
            from = globalSettings.from;
            secure = globalSettings.secure;
        }

        return { user, pass, host, port, from, secure };
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
                from: document.value['from-name'],
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
        try {
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: userEmail,
                subject: 'Welcome to Fyipe.',
                template: 'sign_up_body',
                context: {
                    homeURL: global.homeHost,
                    name: name.split(' ')[0].toString(),
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },
    sendVerifyEmail: async function(tokenVerifyURL, name, email) {
        let mailOptions = {};
        const accountMail = await _this.getSmtpSettings();
        try {
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: '[Fyipe] Verify your Email',
                template: 'send_verification_email',
                context: {
                    homeURL: global.homeHost,
                    tokenVerifyURL,
                    name: name.split(' ')[0].toString(),
                },
            };
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
                });
                return;
            }

            const mailer = await _this.createMailer({});
            const info = await mailer.sendMail(mailOptions);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Success',
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
            });
            throw error;
        }
    },
    sendLeadEmailToFyipeTeam: async function(lead) {
        let mailOptions = {};
        const accountMail = await _this.getSmtpSettings();
        try {
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: 'noreply@fyipe.com',
                subject: 'New Lead Added',
                template: 'lead_to_fyipe_team',
                context: {
                    homeURL: global.homeHost,
                    text: JSON.stringify(lead, null, 2),
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    sendUserFeedbackResponse: async function(userEmail, name) {
        let mailOptions = {};
        const accountMail = await _this.getSmtpSettings();
        try {
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: userEmail,
                subject: 'Thank you for your feedback!',
                template: 'feedback_response',
                context: {
                    homeURL: global.homeHost,
                    name: name.split(' ')[0].toString(),
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    sendRequestDemoEmail: async function(to) {
        let mailOptions = {};
        try {
            if (!to) {
                const error = new Error('Email not found');
                error.code = 400;
                throw error;
            } else {
                const accountMail = await _this.getSmtpSettings();
                mailOptions = {
                    from: '"Fyipe " <' + accountMail.from + '>',
                    cc: 'noreply@fyipe.com',
                    to: to,
                    subject: 'Thank you for your demo request.',
                    template: 'request_demo_body',
                };

                const mailer = await _this.createMailer({});

                if (!mailer) {
                    await EmailStatusService.create({
                        from: mailOptions.from,
                        to: mailOptions.to,
                        subject: mailOptions.subject,
                        template: mailOptions.template,
                        status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    sendWhitepaperEmail: async function(to, whitepaperName) {
        let mailOptions = {};
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
                        from: '"Fyipe " <' + accountMail.from + '>',
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

                    if (!mailer) {
                        await EmailStatusService.create({
                            from: mailOptions.from,
                            to: mailOptions.to,
                            subject: mailOptions.subject,
                            template: mailOptions.template,
                            status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Password Reset for Fyipe',
                template: 'forgot_password_body',
                context: {
                    homeURL: global.homeHost,
                    forgotPasswordURL,
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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

        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Your password has been changed.',
                template: 'reset_password_body',
                context: {
                    homeURL: global.homeHost,
                    accountsURL: global.homeHost + '/accounts',
                },
            };
            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
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
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: "You've been added to a project on Fyipe",
                template: 'existing_user_added_to_project_body',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };
            const mailer = await _this.createMailer({});
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
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
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: "You've been added to a subproject on Fyipe",
                template: 'existing_user_added_to_subproject_body',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };
            const mailer = await _this.createMailer({});
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    sendNewStatusPageViewerMail: async function(project, addedByUser, email) {
        let mailOptions = {};
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
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
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: "You've been assigned a new role",
                template: 'change_role',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: addedByUser.name,
                    role: role,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: "You've been removed from a project on Fyipe",
                template: 'removed_from_project',
                context: {
                    homeURL: global.homeHost,
                    projectName: project.name,
                    userName: removedByUser.name,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: "You've been removed from a subproject on Fyipe",
                template: 'removed_from_subproject',
                context: {
                    homeURL: global.homeHost,
                    subProjectName: subProject.name,
                    userName: removedByUser.name,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: `${projectName}/${monitorName} is ${incidentType}`,
                template: 'new_incident_created',
                context: {
                    homeURL: global.homeHost,
                    incidentTime: incidentTime,
                    monitorName: monitorName,
                    accessToken,
                    firstName,
                    userId,
                    projectId,
                    acknowledgeUrl,
                    resolveUrl,
                    incidentType,
                    projectName,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };
            const mailer = await _this.createMailer({});
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        trackEmailAsViewedUrl
    ) {
        let mailOptions = {};
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
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
            const privateMailer = await _this.createMailer(smtpSettings);
            mailOptions = {
                from: '"Fyipe " <' + smtpSettings.from + '>',
                to: email,
                subject: subject,
                template: 'template',
                context: {
                    body: template,
                },
            };

            if (!privateMailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        trackEmailAsViewedUrl
    ) {
        let mailOptions = {};
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
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
            const privateMailer = await _this.createMailer(smtpSettings);
            mailOptions = {
                from: '"Fyipe " <' + smtpSettings.from + '>',
                to: email,
                subject: subject,
                template: 'template',
                context: {
                    body: template,
                },
            };
            if (!privateMailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        trackEmailAsViewedUrl
    ) {
        let mailOptions = {};
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
            };
            template = template(data);
            subject = subject(data);
            const smtpSettings = await _this.getProjectSmtpSettings(
                incident.projectId
            );
            const privateMailer = await _this.createMailer({});
            mailOptions = {
                from: '"Fyipe " <' + smtpSettings.from + '>',
                to: email,
                subject: subject,
                template: 'template',
                context: {
                    homeURL: global.homeHost,
                    body: template,
                },
            };
            if (!privateMailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    testSmtpConfig: async function(data) {
        let mailOptions = {};
        try {
            const privateMailer = await _this.createMailer(data);
            mailOptions = {
                from: '"Fyipe " <' + data.from + '>',
                to: data.email,
                subject: 'Email Smtp Settings Test',
                template: 'smtp_test',
                context: {
                    homeURL: global.homeHost,
                },
            };
            if (!privateMailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            return info;
        } catch (error) {
            let err;
            if (error.code === 'EAUTH') {
                err = new Error('Username and Password not accepted.');
                err.code = 400;
            } else if (error.code === 'ECONNECTION') {
                err = new Error(
                    'Please check your host and port settings again.'
                );
                err.code = 400;
            } else {
                err = new Error('Please check your settings again.');
                err.code = 400;
            }
            ErrorService.log('mailService.testSmtpConfig', error);
            await EmailStatusService.create({
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
                template: mailOptions.template,
                status: 'Error',
            });
            throw err;
        }
    },

    sendChangePlanMail: async function(projectName, oldPlan, newPlan, email) {
        let mailOptions = {};
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Change of Subscription Plan',
                template: 'changed_subscription_plan',
                context: {
                    homeURL: global.homeHost,
                    projectName: projectName,
                    oldPlan: oldPlan,
                    newPlan: newPlan,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    sendCreateProjectMail: async function(projectName, email) {
        let mailOptions = {};
        try {
            const accountMail = await _this.getSmtpSettings();

            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'New Project',
                template: 'create_project',
                context: {
                    homeURL: global.homeHost,
                    projectName: projectName,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };

            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },

    sendCreateSubProjectMail: async function(subProjectName, email) {
        let mailOptions = {};
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'New Sub-Project',
                template: 'create_subproject',
                context: {
                    homeURL: global.homeHost,
                    subProjectName: subProjectName,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };
            const mailer = await _this.createMailer({});

            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
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
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
        try {
            const accountMail = await _this.getSmtpSettings();
            mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Subscription Payment Failed',
                template: 'subscription_payment_failed',
                context: {
                    homeURL: global.homeHost,
                    projectName,
                    name,
                    chargeAttemptStage,
                    dashboardURL: global.dashboardHost + '/dashbord',
                },
            };
            const mailer = await _this.createMailer({});
            if (!mailer) {
                await EmailStatusService.create({
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    template: mailOptions.template,
                    status: 'Email not enabled.',
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
            });
            throw error;
        }
    },
};

module.exports = _this;

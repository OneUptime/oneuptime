var nodemailer = require('nodemailer');
var accountMail = require('../config/mail');
var hbs = require('nodemailer-express-handlebars');
var Handlebars = require('handlebars');
var Whitepapers = require('../config/whitepaper');
var ErrorService = require('./errorService');
var defaultEmailTemplates = require('../config/emailTemplate');
var EmailSmtpService = require('./emailSmtpService');
var { ACCOUNTS_HOST, DASHBOARD_HOST, HOME_HOST } = process.env;

var options = {
    viewEngine: {
        extname: '.hbs',
        layoutsDir: 'views/email/',
        defaultLayout: 'template',
        partialsDir: 'views/partials/'
    },
    viewPath: 'views/email/',
    extName: '.hbs'
};


var mailer = nodemailer.createTransport({
    host: accountMail.host,
    port: accountMail.port,
    secure: accountMail.secure,
    auth: {
        user: accountMail.user,
        pass: accountMail.pass,
    },
});

mailer.use('compile', hbs(options));

var getTemplates = async (emailTemplate, emailType) => {
    var defaultTemplate = defaultEmailTemplates.filter(template => template.emailType === emailType);
    var emailContent = defaultTemplate[0].body;
    var emailSubject = defaultTemplate[0].subject;

    if (emailTemplate != null && emailTemplate != undefined && emailTemplate.body) {
        emailContent = emailTemplate.body;
    }
    if (emailTemplate != null && emailTemplate != undefined && emailTemplate.subject) {
        emailSubject = emailTemplate.subject;
    }
    var template = await Handlebars.compile(emailContent);
    var subject = await Handlebars.compile(emailSubject);
    return { template, subject };
};

var getSmtpSettings = async (projectId) => {
    var { user, pass, host, port, from, secure } = accountMail;
    var smtpDb = await EmailSmtpService.findOneBy({ projectId, enabled: true });
    if (smtpDb && smtpDb.user && smtpDb.user !== null && smtpDb.user !== undefined) {
        user = smtpDb.user;
        pass = smtpDb.pass;
        host = smtpDb.host;
        port = smtpDb.port;
        from = smtpDb.from;
        secure = smtpDb.secure;
    }

    return { user, pass, host, port, from, secure };
};

var createMailer = async (host, port, user, pass, secure) => {
    let privateMailer = await nodemailer.createTransport({
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
};

module.exports = {

    // Description: Mails to user if they have successfully signed up.
    // Params:
    // Param 1: userEmail: Email of user
    // Returns: promise
    sendSignupMail: async function (userEmail, name) {

        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: userEmail,
                subject: 'Welcome to Fyipe.',
                template: 'sign_up_body',
                context: {
                    homeURL: HOME_HOST,
                    name: name.split(' ')[0].toString(),
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendMail', error);
            throw error;
        }
    },
    sendVerifyEmail: async function (tokenVerifyURL, name, email) {

        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Activate your Fyipe account',
                template: 'send_verification_email',
                context: {
                    homeURL: HOME_HOST,
                    tokenVerifyURL,
                    name: name.split(' ')[0].toString()
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendVerifyEmail', error);
            throw error;
        }
    },
    sendLeadEmailToFyipeTeam: async function (lead) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: 'noreply@fyipe.com',
                subject: 'New Lead Added',
                template: 'lead_to_fyipe_team',
                context: {
                    homeURL: HOME_HOST,
                    text: JSON.stringify(lead, null, 2)
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendLeadEmailToFyipeTeam', error);
            throw error;
        }
    },

    sendUserFeedbackResponse: async function (userEmail, name) {

        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: userEmail,
                subject: 'Thank you for your feedback!',
                template: 'feedback_response',
                context: {
                    homeURL: HOME_HOST,
                    name: name.split(' ')[0].toString()
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendUserFeedbackResponse', error);
            throw error;
        }
    },

    sendRequestDemoEmail: async function (to) {
        try {
            if (!to) {
                let error = new Error('Email not found');
                error.code = 400;
                throw error;
            }
            else {

                var mailOptions = {
                    from: '"Fyipe " <' + accountMail.from + '>',
                    cc: 'noreply@fyipe.com',
                    to: to,
                    subject: 'Thank you for your demo request.',
                    template: 'request_demo_body',
                };
                var info = await mailer.sendMail(mailOptions);
                return info;
            }
        } catch (error) {
            ErrorService.log('mailService.sendRequestDemoEmail', error);
            throw error;
        }
    },

    sendWhitepaperEmail: async function (to, whitepaperName) {
        try {
            if (!to || whitepaperName) {
                let error = new Error('Email or Whitepaper found');
                error.code = 400;
                ErrorService.log('mailService.sendWhitepaperEmail', error);
                throw error;
            }
            else {
                let link = null;

                for (var i = 0; i < Whitepapers.length; i++) {
                    if (Whitepapers[i].name === whitepaperName) {
                        link = Whitepapers[i].link;
                    }
                }


                if (!link) {
                    let error = new Error('Whitepaper not found');
                    error.code = 400;
                    ErrorService.log('mailService.sendWhitepaperEmail', error);
                    throw error;
                }
                else {
                    var mailOptions = {
                        from: '"Fyipe " <' + accountMail.from + '>',
                        cc: 'noreply@fyipe.com',
                        to: to,
                        subject: 'Here\'s your Whitepaper',
                        template: 'whitepaper_body',
                        context: {
                            homeURL: HOME_HOST,
                            link: link
                        }
                    };
                    var info = await mailer.sendMail(mailOptions);
                    return info;
                }
            }
        } catch (error) {
            ErrorService.log('mailService.sendWhitepaperEmail', error);
            throw error;
        }
    },

    // Description: Mails to user if they have requested for password reset
    // Params:
    // Param 1: host: url
    // Param 2: email: Email of user
    // Param 3: token: Password reset token
    // Returns: promise
    sendForgotPasswordMail: async function (forgotPasswordURL, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Password Reset for Fyipe',
                template: 'forgot_password_body',
                context: {
                    homeURL: HOME_HOST,
                    forgotPasswordURL
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendForgotPasswordMail', error);
            throw error;
        }
    },

    // Description: Mails to user after their password has been successfully set.
    // Params:
    // Param 1: email: Email of user
    // Returns: promise
    sendResetPasswordConfirmMail: async function (email) {

        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Your password has been changed.',
                template: 'reset_password_body',
                context: {
                    homeURL: HOME_HOST,
                    accountsURL: ACCOUNTS_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendResetPasswordConfirmMail', error);
            throw error;
        }
    },

    // Description: Mail to users for registering  after they have been added by Admin to Project.
    // Params:
    // Param 1: userEmail: Email of users
    // Returns: promise
    sendNewUserAddedToProjectMail: async function (project, addedByUser, email, registerUrl) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'You\'ve been added to a project on Fyipe',
                template: 'new_user_added_to_project_body',
                context: {
                    homeURL: HOME_HOST,
                    projectName: project.name,
                    userName: addedByUser.name,
                    registerUrl
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendNewUserAddedToProjectMail', error);
            throw error;
        }
    },

    sendExistingUserAddedToProjectMail: async function (project, addedByUser, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'You\'ve been added to a project on Fyipe',
                template: 'existing_user_added_to_project_body',
                context: {
                    homeURL: HOME_HOST,
                    projectName: project.name,
                    userName: addedByUser.name,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendExistingUserAddedToProjectMail', error);
            throw error;
        }
    },

    sendExistingStatusPageViewerMail: async function (subProject, addedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been added to a sub-project on Fyipe',
            template: 'existing_viewer_added_to_project_body',
            context: {
                homeURL: HOME_HOST,
                subProjectName: subProject.name,
                userName: addedByUser.name
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },

    sendExistingUserAddedToSubProjectMail: async function (project, addedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been added to a subproject on Fyipe',
            template: 'existing_user_added_to_subproject_body',
            context: {
                homeURL: HOME_HOST,
                projectName: project.name,
                userName: addedByUser.name,
                dashboardURL: DASHBOARD_HOST
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },

    sendNewStatusPageViewerMail: async function (project, addedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been added to a project on Fyipe',
            template: 'new_viewer_added_to_project',
            context: {
                homeURL: HOME_HOST,
                projectName: project.name,
                userName: addedByUser.name,
                accountsURL: ACCOUNTS_HOST
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },

    sendChangeRoleEmailToUser: async function (project, addedByUser, email, role) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'You\'ve been assigned a new role',
                template: 'change_role',
                context: {
                    homeURL: HOME_HOST,
                    projectName: project.name,
                    userName: addedByUser.name,
                    role: role,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendChangeRoleEmailToUser', error);
            throw error;
        }
    },

    sendRemoveFromProjectEmailToUser: async function (project, removedByUser, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'You\'ve been removed from a project on Fyipe',
                template: 'removed_from_project',
                context: {
                    homeURL: HOME_HOST,
                    projectName: project.name,
                    userName: removedByUser.name,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendRemoveFromProjectEmailToUser', error);
            throw error;
        }
    },

    sendRemoveFromSubProjectEmailToUser: async function (subProject, removedByUser, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'You\'ve been removed from a subproject on Fyipe',
                template: 'removed_from_subproject',
                context: {
                    homeURL: HOME_HOST,
                    subProjectName: subProject.name,
                    userName: removedByUser.name,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendRemoveFromSubProjectEmailToUser', error);
            throw error;
        }
    },

    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     * @param {string} ack_url API link that has requirements for acknowledging incident.
     * @param {string} resolve_url API link that has requirements for resolving incident.
     * @param {string} accessToken An access token to be used used to access API from email.
     */
    sendIncidentCreatedMail: async function (incidentTime, monitorName, email, userId, userName, projectId, ack_url, resolve_url, accessToken, incidentType) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'A new incident created',
            template: 'new_incident_created',
            context: {
                homeURL: HOME_HOST,
                incidentTime: incidentTime,
                monitorName: monitorName,
                accessToken,
                userName,
                userId,
                projectId,
                ack_url,
                resolve_url,
                incidentType,
                dashboardURL: DASHBOARD_HOST
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },


    /**
     * @param {js date object} incidentTime JS date of the incident used as timestamp.
     * @param {string} monitorName Name of monitor with incident.
     * @param {string} email Email of user being alerted.
     * @param {string} userId Id of the user.
     * @param {string} projectId Id of the project whose monitor has incident.
     */
    sendIncidentCreatedMailToSubscriber: async function (incidentTime, monitorName, email, userId, userName, incident, projectName, emailTemplate) {
        try {
            var { template, subject } = await getTemplates(emailTemplate, 'Subscriber Incident Created');
            let data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
            };
            template = template(data);
            subject = subject(data);
            var smtpSettings = await getSmtpSettings(incident.projectId);
            let privateMailer = await createMailer(smtpSettings.host, smtpSettings.port, smtpSettings.user, smtpSettings.pass, smtpSettings.secure);
            var mailOptions = {
                from: '"Fyipe " <' + smtpSettings.from + '>',
                to: email,
                subject: subject,
                template: 'template',
                context: {
                    body: template
                }
            };
            var info = await privateMailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendIncidentCreatedMailToSubscriber', error);
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
    sendIncidentAcknowledgedMailToSubscriber: async function (incidentTime, monitorName, email, userId, userName, incident, projectName, emailTemplate) {
        try {
            var { template, subject } = await getTemplates(emailTemplate, 'Subscriber Incident Acknowldeged');
            let data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
            };
            template = template(data);
            subject = subject(data);
            var smtpSettings = await getSmtpSettings(incident.projectId);
            let privateMailer = await createMailer(smtpSettings.host, smtpSettings.port, smtpSettings.user, smtpSettings.pass, smtpSettings.secure);
            var mailOptions = {
                from: '"Fyipe " <' + smtpSettings.from + '>',
                to: email,
                subject: subject,
                template: 'template',
                context: {
                    body: template
                }
            };
            var info = await privateMailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendIncidentCreatedMailToSubscriber', error);
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
    sendIncidentResolvedMailToSubscriber: async function (incidentTime, monitorName, email, userId, userName, incident, projectName, emailTemplate) {
        try {
            var { template, subject } = await getTemplates(emailTemplate, 'Subscriber Incident Resolved');
            let data = {
                incidentTime,
                monitorName,
                userName,
                userId,
                projectName,
                projectId: incident.projectId,
                incidentType: incident.incidentType,
            };
            template = template(data);
            subject = subject(data);
            var smtpSettings = await getSmtpSettings(incident.projectId);
            let privateMailer = await createMailer(smtpSettings.host, smtpSettings.port, smtpSettings.user, smtpSettings.pass, smtpSettings.secure);
            var mailOptions = {
                from: '"Fyipe " <' + smtpSettings.from + '>',
                to: email,
                subject: subject,
                template: 'template',
                context: {
                    homeURL: HOME_HOST,
                    body: template
                }
            };
            var info = await privateMailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendIncidentCreatedMailToSubscriber', error);
            throw error;
        }
    },

    testSmtpConfig: async function (data) {
        try {
            var privateMailer = await createMailer(data.host, data.port, data.user, data.pass, data.secure);
            var mailOptions = {
                from: '"Fyipe " <' + data.from + '>',
                to: data.email,
                subject: 'Email Smtp Settings Test',
                template: 'smtp_test',
                context: {
                    homeURL: HOME_HOST,
                }
            };
            var info = await privateMailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            let err;
            if (error.code === 'EAUTH') {
                err = new Error('Username and Password not accepted.');
                err.code = 400;
            }
            else if (error.code === 'ECONNECTION') {
                err = new Error('Please check your host and port settings again.');
                err.code = 400;
            }
            else {
                err = new Error('Please check your settings again.');
                err.code = 400;
            }
            ErrorService.log('mailService.testSmtpConfig', error);
            throw err;
        }
    },

    sendChangePlanMail: async function (projectName, oldPlan, newPlan, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Change of Subscription Plan',
                template: 'changed_subscription_plan',
                context: {
                    homeURL: HOME_HOST,
                    projectName: projectName,
                    oldPlan: oldPlan,
                    newPlan: newPlan,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailService.sendChangePlanMail', error);
            throw error;
        }
        return info;
    },

    sendCreateProjectMail: async function (projectName, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'New Project',
                template: 'create_project',
                context: {
                    homeURL: HOME_HOST,
                    projectName: projectName,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailService.sendCreateProjectMail', error);
            throw error;
        }
        return info;
    },

    sendCreateSubProjectMail: async function (subProjectName, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'New Sub-Project',
            template: 'create_subproject',
            context: {
                homeURL: HOME_HOST,
                subProjectName: subProjectName,
                dashboardURL: DASHBOARD_HOST
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },

    sendUpgradeToEnterpriseMail: async function (projectName, projectId, oldPlan, email) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: 'support@fyipe.com',
                subject: 'Upgrade to enterprise plan request from ' + email,
                template: 'enterprise_upgrade',
                context: {
                    homeURL: HOME_HOST,
                    projectName: projectName,
                    projectId: projectId,
                    oldPlan: oldPlan,
                    email: email
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendUpgradeToEnterpriseMail', error);
            throw error;
        }
    },

    sendPaymentFailedEmail: async function (projectName, email, name, chargeAttemptStage) {
        try {
            var mailOptions = {
                from: '"Fyipe " <' + accountMail.from + '>',
                to: email,
                subject: 'Subscription Payment Failed',
                template: 'subscription_payment_failed',
                context: {
                    homeURL: HOME_HOST,
                    projectName,
                    name,
                    chargeAttemptStage,
                    dashboardURL: DASHBOARD_HOST
                }
            };
            var info = await mailer.sendMail(mailOptions);
            return info;
        } catch (error) {
            ErrorService.log('mailService.sendPaymentFailedEmail', error);
            throw error;
        }
    }
};

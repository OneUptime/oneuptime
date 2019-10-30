var nodemailer = require('nodemailer');
var accountMail = require('../config/mail');
var hbs = require('nodemailer-express-handlebars');
var Handlebars = require('handlebars');
var Whitepapers = require('../config/whitepaper');
var ErrorService = require('./errorService');
var defaultEmailTemplates = require('../config/emailTemplate');
var EmailSmtpService = require('./emailSmtpService');

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

var getTemplates = async (emailTemplate) => {
    var defaultTemplate = defaultEmailTemplates.filter(template => template.emailType === 'Subscriber Incident');
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

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: userEmail,
            subject: 'Welcome to Fyipe.',
            template: 'sign_up_body',
            context: {
                name: name.split(' ')[0].toString()
            }
        };
        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },
    sendVerifyEmail: async function (tokenVerifyURL, name, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'Activate your Fyipe account',
            template: 'send_verification_email',
            context: {
                tokenVerifyURL,
                name: name.split(' ')[0].toString()
            }
        };
        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },
    sendLeadEmailToFyipeTeam: async function (lead) {


        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: 'noreply@fyipe.com',
            subject: 'New Lead Added',
            template: 'lead_to_fyipe_team',
            context: {
                text: JSON.stringify(lead, null, 2)
            }
        };
        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendUserFeedbackResponse: async function (userEmail, name) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: userEmail,
            subject: 'Thank you for your feedback!',
            template: 'feedback_response',
            context: {
                name: name.split(' ')[0].toString()
            }
        };
        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendRequestDemoEmail: async function (to) {

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
            try {
                var info = await mailer.sendMail(mailOptions);
            } catch (error) {
                ErrorService.log('mailer.sendMail', error);
                throw error;
            }
            return info;
        }
    },

    sendWhitepaperEmail: async function (to, whitepaperName) {

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
                        link: link
                    }
                };
                try {
                    var info = await mailer.sendMail(mailOptions);
                } catch (error) {
                    ErrorService.log('mailer.sendMail', error);
                    throw error;
                }
                return info;
            }
        }
    },

    // Description: Mails to user if they have requested for password reset
    // Params:
    // Param 1: host: url
    // Param 2: email: Email of user
    // Param 3: token: Password reset token
    // Returns: promise
    sendForgotPasswordMail: async function (forgotPasswordURL, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'Password Reset for Fyipe',
            template: 'forgot_password_body',
            context: {
                forgotPasswordURL
            }
        };
        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    // Description: Mails to user after their password has been successfully set.
    // Params:
    // Param 1: email: Email of user
    // Returns: promise
    sendResetPasswordConfirmMail: async function (email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'Your password has been changed.',
            template: 'reset_password_body',

        };
        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    // Description: Mail to users for registering  after they have been added by Admin to Project.
    // Params:
    // Param 1: userEmail: Email of users
    // Returns: promise
    sendNewUserAddedToProjectMail: async function (project, addedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been added to a project on Fyipe',
            template: 'new_user_added_to_project_body',
            context: {
                projectName: project.name,
                userName: addedByUser.name
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendExistingUserAddedToProjectMail: async function (project, addedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been added to a project on Fyipe',
            template: 'existing_user_added_to_project_body',
            context: {
                projectName: project.name,
                userName: addedByUser.name
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendExistingStatusPageViewerMail: async function (subProject, addedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been added to a sub-project on Fyipe',
            template: 'existing_viewer_added_to_project_body',
            context: {
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
                projectName: project.name,
                userName: addedByUser.name
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
                projectName: project.name,
                userName: addedByUser.name
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },

    sendChangeRoleEmailToUser: async function (project, addedByUser, email, role) {
        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been assigned a new role',
            template: 'change_role',
            context: {
                projectName: project.name,
                userName: addedByUser.name,
                role: role
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendRemoveFromProjectEmailToUser: async function (project, removedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been removed from a project on Fyipe',
            template: 'removed_from_project',
            context: {
                projectName: project.name,
                userName: removedByUser.name,
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendRemoveFromSubProjectEmailToUser: async function (subProject, removedByUser, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'You\'ve been removed from a subproject on Fyipe',
            template: 'removed_from_subproject',
            context: {
                subProjectName: subProject.name,
                userName: removedByUser.name,
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
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
    sendIncidentCreatedMail: async function (incidentTime, monitorName, email, userId, userName, projectId, ack_url, resolve_url, accessToken) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'A new incident created',
            template: 'new_incident_created',
            context: {
                incidentTime: incidentTime,
                monitorName: monitorName,
                accessToken,
                userName,
                userId,
                projectId,
                ack_url,
                resolve_url
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
    sendIncidentCreatedMailToSubscriber: async function (incidentTime, monitorName, email, userId, userName, projectId, emailTemplate) {
        var { template, subject } = await getTemplates(emailTemplate);
        let data = {
            incidentTime,
            monitorName,
            userName,
            userId,
            projectId,
        };
        template = template(data);
        subject = subject(data);
        var smtpSettings = await getSmtpSettings(projectId);
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

        try {
            var info = await privateMailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    testSmtpConfig: async function (data) {
        var privateMailer = await createMailer(data.host, data.port, data.user, data.pass, data.secure);
        var mailOptions = {
            from: '"Fyipe " <' + data.from + '>',
            to: data.email,
            subject: 'Email Smtp Settings Test',
            template: 'smtp_test',
            context: {
            }
        };

        try {
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
            ErrorService.log('mailer.testSmtpConfig', error);
            throw err;
        }
    },

    sendChangePlanMail: async function (projectName, oldPlan, newPlan, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'Change of Subscription Plan',
            template: 'changed_subscription_plan',
            context: {
                projectName: projectName,
                oldPlan: oldPlan,
                newPlan: newPlan
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendCreateProjectMail: async function (projectName, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'New Project',
            template: 'create_project',
            context: {
                projectName: projectName
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
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
                subProjectName: subProjectName
            }
        };

        var info = await mailer.sendMail(mailOptions);
        return info;
    },

    sendUpgradeToEnterpriseMail: async function (projectName, projectId, oldPlan, email) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: 'support@fyipe.com',
            subject: 'Upgrade to enterprise plan request from ' + email,
            template: 'enterprise_upgrade',
            context: {
                projectName: projectName,
                projectId: projectId,
                oldPlan: oldPlan,
                email: email
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    },

    sendPaymentFailedEmail: async function (projectName, email, name, chargeAttemptStage) {

        var mailOptions = {
            from: '"Fyipe " <' + accountMail.from + '>',
            to: email,
            subject: 'Subscription Payment Failed',
            template: 'subscription_payment_failed',
            context: {
                projectName,
                name,
                chargeAttemptStage
            }
        };

        try {
            var info = await mailer.sendMail(mailOptions);
        } catch (error) {
            ErrorService.log('mailer.sendMail', error);
            throw error;
        }
        return info;
    }
};

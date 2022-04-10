import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/Utils/Express';
import ProjectService from '../Services/projectService';

const router = express.getRouter();
import PaymentService from '../Services/paymentService';
import UserService from '../Services/userService';
import MailService from '../Services/mailService';
import AirtableService from '../Services/airtableService';
const getUser = require('../middlewares/user').getUser;
const isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
const isUserOwner = require('../middlewares/project').isUserOwner;
const isUserAdmin = require('../middlewares/project').isUserAdmin;

import { IS_SAAS_SERVICE } from '../config/server';

import { isAuthorized } from '../middlewares/authorization';
import {
    sendErrorResponse,
    sendListResponse,
    sendItemResponse,
} from 'common-server/Utils/Response';
import Exception from 'common/types/exception/Exception';
import ClusterKeyAuthorization from 'common-server/middleware/ClusterKeyAuthorization';
import ErrorService from 'common-server/utils/error';

// Route
// Description: Creating new Porject by Admin.
// Params:
// Param 1: req.body-> {project_name}; req.headers-> {token}
// Returns: 200: Project Details; 400: Error.
router.post(
    '/create',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data = req.body;
            data.name = data.projectName;

            // Sanitize
            if (!data.projectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project name must be present.',
                });
            }

            if (typeof data.projectName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Project name is not in string format.',
                });
            }

            let stripePlanId;

            if (IS_SAAS_SERVICE) {
                if (!data.planId) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Stripe Plan Id must be present.',
                    });
                }

                if (typeof data.planId !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Stripe Plan Id is not in string format.',
                    });
                }

                stripePlanId = data.planId;

                if (!data.stripePlanId) {
                    data.stripePlanId = stripePlanId;
                }
            }

            const projectName = data.projectName;

            const userId = req.user ? req.user.id : null;
            data.userId = userId;

            // check if user has a project with provided name already
            const countProject = await ProjectService.countBy({
                name: projectName,
                'users.userId': userId,
            });

            if (countProject < 1) {
                let user = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'stripeCustomerId email name',
                });
                if (!user.stripeCustomerId && IS_SAAS_SERVICE) {
                    if (!data.paymentIntent) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: 'Payment intent is not present.',
                        });
                    }

                    if (typeof data.paymentIntent !== 'string') {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: 'Payment intent is not in string format.',
                        });
                    }

                    const paymentIntent = {
                        id: data.paymentIntent,
                    };
                    const checkedPaymentIntent =
                        await PaymentService.checkPaymentIntent(paymentIntent);
                    if (checkedPaymentIntent.status !== 'succeeded') {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: 'Unsuccessful attempt to charge card',
                        });
                    }

                    const [updatedUser, subscriptionnew] = await Promise.all([
                        UserService.updateOneBy(
                            { _id: userId },
                            { stripeCustomerId: checkedPaymentIntent.customer }
                        ),

                        PaymentService.subscribePlan(
                            stripePlanId,
                            checkedPaymentIntent.customer
                        ),
                    ]);

                    user = updatedUser;

                    if (!data.stripeSubscriptionId) {
                        data.stripeSubscriptionId =
                            subscriptionnew.stripeSubscriptionId;
                    }
                    const project = await ProjectService.create(data);
                    try {
                        MailService.sendCreateProjectMail(
                            projectName,
                            user.email
                        );
                    } catch (error) {
                        ErrorService.log(
                            'mailService.sendCreateProjectMail',
                            error
                        );
                    }
                    return sendItemResponse(req, res, project);
                } else {
                    if (IS_SAAS_SERVICE) {
                        const subscription = await PaymentService.subscribePlan(
                            stripePlanId,
                            user.stripeCustomerId
                        );
                        if (
                            subscription.subscriptionPaymentStatus ===
                                'canceled' ||
                            subscription.subscriptionPaymentStatus === 'unpaid'
                        ) {
                            user = await UserService.findOneBy({
                                query: { _id: userId },
                                select: 'email name',
                            });
                            try {
                                MailService.sendPaymentFailedEmail(
                                    projectName,
                                    user.email,
                                    user.name
                                );
                            } catch (error) {
                                ErrorService.log(
                                    'mailService.sendPaymentFailedEmail',
                                    error
                                );
                            }
                        }
                        if (!data.stripeSubscriptionId) {
                            data.stripeSubscriptionId =
                                subscription.stripeSubscriptionId;
                        }
                    }

                    const [project, foundUser] = await Promise.all([
                        ProjectService.create(data),
                        UserService.findOneBy({
                            query: { _id: userId },
                            select: 'email',
                        }),
                    ]);

                    user = foundUser;

                    try {
                        MailService.sendCreateProjectMail(
                            projectName,
                            user.email
                        );
                    } catch (error) {
                        ErrorService.log(
                            'mailService.sendCreateProjectMail',
                            error
                        );
                    }
                    return sendItemResponse(req, res, project);
                }
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You already have project with same name.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Fetching project records.
// Params:
// Param 1: req.headers-> {token};
// Returns: 200: [{project}]; 400: Error.
router.get(
    '/projects',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId = req.user ? req.user.id : null;
            // find user subprojects and parent projects

            const userProjects = await ProjectService.findBy({
                query: { 'users.userId': userId },
                select: 'parentProjectId _id',
            });
            let parentProjectIds = [];
            let projectIds = [];
            if (userProjects.length > 0) {
                const subProjects = userProjects
                    .map((project: $TSFixMe) =>
                        project.parentProjectId ? project : null
                    )
                    .filter((subProject: $TSFixMe) => subProject !== null);
                parentProjectIds = subProjects.map(
                    (subProject: $TSFixMe) =>
                        subProject.parentProjectId._id ||
                        subProject.parentProjectId
                );
                const projects = userProjects
                    .map((project: $TSFixMe) =>
                        project.parentProjectId ? null : project
                    )
                    .filter((project: $TSFixMe) => project !== null);
                projectIds = projects.map((project: $TSFixMe) => project._id);
            }

            // query data
            const query = {
                $or: [
                    { _id: { $in: parentProjectIds } },
                    { _id: { $in: projectIds } },
                ],
            };

            const populate = [{ path: 'parentProjectId', select: 'name' }];
            const select = `_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes
             sendCreatedIncidentNotificationSms sendAcknowledgedIncidentNotificationSms sendResolvedIncidentNotificationSms
             sendCreatedIncidentNotificationEmail sendAcknowledgedIncidentNotificationEmail sendResolvedIncidentNotificationEmail
             sendCreatedIncidentNotificationEmail sendAcknowledgedIncidentNotificationEmail sendResolvedIncidentNotificationEmail
             enableInvestigationNoteNotificationSMS enableInvestigationNoteNotificationEmail sendAnnouncementNotificationSms
             sendAnnouncementNotificationEmail sendCreatedScheduledEventNotificationSms sendCreatedScheduledEventNotificationEmail
             sendScheduledEventResolvedNotificationSms sendScheduledEventResolvedNotificationEmail sendNewScheduledEventInvestigationNoteNotificationSms
             sendNewScheduledEventInvestigationNoteNotificationEmail sendScheduledEventCancelledNotificationSms sendScheduledEventCancelledNotificationEmail
             enableInvestigationNoteNotificationWebhook unpaidSubscriptionNotifications`; // All these are needed upon page reload

            const [response, count] = await Promise.all([
                ProjectService.findBy({
                    query,
                    limit: req.query['limit'] || 10,
                    skip: req.query['skip'] || 0,
                    populate,
                    select,
                }),
                ProjectService.countBy(query),
            ]);

            return sendListResponse(req, res, response, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

//Description: Get project balance of a project
// Param 1: req.headers-> {token}; req.params-> {projectId};
//Returns: 200: {projectBalance}; 400: Error.
router.get(
    '/:projectId/balance',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const projectId = req.params.projectId;
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }
            const balance = await ProjectService.getBalance({ _id: projectId });
            return sendItemResponse(req, res, balance);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Resetting the API key of a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200: {project}; 400: Error.
router.get(
    '/:projectId/resetToken',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const projectId = req.params.projectId;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }
            const project = await ProjectService.resetApiKey(projectId);
            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Renaming a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName}
// Returns: 200: {project}; 400: Error.
router.put(
    '/:projectId/renameProject',
    getUser,
    isAuthorized,
    isUserAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const projectName = req.body.projectName;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }

            if (!projectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'New project name must be present.',
                });
            }
            const project = await ProjectService.updateOneBy(
                { _id: projectId },
                { name: projectName }
            );
            return sendItemResponse(req, res, project);
        } catch (error) {
            sendErrorResponse(req, res, error);
        }
    }
);

// Description: updating a project balance by admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200; 400: Error.
router.put(
    '/:projectId/updateBalance',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }
            let { rechargeBalanceAmount } = req.body;
            if (typeof rechargeBalanceAmount === 'string') {
                rechargeBalanceAmount = parseFloat(rechargeBalanceAmount);
            }
            const project = await ProjectService.updateOneBy(
                { _id: projectId },
                { balance: rechargeBalanceAmount }
            );
            return sendItemResponse(req, res, project);
        } catch (error) {
            sendErrorResponse(req, res, error);
        }
    }
);

router.put(
    '/:projectId/alertOptions',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;

            const userId = req.user ? req.user.id : null;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }

            let data = req.body;

            const minimumBalance = Number(data.minimumBalance);
            const rechargeToBalance = Number(data.rechargeToBalance);

            if (!minimumBalance) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Minimum balance must be present and valid.',
                });
            }
            if (!rechargeToBalance) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Recharge balance must be present and valid.',
                });
            }
            if (data.billingUS && minimumBalance < 20) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Price-plan mismatch',
                });
            }
            if (data.billingNonUSCountries && minimumBalance < 50) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Price-plan mismatch',
                });
            }
            if (data.billingRiskCountries && minimumBalance < 100) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Price-plan mismatch',
                });
            }
            if (data.billingUS && rechargeToBalance < 40) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Price-plan mismatch',
                });
            }
            if (data.billingNonUSCountries && rechargeToBalance < 100) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Price-plan mismatch',
                });
            }
            if (data.billingRiskCountries && rechargeToBalance < 200) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Price-plan mismatch',
                });
            }

            data = {
                _id: data._id,
                alertEnable: data.alertEnable,
                alertOptions: {
                    rechargeToBalance,
                    minimumBalance,
                    billingNonUSCountries: data.billingNonUSCountries,
                    billingRiskCountries: data.billingRiskCountries,
                    billingUS: data.billingUS,
                },
                userId,
            };
            const project = await ProjectService.updateAlertOptions(data);
            return sendItemResponse(req, res, project);
        } catch (error) {
            sendErrorResponse(req, res, error);
        }
    }
);

// Description: Deleting a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200; 400: Error.
router.delete(
    '/:projectId/deleteProject',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;

            const userId = req.user.id;
            const feedback = req.body.feedback;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }
            const project = await ProjectService.deleteBy(
                { _id: projectId },
                userId
            );

            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'name email',
            });

            if (project) {
                const projectName = project.name;
                try {
                    // SEND MAIL IN THE BACKGROUND
                    MailService.sendDeleteProjectEmail({
                        name: user.name,
                        userEmail: user.email,
                        projectName,
                    });
                } catch (error) {
                    ErrorService.log(
                        'mailService.sendDeleteProjectEmail',
                        error
                    );
                }
            }

            AirtableService.logProjectDeletionFeedback({
                reason: feedback
                    ? feedback
                    : 'Feedback was not provided by the user',
                project: project.name,
                name: user.name,
                email: user.email,
            });

            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// delete a project from init script
// once the subscription of a project is already deleted
// the init script ensures we also deletes the project
router.delete(
    '/:projectId/initScript/deleteProject',
    ClusterKeyAuthorization.isAuthorizedService,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }

            let userId = null;

            let project = await ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'users _id',
            });

            if (project) {
                for (const userObj of project.users) {
                    if (userObj.role === 'Owner') {
                        userId = userObj.userId;
                        break;
                    }
                }
                project = await ProjectService.deleteBy(
                    { _id: projectId },
                    userId,
                    false // cancel sub should be false, since the subscription is already canceled by stripe
                );
            }

            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Changing Suscription Plan for a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName, planId, oldPlan, newPlan}
// Returns: 200: {project}; 400: Error.
router.post(
    '/:projectId/changePlan',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const projectName = req.body.projectName;
            const planId = req.body.planId;

            const userId = req.user ? req.user.id : null;
            const oldPlan = req.body.oldPlan;
            const newPlan = req.body.newPlan;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }

            if (!projectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectName must be present.',
                });
            }

            if (!planId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'PlanID must be present.',
                });
            }

            if (!oldPlan) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Old Plan must be present.',
                });
            }

            if (!newPlan) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'New Plan must be present.',
                });
            }
            const [project, user] = await Promise.all([
                ProjectService.changePlan(projectId, userId, planId),
                UserService.findOneBy({
                    query: { _id: userId },
                    select: 'email',
                }),
            ]);
            const email = user.email;

            MailService.sendChangePlanMail(
                projectName,
                oldPlan,
                newPlan,
                email
            );

            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/admin/changePlan',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const projectName = req.body.projectName;
            const planId = req.body.planId;

            const userId = req.user ? req.user.id : null;
            const oldPlan = req.body.oldPlan;
            const newPlan = req.body.newPlan;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }

            if (!projectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectName must be present.',
                });
            }

            if (!planId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'PlanID must be present.',
                });
            }

            if (planId === 'enterprise') {
                // run all the upgrade here for enterprise plan
                const response = await ProjectService.upgradeToEnterprise(
                    projectId
                );
                return sendItemResponse(req, res, response);
            } else {
                if (!oldPlan) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Old Plan must be present.',
                    });
                }

                if (!newPlan) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'New Plan must be present.',
                    });
                }

                const project = await ProjectService.findOneBy({
                    query: { _id: projectId },
                    select: 'users',
                });
                const owner = project.users.find(
                    (user: $TSFixMe) => user.role === 'Owner'
                );
                const [updatedProject, user] = await Promise.all([
                    ProjectService.changePlan(projectId, owner.userId, planId),
                    UserService.findOneBy({
                        query: { _id: userId },
                        select: 'email',
                    }),
                ]);
                const email = user.email;

                MailService.sendChangePlanMail(
                    projectName,
                    oldPlan,
                    newPlan,
                    email
                );

                return sendItemResponse(req, res, updatedProject);
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Emailing OneUptime Support to upgrade to Enterprise Plan after maxing out of Pro Plan.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName, planId, oldPlan}
// Returns: 200: {project}; 400: Error.
router.post(
    '/:projectId/upgradeToEnterprise',
    getUser,
    isAuthorized,
    isUserOwner,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const projectName = req.body.projectName;

            const userId = req.user ? req.user.id : null;
            const oldPlan = req.body.oldPlan;

            if (!projectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectId must be present.',
                });
            }

            if (!projectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'ProjectName must be present.',
                });
            }

            if (!oldPlan) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Old Plan must be present.',
                });
            }
            const user = await UserService.findOneBy({
                query: { _id: userId },
                select: 'email',
            });
            const email = user.email;
            try {
                MailService.sendUpgradeToEnterpriseMail(
                    projectName,
                    projectId,
                    oldPlan,
                    email
                );
            } catch (error) {
                ErrorService.log(
                    'mailService.sendUpgradeToEnterpriseMail',
                    error
                );
            }
            return sendItemResponse(req, res, 'Mail Sent Successfully!');
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Removing team member by Project Admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: "User successfully removed"; 400: Error.
router.delete(
    '/:projectId/user/:userId/exitProject',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        // Call the ProjectService
        try {
            const userId = req.user ? req.user.id : null;
            const projectId = req.params.projectId;

            const teamMember = await ProjectService.exitProject(
                projectId,
                userId
            );
            return sendItemResponse(req, res, teamMember);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Creating a new subproject by Project Admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: subproject;
router.post(
    '/:projectId/subProject',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const userId = req.user ? req.user.id : null;
            const parentProjectId = req.params.projectId;
            const subProjectName =
                req.body && req.body.subProjectName
                    ? req.body.subProjectName
                    : null;
            if (!subProjectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Subproject name must be present.',
                });
            }
            if (typeof subProjectName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Subproject name is not in string format.',
                });
            }
            // check if project has a sub-project with provided name
            const countSubProject = await ProjectService.countBy({
                name: subProjectName,
                parentProjectId: parentProjectId,
            });
            if (countSubProject > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You already have a sub-project with same name.',
                });
            }
            const data = {
                name: subProjectName,
                userId,
                parentProjectId,
            };

            let subProjects = await ProjectService.create(data);
            const populate = [{ path: 'parentProjectId', select: 'name' }];
            const select =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

            subProjects = await ProjectService.findBy({
                query: { _id: subProjects._id },
                select,
                populate,
            });
            return sendItemResponse(req, res, subProjects);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Delete subproject.
router.delete(
    '/:projectId/:subProjectId',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const parentProjectId = req.params.projectId;
            const subProjectId = req.params.subProjectId;

            const userId = req.user.id;

            if (!subProjectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'subProjectId must be present.',
                });
            }
            const subProject = await ProjectService.deleteBy(
                { _id: subProjectId, parentProjectId },
                userId
            );
            return sendItemResponse(req, res, subProject);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Fetch all subprojects.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: [...subprojects];
router.get(
    '/:projectId/subProjects',
    getUser,
    isAuthorized,
    async function (req, res) {
        // Call the ProjectService
        try {
            const parentProjectId = req.params.projectId;

            const userId = req.user ? req.user.id : null;
            const skip = req.query['skip'] || 0;
            const limit = req.query['limit'] || 10;
            const populate = [{ path: 'parentProjectId', select: 'name' }];
            const select =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes createdAt';
            const [subProjects, count] = await Promise.all([
                ProjectService.findBy({
                    query: { parentProjectId, 'users.userId': userId },
                    limit,
                    skip,
                    select,
                    populate,
                }),
                ProjectService.countBy({
                    parentProjectId,
                    'users.userId': userId,
                }),
            ]);
            return sendListResponse(req, res, subProjects, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/projects/user/:userId',
    getUser,
    isUserMasterAdmin,
    async function (req, res) {
        try {
            const userId = req.params.userId;
            const skip = req.query['skip'] || 0;
            const limit = req.query['limit'] || 10;
            const { projects, count } = await ProjectService.getUserProjects(
                userId,
                skip,
                limit
            );
            return sendListResponse(req, res, projects, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/projects/allProjects',
    getUser,
    isUserMasterAdmin,
    async function (req, res) {
        try {
            const skip = req.query['skip'] || 0;
            const limit = req.query['limit'] || 10;
            const [projects, count] = await Promise.all([
                ProjectService.getAllProjects(skip, limit),
                ProjectService.countBy({
                    parentProjectId: null,
                    deleted: { $ne: null },
                }),
            ]);
            return sendListResponse(req, res, projects, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/projects/:slug',
    getUser,
    isUserMasterAdmin,
    async function (req, res) {
        try {
            const slug = req.params.slug;
            const populate = [{ path: 'parentProjectId', select: 'name' }];
            const select =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';
            const project = await ProjectService.findOneBy({
                query: { slug: slug, deleted: { $ne: null } },
                select,
                populate,
            });

            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/project-slug/:slug',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { slug } = req.params;
            const populate = [{ path: 'parentProjectId', select: 'name' }];
            const select =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

            const project = await ProjectService.findOneBy({
                query: { slug },
                select,
                populate,
            });
            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/blockProject',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const project = await ProjectService.updateOneBy(
                { _id: projectId },
                { isBlocked: true }
            );
            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/renewAlertLimit',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            let limit = req.body.alertLimit;
            if (!limit) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'New alert limit must be present.',
                });
            }

            const oldProject = await ProjectService.findOneBy({
                query: { _id: projectId, deleted: false },
                select: 'alertLimit',
            });
            if (oldProject && oldProject.alertLimit) {
                limit =
                    parseInt(limit, 10) + parseInt(oldProject.alertLimit, 10);
            }
            const project = await ProjectService.updateOneBy(
                { _id: projectId },
                { alertLimitReached: false, alertLimit: limit }
            );
            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/unblockProject',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const project = await ProjectService.updateOneBy(
                { _id: projectId },
                { isBlocked: false }
            );
            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/restoreProject',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const projectId = req.params.projectId;
            const project = await ProjectService.restoreBy({
                _id: projectId,
                deleted: true,
            });
            return sendItemResponse(req, res, project);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Description: Rename subproject.
router.put(
    '/:projectId/:subProjectId',
    getUser,
    isAuthorized,
    async function (req, res) {
        try {
            const parentProjectId = req.params.projectId;
            const subProjectId = req.params.subProjectId;
            const subProjectName =
                req.body && req.body.subProjectName
                    ? req.body.subProjectName
                    : null;
            if (!subProjectId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'subProjectId must be present.',
                });
            }

            if (!subProjectName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'SubProject Name must be present.',
                });
            }
            // check if project has a sub-project with provided name
            const count = await ProjectService.countBy({
                name: subProjectName,
                parentProjectId,
            });
            if (count && count > 0) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'You already have a sub-project with same name.',
                });
            }
            const subProject = await ProjectService.updateOneBy(
                { _id: subProjectId },
                { name: subProjectName }
            );
            return sendItemResponse(req, res, subProject);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:projectId/addNote',
    getUser,
    isUserMasterAdmin,
    async function (req, res) {
        try {
            const projectId = req.params.projectId;
            if (Array.isArray(req.body)) {
                const data: $TSFixMe = [];
                if (req.body.length > 0) {
                    for (const val of req.body) {
                        if (!val._id) {
                            // Sanitize
                            if (!val.note) {
                                return sendErrorResponse(req, res, {
                                    code: 400,
                                    message: 'Admin note must be present.',
                                });
                            }

                            if (typeof val.note !== 'string') {
                                return sendErrorResponse(req, res, {
                                    code: 400,
                                    message:
                                        'Admin note is not in string format.',
                                });
                            }
                        }
                        data.push(val);
                    }

                    const project = await ProjectService.addNotes(
                        projectId,
                        data
                    );
                    return sendItemResponse(req, res, project);
                } else {
                    const project = await ProjectService.addNotes(
                        projectId,
                        data
                    );
                    return sendItemResponse(req, res, project);
                }
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Admin notes are expected in array format.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/projects/search',
    getUser,
    isUserMasterAdmin,
    async function (req, res) {
        try {
            const filter = req.body.filter;
            const skip = req.query['skip'] || 0;
            const limit = req.query['limit'] || 10;
            const [users, count] = await Promise.all([
                ProjectService.searchProjects(
                    {
                        parentProjectId: null,
                        deleted: { $ne: null },
                        name: { $regex: new RegExp(filter), $options: 'i' },
                    },
                    skip,
                    limit
                ),
                ProjectService.countBy({
                    parentProjectId: null,
                    deleted: { $ne: null },
                    name: { $regex: new RegExp(filter), $options: 'i' },
                }),
            ]);

            return sendListResponse(req, res, users, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/advancedOptions/email',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const data = req.body;

            if (!data.sendCreatedIncidentNotificationEmail) {
                data.sendCreatedIncidentNotificationEmail = false;
            }
            if (!data.sendAcknowledgedIncidentNotificationEmail) {
                data.sendAcknowledgedIncidentNotificationEmail = false;
            }
            if (!data.sendResolvedIncidentNotificationEmail) {
                data.sendResolvedIncidentNotificationEmail = false;
            }
            if (
                (data.replyAddress && !data.replyAddress.trim()) ||
                !data.replyAddress
            ) {
                data.replyAddress = null;
            }

            if (!data.sendCreatedScheduledEventNotificationEmail) {
                data.sendCreatedScheduledEventNotificationEmail = false;
            }

            if (!data.sendScheduledEventResolvedNotificationEmail) {
                data.sendScheduledEventResolvedNotificationEmail = false;
            }
            if (!data.sendNewScheduledEventInvestigationNoteNotificationEmail) {
                data.sendNewScheduledEventInvestigationNoteNotificationEmail =
                    false;
            }
            if (!data.sendScheduledEventResolvedNotificationEmail) {
                data.sendScheduledEventResolvedNotificationEmail = false;
            }
            if (!data.sendScheduledEventCancelledNotificationEmail) {
                data.sendScheduledEventCancelledNotificationEmail = false;
            }

            data.enableInvestigationNoteNotificationEmail =
                data.enableInvestigationNoteNotificationEmail ? true : false;

            const result = await ProjectService.updateOneBy(
                { _id: projectId },
                data
            );
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:projectId/advancedOptions/sms',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const data = req.body;

            if (!data.sendCreatedIncidentNotificationSms) {
                data.sendCreatedIncidentNotificationSms = false;
            }
            if (!data.sendAcknowledgedIncidentNotificationSms) {
                data.sendAcknowledgedIncidentNotificationSms = false;
            }
            if (!data.sendResolvedIncidentNotificationSms) {
                data.sendResolvedIncidentNotificationSms = false;
            }
            data.enableInvestigationNoteNotificationSMS =
                data.enableInvestigationNoteNotificationSMS ? true : false;

            if (!data.sendCreatedScheduledEventNotificationSms) {
                data.sendCreatedScheduledEventNotificationSms = false;
            }

            if (!data.sendScheduledEventResolvedNotificationSms) {
                data.sendScheduledEventResolvedNotificationSms = false;
            }
            if (!data.sendNewScheduledEventInvestigationNoteNotificationSms) {
                data.sendNewScheduledEventInvestigationNoteNotificationSms =
                    false;
            }
            if (!data.sendScheduledEventResolvedNotificationSms) {
                data.sendScheduledEventResolvedNotificationSms = false;
            }
            if (!data.sendScheduledEventCancelledNotificationSms) {
                data.sendScheduledEventCancelledNotificationSms = false;
            }
            const result = await ProjectService.updateOneBy(
                { _id: projectId },
                data
            );
            return sendItemResponse(req, res, result);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);
router.put(
    '/:projectId/advancedOptions/webhook',
    getUser,
    isAuthorized,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { projectId } = req.params;
            const data = req.body;

            data.enableInvestigationNoteNotificationWebhook =
                data.enableInvestigationNoteNotificationWebhook ? true : false;

            const updatedProject = await ProjectService.updateOneBy(
                { _id: projectId },
                data
            );
            return sendItemResponse(req, res, updatedProject);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;

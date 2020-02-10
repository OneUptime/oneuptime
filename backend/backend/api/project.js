var express = require('express');
var ProjectService = require('../services/projectService');

var router = express.Router();
var PaymentService = require('../services/paymentService');
var UserService = require('../services/userService');
var MailService = require('../services/mailService');
var getUser = require('../middlewares/user').getUser;
var isUserMasterAdmin = require('../middlewares/user').isUserMasterAdmin;
var isUserOwner = require('../middlewares/project').isUserOwner;
const {
    isAuthorized
} = require('../middlewares/authorization');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route
// Description: Creating new Porject by Admin.
// Params:
// Param 1: req.body-> {project_name}; req.headers-> {token}
// Returns: 200: Project Details; 400: Error.
router.post('/create', getUser, async function (req, res) {
    try {
        var data = req.body;
        data.name = data.projectName;

        // Sanitize
        if (!data.projectName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project name must be present.'
            });
        }

        if (typeof data.projectName !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Project name is not in string format.'
            });
        }

        if (!data.planId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Stripe Plan Id must be present.'
            });
        }

        if (typeof data.planId !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Stripe Plan Id is not in string format.'
            });
        }

        var stripePlanId = data.planId;
        var projectName = data.projectName;
        var userId = req.user ? req.user.id : null;
        data.userId = userId;

        if (!data.stripePlanId) {
            data.stripePlanId = stripePlanId;
        }

        // check if user has a project with provided name already
        var countProject = await ProjectService.countBy({ name: projectName, 'users.userId': userId });

        if (countProject < 1) {
            var user = await UserService.findOneBy({ _id: userId });
            if (!user.stripeCustomerId) {

                if (!data.paymentIntent) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Payment intent is not present.'
                    });
                }

                if (typeof data.paymentIntent !== 'string') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Payment intent is not in string format.'
                    });
                }

                var paymentIntent = {
                    id: data.paymentIntent
                };
                var checkedPaymentIntent = await PaymentService.checkPaymentIntent(paymentIntent);
                if (checkedPaymentIntent.status !== 'succeeded') {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Unsuccessful attempt to charge card'
                    });
                }
                user = await UserService.updateOneBy({ _id: userId }, { stripeCustomerId: checkedPaymentIntent.customer });
                var subscriptionnew = await PaymentService.subscribePlan(stripePlanId, checkedPaymentIntent.customer);
                if (!data.stripeSubscriptionId) {
                    data.stripeSubscriptionId = subscriptionnew.stripeSubscriptionId;
                }
                var project = await ProjectService.create(data);
                await MailService.sendCreateProjectMail(projectName, user.email);
                return sendItemResponse(req, res, project);

            } else {
                var subscription = await PaymentService.subscribePlan(stripePlanId, user.stripeCustomerId);
                if (subscription.subscriptionPaymentStatus === 'canceled' || subscription.subscriptionPaymentStatus === 'unpaid') {
                    user = await UserService.findOneBy({ _id: userId });
                    await MailService.sendPaymentFailedEmail(projectName, user.email, user.name);
                }
                if (!data.stripeSubscriptionId) {
                    data.stripeSubscriptionId = subscription.stripeSubscriptionId;
                }
                project = await ProjectService.create(data);
                user = await UserService.findOneBy({ _id: userId });
                await MailService.sendCreateProjectMail(projectName, user.email);
                return sendItemResponse(req, res, project);
            }
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You already have project with same name.'
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Fetching project records.
// Params:
// Param 1: req.headers-> {token};
// Returns: 200: [{project}]; 400: Error.
router.get('/projects', getUser, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        // find user subprojects and parent projects
        var userProjects = await ProjectService.findBy({ 'users.userId': userId });
        userProjects = userProjects.filter(project => project.users.find(user => user.userId === userId && user.role !== 'Viewer'));
        var parentProjectIds = [];
        var projectIds = [];
        if (userProjects.length > 0) {
            var subProjects = userProjects.map(project => project.parentProjectId ? project : null).filter(subProject => subProject !== null);
            parentProjectIds = subProjects.map(subProject => subProject.parentProjectId._id);
            var projects = userProjects.map(project => project.parentProjectId ? null : project).filter(project => project !== null);
            projectIds = projects.map(project => project._id);
        }

        // query data
        const query = { $or: [{ _id: { $in: parentProjectIds } }, { _id: { $in: projectIds } }] };
        var response = await ProjectService.findBy(query, req.query.limit || 10, req.query.skip || 0);
        var count = await ProjectService.countBy(query);
        return sendListResponse(req, res, response, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Resetting the API key of a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200: {project}; 400: Error.
router.get('/:projectId/resetToken', getUser, isAuthorized, async function (req, res) {
    try {
        var projectId = req.params.projectId;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectId must be present.'
            });
        }
        var project = await ProjectService.resetApiKey(projectId);
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Renaming a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName}
// Returns: 200: {project}; 400: Error.
router.put('/:projectId/renameProject', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        var projectId = req.params.projectId;
        var projectName = req.body.projectName;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectId must be present.'
            });
        }

        if (!projectName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'New project name must be present.'
            });
        }
        var project = await ProjectService.updateOneBy({ _id: projectId }, { name: projectName });
        return sendItemResponse(req, res, project);
    } catch (error) {
        sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/alertOptions', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let projectId = req.params.projectId;
        var userId = req.user ? req.user.id : null;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectId must be present.'
            });
        }

        let data = req.body;

        let minimumBalance = Number(data.minimumBalance);
        let rechargeToBalance = Number(data.rechargeToBalance);

        if (!minimumBalance) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Minimum balance must be present and valid.'
            });
        }
        if (!rechargeToBalance) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Recharge balance must be present and valid.'
            });
        }
        if (data.billingUS && minimumBalance < 20) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Price-plan mismatch'
            });
        }
        if (data.billingNonUSCountries && minimumBalance < 50) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Price-plan mismatch'
            });
        }
        if (data.billingRiskCountries && minimumBalance < 100) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Price-plan mismatch'
            });
        }
        if (data.billingUS && rechargeToBalance < 40) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Price-plan mismatch'
            });
        }
        if (data.billingNonUSCountries && rechargeToBalance < 100) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Price-plan mismatch'
            });
        }
        if (data.billingRiskCountries && rechargeToBalance < 200) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Price-plan mismatch'
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
                billingUS: data.billingUS
            },
            userId
        };
        var project = await ProjectService.updateAlertOptions(data);
        return sendItemResponse(req, res, project);
    } catch (error) {
        sendErrorResponse(req, res, error);
    }
});

// Description: Deleting a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200; 400: Error.
router.delete('/:projectId/deleteProject', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let projectId = req.params.projectId;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectId must be present.'
            });
        }
        var project = await ProjectService.deleteBy({ _id: projectId }, req.user);
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});



// Description: Changing Suscription Plan for a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName, planId, oldPlan, newPlan}
// Returns: 200: {project}; 400: Error.
router.post('/:projectId/changePlan', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        var projectId = req.params.projectId;
        var projectName = req.body.projectName;
        var planId = req.body.planId;
        var userId = req.user ? req.user.id : null;
        var oldPlan = req.body.oldPlan;
        var newPlan = req.body.newPlan;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectId must be present.'
            });
        }

        if (!projectName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectName must be present.'
            });
        }

        if (!planId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'PlanID must be present.'
            });
        }

        if (!oldPlan) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Old Plan must be present.'
            });
        }

        if (!newPlan) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'New Plan must be present.'
            });
        }
        var project = await ProjectService.changePlan(projectId, planId);
        var user = await UserService.findOneBy({ _id: userId });
        var email = user.email;
        await MailService.sendChangePlanMail(projectName, oldPlan, newPlan, email);
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// Description: Emailing Fyipe Support to upgrade to Enterprise Plan after maxing out of Pro Plan.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName, planId, oldPlan}
// Returns: 200: {project}; 400: Error.
router.post('/:projectId/upgradeToEnterprise', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        var projectId = req.params.projectId;
        var projectName = req.body.projectName;
        var userId = req.user ? req.user.id : null;
        var oldPlan = req.body.oldPlan;

        if (!projectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectId must be present.'
            });
        }

        if (!projectName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'ProjectName must be present.'
            });
        }

        if (!oldPlan) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Old Plan must be present.'
            });
        }
        var user = await UserService.findOneBy({ _id: userId });
        var email = user.email;
        await MailService.sendUpgradeToEnterpriseMail(projectName, projectId, oldPlan, email);
        return sendItemResponse(req, res, 'Mail Sent Successfully!');
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// Description: Removing team member by Project Admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: "User successfully removed"; 400: Error.
router.delete('/:projectId/user/:userId/exitProject', getUser, isAuthorized, async function (req, res) {
    // Call the ProjectService
    try {
        var userId = req.user ? req.user.id : null;
        var projectId = req.params.projectId;
        var teamMember = await ProjectService.exitProject(projectId, userId);
        return sendItemResponse(req, res, teamMember);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// Description: Creating a new subproject by Project Admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: subproject;
router.post('/:projectId/subProject', getUser, isAuthorized, async function (req, res) {
    try {
        var userId = req.user ? req.user.id : null;
        var parentProjectId = req.params.projectId;
        var subProjectName = req.body && req.body.subProjectName ? req.body.subProjectName : null;
        if (!subProjectName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Subproject name must be present.'
            });
        }
        if (typeof subProjectName !== 'string') {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Subproject name is not in string format.'
            });
        }
        // check if project has a sub-project with provided name
        let countSubProject = await ProjectService.countBy({
            name: subProjectName,
            parentProjectId: parentProjectId
        });
        if (countSubProject > 0) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You already have a sub-project with same name.'
            });
        }
        let data = {
            name: subProjectName,
            userId,
            parentProjectId
        };

        let subProjects = await ProjectService.create(data);
        subProjects = await ProjectService.findBy({ _id: subProjects._id });
        return sendItemResponse(req, res, subProjects);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Delete subproject.
router.delete('/:projectId/:subProjectId', getUser, isAuthorized, async function (req, res) {
    try {
        const parentProjectId = req.params.projectId;
        const subProjectId = req.params.subProjectId;

        if (!subProjectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'SubProjectId must be present.'
            });
        }
        var subProject = await ProjectService.deleteBy({ _id: subProjectId, parentProjectId }, req.user);
        return sendItemResponse(req, res, subProject);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Fetch all subprojects.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: [...subprojects];
router.get('/:projectId/subProjects', getUser, isAuthorized, async function (req, res) {
    // Call the ProjectService
    try {
        var parentProjectId = req.params.projectId;
        var userId = req.user ? req.user.id : null;
        var skip = req.query.skip || 0;
        var limit = req.query.limit || 10;
        var subProjects = await ProjectService.findBy({ parentProjectId, 'users.userId': userId }, limit, skip);
        var count = await ProjectService.countBy({ parentProjectId, 'users.userId': userId });
        return sendListResponse(req, res, subProjects, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

router.get('/projects/user/:userId', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        let userId = req.params.userId;
        let skip = req.query.skip || 0;
        let limit = req.query.limit || 10;
        const { projects, count } = await ProjectService.getUserProjects(userId, skip, limit);
        return sendListResponse(req, res, projects, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/projects/allProjects', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const projects = await ProjectService.getAllProjects(skip, limit);
        const count = await ProjectService.countBy({ parentProjectId: null, deleted: { $ne: null } });
        return sendListResponse(req, res, projects, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/projects/:projectId', getUser, isUserMasterAdmin, async function (req, res) {

    try {
        const projectId = req.params.projectId;
        const project = await ProjectService.findOneBy({ _id: projectId, deleted: { $ne: null } });

        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});


router.put('/:projectId/blockProject', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const project = await ProjectService.updateOneBy({ _id: projectId }, { isBlocked: true });
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/renewAlertLimit', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        var limit = req.body.alertLimit;
        if (!limit) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'New alert limit must be present.'
            });
        }
        const oldProject = await ProjectService.findOneBy({ _id: projectId, deleted: false });
        if (oldProject && oldProject.alertLimit) {
            limit = parseInt(limit, 10) + parseInt(oldProject.alertLimit, 10);
        }
        const project = await ProjectService.updateOneBy({ _id: projectId }, { alertLimitReached: false, alertLimit: limit });
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/unblockProject', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const project = await ProjectService.updateOneBy({ _id: projectId }, { isBlocked: false });
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/restoreProject', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        const project = await ProjectService.restoreBy({ _id: projectId, deleted: true }, req.user);
        return sendItemResponse(req, res, project);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Description: Rename subproject.
router.put('/:projectId/:subProjectId', getUser, isAuthorized, async function (req, res) {
    try {
        const parentProjectId = req.params.projectId;
        const subProjectId = req.params.subProjectId;
        const subProjectName = req.body && req.body.subProjectName ? req.body.subProjectName : null;
        if (!subProjectId) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'SubProjectId must be present.'
            });
        }

        if (!subProjectName) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'SubProject Name must be present.'
            });
        }
        // check if project has a sub-project with provided name
        const count = await ProjectService.countBy({ name: subProjectName, parentProjectId });
        if (count && count > 0) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'You already have a sub-project with same name.'
            });
        }
        const subProject = await ProjectService.updateOneBy({ _id: subProjectId }, { name: subProjectName });
        return sendItemResponse(req, res, subProject);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/:projectId/addNote', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const projectId = req.params.projectId;
        if (Array.isArray(req.body)) {
            let data = [];
            if (req.body.length > 0) {
                for (let val of req.body) {
                    if (!val._id) {
                        // Sanitize
                        if (!val.note) {
                            return sendErrorResponse(req, res, {
                                code: 400,
                                message: 'Admin note must be present.'
                            });
                        }

                        if (typeof val.note !== 'string') {
                            return sendErrorResponse(req, res, {
                                code: 400,
                                message: 'Admin note is not in string format.'
                            });
                        }
                    }
                    data.push(val);
                }

                let adminNotes = await ProjectService.addNotes(projectId, data);
                return sendItemResponse(req, res, adminNotes);
            } else {
                let adminNotes = await ProjectService.addNotes(projectId, data);
                return sendItemResponse(req, res, adminNotes);
            }
        } else {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Admin notes are expected in array format.'
            });
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.post('/projects/search', getUser, isUserMasterAdmin, async function (req, res) {
    try {
        const filter = req.body.filter;
        const skip = req.query.skip || 0;
        const limit = req.query.limit || 10;
        const users = await ProjectService.searchProjects({ parentProjectId: null, deleted: { $ne: null }, name: { $regex: new RegExp(filter), $options: 'i' } }, skip, limit);
        const count = await ProjectService.countBy({ parentProjectId: null, deleted: { $ne: null }, name: { $regex: new RegExp(filter), $options: 'i' } });

        return sendListResponse(req, res, users, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

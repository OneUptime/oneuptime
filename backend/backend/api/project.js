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
    var data = req.body;
    data.name = data.projectName;

    // Sanitize
    if (!data.projectName) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Project name must be present.'
        });
    }

    if (typeof data.projectName !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Project name is not in string format.'
        });
    }

    if (!data.planId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Stripe Plan Id must be present.'
        });
    }

    if (typeof data.planId !== 'string') {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Stripe Plan Id is not in string format.'
        });
    }

    var stripePlanId = data.planId;
    var projectName = data.projectName;
    var userId = req.user ? req.user.id : null;
    data.userId = userId;

    if(!data.stripePlanId) {
        data.stripePlanId = stripePlanId;
    }

    // check if user has a project with provided name already
    var countProject = await ProjectService.countBy({name: projectName, 'users.userId': userId});

    if (countProject < 1) {
        try{
            var user = await UserService.findOneBy({_id:userId});
        }catch(error){
            sendErrorResponse(req, res, error);
        }

        if (!user.stripeCustomerId) {

            if (!data.cardNumber) {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card number must be present.'
                });
            }

            if (typeof data.cardNumber !== 'string') {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card number is not in string format.'
                });
            }

            if (!data.cvv) {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card cvv must be present.'
                });
            }

            if (typeof data.cvv !== 'string') {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card cvv is not in string format.'
                });
            }

            if (!data.expiry) {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card expiry must be present.'
                });
            }

            if (typeof data.expiry !== 'string') {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card expiry is not in string format.'
                });
            }

            if (data.expiry.length == 6) {
                return sendErrorResponse( req, res, {
                    code: 400,
                    message: 'Card expiry is not in proper format.'
                });
            }

            try{
                var stripeToken = await PaymentService.createToken(data.cardNumber, data.cvc, data.expiry.split('/')[0], data.expiry.split('/')[1], data.zipCode);
                var customerId = await PaymentService.createCustomer(stripeToken, user);
                user = await UserService.update({_id: userId, stripeCustomerId: customerId});
                var subscriptionnew = await PaymentService.subscribePlan(stripePlanId, customerId);
                if(!data.stripeSubscriptionId) {
                    data.stripeSubscriptionId = subscriptionnew.stripeSubscriptionId;
                }
                if(!data.stripeExtraUserSubscriptionId) {
                    data.stripeExtraUserSubscriptionId = subscriptionnew.stripeExtraUserSubscriptionId;
                }
                if(!data.stripeMeteredSubscriptionId) {
                    data.stripeMeteredSubscriptionId = subscriptionnew.stripeMeteredSubscriptionId;
                }
                var project = await ProjectService.create(data);
                await MailService.sendCreateProjectMail(projectName, user.email);
                return sendItemResponse(req, res, project);
            }catch(error){
                return sendErrorResponse(req, res, error);
            }

        } else {
            try{
                var subscription = await PaymentService.subscribePlan(stripePlanId, user.stripeCustomerId);
                if (subscription.subscriptionPaymentStatus === 'canceled' || subscription.subscriptionPaymentStatus === 'unpaid') {
                    user = await UserService.findOneBy({_id: userId});
                    await MailService.sendPaymentFailedEmail(projectName, user.email, user.name);
                }
                if(!data.stripeSubscriptionId) {
                    data.stripeSubscriptionId = subscription.stripeSubscriptionId;
                }
                if(!data.stripeExtraUserSubscriptionId) {
                    data.stripeExtraUserSubscriptionId = subscription.stripeExtraUserSubscriptionId;
                }
                if(!data.stripeMeteredSubscriptionId) {
                    data.stripeMeteredSubscriptionId = subscription.stripeMeteredSubscriptionId;
                }
                project = await ProjectService.create(data);
                user = await UserService.findOneBy({_id: userId});
                await MailService.sendCreateProjectMail(projectName, user.email);
                return sendItemResponse(req, res, project);
            }catch(error){
                return sendErrorResponse(req, res, error);
            }
        }
    }else {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'You already have project with same name.'
        });
    }
});

// Description: Fetching project records.
// Params:
// Param 1: req.headers-> {token};
// Returns: 200: [{project}]; 400: Error.
router.get('/projects', getUser, async function (req, res) {
    let userId = req.user ? req.user.id : null;

    try{
        // find user subprojects and parent projects
        var userProjects = await ProjectService.findBy({'users.userId': userId});
        userProjects = userProjects.filter(project => project.users.find(user => user.userId === userId && user.role !== 'Viewer'));
        var parentProjectIds = [];
        var projectIds = [];
        if(userProjects.length > 0){
            var subProjects = userProjects.map(project => project.parentProjectId ? project : null).filter(subProject => subProject !== null);
            parentProjectIds = subProjects.map(subProject => subProject.parentProjectId._id);
            var projects = userProjects.map(project => project.parentProjectId ? null : project).filter(project => project !== null);
            projectIds = projects.map(project => project._id);
        }

        // query data
        const query = { $or: [ { _id: { $in: parentProjectIds } }, { _id: { $in: projectIds } } ] };
        var response = await ProjectService.findBy(query, req.query.limit || 10, req.query.skip || 0);
        var count = await ProjectService.countBy(query);
        return sendListResponse(req, res, response, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/projects/user/:userId', getUser, isUserMasterAdmin, async function (req, res) {
    let userId = req.params.userId;
    let skip = req.query.skip || 0;
    let limit = req.query.limit || 10;
    try{
        const { projects, count } = await ProjectService.getUserProjects(userId, skip, limit);
        return sendListResponse(req, res, projects, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

router.get('/projects/allProjects', getUser, isUserMasterAdmin, async function (req, res) {
    const skip = req.query.skip || 0;
    const limit = req.query.limit || 10;
    // try{
    const projects = await ProjectService.getAllProjects(skip, limit);
    const count = await ProjectService.countBy({ parentProjectId: null });
    return sendListResponse(req, res, projects, count);
    // }catch(error){
    //     return sendErrorResponse(req, res, {
    //         code: 500,
    //         message: 'Server Error'
    //     });
    // }
});

// Description: Resetting the API key of a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200: {project}; 400: Error.
router.get('/:projectId/resetToken', getUser, isAuthorized, async function (req, res) {
    var projectId = req.params.projectId;

    if (!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectId must be present.'
        });
    }

    try{
        var project = await ProjectService.resetApiKey(projectId);
        return sendItemResponse(req, res, project);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

// Description: Renaming a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName}
// Returns: 200: {project}; 400: Error.
router.put('/:projectId/renameProject', getUser, isAuthorized, isUserOwner, async function (req, res) {
    var projectId = req.params.projectId;
    var projectName = req.body.projectName;

    if (!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectId must be present.'
        });
    }

    if (!projectName) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'New project name must be present.'
        });
    }

    try{
        var project = await ProjectService.update({_id: projectId, name: projectName});
        return sendItemResponse(req, res, project);
    }catch(error){
        sendErrorResponse(req, res, error);
    }
});

router.put('/:projectId/alertOptions', getUser, isAuthorized, isUserOwner, async function(req, res){
    let projectId = req.params.projectId;
    var userId = req.user ? req.user.id : null;

    if (!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectId must be present.'
        });
    }

    let data = req.body;

    let minimumBalance = Number(data.minimumBalance);
    let rechargeToBalance = Number(data.rechargeToBalance);
    
    if (!minimumBalance){
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Minimum balance must be present and valid.'
        });
    }
    if (!rechargeToBalance){
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
        alertOptions:{
            rechargeToBalance,
            minimumBalance,
            billingNonUSCountries: data.billingNonUSCountries,
            billingRiskCountries: data.billingRiskCountries,
            billingUS: data.billingUS
        },
        userId
    };

    try{
        var project = await ProjectService.updateAlertOptions(data);
        return sendItemResponse(req, res, project);
    }catch(error){
        sendErrorResponse(req, res, error);
    }
});

// Description: Deleting a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId};
// Returns: 200; 400: Error.
router.delete('/:projectId/deleteProject', getUser, isAuthorized, isUserOwner, async function (req, res) {
    let projectId = req.params.projectId;
    let userId = req.user.id;

    if (!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectId must be present.'
        });
    }

    try{
        var project = await ProjectService.deleteBy({_id: projectId}, userId);
        return sendItemResponse(req, res, project);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});



// Description: Changing Suscription Plan for a project.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName, planId, oldPlan, newPlan}
// Returns: 200: {project}; 400: Error.
router.post('/:projectId/changePlan', getUser, isAuthorized, isUserOwner, async function (req, res) {
    var projectId = req.params.projectId;
    var projectName = req.body.projectName;
    var planId = req.body.planId;
    var userId = req.user ? req.user.id : null;
    var oldPlan = req.body.oldPlan;
    var newPlan = req.body.newPlan;

    if (!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectId must be present.'
        });
    }

    if (!projectName) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectName must be present.'
        });
    }

    if (!planId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'PlanID must be present.'
        });
    }

    if (!oldPlan) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Old Plan must be present.'
        });
    }

    if (!newPlan) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'New Plan must be present.'
        });
    }

    try{
        var project = await ProjectService.changePlan(projectId, planId);
        var user = await UserService.findOneBy({_id: userId});
        var email = user.email;
        await MailService.sendChangePlanMail(projectName, oldPlan, newPlan, email);
        return sendItemResponse(req, res, project);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }

});

// Description: Emailing Fyipe Support to upgrade to Enterprise Plan after maxing out of Pro Plan.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}; req.body-> {projectName, planId, oldPlan}
// Returns: 200: {project}; 400: Error.
router.post('/:projectId/upgradeToEnterprise', getUser, isAuthorized, isUserOwner, async function (req, res) {
    var projectId = req.params.projectId;
    var projectName = req.body.projectName;
    var userId = req.user ? req.user.id : null;
    var oldPlan = req.body.oldPlan;

    if (!projectId) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectId must be present.'
        });
    }

    if (!projectName) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'ProjectName must be present.'
        });
    }

    if (!oldPlan) {
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Old Plan must be present.'
        });
    }

    try{
        var user = await UserService.findOneBy({_id: userId});
        var email = user.email;
        await MailService.sendUpgradeToEnterpriseMail(projectName, projectId, oldPlan, email);
        return sendItemResponse(req, res, 'Mail Sent Successfully!');
    }catch(error){
        return sendErrorResponse(req, res, error);
    }

});

// Description: Removing team member by Project Admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: "User successfully removed"; 400: Error.
router.delete('/:projectId/user/:userId/exitProject', getUser, isAuthorized, async function (req, res) {
    var userId = req.user ? req.user.id : null;
    var projectId = req.params.projectId;

    // Call the ProjectService
    try{
        var teamMember = await ProjectService.exitProject(projectId, userId);
        return sendItemResponse(req, res, teamMember);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }

});

// Description: Creating a new subproject by Project Admin.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: subproject;
router.post('/:projectId/subProject', getUser, isAuthorized, async function (req, res) {
    var userId = req.user ? req.user.id : null;
    var parentProjectId = req.params.projectId;

    if(Array.isArray(req.body)){
        let data = [];
        if(req.body.length > 0){
            for(let val of req.body){
                if(!val._id){
                    // Sanitize
                    if (!val.name) {
                        return sendErrorResponse( req, res, {
                            code: 400,
                            message: 'Subproject name must be present.'
                        });
                    }
        
                    if (typeof val.name !== 'string') {
                        return sendErrorResponse( req, res, {
                            code: 400,
                            message: 'Subproject name is not in string format.'
                        });
                    }
        
                    try{
                        // check if project has a sub-project with provided name
                        let countSubProject = await ProjectService.countBy({name: val.name, parentProjectId: req.params.projectId});
                        if(countSubProject > 0){
                            return sendErrorResponse( req, res, {
                                code: 400,
                                message: 'You already have a sub-project with same name.'
                            });
                        }
                    }catch(error){
                        return sendErrorResponse(req, res, error);
                    }
                }
                val.userId = userId;
                val.parentProjectId = parentProjectId;
                data.push(val);
            }
        
            try{
                let subProjects = await ProjectService.addSubProjects(data, parentProjectId, userId);
                return sendItemResponse(req, res, subProjects);
            }catch(error){
                return sendErrorResponse(req, res, error);
            }
        }else{
            try{
                let subProjects = await ProjectService.addSubProjects(data, parentProjectId, userId);
                return sendItemResponse(req, res, subProjects);
            }catch(error){
                return sendErrorResponse(req, res, error);
            }
        }
    }else{
        return sendErrorResponse( req, res, {
            code: 400,
            message: 'Subprojects are expected in array format.'
        });
    }

});

// Description: Fetch all subprojects.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId, userId}
// Returns: 200: [...subprojects];
router.get('/:projectId/subProjects', getUser, isAuthorized, async function (req, res) {
    var parentProjectId = req.params.projectId;
    var userId = req.user ? req.user.id : null;

    // Call the ProjectService
    try{
        var subProjects = await ProjectService.findBy({parentProjectId, 'users.userId': userId});
        var count = await ProjectService.countBy({parentProjectId, 'users.userId': userId});
        return sendListResponse(req, res, subProjects, count);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }

});

module.exports = router;

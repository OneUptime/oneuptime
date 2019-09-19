module.exports = {

    findBy: async function (query, limit, skip) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof (skip) === 'string') skip = parseInt(skip);

        if (typeof (limit) === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if(!query.deleted) query.deleted = false;
        try{
            var projects = await ProjectModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('userId', 'name')
                .populate('parentProjectId', 'name');
        }catch(error){
            ErrorService.log('ProjectModel.find', error);
            throw error;
        }
        return projects;
    },

    create: async function (data) {
        var _this = this;
        var projectModel = new ProjectModel();
        if(data.parentProjectId){
            var parentProject = await _this.findOneBy({_id: data.parentProjectId});
            projectModel.users = parentProject.users;
        }else{
            projectModel.users = [{
                userId: data.userId,
                role: 'Owner'
            }];
        }
        projectModel.name = data.name || null;
        projectModel.slug = data.slug || null;
        projectModel.apiKey = uuidv1();
        projectModel.stripePlanId = data.stripePlanId || null;
        projectModel.stripeSubscriptionId = data.stripeSubscriptionId || null;
        projectModel.stripeExtraUserSubscriptionId = data.stripeExtraUserSubscriptionId || null;
        projectModel.stripeMeteredSubscriptionId = data.stripeMeteredSubscriptionId || null;
        projectModel.parentProjectId = data.parentProjectId || null;
        projectModel.seats = '1';
        projectModel.isBlocked = data.isBlocked || false;
        projectModel.adminNotes = data.adminNotes || null;
        try{
            var project = await projectModel.save();
        }catch(error){
            ErrorService.log('projectModel.save', error);
            throw error;
        }
        return project;
    },

    countBy: async function (query) {
        if (!query) {
            query = {};
        }
        if(!query.deleted) query.deleted = false;

        var count = await ProjectModel.count(query);
        return count;
    },

    deleteBy: async function (query, userId) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        try{
            var project = await ProjectModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
        }catch(error){
            ErrorService.log('ProjectModel.findOneAndUpdate', error);
            throw error;
        }
        if(project){
            if (project.stripeSubscriptionId) {
                try{
                    await PaymentService.removeSubscription(project.stripeSubscriptionId, project.stripeMeteredSubscriptionId, project.stripeExtraUserSubscriptionId);
                }catch(error){
                    ErrorService.log('PaymentService.removeSubscription', error);
                    throw error;
                }
            }
            try{
                var monitors = await MonitorService.findBy({projectId: project._id});
            }catch(error){
                ErrorService.log('MonitorService.findBy');
                throw error;
            }
            await Promise.all(monitors.map(async (monitor)=>{
                await MonitorService.deleteBy({_id: monitor._id});
            }));
            try{
                var schedules = await ScheduleService.findBy({projectId: project._id});
            }catch(error){
                ErrorService.log('ScheduleService.findBy', error);
                throw error;
            }
            await Promise.all(schedules.map(async (schedule)=>{
                await ScheduleService.deleteBy({_id: schedule._id});
            }));
            try{
                var statusPages = await StatusPageService.findBy({projectId: project._id});
            }catch(error){
                ErrorService.log('StatusPageService.findBy', error);
                throw error;
            }
            await Promise.all(statusPages.map(async (statusPage)=>{
                await StatusPageService.deleteBy({_id: statusPage._id});
            }));
            try{
                await integrationService.deleteBy({ projectId: project._id }, userId);
            }catch(error){
                ErrorService.log('integrationService.deleteBy', error);
                throw error;
            }
        }
        return project;
    },

    findOneBy: async function (query) {
        if (!query) {
            query = {};
        }
        if(!query.deleted) query.deleted = false;

        try{
            var project = await ProjectModel.findOne(query)
                .sort([['createdAt', -1]])
                .populate('userId', 'name')
                .populate('parentProjectId', 'name');
        }catch(error){
            ErrorService.log('ProjectModel.findOne', error);
            throw error;
        }
        return project;
    },

    update: async function (data) {
        var _this = this;
        if (!data._id) {
            try{
                var project = await _this.create(data);
            }catch(error){
                ErrorService.log('ProjectService.create', error);
                throw error;
            }
            return project;
        } else {
            try{
                var oldProject = await _this.findOneBy({ _id: data._id, deleted: { $ne: null } });
            }catch(error){
                ErrorService.log('ProjectService.findOneBy', error);
                throw error;
            }
            var name = data.name || oldProject.name;
            var slug = data.slug || oldProject.slug;
            var apiKey = data.apiKey || oldProject.apiKey || uuidv1();
            var stripePlanId = data.stripePlanId || oldProject.stripePlanId;
            var stripeSubscriptionId = data.stripeSubscriptionId || oldProject.stripeSubscriptionId;
            var stripeExtraUserSubscriptionId = data.stripeExtraUserSubscriptionId || oldProject.stripeExtraUserSubscriptionId;
            var stripeMeteredSubscriptionId = data.stripeMeteredSubscriptionId || oldProject.stripeMeteredSubscriptionId;
            var parentProjectId = data.parentProjectId || oldProject.parentProjectId;
            var users = oldProject.users;
            var seats = data.seats || oldProject.seats;
            var alertEnable = data.alertEnable !== undefined ? data.alertEnable : oldProject.alertEnable;
            var alertOptions = data.alertOptions || oldProject.alertOptions;
            var adminNotes = data.adminNotes || oldProject.adminNotes;

            if (data.users) {
                users = data.users;
            }
            
            var isBlocked = oldProject.isBlocked;
            if(typeof data.isBlocked === 'boolean'){
                isBlocked = data.isBlocked;
            }

            var deleted = oldProject.deleted;
            var deletedById = oldProject.deletedById;
            var deletedAt = oldProject.deletedAt;
            if(data.deleted === false){
                deleted = false;
                deletedById = null;
                deletedAt = null;
            }

            try{
                var updatedProject = await ProjectModel.findByIdAndUpdate(data._id, {
                    $set: {
                        name: name,
                        slug: slug,
                        users: users,
                        apiKey: apiKey,
                        stripePlanId: stripePlanId,
                        stripeSubscriptionId: stripeSubscriptionId,
                        stripeExtraUserSubscriptionId: stripeExtraUserSubscriptionId,
                        stripeMeteredSubscriptionId: stripeMeteredSubscriptionId,
                        parentProjectId: parentProjectId,
                        seats: seats,
                        alertEnable,
                        alertOptions,
                        isBlocked,
                        deleted,
                        deletedById,
                        deletedAt,
                        adminNotes
                    }
                }, {
                    new: true
                });
            }catch(error){
                ErrorService.log('ProjectModel.findByIdAndUpdate', error);
                throw error;
            }
            return updatedProject;
        }
    },
    updateAlertOptions: async function (data) {
        var projectId = data._id;
        var userId = data.userId;
        var project = await ProjectModel.findById(projectId).lean();
        var currentBalance = project.balance;
        var { minimumBalance, rechargeToBalance } = data.alertOptions;
        var updatedProject = {};

        if (!data.alertEnable) {
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId, {
                    $set: {
                        alertEnable: false,
                    }
                }, { new: true });
            return updatedProject;
        }

        if (currentBalance >= minimumBalance) {
            // update settings, the current balance satisfies incoming project's alert settings
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId, {
                    $set: {
                        alertEnable: data.alertEnable,
                        alertOptions: data.alertOptions
                    }
                }, { new: true });
            return updatedProject;
        }
        var chargeForBalance = await StripeService.chargeCustomerForBalance(userId, rechargeToBalance, projectId, data.alertOptions);
        if (chargeForBalance && chargeForBalance.paid) {
            var newBalance = rechargeToBalance + currentBalance;
            updatedProject = await ProjectModel.findByIdAndUpdate(
                projectId, {
                    $set: {
                        balance: newBalance,
                        alertEnable: data.alertEnable,
                        alertOptions: data.alertOptions
                    }
                }, { new: true });
            return updatedProject;
        }
        else if (chargeForBalance && chargeForBalance.client_secret) {
            updatedProject = {
                ...project,
                paymentIntent: chargeForBalance.client_secret
            };
            return updatedProject;
        }
        else {
            var error = new Error('Cannot save project settings');
            error.code = 403;
            ErrorService.log('ProjectService.updateAlertOptions', error);
            throw error;
        }
    },
    saveProject: async function (project) {
        try{
            project = await project.save();
        }catch(error){
            ErrorService.log('project.save', error);
            throw error;
        }
        return project;
    },

    getProjectIdsBy: async function (query) {
        var _this = this;
        try{
            var projects = await _this.findBy(query);
        }catch(error){
            ErrorService.log('ProjectService.getProjectIdsBy', error);
            throw error;
        }
        var projectsId = [];

        for (var i = 0; i < projects.length; i++) {
            projectsId.push(projects[i]._id);
        }
        return projectsId;
    },

    resetApiKey: async function (projectId) {
        var _this = this;
        var apiKey = uuidv1();
        try{
            var project = await _this.update({ _id: projectId, apiKey: apiKey });
        }catch(error){
            ErrorService.log('ProjectService.resetApiKey', error);
            throw error;
        }
        return project;
    },

    changePlan: async function (projectId, planId) {
        var _this = this;
        try{
            var project = await _this.update({ _id: projectId, stripePlanId: planId });
        }catch(error){
            ErrorService.log('ProjectService.update', error);
            throw error;
        }
        if (!project.stripeSubscriptionId) {
            let error = new Error('You have not subscribed to a plan.');
            error.code = 400;
            ErrorService.log('ProjectService.changePlan', error);
            throw error;
        }
        var trialLeft = moment(new Date()).diff(moment(project.createdAt), 'days');
        try{
            var stripeSubscriptionId = await PaymentService.changePlan(project.stripeSubscriptionId, planId, project.users.length, trialLeft);
        }catch(error){
            ErrorService.log('PaymentService.changePlan', error);
            throw error;
        }
        try{
            project = await _this.update({ _id: project._id, stripeSubscriptionId: stripeSubscriptionId });
        }catch(error){
            ErrorService.log('ProjectService.update', error);
            throw error;
        }
        return project;
    },

    exitProject: async function (projectId, userId, saveUserSeat) {
        var _this = this;
        var subProject = null;
        try{
            var project = await _this.findOneBy({ _id: projectId, 'users.userId': userId });
        }catch(error){
            ErrorService.log('ProjectService.findOneBy', error);
            throw error;
        }
        if(project.parentProjectId){
            subProject = project;
            project = await _this.findOneBy({_id: subProject.parentProjectId});
        }
        if(project){
            var users = subProject ? subProject.users : project.users;
            projectId = subProject ? subProject._id : project._id;
            var remainingUsers = [];
            for (let user of users) {
                if (user.userId != userId) {
                    remainingUsers.push(user);
                }
            }
            try{
                await _this.update({ _id: projectId, users: remainingUsers});
            }catch(error){
                ErrorService.log('ProjectService.update', error);
                throw error;
            }
            try{
                await EscalationService.removeEscalationMember(projectId, userId);
            }catch(error){
                ErrorService.log('EscalationService.removeEscalationMember', error);
                throw error;
            }

            var countUserInSubProjects = await _this.findBy({parentProjectId: project._id, 'users.userId': userId});

            if(!saveUserSeat){
                if(countUserInSubProjects && countUserInSubProjects.length < 1){
                    let count = 0;
                    try{
                        var user_member = await UserService.findOneBy({ _id: userId });
                    }catch(error){
                        ErrorService.log('UserService.findOneBy', error);
                        throw error;
                    }
                    domains.domains.forEach(async domain => {
                        if (user_member.email.indexOf(domain) > -1) {
                            count++;
                        }
                    });
    
                    var subProjectIds = [];
                    var subProjects = await _this.findBy({ parentProjectId: project._id });
                    if(subProjects && subProjects.length > 0){
                        subProjectIds = subProjects.map(project => project._id);
                    }
                    subProjectIds.push(project._id);
                    try {
                        var countMonitor = await MonitorService.countBy({ projectId: { $in: subProjectIds } });
                    } catch (error) {
                        ErrorService.log('MonitorService.countBy', error);
                        throw error;
                    }
                    var projectSeats = project.seats;
                
                    if (typeof (projectSeats) === 'string') {
                        projectSeats = parseInt(projectSeats);
                    }
                    // check if project seat after reduction still caters for monitors.
                    if (count < 1 && countMonitor <= ((projectSeats - 1) * 5)) {
                        projectSeats = projectSeats - 1;
                        try{
                            await PaymentService.changeSeats(project.stripeExtraUserSubscriptionId, (projectSeats));
                        }catch(error){
                            ErrorService.log('PaymentService.changeSeats', error);
                            throw error;
                        }
                    }
                    try{
                        await _this.update({ _id: project._id, seats: projectSeats.toString() });
                    }catch(error){
                        ErrorService.log('ProjectService.update', error);
                        throw error;
                    }
                }
            }
        }
        return 'User successfully exited the project';
    },

    hardDeleteBy: async function (query) {
        try{
            await ProjectModel.deleteMany(query);
        }catch(error){
            ErrorService.log('ProjectModel.deleteMany', error);
            throw error;
        }
        return 'Project(s) Removed Successfully!';
    },

    addSubProjects: async function(data, parentProjectId, userId){
        let _this = this;
        let subProjectIds = [];

        for(let value of data){
            let subProject = await _this.update(value);
            subProjectIds.push(subProject._id);
        }

        await _this.subProjectCheck(subProjectIds, parentProjectId, userId);

        let subProjects = await Promise.all(subProjectIds.map(async (subProjectId) => {
            return await _this.findOneBy({ _id: subProjectId });
        }));
        
        return subProjects;
    },

    subProjectCheck: async function(subProjectIds, parentProjectId, userId){
        let _this = this;
        let subProjects = await _this.findBy({ parentProjectId: parentProjectId });

        subProjects = subProjects.map(i => i._id.toString());
        subProjectIds = subProjectIds.map(i => i.toString());

        subProjects.map(async (id) => {
            if (subProjectIds.indexOf(id) < 0) {
                await _this.deleteBy({ _id: id }, userId);
            }
        });
    },

    getAllProjects: async function(skip, limit){
        var _this = this;
        let projects = await _this.findBy({ parentProjectId: null, deleted: { $ne: null } }, limit, skip);

        projects = await Promise.all(projects.map(async(project) => {
            // get both sub-project users and project users
            let users = await TeamService.getTeamMembersBy({parentProjectId: project._id});
            if(users.length < 1){
                users = await TeamService.getTeamMembersBy({_id: project._id});
            }
            const projectObj = Object.assign({}, project._doc, { users });
            return projectObj;
        }));
        return projects;
    },

    getUserProjects: async function(userId, skip, limit){
        var _this = this;
        // find user subprojects and parent projects
        var userProjects = await _this.findBy({'users.userId': userId});
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
        projects = await _this.findBy(query, limit || 10, skip || 0);
        var count = await _this.countBy(query);

        // add project monitors
        projects = await Promise.all(projects.map(async(project) => {
            // get both sub-project users and project users
            let users = [];
            if(project.parentProjectId){
                users = await TeamService.getTeamMembersBy({parentProjectId: project.parentProjectId});
                project.users = users;
            }else{
                users = await Promise.all(project.users.map(async (user) => {
                    return await UserService.findOneBy({ _id: user.userId });
                }));
                project.users = users;
            }
            return Object.assign({}, project._doc, { users });
        }));
        return { projects, count };
    },

    restoreBy: async function(query){
        const _this = this;
        query.deleted = true;

        let project = await _this.findBy(query);
        if(project && project.length > 1){
            const projects = await Promise.all(project.map(async (project) => {
                const projectId = project._id;
                let projectOwner = project.users.find(user => user.role === 'Owner');
                projectOwner = await UserService.findOneBy({_id: projectOwner.userId});
                const subscription = await PaymentService.subscribePlan(project.stripePlanId, projectOwner.stripeCustomerId);
                project = await _this.update({
                    _id: projectId, 
                    deleted: false, 
                    deletedBy: null, 
                    deletedAt: null,
                    stripeSubscriptionId: subscription.stripeSubscriptionId,
                    stripeExtraUserSubscriptionId:subscription.stripeExtraUserSubscriptionId,
                    stripeMeteredSubscriptionId: subscription.stripeMeteredSubscriptionId
                });
                let projectSeats = project.seats;
                await PaymentService.changeSeats(project.stripeExtraUserSubscriptionId, (projectSeats));
                await ScheduleService.restoreBy({ projectId, deleted: true });
                await StatusPageService.restoreBy({ projectId, deleted: true });
                await integrationService.restoreBy({ projectId, deleted: true });
                await MonitorService.restoreBy({ projectId, deleted: true });
                return project;
            }));
            return projects;
        }else{
            project = project[0];
            if(project){
                const projectId = project._id;
                let projectOwner = project.users.find(user => user.role === 'Owner');
                projectOwner = await UserService.findOneBy({_id: projectOwner.userId});
                const subscription = await PaymentService.subscribePlan(project.stripePlanId, projectOwner.stripeCustomerId);
                project = await _this.update({
                    _id: projectId, 
                    deleted: false, 
                    deletedBy: null, 
                    deletedAt: null,
                    stripeSubscriptionId: subscription.stripeSubscriptionId,
                    stripeExtraUserSubscriptionId:subscription.stripeExtraUserSubscriptionId,
                    stripeMeteredSubscriptionId: subscription.stripeMeteredSubscriptionId
                });
                let projectSeats = project.seats;
                await PaymentService.changeSeats(project.stripeExtraUserSubscriptionId, (projectSeats));
                await integrationService.restoreBy({ projectId, deleted: true });
                await ScheduleService.restoreBy({ projectId, deleted: true });
                await StatusPageService.restoreBy({ projectId, deleted: true });
                await MonitorService.restoreBy({ projectId, deleted: true });
            }
            return project;
        }
    },

    addNotes: async function(projectId, notes){
        const _this = this;
        let adminNotes = (await _this.update({
            _id: projectId,
            adminNotes: notes
        })).adminNotes;
        return adminNotes;
    },

    searchProjects: async function(query, skip, limit){
        var _this = this;
        let projects = await _this.findBy(query, limit, skip);

        projects = await Promise.all(projects.map(async(project) => {
            // get both sub-project users and project users
            let users = await TeamService.getTeamMembersBy({parentProjectId: project._id});
            if(users.length < 1){
                users = await TeamService.getTeamMembersBy({_id: project._id});
            }
            const projectObj = Object.assign({}, project._doc, { users });
            return projectObj;
        }));
        return projects;
    },
};

var ProjectModel = require('../models/project');
var uuidv1 = require('uuid/v1');
var MonitorService = require('../services/monitorService');
var PaymentService = require('./paymentService');
var ErrorService = require('./errorService');
var UserService = require('./userService');
var integrationService = require('./integrationService');
var ScheduleService = require('./scheduleService');
var moment = require('moment');
var domains = require('../config/domains');
var EscalationService = require('./escalationService');
var StripeService = require('./stripeService');
var TeamService = require('./teamService');
var StatusPageService = require('./statusPageService');
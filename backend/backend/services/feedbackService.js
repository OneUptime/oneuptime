/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */
module.exports = {
    //Description: Create new project for user.
    //Params: 
    //Param 1: projectName: Project name.
    //Param 2: projectId: Project Id present in req.params.
    //Param 3: userId: User Id.
    //Returns: promise
    create: async function (projectId, message, page, createdById) {
        try {
            var feedback = new FeedbackModel();
    
            feedback.message = message;
            feedback.page = page;
            feedback.projectId = projectId;
            feedback.createdById = createdById;
            feedback = await feedback.save();
            feedback = feedback.toObject();
    
            var project = await ProjectService.findOneBy({ _id: projectId });
            feedback.project = project;

            var user = await UserService.findOneBy({ _id: createdById });
            feedback.createdBy = user;

            var record = await AirtableService.logFeedback({
                message,
                name: user.name,
                email: user.email,
                project: project.name,
                page
            });
            feedback.airtableId = record.id || null;
    
            await MailService.sendLeadEmailToFyipeTeam(feedback);
            await MailService.sendUserFeedbackResponse(user.email, user.name);
            return feedback;
        } catch (error) {
            ErrorService.log('FeedbackService.create', error);
            throw error;
        }
    },

    hardDeleteBy: async function (query) {
        try {
            await FeedbackModel.deleteMany(query);
            return 'Feedback(s) removed successfully!';
        } catch (error) {
            ErrorService.log('FeedbackService.deleteMany', error);
            throw error;
        }
    }
};

var FeedbackModel = require('../models/feedback');
var MailService = require('./mailService');
var ErrorService = require('./errorService');
var UserService = require('./userService');
var ProjectService = require('./projectService');
var AirtableService = require('./airtableService');
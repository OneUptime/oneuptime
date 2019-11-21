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
        var feedback = new FeedbackModel();

        feedback.message = message;
        feedback.page = page;
        feedback.projectId = projectId;
        feedback.createdById = createdById;

        try {
            feedback = await feedback.save();
        } catch (error) {
            ErrorService.log('feedback.save', error);
            throw error;
        }

        feedback = feedback.toObject();

        var project = await ProjectService.findOneBy({ _id: projectId });
        feedback.project = project;

        var user = await UserService.findOneBy({ _id: createdById });
        feedback.createdBy = user;

        try {
            var record = await AirtableService.logFeedback({
                message,
                name: user.name,
                email: user.email,
                project: project.name,
                page
            });
            feedback.airtableId = record.id || null;
        } catch (error) {
            ErrorService.log('AirtableService.logFeedback', error);
            throw error;
        }

        try {
            await MailService.sendLeadEmailToFyipeTeam(feedback);
        } catch (error) {
            ErrorService.log('MailService.sendLeadEmailToFyipeTeam', error);
            throw error;
        }
        try {
            await MailService.sendUserFeedbackResponse(user.email, user.name);
        } catch (error) {
            ErrorService.log('MailService.sendUserFeedbackResponse', error);
            throw error;
        }
        return feedback;
    },

    hardDeleteBy: async function (query) {
        try {
            await FeedbackModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('FeedbackModel.deleteMany', error);
            throw error;
        }
        return 'Feedback(s) removed successfully!';
    }
};

var FeedbackModel = require('../models/feedback');
var MailService = require('./mailService');
var ErrorService = require('./errorService');
var UserService = require('./userService');
var ProjectService = require('./projectService');
var AirtableService = require('./airtableService');
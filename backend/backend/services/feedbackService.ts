export default {
    //Description: Create new project for user.
    //Params:
    //Param 1: projectName: Project name.
    //Param 2: projectId: Project Id present in req.params.
    //Param 3: userId: User Id.
    //Returns: promise
    create: async function(
        projectId: $TSFixMe,
        message: $TSFixMe,
        page: $TSFixMe,
        createdById: $TSFixMe
    ) {
        let feedback = new FeedbackModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type 'Documen... Remove this comment to see the full error message
        feedback.message = message;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'page' does not exist on type 'Document<a... Remove this comment to see the full error message
        feedback.page = page;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'Docum... Remove this comment to see the full error message
        feedback.projectId = projectId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
        feedback.createdById = createdById;
        feedback = await feedback.save();
        // @ts-expect-error ts-migrate(2740) FIXME: Type 'LeanDocument<Document<any, any, any>>' is mi... Remove this comment to see the full error message
        feedback = feedback.toObject();

        const [project, user] = await Promise.all([
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ query: { _id: any; }; select: ... Remove this comment to see the full error message
            ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'name',
            }),
            UserService.findOneBy({
                query: { _id: createdById },
                select: 'name email companyPhoneNumber',
            }),
        ]);
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'project' does not exist on type 'Documen... Remove this comment to see the full error message
        feedback.project = project;

        AirtableService.logFeedback({
            message,
            name: user.name,
            email: user.email,
            project: project.name,
            page,
        });

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userName' does not exist on type 'Docume... Remove this comment to see the full error message
        feedback.userName = user.name;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type 'Document<... Remove this comment to see the full error message
        feedback.email = user.email;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'phone' does not exist on type 'Document<... Remove this comment to see the full error message
        feedback.phone = user.companyPhoneNumber;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'templateName' does not exist on type 'Do... Remove this comment to see the full error message
        feedback.templateName = 'User Feedback';

        try {
            MailService.sendLeadEmailToOneUptimeTeam(feedback);
            MailService.sendUserFeedbackResponse(user.email, user.name);
        } catch (error) {
            ErrorService.log('feedbackservice.create', error);
        }
        return feedback;
    },

    hardDeleteBy: async function(query: $TSFixMe) {
        await FeedbackModel.deleteMany(query);
        return 'Feedback(s) removed successfully!';
    },
};

import FeedbackModel from '../models/feedback';
import MailService from './mailService';
import UserService from './userService';
import ProjectService from './projectService';
import AirtableService from './airtableService';
import ErrorService from 'common-server/utils/error';

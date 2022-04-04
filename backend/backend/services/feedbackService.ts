import FeedbackModel from 'common-server/models/feedback';
import MailService from './mailService';
import UserService from './userService';
import ProjectService from './projectService';
import AirtableService from './airtableService';
import Query from 'common-server/types/db/Query';
export default {
    //Description: Create new project for user.
    //Params:
    //Param 1: projectName: Project name.
    //Param 2: projectId: Project Id present in req.params.
    //Param 3: userId: User Id.
    //Returns: promise
    create: async function (
        projectId: $TSFixMe,
        message: $TSFixMe,
        page: $TSFixMe,
        createdById: $TSFixMe
    ) {
        let feedback = new FeedbackModel();

        feedback.message = message;

        feedback.page = page;

        feedback.projectId = projectId;

        feedback.createdById = createdById;
        feedback = await feedback.save();

        feedback = feedback.toObject();

        const [project, user] = await Promise.all([
            ProjectService.findOneBy({
                query: { _id: projectId },
                select: 'name',
            }),
            UserService.findOneBy({
                query: { _id: createdById },
                select: 'name email companyPhoneNumber',
            }),
        ]);

        feedback.project = project;

        AirtableService.logFeedback({
            message,
            name: user.name,
            email: user.email,
            project: project.name,
            page,
        });

        feedback.userName = user.name;

        feedback.email = user.email;

        feedback.phone = user.companyPhoneNumber;

        feedback.templateName = 'User Feedback';

        MailService.sendLeadEmailToOneUptimeTeam(feedback);
        MailService.sendUserFeedbackResponse(user.email, user.name);

        return feedback;
    },

    hardDeleteBy: async function (query: Query) {
        await FeedbackModel.deleteMany(query);
        return 'Feedback(s) removed successfully!';
    },
};

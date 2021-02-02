module.exports = {
    create: async function(data) {
        try {
            const _this = this;

            // prepare issue timeline model
            const issueTimeline = new IssueTimelineModel();

            issueTimeline.status = data.status;
            issueTimeline.issueId = data.issueId;
            issueTimeline.createdById = data.userId;

            let savedIssueTimeline = await issueTimeline.save();
            savedIssueTimeline = await _this.findOneBy({
                _id: issueTimeline._id,
            });
            return savedIssueTimeline;
        } catch (error) {
            ErrorService.log('issueTimelineService.create', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const issueTimeline = await IssueTimelineModel.findOne(query)
                .populate('issueId', 'name')
                .populate('createdById', 'name');
            return issueTimeline;
        } catch (error) {
            ErrorService.log('issueTimelineService.findOneBy', error);
            throw error;
        }
    },
    // get a list of IssueTimeline
    async findBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const issues = await IssueTimelineModel.find(query)
                .populate('issueId', 'name')
                .populate('createdById', 'name');
            return issues;
        } catch (error) {
            ErrorService.log('issueTimelineService.findBy', error);
            throw error;
        }
    },
};

const IssueTimelineModel = require('../models/issueTimeline');
const ErrorService = require('./errorService');

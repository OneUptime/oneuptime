export default {
    create: async function (data: $TSFixMe) {
        const _this = this;

        // prepare issue timeline model
        const issueTimeline = new IssueTimelineModel();

        issueTimeline.status = data.status;

        issueTimeline.issueId = data.issueId;

        issueTimeline.createdById = data.createdById;

        let savedIssueTimeline = await issueTimeline.save();
        const populateIssueTimeline = [
            { path: 'issueId', select: 'name' },
            { path: 'createdById', select: 'name' },
        ];

        const selectIssueTimeline =
            'issueId createdById createdAt status deleted';

        savedIssueTimeline = await _this.findOneBy({
            query: { _id: issueTimeline._id },
            select: selectIssueTimeline,
            populate: populateIssueTimeline,
        });
        return savedIssueTimeline;
    },
    async findOneBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let issueTimelineQuery = IssueTimelineModel.findOne(query).lean();

        issueTimelineQuery = handleSelect(select, issueTimelineQuery);
        issueTimelineQuery = handlePopulate(populate, issueTimelineQuery);

        const issueTimeline = await issueTimelineQuery;

        return issueTimeline;
    },
    // get a list of IssueTimeline
    async findBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let issuesQuery = IssueTimelineModel.find(query).lean();

        issuesQuery = handleSelect(select, issuesQuery);
        issuesQuery = handlePopulate(populate, issuesQuery);

        const issues = await issuesQuery;
        return issues;
    },
};

import IssueTimelineModel from 'common-server/models/issueTimeline';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

import IssueTimelineModel from '../models/issueTimeline';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';

export default class Service {
    async create(data: $TSFixMe) {
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
    }
    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const issueTimelineQuery = IssueTimelineModel.findOne(query)
            .sort(sort)
            .lean();

        issueTimelineQuery.select(select);
        issueTimelineQuery.populate(populate);

        const issueTimeline = await issueTimelineQuery;

        return issueTimeline;
    }
    // get a list of IssueTimeline
    async findBy({ query, select, populate, sort }: FindBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const issuesQuery = IssueTimelineModel.find(query).sort(sort).lean();

        issuesQuery.select(select);
        issuesQuery.populate(populate);

        const issues = await issuesQuery;
        return issues;
    }
}

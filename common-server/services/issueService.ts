import IssueModel from 'common-server/models/issue';
import sha256 from 'crypto-js/sha256';
import ComponentService from './componentService';
import RealTimeService from './realTimeService';
import NotificationService from './notificationService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const _this = this;

        // prepare issue model
        let issue = new IssueModel();

        issue.name = data.exception ? data.exception.type : 'Unknown Error';

        issue.description = data.exception ? data.exception.message : '';

        // generate hash from fingerprint
        const hash = sha256(data.fingerprint.join('')).toString();

        issue.fingerprintHash = hash;

        issue.fingerprint = data.fingerprint;

        issue.type = data.type;

        issue.errorTrackerId = data.errorTrackerId;

        const savedIssue = await issue.save();
        const populateIssue = [
            { path: 'errorTrackerId', select: 'name' },
            { path: 'resolvedById', select: 'name' },
            { path: 'ignoredById', select: 'name' },
        ];

        const selectIssue =
            'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

        issue = await _this.findOneBy({
            query: { _id: savedIssue._id },
            select: selectIssue,
            populate: populateIssue,
        });
        return issue;
    },
    // find a list of Issues
    async findBy({ query, limit, skip, select, populate, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let issuesQuery = IssueModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        issuesQuery = handleSelect(select, issuesQuery);
        issuesQuery = handlePopulate(populate, issuesQuery);

        const issues = await issuesQuery;

        return issues;
    },

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let issueQuery = IssueModel.findOne(query).sort(sort).lean();

        issueQuery = handleSelect(select, issueQuery);
        issueQuery = handlePopulate(populate, issueQuery);

        const issue = await issueQuery;
        return issue;
    },
    findOneByHashAndErrorTracker: async function (
        fingerprint: $TSFixMe,
        errorTrackerId: $TSFixMe
    ) {
        const query = {};
        const hash = sha256(fingerprint.join('')).toString();

        if (!query['deleted']) query['deleted'] = false;

        query.fingerprintHash = hash;

        query.errorTrackerId = errorTrackerId;
        const issue = await IssueModel.findOne(query)
            .lean()
            .populate('resolvedById', 'name')
            .populate('ignoredById', 'name');
        return issue;
    },
    updateOneBy: async function (
        query: Query,
        data: $TSFixMe,
        unsetData = null
    ) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let issue = await IssueModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
            issue = await IssueModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }

        const populateIssue = [
            { path: 'errorTrackerId', select: 'name' },
            { path: 'resolvedById', select: 'name' },
            { path: 'ignoredById', select: 'name' },
        ];

        const selectIssue =
            'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

        issue = await this.findOneBy({
            query,
            select: selectIssue,
            populate: populateIssue,
        });

        return issue;
    },
    deleteBy: async function (
        query: Query,
        userId: string,
        componentId: $TSFixMe
    ) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const issue = await IssueModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            { new: true }
        ).populate('deletedById', 'name');
        if (issue) {
            const component = await ComponentService.findOneBy({
                query: { _id: componentId },
                select: 'projectId',
            });

            NotificationService.create(
                component.projectId,
                `An Issue under Error Tracker ${issue.errorTrackerId.name} was deleted under the component ${component.name} by ${issue.deletedById.name}`,
                issue.deletedById._id,
                'errorTrackerIssueaddremove'
            );
            // run in the background
            RealTimeService.sendErrorTrackerIssueDelete(issue);
            return issue;
        } else {
            return null;
        }
    },

    countBy: async function (query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await IssueModel.countDocuments(query);
        return count;
    },
};

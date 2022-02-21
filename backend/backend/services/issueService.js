module.exports = {
    create: async function(data) {
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
    async findBy({ query, limit, skip, select, populate }) {
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

        if (!query.deleted) query.deleted = false;
        let issuesQuery = IssueModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        issuesQuery = handleSelect(select, issuesQuery);
        issuesQuery = handlePopulate(populate, issuesQuery);

        const issues = await issuesQuery;

        return issues;
    },

    async findOneBy({ query, select, populate }) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let issueQuery = IssueModel.findOne(query).lean();

        issueQuery = handleSelect(select, issueQuery);
        issueQuery = handlePopulate(populate, issueQuery);

        const issue = await issueQuery;
        return issue;
    },
    findOneByHashAndErrorTracker: async function(fingerprint, errorTrackerId) {
        const query = {};
        const hash = sha256(fingerprint.join('')).toString();

        if (!query.deleted) query.deleted = false;
        query.fingerprintHash = hash;
        query.errorTrackerId = errorTrackerId;
        const issue = await IssueModel.findOne(query)
            .lean()
            .populate('resolvedById', 'name')
            .populate('ignoredById', 'name');
        return issue;
    },
    updateOneBy: async function(query, data, unsetData = null) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
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
    deleteBy: async function(query, userId, componentId) {
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
            ).catch(error => {
                errorService.log('NotificationService.create', error);
            });
            // run in the background
            RealTimeService.sendErrorTrackerIssueDelete(issue);
            return issue;
        } else {
            return null;
        }
    },

    countBy: async function(query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await IssueModel.countDocuments(query);
        return count;
    },
};

const IssueModel = require('../models/issue');
const sha256 = require('crypto-js/sha256');
const ComponentService = require('./componentService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');
const errorService = require('common-server/utils/error');

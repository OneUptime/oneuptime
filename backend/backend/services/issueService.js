module.exports = {
    create: async function(data) {
        try {
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
                'name description errorTrackerId type fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

            issue = await _this.findOneBy({
                query: { _id: savedIssue._id },
                select: selectIssue,
                populate: populateIssue,
            });
            return issue;
        } catch (error) {
            ErrorService.log('issueService.create', error);
            throw error;
        }
    },
    // find a list of Issues
    async findBy({ query, limit, skip, select, populate }) {
        try {
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
        } catch (error) {
            ErrorService.log('issueService.findBy', error);
            throw error;
        }
    },

    async findOneBy({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let issueQuery = IssueModel.findOne(query).lean();

            issueQuery = handleSelect(select, issueQuery);
            issueQuery = handlePopulate(populate, issueQuery);

            const issue = await issueQuery;
            return issue;
        } catch (error) {
            ErrorService.log('issueService.findOneBy', error);
            throw error;
        }
    },
    findOneByHashAndErrorTracker: async function(fingerprint, errorTrackerId) {
        try {
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
        } catch (error) {
            ErrorService.log('issueService.findOneBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, unsetData = null) {
        try {
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
                'name description errorTrackerId type fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

            issue = await this.findOneBy({
                query,
                select: selectIssue,
                populate: populateIssue,
            });

            return issue;
        } catch (error) {
            ErrorService.log('issueService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query, userId, componentId) {
        try {
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
        } catch (error) {
            ErrorService.log('issueService.deleteBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await IssueModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('issueService.countBy', error);
            throw error;
        }
    },
};

const IssueModel = require('../models/issue');
const ErrorService = require('./errorService');
const sha256 = require('crypto-js/sha256');
const ComponentService = require('./componentService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

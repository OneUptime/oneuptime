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
            issue = await _this.findOneBy({
                _id: savedIssue._id,
            });
            return issue;
        } catch (error) {
            ErrorService.log('issueService.create', error);
            throw error;
        }
    },
    // find a list of Issues
    async findBy(query, limit, skip) {
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
            const issues = await IssueModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('errorTrackerId', 'name')
                .populate('resolvedById', 'name')
                .populate('ignoredById', 'name');
            return issues;
        } catch (error) {
            ErrorService.log('issueService.findBy', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const issue = await IssueModel.findOne(query)
                .populate('errorTrackerId', 'name')
                .populate('resolvedById', 'name')
                .populate('ignoredById', 'name');
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

            issue = await this.findOneBy(query);

            return issue;
        } catch (error) {
            ErrorService.log('issueService.updateOneBy', error);
            throw error;
        }
    },
};

const IssueModel = require('../models/issue');
const ErrorService = require('./errorService');
const sha256 = require('crypto-js/sha256');

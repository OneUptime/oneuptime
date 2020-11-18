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
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const issue = await IssueModel.findOne(query)
                .populate('resolvedById', 'name')
                .populate('ignoredById', 'name');
            return issue;
        } catch (error) {
            ErrorService.log('issueService.findOneBy', error);
            throw error;
        }
    },
    findOneByHash: async function(fingerprint) {
        try {
            const query = {};
            const hash = sha256(fingerprint.join('')).toString();

            if (!query.deleted) query.deleted = false;
            query.fingerprintHash = hash;
            const issue = await IssueModel.findOne(query)
                .populate('resolvedById', 'name')
                .populate('ignoredById', 'name');
            return issue;
        } catch (error) {
            ErrorService.log('issueService.findOneBy', error);
            throw error;
        }
    },
};

const IssueModel = require('../models/issue');
const ErrorService = require('./errorService');
const sha256 = require('crypto-js/sha256');

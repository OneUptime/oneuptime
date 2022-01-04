const Crypto = require('crypto');
const GitCredentialModel = require('../models/gitCredential');
const { encrypt } = require('../config/encryptDecrypt');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    findOneBy: async function({ query, populate, select }) {
        if (!query) query = {};
        if (!query.deleted) query.deleted = false;

        let gitCredentialQuery = GitCredentialModel.findOne(query).lean();

        gitCredentialQuery = handleSelect(select, gitCredentialQuery);
        gitCredentialQuery = handlePopulate(populate, gitCredentialQuery);

        const gitCredential = await gitCredentialQuery;

        return gitCredential;
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let gitCredentialsQuery = GitCredentialModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip)
            .populate('projectId');

        gitCredentialsQuery = handleSelect(select, gitCredentialsQuery);
        gitCredentialsQuery = handlePopulate(populate, gitCredentialsQuery);

        const gitCredentials = await gitCredentialsQuery;

        return gitCredentials;
    },
    create: async function(data) {
        const { gitUsername, gitPassword, projectId } = data;

        const gitCredential = await this.findOneBy({
            query: { gitUsername, projectId },
            select: '_id',
        });

        if (gitCredential) {
            const error = new Error(
                'Git Credential already exist in this project'
            );
            error.code = 400;
            throw error;
        }

        const iv = Crypto.randomBytes(16);
        const encryptedPassword = await encrypt(gitPassword, iv);

        const response = await GitCredentialModel.create({
            gitUsername,
            gitPassword: encryptedPassword,
            projectId,
            iv,
        });
        return response;
    },
    updateOneBy: async function(query, data) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        if (data.gitPassword) {
            const iv = Crypto.randomBytes(16);
            data.gitPassword = await encrypt(data.gitPassword, iv);
            data.iv = iv;
        }

        let gitCredential = await GitCredentialModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );
        const selectGitCredentials =
            'gitUsername gitPassword iv projectId deleted';

        const populateGitCredentials = [
            { path: 'projectId', select: 'name slug' },
        ];
        gitCredential = await this.findOneBy({
            query: {
                _id: gitCredential._id,
                deleted: gitCredential.deleted,
            },
            select: selectGitCredentials,
            populate: populateGitCredentials,
        }); // This is needed for proper query. It considers deleted and non-deleted git credentials

        if (!gitCredential) {
            const error = new Error(
                'Git Credential not found or does not exist'
            );
            error.code = 400;
            throw error;
        }

        return gitCredential;
    },
    deleteBy: async function(query) {
        let gitCredential = await this.findOneBy({ query, select: '_id' });

        if (!gitCredential) {
            const error = new Error(
                'Git Credential not found or does not exist'
            );
            error.code = 400;
            throw error;
        }

        gitCredential = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });

        return gitCredential;
    },
    hardDeleteBy: async function(query) {
        await GitCredentialModel.deleteMany(query);
        return 'Git credential(s) successfully deleted';
    },
};

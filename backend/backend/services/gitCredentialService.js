const Crypto = require('crypto');
const GitCredentialModel = require('../models/gitCredential');
const ErrorService = require('./errorService');
const { encrypt } = require('../config/encryptDecrypt');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    findOneBy: async function({ query, populate, select }) {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;

            let gitCredentialQuery = GitCredentialModel.findOne(query).lean();

            gitCredentialQuery = handleSelect(select, gitCredentialQuery);
            gitCredentialQuery = handlePopulate(populate, gitCredentialQuery);

            const gitCredential = await gitCredentialQuery;

            return gitCredential;
        } catch (error) {
            ErrorService.log('gitCredentialService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
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
        } catch (error) {
            ErrorService.log('gitCredentialService.findBy', error);
            throw error;
        }
    },
    create: async function(data) {
        try {
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
                ErrorService.log('gitCredentialService.create', error);
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
        } catch (error) {
            ErrorService.log('gitCredentialService.create', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
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
        } catch (error) {
            ErrorService.log('gitCredentialService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
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
        } catch (error) {
            ErrorService.log('gitCredentialService.deleteBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await GitCredentialModel.deleteMany(query);
            return 'Git credential(s) successfully deleted';
        } catch (error) {
            ErrorService.log('gitCredentialService.hardDeleteBy', error);
            throw error;
        }
    },
};

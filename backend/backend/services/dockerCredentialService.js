const Crypto = require('crypto');
const DockerCredentialModel = require('../models/dockerCredential');
const ErrorService = require('./errorService');
const { encrypt, decrypt } = require('../config/encryptDecrypt');
const axios = require('axios');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let dockerCredentialQuery = DockerCredentialModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            dockerCredentialQuery = handleSelect(select, dockerCredentialQuery);
            dockerCredentialQuery = handlePopulate(
                populate,
                dockerCredentialQuery
            );

            const dockerCredentials = await dockerCredentialQuery;
            return dockerCredentials;
        } catch (error) {
            ErrorService.log('dockerCredentialService.findBy', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;

            let dockerCredentialQuery = DockerCredentialModel.findOne(
                query
            ).lean();
            dockerCredentialQuery = handleSelect(select, dockerCredentialQuery);
            dockerCredentialQuery = handlePopulate(
                populate,
                dockerCredentialQuery
            );

            const dockerCredential = await dockerCredentialQuery;
            return dockerCredential;
        } catch (error) {
            ErrorService.log('dockerCredentialService.findOneBy', error);
            throw error;
        }
    },
    create: async function(data) {
        try {
            // no more than one docker credential with the same details in a project
            const dockerCredential = await this.findOneBy({
                query: {
                    dockerRegistryUrl: data.dockerRegistryUrl,
                    projectId: data.projectId,
                    dockerUsername: data.dockerUsername,
                },
                select: '_id',
            });

            if (dockerCredential) {
                const error = new Error(
                    'Docker Credential already exist in this project'
                );
                error.code = 400;
                ErrorService.log('dockerCredentialService.create', error);
                throw error;
            }

            const iv = Crypto.randomBytes(16);
            data.dockerPassword = await encrypt(data.dockerPassword, iv);
            data.iv = iv;

            const response = await DockerCredentialModel.create(data);
            return response;
        } catch (error) {
            ErrorService.log('dockerCredentialService.create', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let dockerCredential = await this.findOneBy({
                query,
                select: 'dockerPassword iv',
            });

            if (!data.deleted && !data.deletedAt) {
                // validate docker username and password before update
                if (data.dockerPassword) {
                    await this.validateDockerCredential({
                        username: data.dockerUsername,
                        password: data.dockerPassword,
                    });
                    const iv = Crypto.randomBytes(16);
                    data.dockerPassword = await encrypt(
                        data.dockerPassword,
                        iv
                    );
                    data.iv = iv;
                } else {
                    const password = await decrypt(
                        dockerCredential.dockerPassword,
                        dockerCredential.iv.buffer
                    );
                    await this.validateDockerCredential({
                        username: data.dockerUsername,
                        password,
                    });
                }
            }

            dockerCredential = await DockerCredentialModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );
            const populate = [{ path: 'projectId', select: 'name slug _id' }];
            const select =
                'dockerRegistryUrl dockerUsername dockerPassword iv projectId';
            dockerCredential = await this.findOneBy({
                query: { _id: dockerCredential._id },
                select,
                populate,
            });

            if (!dockerCredential) {
                const error = new Error(
                    'Docker Credential not found or does not exist'
                );
                error.code = 400;
                throw error;
            }

            return dockerCredential;
        } catch (error) {
            ErrorService.log('dockerCredentialService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            let dockerCredential = await this.findOneBy({
                query,
                select: '_id',
            });

            if (!dockerCredential) {
                const error = new Error(
                    'Docker Credential not found or does not exist'
                );
                error.code = 400;
                ErrorService.log('dockerCredentialService.deleteBy', error);
                throw error;
            }

            dockerCredential = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            return dockerCredential;
        } catch (error) {
            ErrorService.log('dockerCredentialService.deleteBy', error);
            throw error;
        }
    },
    hardDeleteBy: async function(query) {
        try {
            await DockerCredentialModel.deleteMany(query);
            return 'Docker credential(s) successfully deleted';
        } catch (error) {
            ErrorService.log('dockerCredentialService.hardDeleteBy', error);
            throw error;
        }
    },
    validateDockerCredential: async function({ username, password }) {
        try {
            // user docker api to check if username and password is valid
            const response = await axios.post(
                'https://hub.docker.com/v2/users/login',
                { username, password }
            );
            // response.data should contain a token
            return response.data;
        } catch (err) {
            // username or password was incorrect
            const error = new Error('Invalid docker credential');
            error.code = 400;
            throw error;
        }
    },
};

const DockerCredentialModel = require('../models/dockerCredential');
const ErrorService = require('./errorService');
const { encrypt } = require('../config/encryptDecrypt');

module.exports = {
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const dockerCredentials = await DockerCredentialModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('projectId');

            return dockerCredentials;
        } catch (error) {
            ErrorService.log('dockerCredentialService.findBy', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) query = {};
            if (!query.deleted) query.deleted = false;

            const dockerCredential = await DockerCredentialModel.findOne(
                query
            ).populate('projectId');
            return dockerCredential;
        } catch (error) {
            ErrorService.log('dockerCredentialService.findOneBy', error);
            throw error;
        }
    },
    create: async function(data) {
        try {
            // no more than one dockerRegistryUrl in a project
            const dockerCredential = await this.findOneBy({
                dockerRegistryUrl: data.dockerRegistryUrl,
                projectId: data.projectId,
            });

            if (dockerCredential) {
                const error = new Error(
                    'Docker Credential already exist in this project'
                );
                error.code = 400;
                ErrorService.log('dockerCredentialService.create', error);
                throw error;
            }

            data.dockerPassword = await encrypt(data.dockerPassword);

            const response = DockerCredentialModel.create(data);
            return response;
        } catch (error) {
            ErrorService.log('dockerCredentialService.create', error);
            throw error;
        }
    },
};

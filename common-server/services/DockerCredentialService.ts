import Crypto from 'crypto';
import DockerCredentialModel from '../models/dockerCredential';

import { encrypt, decrypt } from '../config/encryptDecrypt';
import axios from 'axios';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const dockerCredentialQuery = DockerCredentialModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        dockerCredentialQuery.select(select);
        dockerCredentialQuery.populate(populate);

        const dockerCredentials = await dockerCredentialQuery;
        return dockerCredentials;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};
        if (!query['deleted']) query['deleted'] = false;

        const dockerCredentialQuery = DockerCredentialModel.findOne(query)
            .sort(sort)
            .lean();
        dockerCredentialQuery.select(select);
        dockerCredentialQuery.populate(populate);

        const dockerCredential = await dockerCredentialQuery;
        return dockerCredential;
    }

    async create(data: $TSFixMe) {
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
            throw error;
        }

        const iv = Crypto.randomBytes(16);
        data.dockerPassword = await encrypt(data.dockerPassword, iv);
        data.iv = iv;

        const response = await DockerCredentialModel.create(data);
        return response;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

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
                data.dockerPassword = await encrypt(data.dockerPassword, iv);
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
            query: {
                _id: dockerCredential._id,

                deleted: dockerCredential.deleted,
            },
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
    }

    async deleteBy(query: Query) {
        let dockerCredential = await this.findOneBy({
            query,
            select: '_id',
        });

        if (!dockerCredential) {
            const error = new Error(
                'Docker Credential not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        dockerCredential = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });

        return dockerCredential;
    }

    async hardDeleteBy(query: Query) {
        await DockerCredentialModel.deleteMany(query);
        return 'Docker credential(s) successfully deleted';
    }

    async validateDockerCredential({ username, password }: $TSFixMe) {
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
    }
}

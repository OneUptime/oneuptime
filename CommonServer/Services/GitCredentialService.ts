import Crypto from 'crypto';
import GitCredentialModel from '../Models/gitCredential';

import { encrypt } from '../config/encryptDecrypt';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
import fs from 'fs';

export default class Service {
    async findOneBy({ query, populate, select, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const gitCredentialQuery: $TSFixMe = GitCredentialModel.findOne(query)
            .sort(sort)
            .lean();

        gitCredentialQuery.select(select);
        gitCredentialQuery.populate(populate);

        const gitCredential: $TSFixMe = await gitCredentialQuery;

        return gitCredential;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = Number(skip);
        }

        if (typeof limit === 'string') {
            limit = Number(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const gitCredentialsQuery: $TSFixMe = GitCredentialModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .populate('projectId');

        gitCredentialsQuery.select(select);
        gitCredentialsQuery.populate(populate);

        const gitCredentials: $TSFixMe = await gitCredentialsQuery;

        return gitCredentials;
    }

    async create(data: $TSFixMe): void {
        const {
            gitUsername,
            gitPassword,
            projectId,
            sshTitle,
            sshPrivateKey,
        }: $TSFixMe = data;
        if (gitUsername && gitPassword) {
            const gitCredential: $TSFixMe = await this.findOneBy({
                query: { gitUsername, projectId },
                select: '_id',
            });
            if (gitCredential) {
                const error: $TSFixMe = new Error(
                    'Git Credential already exist in this project'
                );

                error.code = 400;
                throw error;
            }

            const iv: $TSFixMe = Crypto.randomBytes(16);
            const encryptedPassword: $TSFixMe = await encrypt(gitPassword, iv);

            const response: $TSFixMe = await GitCredentialModel.create({
                gitUsername,
                gitPassword: encryptedPassword,
                projectId,
                iv,
            });
            return response;
        } else if (sshTitle && sshPrivateKey) {
            const gitSsh: $TSFixMe = await this.findOneBy({
                query: { sshTitle, projectId },
                select: '_id',
            });
            if (gitSsh) {
                const error: $TSFixMe = new Error(
                    'Git Ssh already exist in this project'
                );

                error.code = 400;
                throw error;
            }

            const response: $TSFixMe = await GitCredentialModel.create({
                sshTitle,
                sshPrivateKey: sshPrivateKey,
                projectId,
            });
            return response;
        }
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        if (data.gitPassword) {
            const iv: $TSFixMe = Crypto.randomBytes(16);
            data.gitPassword = await encrypt(data.gitPassword, iv);
            data.iv = iv;
        }
        if (data.sshPrivateKey) {
            data.sshPrivateKey = fs.readFileSync(data.sshPrivateKey);
        }
        let gitCredential: $TSFixMe = await GitCredentialModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );
        const selectGitCredentials: $TSFixMe =
            'sshTitle sshPrivateKey gitUsername gitPassword iv projectId deleted';

        const populateGitCredentials: $TSFixMe = [
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
            const error: $TSFixMe = new Error(
                'Git Credential not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        return gitCredential;
    }

    async deleteBy(query: Query): void {
        let gitCredential: $TSFixMe = await this.findOneBy({ query, select: '_id' });

        if (!gitCredential) {
            const error: $TSFixMe = new Error(
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
    }
}

import ApplicationSecurityModel from '../Models/applicationSecurity';
import moment from 'moment';

import { decrypt } from '../config/encryptDecrypt';
import ApplicationSecurityLogService from './ApplicationSecurityLogService';
import GitCredentialService from './GitCredentialService';
import ResourceCategoryService from './ResourceCategoryService';
import getSlug from '../Utils/getSlug';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
import RealTimeService from './realTimeService';

export default class Service {
    async create(data: $TSFixMe) {
        const [
            applicationNameExist,
            gitRepositoryUrlExist,
            gitCredentialExist,
        ] = await Promise.all([
            this.findOneBy({
                query: { name: data.name, componentId: data.componentId },
                select: '_id',
            }),
            this.findOneBy({
                query: {
                    gitRepositoryUrl: data.gitRepositoryUrl,
                    componentId: data.componentId,
                },
                select: '_id',
            }),
            GitCredentialService.findOneBy({
                query: { _id: data.gitCredential },
                select: '_id',
            }),
        ]);

        if (applicationNameExist) {
            const error = new Error(
                'Application security with this name already exist in this component'
            );

            error.code = 400;
            throw error;
        }

        if (gitRepositoryUrlExist) {
            const error = new Error(
                'Application security with this git repository url already exist in this component'
            );

            error.code = 400;
            throw error;
        }

        if (!gitCredentialExist) {
            const error = new Error(
                'Git Credential not found or does not exist'
            );

            error.code = 400;
            throw error;
        }
        const resourceCategoryCount = await ResourceCategoryService.countBy({
            _id: data.resourceCategory,
        });
        if (!resourceCategoryCount || resourceCategoryCount === 0) {
            delete data.resourceCategory;
        }
        data.slug = getSlug(data.name);
        const applicationSecurity = await ApplicationSecurityModel.create(data);
        return applicationSecurity;
    }

    async findOneBy({ query, populate, select, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        // won't be using lean() here because of iv cypher for password
        const applicationSecurityQuery =
            ApplicationSecurityModel.findOne(query).sort(sort);

        applicationSecurityQuery.select(select);

        applicationSecurityQuery.populate(populate);

        const applicationSecurity = await applicationSecurityQuery;
        return applicationSecurity;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;

        // won't be using lean() here because of iv cypher for password
        const applicationSecuritiesQuery = ApplicationSecurityModel.find(query)
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        applicationSecuritiesQuery.select(select);
        applicationSecuritiesQuery.populate(populate);

        const applicationSecurities = await applicationSecuritiesQuery;
        return applicationSecurities;
    }

    async updateOneBy(query: Query, data: $TSFixMe, unsetData = null) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }
        let applicationSecurity =
            await ApplicationSecurityModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            ).populate('gitCredential');

        if (unsetData) {
            applicationSecurity =
                await ApplicationSecurityModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
        }
        if (!applicationSecurity) {
            const error = new Error(
                'Application Security not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        const populateApplicationSecurity = [
            { path: 'componentId', select: '_id slug name slug' },

            { path: 'resourceCategory', select: 'name' },
            {
                path: 'gitCredential',
                select: 'gitUsername gitPassword iv projectId deleted',
            },
        ];

        const selectApplicationSecurity =
            '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

        applicationSecurity = this.findOneBy({
            query: { _id: applicationSecurity._id },
            populate: populateApplicationSecurity,
            select: selectApplicationSecurity,
        });
        return applicationSecurity;
    }

    async deleteBy(query: Query) {
        let applicationSecurity = await this.countBy(query);

        if (!applicationSecurity) {
            const error = new Error(
                'Application Security not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        const securityLog = await ApplicationSecurityLogService.findOneBy({
            query: { securityId: applicationSecurity._id },
            select: '_id',
        });

        // delete log associated with this application security
        if (securityLog) {
            await ApplicationSecurityLogService.deleteBy({
                _id: securityLog._id,
            });
        }

        await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });

        const populateApplicationSecurity = [
            { path: 'componentId', select: '_id slug name slug' },

            { path: 'resourceCategory', select: 'name' },
            {
                path: 'gitCredential',
                select: 'gitUsername gitPassword iv projectId deleted',
            },
        ];

        const selectApplicationSecurity =
            '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

        applicationSecurity = await this.findOneBy({
            query: { ...query, deleted: true },
            populate: populateApplicationSecurity,
            select: selectApplicationSecurity,
        });
        return applicationSecurity;
    }

    async hardDelete(query: Query) {
        await ApplicationSecurityModel.deleteMany(query);
        return 'Application Securities deleted successfully';
    }

    async getSecuritiesToScan() {
        const oneDay = moment().subtract(1, 'days').toDate();

        const populateApplicationSecurity = [
            {
                path: 'componentId',
                select: '_id slug name slug',
            },

            { path: 'resourceCategory', select: 'name' },
            {
                path: 'gitCredential',
                select: 'sshTitle sshPrivateKey gitUsername gitPassword iv projectId deleted',
            },
        ];

        const selectApplicationSecurity =
            '_id name slug gitRepositoryUrl gitCredential componentId resourceCategory lastScan scanned scanning deleted';

        const securities = await this.findBy({
            query: {
                $or: [{ lastScan: { $lt: oneDay } }, { scanned: false }],
                scanning: false,
            },
            select: selectApplicationSecurity,
            populate: populateApplicationSecurity,
        });
        return securities;
    }

    async decryptPassword(security: $TSFixMe) {
        const values = [];
        for (let i = 0; i <= 15; i++) values.push(security.gitCredential.iv[i]);
        const iv = Buffer.from(values);
        security.gitCredential.gitPassword = await decrypt(
            security.gitCredential.gitPassword,
            iv
        );
        return security;
    }

    async updateScanTime(query: Query) {
        const newDate = new Date();
        const applicationSecurity = await this.updateOneBy(query, {
            lastScan: newDate,
            scanned: true,
            scanning: false,
        });

        RealTimeService.handleScanning({
            security: applicationSecurity,
        });
        return applicationSecurity;
    }
    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await ApplicationSecurityModel.countDocuments(query);
        return count;
    }
}

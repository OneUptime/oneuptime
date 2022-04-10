import ContainerSecurityModel from '../Models/containerSecurity';
import moment from 'moment';

import { decrypt } from '../config/encryptDecrypt';
import ContainerSecurityLogService from './ContainerSecurityLogService';
import DockerCredentialService from './DockerCredentialService';
import ResourceCategoryService from './ResourceCategoryService';
import getSlug from '../utils/getSlug';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
import RealTimeService from './realTimeService';

export default class Service {
    async create(data: $TSFixMe) {
        const [containerNameExist, imagePathExist, dockerCredentialExist] =
            await Promise.all([
                this.findOneBy({
                    query: { name: data.name, componentId: data.componentId },
                    select: '_id',
                }),
                this.findOneBy({
                    query: {
                        imagePath: data.imagePath,
                        componentId: data.componentId,
                    },
                    select: '_id',
                }),
                DockerCredentialService.findOneBy({
                    query: { _id: data.dockerCredential },
                    select: '_id',
                }),
            ]);

        if (containerNameExist) {
            const error = new Error(
                'Container security with this name already exist in this component'
            );

            error.code = 400;
            throw error;
        }

        if (imagePathExist) {
            const error = new Error(
                'Container security with this image path already exist in this component'
            );

            error.code = 400;
            throw error;
        }

        if (!dockerCredentialExist) {
            const error = new Error(
                'Docker Credential not found or does not exist'
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
        const containerSecurity = await ContainerSecurityModel.create(data);
        return containerSecurity;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        // won't be using lean() here because of iv cypher for password
        const containerSecurityQuery =
            ContainerSecurityModel.findOne(query).sort(sort);
        containerSecurityQuery.select(select);
        containerSecurityQuery.populate(populate);

        const containerSecurity = await containerSecurityQuery;
        return containerSecurity;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        // won't be using lean() here because of iv cypher for password
        const containerSecurityQuery = ContainerSecurityModel.find(query)
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        containerSecurityQuery.select(select);
        containerSecurityQuery.populate(populate);

        const containerSecurities = await containerSecurityQuery;
        return containerSecurities;
    }

    async updateOneBy(query: Query, data: $TSFixMe, unsetData = null) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        // The received value from probe service is '{ scanning: true }'
        if (data && data.name) {
            data.slug = getSlug(data.name);
        }

        let containerSecurity = await ContainerSecurityModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        if (unsetData) {
            containerSecurity = await ContainerSecurityModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }

        if (!containerSecurity) {
            const error = new Error(
                'Container Security not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        const populate = [
            { path: 'componentId', select: 'name slug _id' },
            { path: 'resourceCategory', select: 'name' },
            {
                path: 'dockerCredential',
                select: 'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
            },
        ];
        const select =
            'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
        containerSecurity = this.findOneBy({
            query: { _id: containerSecurity._id },
            select,
            populate,
        });
        return containerSecurity;
    }

    async deleteBy(query: Query) {
        let containerSecurity = await this.findOneBy({
            query,
            select: '_id',
        });

        if (!containerSecurity) {
            const error = new Error(
                'Container Security not found or does not exist'
            );

            error.code = 400;
            throw error;
        }

        const securityLog = await ContainerSecurityLogService.findOneBy({
            query: { securityId: containerSecurity._id },
            select: '_id',
        });

        if (securityLog) {
            await ContainerSecurityLogService.deleteBy({
                _id: securityLog._id,
            });
        }

        await this.updateOneBy(query, {
            deleted: true,
            deleteAt: Date.now(),
        });

        containerSecurity = await this.findOneBy({
            query: { ...query, deleted: true },
            select: '_id name slug',
        });
        return containerSecurity;
    }

    async hardDelete(query: Query) {
        await ContainerSecurityModel.deleteMany(query);
        return 'Container Securities deleted successfully';
    }

    async getSecuritiesToScan() {
        const oneDay = moment().subtract(1, 'days').toDate();
        const populate = [
            { path: 'componentId', select: 'name slug _id' },
            { path: 'resourceCategory', select: 'name' },
            {
                path: 'dockerCredential',
                select: 'dockerRegistryUrl dockerUsername dockerPassword iv projectId',
            },
        ];
        const select =
            'componentId resourceCategory dockerCredential name slug imagePath imageTags lastScan scanned scanning';
        const securities = await this.findBy({
            query: {
                $or: [{ lastScan: { $lt: oneDay } }, { scanned: false }],
                scanning: false,
            },
            select,
            populate,
        });
        return securities;
    }

    async decryptPassword(security: $TSFixMe) {
        const values = [];
        for (let i = 0; i <= 15; i++)
            values.push(security.dockerCredential.iv[i]);
        const iv = Buffer.from(values);
        security.dockerCredential.dockerPassword = await decrypt(
            security.dockerCredential.dockerPassword,
            iv
        );
        return security;
    }

    async updateScanTime(query: Query) {
        const newDate = new Date();
        const containerSecurity = await this.updateOneBy(query, {
            lastScan: newDate,
            scanned: true,
            scanning: false,
        });

        RealTimeService.handleScanning({ security: containerSecurity });
        return containerSecurity;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await ContainerSecurityModel.countDocuments(query);
        return count;
    }
}

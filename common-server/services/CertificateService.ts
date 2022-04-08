import CertificateModel from '../models/certificate';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

export default class Service {
    async create(data: $TSFixMe) {
        const certificate = await CertificateModel.create(data);
        return certificate;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const certificateQuery = CertificateModel.findOne(query)
            .sort(sort)
            .lean();

        certificateQuery.select(select);
        certificateQuery.populate(populate);

        const certificate = await certificateQuery;
        return certificate;
    }

    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        const certificateQuery = CertificateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        certificateQuery.select(select);
        certificateQuery.populate(populate);

        const certificates = await certificateQuery;
        return certificates;
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) query = {};

        // if (!query['deleted']) query['deleted'] = false;

        let certificate = await CertificateModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        if (!certificate) {
            certificate = await this.create(data);
        }

        return certificate;
    }

    async deleteBy(query: Query) {
        const certificate = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return certificate;
    }

    async hardDelete(query: Query) {
        await CertificateModel.deleteMany(query);
        return 'certificate store successfully deleted';
    }
    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await CertificateModel.countDocuments(query);
        return count;
    }
}

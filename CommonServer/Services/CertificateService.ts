import CertificateModel from '../Models/certificate';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

export default class Service {
    async create(data: $TSFixMe): void {
        const certificate: $TSFixMe = await CertificateModel.create(data);
        return certificate;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const certificateQuery: $TSFixMe = CertificateModel.findOne(query)
            .sort(sort)
            .lean();

        certificateQuery.select(select);
        certificateQuery.populate(populate);

        const certificate: $TSFixMe = await certificateQuery;
        return certificate;
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

        const certificateQuery: $TSFixMe = CertificateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        certificateQuery.select(select);
        certificateQuery.populate(populate);

        const certificates: $TSFixMe = await certificateQuery;
        return certificates;
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

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

    async deleteBy(query: Query): void {
        const certificate: $TSFixMe = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return certificate;
    }

    async hardDelete(query: Query): void {
        await CertificateModel.deleteMany(query);
        return 'certificate store successfully deleted';
    }
    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const count: $TSFixMe = await CertificateModel.countDocuments(query);
        return count;
    }
}

import CertificateModel from 'common-server/models/certificate';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import FindBy from 'common-server/types/db/FindBy';
import Query from 'common-server/types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const certificate = await CertificateModel.create(data);
        return certificate;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let certificateQuery = CertificateModel.findOne(query)
            .sort(sort)
            .lean();

        certificateQuery = handleSelect(select, certificateQuery);
        certificateQuery = handlePopulate(populate, certificateQuery);

        const certificate = await certificateQuery;
        return certificate;
    },
    findBy: async function ({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let certificateQuery = CertificateModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        certificateQuery = handleSelect(select, certificateQuery);
        certificateQuery = handlePopulate(populate, certificateQuery);

        const certificates = await certificateQuery;
        return certificates;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        const _this = this;
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
            certificate = await _this.create(data);
        }

        return certificate;
    },
    deleteBy: async function (query: Query) {
        const certificate = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return certificate;
    },
    hardDelete: async function (query: Query) {
        await CertificateModel.deleteMany(query);
        return 'certificate store successfully deleted';
    },
    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await CertificateModel.countDocuments(query);
        return count;
    },
};

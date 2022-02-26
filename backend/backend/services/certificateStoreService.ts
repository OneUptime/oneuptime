import CertificateModel from '../models/certificate'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

export default {
    create: async function(data: $TSFixMe) {
        const certificate = await CertificateModel.create(data);
        return certificate;
    },
    findOneBy: async function({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let certificateQuery = CertificateModel.findOne(query).lean();

        certificateQuery = handleSelect(select, certificateQuery);
        certificateQuery = handlePopulate(populate, certificateQuery);

        const certificate = await certificateQuery;
        return certificate;
    },
    findBy: async function({
        query,
        limit,
        skip,
        select,
        populate
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = Number(skip);

        if (typeof limit === 'string') limit = Number(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;

        let certificateQuery = CertificateModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        certificateQuery = handleSelect(select, certificateQuery);
        certificateQuery = handlePopulate(populate, certificateQuery);

        const certificates = await certificateQuery;
        return certificates;
    },
    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        // if (!query.deleted) query.deleted = false;

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
    deleteBy: async function(query: $TSFixMe) {
        const certificate = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });
        return certificate;
    },
    hardDelete: async function(query: $TSFixMe) {
        await CertificateModel.deleteMany(query);
        return 'certificate store successfully deleted';
    },
    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await CertificateModel.countDocuments(query);
        return count;
    },
};

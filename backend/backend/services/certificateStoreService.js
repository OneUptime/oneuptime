const CertificateModel = require('../models/certificate');
const ErrorService = require('./errorService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

module.exports = {
    create: async function(data) {
        try {
            const certificate = await CertificateModel.create(data);
            return certificate;
        } catch (error) {
            ErrorService.log('certificateStoreService.create', error);
            throw error;
        }
    },
    findOneBy: async function({ query, select, populate }) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            let certificateQuery = CertificateModel.findOne(query).lean();

            certificateQuery = handleSelect(select, certificateQuery);
            certificateQuery = handlePopulate(populate, certificateQuery);

            const certificate = await certificateQuery;
            return certificate;
        } catch (error) {
            ErrorService.log('certificateStoreService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function({ query, limit, skip, select, populate }) {
        try {
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
        } catch (error) {
            ErrorService.log('certificateStoreService.findBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        const _this = this;
        try {
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
        } catch (error) {
            ErrorService.log('certificateStoreService.updateOneBy', error);
            throw error;
        }
    },
    deleteBy: async function(query) {
        try {
            const certificate = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });
            return certificate;
        } catch (error) {
            ErrorService.log('certificateStoreService.deleteBy', error);
            throw error;
        }
    },
    hardDelete: async function(query) {
        try {
            await CertificateModel.deleteMany(query);
            return 'certificate store successfully deleted';
        } catch (error) {
            ErrorService.log('certificateStoreService.hardDelete', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await CertificateModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('certificateStoreService.countBy', error);
            throw error;
        }
    },
};

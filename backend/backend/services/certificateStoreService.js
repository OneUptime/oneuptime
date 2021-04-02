const CertificateModel = require('../models/certificate');
const ErrorService = require('./errorService');

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
    findOneBy: async function(query) {
        try {
            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const certificate = await CertificateModel.findOne(query);
            return certificate;
        } catch (error) {
            ErrorService.log('certificateStoreService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = Number(skip);

            if (typeof limit === 'string') limit = Number(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const certificates = await CertificateModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

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

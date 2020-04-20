const DomainVerificationTokenModel = require('../models/domainVerificationToken');
const ErrorService = require('./errorService');

module.exports = {
    create: async function(data) {
        try {
            const creationData = {
                domain: data.domain,
                verificationToken: data.verificationToken,
                verifiedAt: null,
            };
            const domainVerificationToken = await DomainVerificationTokenModel.create(
                creationData
            );
            return domainVerificationToken;
        } catch (error) {
            ErrorService.log('domainVerificationService.create', error);
            throw error;
        }
    },
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            return await DomainVerificationTokenModel.findOne(query);
        } catch (error) {
            ErrorService.log('domainVerificationService.findOneBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        try {
            const updatedDomain = await DomainVerificationTokenModel.findOneAndUpdate(
                query,
                data,
                {
                    new: true,
                }
            );

            return updatedDomain;
        } catch (error) {
            ErrorService.log('domainVerificationService.updateOneBy', error);
            throw error;
        }
    },
};

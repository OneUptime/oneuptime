const dns = require('dns');
const DomainVerificationTokenModel = require('../models/domainVerificationToken');
const ErrorService = require('./errorService');
const getDomain = require('../utils/getDomain');
const flatten = require('../utils/flattenArray');

const dnsPromises = dns.promises;

module.exports = {
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            return await DomainVerificationTokenModel.findOne(query).populate(
                'projectId'
            );
        } catch (error) {
            ErrorService.log('domainVerificationService.findOneBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, subDomain) {
        const domain = getDomain(subDomain);
        if (!query) {
            query = {};
        }

        try {
            const existingBaseDomain = await this.findOneBy({ domain });

            // check for case where the domain is not in the db
            if (!existingBaseDomain) {
                throw {
                    code: 400,
                    message: 'Domain does not exist',
                };
            }

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
    doesTxtRecordExist: async function(subDomain, verificationToken) {
        const host = 'fyipe';
        const domain = getDomain(subDomain);
        const domainToLookup = `${host}.${domain}`;

        try {
            const records = await dnsPromises.resolveTxt(domainToLookup);
            // records is an array of arrays
            // flatten the array to a single array
            const txtRecords = flatten(records);
            return txtRecords.some(
                txtRecord => verificationToken === txtRecord
            );
        } catch (error) {
            if (error.code === 'ENODATA') {
                throw {
                    message: 'TXT record not found.',
                    code: 400,
                };
            }

            if (error.code === 'ENOTFOUND') {
                throw {
                    message: 'TXT record not found.',
                    code: 400,
                };
            }

            ErrorService.log(
                'domainVerificationService.doesTxtRecordExist',
                error
            );
            throw error;
        }
    },
    doesDomainBelongToProject: async function(projectId, subDomain) {
        const domain = getDomain(subDomain);
        const result = await this.findOneBy({
            domain,
        });
        // compare actual strings
        if (result && String(result.projectId._id) !== String(projectId)) {
            return true;
        }

        return false;
    },
    hardDeleteBy: async function(query) {
        try {
            await DomainVerificationTokenModel.deleteMany(query);
            return 'Domain verification token(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('domainVerificationService.hardDeleteBy', error);
            throw error;
        }
    },
};

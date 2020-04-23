const dns = require('dns');
const DomainVerificationTokenModel = require('../models/domainVerificationToken');
const ErrorService = require('./errorService');
const randomChar = require('../utils/randomChar');
const getDomain = require('../utils/getDomain');
const flatten = require('../utils/flattenArray');
const StatusPageService = require('./statusPageService');

const dnsPromises = dns.promises;

module.exports = {
    create: async function(subDomain, projectId, statusPageId) {
        const token = 'fyipe=' + randomChar();
        const domain = getDomain(subDomain);
        let createdDomain = {};

        try {
            // check if domain already exist
            const existingBaseDomain = await this.findOneBy({
                domain,
            });

            if (!existingBaseDomain) {
                const creationData = {
                    domain,
                    verificationToken: token,
                    verifiedAt: null,
                    deletedAt: null,
                    projectId,
                };
                // create the domain
                createdDomain = await DomainVerificationTokenModel.create(
                    creationData
                );
            }
            const statusPage = await StatusPageService.findOneBy({
                _id: statusPageId,
            });

            if (statusPage) {
                // attach the domain id to statuspage collection and update it
                statusPage.domains = [
                    ...statusPage.domains,
                    {
                        domain: subDomain,
                        domainVerificationToken:
                            createdDomain._id || existingBaseDomain._id,
                    },
                ];

                const result = await statusPage.save();
                return result
                    .populate('domains.domainVerificationToken')
                    .execPopulate();
            } else {
                const error = new Error(
                    'Status page not found or does not exist'
                );
                ErrorService.log('domainVerificationService.create', error);
                throw error;
            }
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
    txtRecordExist: async function(subDomain, verificationToken) {
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
                    message: 'TXT record not found',
                    code: 400,
                };
            }

            if (error.code === 'ENOTFOUND') {
                throw {
                    message: 'Domain not found',
                    code: 400,
                };
            }

            ErrorService.log('domainVerificationService.txtRecordExist', error);
            throw error;
        }
    },
    domainExist: async function(projectId, subDomain) {
        const domain = getDomain(subDomain);
        let result = await this.findOneBy({
            domain,
        });
        // compare actual strings
        if (result && String(result.projectId._id) !== String(projectId)) {
            return true;
        }

        return false;
    },
    hardDeleteBy: async function(query){
        try {
            await DomainVerificationTokenModel.deleteMany(query);
            return 'Domain verification token(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('domainVerificationService.hardDeleteBy', error);
            throw error;
        }
    }
};

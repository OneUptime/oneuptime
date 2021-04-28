const dns = require('dns');
const psl = require('psl');
const DomainVerificationTokenModel = require('../models/domainVerificationToken');
const ErrorService = require('./errorService');
const flatten = require('../utils/flattenArray');
const randomChar = require('../utils/randomChar');
const StatusPageService = require('../services/statusPageService');
const ProjectService = require('../services/projectService');
const dnsPromises = dns.promises;

module.exports = {
    create: async function({ domain, projectId }) {
        const parsed = psl.parse(domain);
        const token = 'fyipe=' + randomChar();
        const creationData = {
            domain: parsed.domain,
            verificationToken: token,
            verifiedAt: null,
            deletedAt: null,
            projectId,
        };

        return await DomainVerificationTokenModel.create(creationData);
    },
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            if (query.domain) {
                const parsed = psl.parse(query.domain);
                query.domain = parsed.domain;
            }

            return await DomainVerificationTokenModel.findOne(query).populate(
                'projectId'
            );
        } catch (error) {
            ErrorService.log('domainVerificationService.findOneBy', error);
            throw error;
        }
    },
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') {
                skip = Number(skip);
            }

            if (typeof limit === 'string') {
                limit = Number(limit);
            }

            if (!query) {
                query = {};
            }
            query.deleted = false;

            if (query.domain) {
                const parsed = psl.parse(query.domain);
                query.domain = parsed.domain;
            }

            // fetch subproject
            if (query.projectId) {
                let subProjects = await ProjectService.findBy({
                    parentProjectId: query.projectId,
                });
                subProjects = subProjects.map(project => project._id); // grab just the project ids
                const totalProjects = [query.projectId, ...subProjects];

                query = { ...query, projectId: { $in: totalProjects } };
            }

            return await DomainVerificationTokenModel.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip)
                .populate('projectId');
        } catch (error) {
            ErrorService.log('domainVerificationService.findOneBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data) {
        if (query && query.domain) {
            const parsed = psl.parse(query.domain);
            query.domain = parsed.domain;
        }

        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

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
    resetDomain: async function(domain) {
        try {
            const _this = this;
            const updateObj = {
                verificationToken: 'fyipe=' + randomChar(),
                verified: false,
                updatedAt: new Date(),
            };
            const updatedDomain = await _this.updateOneBy(
                { _id: domain },
                updateObj
            );
            return updatedDomain;
        } catch (error) {
            ErrorService.log('domainVerificationService.resetDomain', error);
            throw error;
        }
    },
    doesTxtRecordExist: async function(subDomain, verificationToken) {
        const parsed = psl.parse(subDomain);
        const host = 'fyipe';
        const domain = parsed.domain;
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
                    message:
                        "TXT record not found. If you've just made a change, it might take more than 48 hours for your DNS to reflect changes.",
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
        // ensure that a particular domain is available to all project and subProject
        const project = await ProjectService.findOneBy({ _id: projectId });
        const projectList = [project._id];
        if (project.parentProjectId) {
            projectList.push(project.parentProjectId._id);
        } else {
            let subProjects = await ProjectService.findBy({
                parentProjectId: project._id,
            });
            subProjects = subProjects.map(project => project._id); // grab just the project ids
            projectList.push(...subProjects);
        }

        const parsed = psl.parse(subDomain);
        const domain = parsed.domain;
        const result = await DomainVerificationTokenModel.find({
            domain,
            /**
             * USE CASE THAT WARRANT REMOVAL OF VERIFIED FIELD
             *
             * A user can have the same unverified domain in more than one project,
             * and if they verify the domain, that means we now have the same verified domains in two different project
             * defeating the initial purpose of this
             */
            // verified: true,
            projectId: { $nin: projectList },
            deleted: false,
        });

        if (result && result.length > 0) {
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
    deleteBy: async function(query) {
        try {
            let domain = await this.findOneBy(query);

            if (!domain) {
                const error = new Error('Domain not found or does not exist');
                error.code = 400;
                throw error;
            }

            domain = await this.updateOneBy(query, {
                deleted: true,
                deletedAt: Date.now(),
            });

            const statusPages = await StatusPageService.findBy({
                domains: {
                    $elemMatch: { domainVerificationToken: domain._id },
                },
            });

            // making this synchronous is intentional
            // so we don't have a delay in deleting domains from project settings
            // while all custom domains is deleted gradually in the background
            for (const statusPage of statusPages) {
                const statusPageId = statusPage._id;
                for (const eachDomain of statusPage.domains) {
                    if (
                        String(eachDomain.domainVerificationToken._id) ===
                        String(domain._id)
                    ) {
                        // delete all custom domains attached to this domain
                        StatusPageService.deleteDomain(
                            statusPageId,
                            eachDomain._id
                        );
                    }
                }
            }

            return domain;
        } catch (error) {
            ErrorService.log('domainVerificationService.deleteBy', error);
            throw error;
        }
    },
    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await DomainVerificationTokenModel.countDocuments(
                query
            );
            return count;
        } catch (error) {
            ErrorService.log('domainVerificationService.countBy', error);
            throw error;
        }
    },
};

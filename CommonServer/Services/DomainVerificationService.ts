import dns from 'dns';
import BadDataException from 'Common/Types/Exception/BadDataException';
import psl from 'psl';
import DomainVerificationTokenModel from '../Models/domainVerificationToken';
import ObjectID from 'Common/Types/ObjectID';
import flatten from '../Utils/flattenArray';
import randomChar from '../Utils/randomChar';
import StatusPageService from './StatusPageService';
import ProjectService from './ProjectService';
const dnsPromises: $TSFixMe = dns.promises;
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
import errorService from '../Utils/error';

export default class Service {
    public async create({ domain, projectId }: $TSFixMe): void {
        const parsed: $TSFixMe = psl.parse(domain);
        const token: string = 'oneuptime=' + randomChar();

        const creationData: $TSFixMe = {
            domain: parsed.domain,
            verificationToken: token,
            verifiedAt: null,
            deletedAt: null,
            projectId,
        };

        return await DomainVerificationTokenModel.create(creationData);
    }

    public async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort,
    }: FindBy): void {
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
        query.deleted = false;

        if (query.domain) {
            const parsed: $TSFixMe = psl.parse(query.domain);
            query.domain = parsed.domain;
        }

        // Fetch subproject
        if (query.projectId) {
            let subProjects: $TSFixMe = await ProjectService.findBy({
                query: { parentProjectId: query.projectId },
                select: '_id',
            });
            subProjects = subProjects.map((project: $TSFixMe) => {
                return project._id;
            }); // Grab just the project ids
            const totalProjects: $TSFixMe = [query.projectId, ...subProjects];

            query = { ...query, projectId: { $in: totalProjects } };
        }

        const domainsQuery: $TSFixMe = DomainVerificationTokenModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        domainsQuery.select(select);
        domainsQuery.populate(populate);

        const domains: $TSFixMe = await domainsQuery;
        return domains;
    }

    public async resetDomain(domain: $TSFixMe): void {
        const updateObj: $TSFixMe = {
            verificationToken: 'oneuptime=' + randomChar(),
            verified: false,
            updatedAt: new Date(),
        };
        const updatedDomain: $TSFixMe = await this.updateOneBy(
            { _id: domain },
            updateObj
        );
        return updatedDomain;
    }

    public async doesTxtRecordExist(
        subDomain: $TSFixMe,
        verificationToken: $TSFixMe
    ): void {
        try {
            const parsed: $TSFixMe = psl.parse(subDomain);
            const host: string = 'oneuptime';
            const previousHost: string = 'oneuptime';
            const domain: $TSFixMe = parsed.domain;
            const domainToLookup: string = `${host}.${domain}`;
            const prevDomainToLookup: string = `${previousHost}.${domain}`;

            let records: $TSFixMe = await dnsPromises.resolveTxt(
                domainToLookup
            );
            /*
             * Records is an array of arrays
             * Flatten the array to a single array
             */
            let txtRecords: $TSFixMe = flatten(records);
            let result: $TSFixMe = txtRecords.some((txtRecord: $TSFixMe) => {
                return verificationToken === txtRecord;
            });

            if (result) {
                return { result, txtRecords };
            }

            records = await dnsPromises.resolveTxt(prevDomainToLookup);

            txtRecords = flatten(records);
            result = txtRecords.some((txtRecord: $TSFixMe) => {
                return verificationToken === txtRecord;
            });

            return { result, txtRecords };
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

            throw error;
        }
    }

    public async doesDomainBelongToProject(
        projectId: ObjectID,
        subDomain: $TSFixMe
    ): void {
        /*
         * Ensure that a particular domain is available to all project and subProject
         * Domain added to a project should be available for both project and subProjects
         * Domain added to a subProject should be available to other subProjects and project
         */

        const project: $TSFixMe = await ProjectService.findOneBy({
            query: { _id: projectId },
            select: '_id parentProjectId',
        });
        let projectList: $TSFixMe = [project._id];
        let subProjects: $TSFixMe = [];
        if (project.parentProjectId) {
            projectList.push(
                project.parentProjectId._id || project.parentProjectId
            );

            // Find all the subProjects attached to this parent project

            subProjects = await ProjectService.findBy({
                query: {
                    parentProjectId:
                        project.parentProjectId._id || project.parentProjectId,
                },
                select: '_id',
            });
        } else {
            subProjects = await ProjectService.findBy({
                query: { parentProjectId: project._id },
                select: '_id',
            });
        }
        subProjects = subProjects.map((project: $TSFixMe) => {
            return project._id;
        }); // Grab just the project ids
        projectList.push(...subProjects);

        projectList = projectList.filter(
            (projectId: $TSFixMe, index: $TSFixMe) => {
                return projectList.indexOf(projectId) === index;
            }
        );

        const parsed: $TSFixMe = psl.parse(subDomain);
        const domain: $TSFixMe = parsed.domain;
        const result: $TSFixMe = await DomainVerificationTokenModel.find({
            domain,
            /**
             * USE CASE THAT WARRANT REMOVAL OF VERIFIED FIELD
             *
             * A user can have the same unverified domain in more than one project,
             * and if they verify the domain, that means we now have the same verified domains in two different project
             * defeating the initial purpose of this
             */
            // Verified: true,
            projectId: { $nin: projectList },
            deleted: false,
        });

        if (result && result.length > 0) {
            return true;
        }

        return false;
    }

    public async deleteBy(query: Query): void {
        const domainCount: $TSFixMe = await this.countBy(query);

        if (!domainCount || domainCount === 0) {
            throw new BadDataException('Domain not found or does not exist');
        }

        const domain: $TSFixMe = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
        });

        const statusPages: $TSFixMe = await StatusPageService.findBy({
            query: {
                domains: {
                    $elemMatch: { domainVerificationToken: domain._id },
                },
            },
            select: '_id domains',
        });

        /*
         * Making this synchronous is intentional
         * So we don't have a delay in deleting domains from project settings
         * While all custom domains is deleted gradually in the background
         */

        for (const statusPage of statusPages) {
            const statusPageId: $TSFixMe = statusPage._id;
            for (const eachDomain of statusPage.domains) {
                if (
                    String(eachDomain.domainVerificationToken._id) ===
                    String(domain._id)
                ) {
                    // Delete all custom domains attached to this domain
                    StatusPageService.deleteDomain(
                        statusPageId,
                        eachDomain._id
                    ).catch((error: Error) => {
                        errorService.log(
                            'StatusPageService.deleteDomain',
                            error
                        );
                    });
                }
            }
        }

        return domain;
    }

    public async findDomain(domainId: $TSFixMe, projectArr = []): void {
        let projectId: $TSFixMe;
        for (const pId of projectArr) {
            const populateDomainVerify: $TSFixMe = [
                { path: 'projectId', select: '_id' },
            ];
            const check: $TSFixMe = await this.findOneBy({
                query: { _id: domainId, projectId: pId },
                select: 'projectId',
                populate: populateDomainVerify,
            });
            if (check) {
                projectId = check.projectId._id;
            }
        }
        return projectId;
    }
}

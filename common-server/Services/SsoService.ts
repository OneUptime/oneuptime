export default class Service {
    async findBy({ query, limit, skip, populate, select, sort }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;

        const ssosQuery = SsoModel.find(query, {
            _id: 1,
            domain: 1,
            createdAt: 1,
        })
            .lean()
            .sort(sort)
            .skip(skip.toNumber())
            .limit(limit.toNumber());

        ssosQuery.select(select);
        ssosQuery.populate(populate);

        const ssos = await ssosQuery;
        return ssos;
    }

    async deleteBy(query: Query) {
        if (!query) {
            query = {};
        }
        query.deleted = false;
        const sso = await SsoModel.findOneAndUpdate(
            query,
            { $set: { deleted: true, deletedAt: Date.now() } },
            { new: true }
        );
        if (sso) {
            const { _id: domain } = sso;
            const ssoDefaultRoles = await SsoDefaultRolesService.findBy({
                query: { domain },
                select: '_id',
            });
            for (const ssoDefaultRole of ssoDefaultRoles) {
                const { _id } = ssoDefaultRole;
                await SsoDefaultRolesService.deleteBy({ _id });
            }
        }
        return sso;
    }

    async create(data: $TSFixMe) {
        const sso = new SsoModel();

        sso['saml-enabled'] = data['saml-enabled'] || false;

        if (data.projectId) {
            sso.projectId = data.projectId;
        }

        if (!data.domain) {
            const error = new Error('Domain must be defined.');

            error.code = 400;
            throw error;
        }
        const domainExists = await this.findOneBy({
            query: { domain: data.domain },
            select: 'domain',
        });
        if (domainExists) {
            const error = new Error('Domain already exist');

            error.code = 400;
            throw error;
        }

        sso.domain = data.domain;

        if (!data.entityId) {
            const error = new Error('Application ID must be defined');

            error.code = 400;
            throw error;
        }

        sso.entityId = data.entityId;

        if (!data.remoteLoginUrl) {
            const error = new Error('Remote Login Url must be defined.');

            error.code = 400;
            throw error;
        }

        sso.remoteLoginUrl = data.remoteLoginUrl;

        sso.certificateFingerprint = data.certificateFingerprint;

        if (!data.remoteLogoutUrl) {
            const error = new Error('Remote Logout URL must be defined.');

            error.code = 400;
            throw error;
        }

        sso.remoteLogoutUrl = data.remoteLogoutUrl;

        sso.ipRanges = data.ipRanges;

        const savedSso = await sso.save();
        return savedSso;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.deleted = false;
        }
        const ssoQuery = SsoModel.findOne(query).sort(sort).lean();

        ssoQuery.select(select);
        ssoQuery.populate(populate);

        const sso = await ssoQuery;

        return sso;
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (query.createdAt !== undefined) {
            delete query.createdAt;
        }
        query.deleted = false;

        let domainExists = null;
        if (data.domain) {
            domainExists = await this.findOneBy({
                query: { domain: data.domain, _id: { $ne: query._id } },
                select: 'domain',
            });
        }

        if (domainExists) {
            const error = new Error('Domain already exist');

            error.code = 400;
            throw error;
        }

        delete data.projectId;

        await SsoModel.updateMany(query, {
            $set: data,
        });

        const selectSso =
            '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById';
        const sso = await this.findBy({ query, select: selectSso });
        return sso;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

        const count = await SsoModel.countDocuments(query);
        return count;
    }

    async hardDeleteBy(query: Query) {
        await SsoModel.deleteMany(query);
        return 'SSO(s) removed successfully!';
    }

    // grab the email from xml response
    // assuming there's only one email in the xml response
    // or the same email x times in the response
    getEmail(xml: $TSFixMe) {
        const stringifiedXml = String(xml);

        const regex = // eslint-disable-next-line no-control-regex
            /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/gi;

        return stringifiedXml.match(regex)[0];
    }
}

import SsoModel from '../Models/SSO';
import SsoDefaultRolesService from './SsoDefaultRolesService';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

import BadDataException from 'Common/Types/Exception/BadDataException';

export default class Service {
    public async deleteBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;
        const sso: $TSFixMe = await SsoModel.findOneAndUpdate(
            query,
            { $set: { deleted: true, deletedAt: Date.now() } },
            { new: true }
        );
        if (sso) {
            const { _id: domain } = sso;
            const ssoDefaultRoles: $TSFixMe =
                await SsoDefaultRolesService.findBy({
                    query: { domain },
                    select: '_id',
                });
            for (const ssoDefaultRole of ssoDefaultRoles) {
                const { _id }: $TSFixMe = ssoDefaultRole;
                await SsoDefaultRolesService.deleteBy({ _id });
            }
        }
        return sso;
    }

    public async create(data: $TSFixMe): void {
        const sso: $TSFixMe = new SsoModel();

        sso['saml-enabled'] = data['saml-enabled'] || false;

        if (data.projectId) {
            sso.projectId = data.projectId;
        }

        if (!data.domain) {
            throw new BadDataException('Domain must be defined.');
        }
        const domainExists: $TSFixMe = await this.findOneBy({
            query: { domain: data.domain },
            select: 'domain',
        });
        if (domainExists) {
            throw new BadDataException('Domain already exist');
        }

        sso.domain = data.domain;

        if (!data.entityId) {
            throw new BadDataException('Application ID must be defined');
        }

        sso.entityId = data.entityId;

        if (!data.remoteLoginUrl) {
            throw new BadDataException('Remote Login Url must be defined.');
        }

        sso.remoteLoginUrl = data.remoteLoginUrl;

        sso.certificateFingerprint = data.certificateFingerprint;

        if (!data.remoteLogoutUrl) {
            throw new BadDataException('Remote Logout URL must be defined.');
        }

        sso.remoteLogoutUrl = data.remoteLogoutUrl;

        sso.ipRanges = data.ipRanges;

        const savedSso: $TSFixMe = await sso.save();
        return savedSso;
    }

    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query['deleted'] = false;
        }
        const ssoQuery: $TSFixMe = SsoModel.findOne(query).sort(sort).lean();

        ssoQuery.select(select);
        ssoQuery.populate(populate);

        const sso: $TSFixMe = await ssoQuery;

        return sso;
    }

    public async updateBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (query.createdAt !== undefined) {
            delete query.createdAt;
        }
        query['deleted'] = false;

        let domainExists: $TSFixMe = null;
        if (data.domain) {
            domainExists = await this.findOneBy({
                query: { domain: data.domain, _id: { $ne: query._id } },
                select: 'domain',
            });
        }

        if (domainExists) {
            throw new BadDataException('Domain already exist');
        }

        delete data.projectId;

        await SsoModel.updateMany(query, {
            $set: data,
        });

        const selectSso: $TSFixMe =
            '_id saml-enabled domain entityId remoteLoginUrl certificateFingerprint remoteLogoutUrl ipRanges createdAt deleted deletedAt deletedById';
        const sso: $TSFixMe = await this.findBy({ query, select: selectSso });
        return sso;
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const count: $TSFixMe = await SsoModel.countDocuments(query);
        return count;
    }

    // grab the email from xml response
    // assuming there's only one email in the xml response
    // or the same email x times in the response
    public getEmail(xml: $TSFixMe): void {
        const stringifiedXml: $TSFixMe = String(xml);

        const regex: $TSFixMe = // eslint-disable-next-line no-control-regex
            /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/gi;

        return stringifiedXml.match(regex)[0];
    }
}

import SsoModel from '../Models/SSO';
import SsoDefaultRolesService from './SsoDefaultRolesService';

import FindOneBy from '../Types/DB/FindOneBy';
import Query from '../Types/DB/Query';

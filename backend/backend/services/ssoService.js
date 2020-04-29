module.exports = {
    findBy: async function (query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;

            const ssos = await SsoModel.find(
                query,
                { _id: 1, domain: 1, createdAt: 1 })
                .sort([['createdAt', -1]])
                .skip(skip)
                .limit(limit);
            return ssos;
        } catch (error) {
            ErrorService.log('ssoService.findBy', error);
            throw error;
        }
    },

    deleteBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const sso = await SsoModel.findOneAndUpdate(
                query,
                { $set: { deleted: true, deletedAt: Date.now() } },
                { new: true }
            );
            return sso;
        } catch (error) {
            ErrorService.log('ssoService.deleteBy', error);
            throw error;
        }
    },

    create: async function (data) {
        const sso = new SsoModel();
        sso["saml-enabled"] = data["saml-enabled"] || false
        sso.domain = data.domain
        sso.samlSsoUrl = data.samlSsoUrl
        sso.certificateFingerprint = data.certificateFingerprint
        sso.remoteLogoutUrl = data.remoteLogoutUrl
        sso.ipRanges = data.ipRanges
        try {
            await sso.save()
        } catch (error) {
            ErrorService.log('ssoService.create', error);
            throw error;
        }
    },

    getSso: async function (ssoId) {
        try {
            const sso = await SsoModel.findOne({ _id: ssoId });
            if (!sso)
                throw {
                    code: 404,
                    message: 'SSO not found.'
                }
            return sso;
        } catch (error) {
            ErrorService.log('ssoService.getSso', error);
            throw error;
        }
    },
    updateSso: async function (ssoId, data) {
        try {
            const sso = await SsoModel.findOne({ _id: ssoId });
            if (!sso)
                throw {
                    code: 404,
                    message: 'SSO not found.'
                }
            sso["saml-enabled"] = data["saml-enabled"] || false
            sso.domain = data.domain
            sso.samlSsoUrl = data.samlSsoUrl
            sso.certificateFingerprint = data.certificateFingerprint
            sso.remoteLogoutUrl = data.remoteLogoutUrl
            sso.ipRanges = data.ipRanges
            await sso.save();
        } catch (error) {
            ErrorService.log('ssoService.getSso', error);
            throw error;
        }
    },
    countBy: async function (query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        const count = await SsoModel.countDocuments(query);
        return count;
    }
}

const SsoModel = require('../models/sso');
const ErrorService = require('./errorService');
module.exports = {
    getAllSsos: async function () {
        const ssos = await SsoModel.find(
            {},
            { _id: 1, samlSsoUrl: 1, createdAt: 1 }
        );
        return ssos;
    },
    deleteSso: async function (ssoId) {
        try {
            const result = await SsoModel.deleteOne({ _id: ssoId });
            const { ok, deletedCount } = result;
            if (!ok || !deletedCount)
                throw {
                    code: 400,
                    message: 'Failed to remove the sso.'
                }
        } catch (error) {
            ErrorService.log('ssoService.deleteSso', error);
            throw error;
        }
    },
    createSso: async function (data) {
        const sso = new SsoModel();
        sso["saml-enabled"] = data["saml-enabled"] || false
        sso.domain = data.domain
        sso.samlSsoUrl = data.samlSsoUrl
        sso.certificateFingerprint = data.certificateFingerprint
        sso.remoteLogoutUrl = data.remoteLogoutUrl
        sso.ipRanges = data.ipRanges
        sso.createdAt = new Date()
        try {
            await sso.save()
        } catch (error) {
            ErrorService.log('ssoService.deleteCreate', error);
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
            sso.createdAt = new Date()
            await sso.save();
        } catch (error) {
            ErrorService.log('ssoService.getSso', error);
            throw error;
        }
    },
}

const SsoModel = require('../models/sso');
const ErrorService = require('./errorService');
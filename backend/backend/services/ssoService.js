module.exports = {
    getAllSsos: async function () {
        const ssos = await SsoModel.find({});
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
    }
}

const SsoModel = require('../models/sso');
const ErrorService = require('./errorService');
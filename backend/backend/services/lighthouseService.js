module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let lighthouseKey;
            if (data.lighthouseKey) {
                lighthouseKey = data.lighthouseKey;
            } else {
                lighthouseKey = uuidv1();
            }
            const storedlighthouse = await _this.findOneBy({
                lighthouseName: data.lighthouseName,
            });
            if (storedlighthouse && storedlighthouse.lighthouseName) {
                const error = new Error('lighthouse name already exists.');
                error.code = 400;
                ErrorService.log('lighthouse.create', error);
                throw error;
            } else {
                const lighthouse = new LighthouseModel();
                lighthouse.lighthouseKey = lighthouseKey;
                lighthouse.lighthouseName = data.lighthouseName;
                lighthouse.version = data.lighthouseVersion;
                const savedlighthouse = await lighthouse.save();
                return savedlighthouse;
            }
        } catch (error) {
            ErrorService.log('lighthouseService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const lighthouse = await LighthouseModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return lighthouse;
        } catch (error) {
            ErrorService.log('lighthouseService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const lighthouse = await LighthouseModel.findOne(query, {
                deleted: false,
            }).lean();
            return lighthouse;
        } catch (error) {
            ErrorService.log('lighthouseService.findOneBy', error);
            throw error;
        }
    },

    conditions: async (monitorType, con, payload, resp, response) => {
        const status = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body = resp && resp.body ? resp.body : null;
        const queryParams = resp && resp.queryParams ? resp.queryParams : null;
        const headers = resp && resp.headers ? resp.headers : null;
        const sslCertificate =
            resp && resp.sslCertificate ? resp.sslCertificate : null;
        const successReasons = [];
        const failedReasons = [];

        let eventOccurred = false;
        let matchedCriterion;

        if (con && con.length) {
            eventOccurred = await some(con, async condition => {
                let stat = true;
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    stat = await checkAnd(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        sslCertificate,
                        response,
                        successReasons,
                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
                    );
                } else if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
                    stat = await checkOr(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        sslCertificate,
                        response,
                        successReasons,
                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
                    );
                }
                if (stat) {
                    matchedCriterion = condition;
                    return true;
                }

                return false;
            });
        }

        return {
            stat: eventOccurred,
            successReasons,
            failedReasons,
            matchedCriterion,
        };
    },
}
const LighthouseModel = require('../models/lighthouse');
const { some } = require('p-iteration');
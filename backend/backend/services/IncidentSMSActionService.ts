export default {
    get: async function(query: $TSFixMe) {
        const alerts = await incidentSMSActionModel
            .find(query)
            .lean()
            .sort([['createdAt', -1]]);
        return alerts;
    },

    updateOneBy: async (query: $TSFixMe, data: $TSFixMe) => {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const incidentafter = await incidentSMSActionModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        return incidentafter;
    },
};

import incidentSMSActionModel from '../models/incidentSMSAction'

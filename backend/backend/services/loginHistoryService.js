module.exports = {
    async findBy(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 10;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }
            const logs = await LoginHistoryModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            const count = await LoginHistoryModel.countDocuments(query);
            const response = { logs, skip, limit, count };
            return response;
        } catch (error) {
            ErrorService.log('loginHistory.findBy', error);
            throw error;
        }
    },
};

const LoginHistoryModel = require('../models/loginIPLog');
const ErrorService = require('./errorService');

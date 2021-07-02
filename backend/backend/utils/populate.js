const ErrorService = require('../services/errorService');
module.exports = (populateArray, query) => {
    try {
        let result;
        for (let populateItem of populateArray) {
            if (
                !populateItem.table ||
                populateItem.table === '' ||
                !populateItem.field ||
                populateItem.field === ''
            ) {
                let error = new Error('Table and field columns are required');
                error.code = 400;
                throw error;
            } else {
                result = query.populate(populateItem.table, populateItem.field);
            }
        }
        return result;
    } catch (error) {
        ErrorService.log('populate', error);
        throw error;
    }
};

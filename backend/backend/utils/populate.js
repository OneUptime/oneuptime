const ErrorService = require('../services/errorService');
module.exports = (populateArray, query) => {
    try {
        let result;
        for (const populateItem of populateArray) {
            if (!populateItem.length) {
                if (
                    !populateItem.table ||
                    populateItem.table === '' ||
                    !populateItem.field ||
                    populateItem.field === ''
                ) {
                    const error = new Error(
                        'Table and field columns are required'
                    );
                    error.code = 400;
                    throw error;
                } else {
                    result = query.populate(
                        populateItem.table,
                        populateItem.field
                    );
                }
            } else {
                //an array containing path
                if (
                    populateItem[0].populate &&
                    populateItem[0].populate &&
                    populateItem[0].populate.select.length > 1
                ) {
                    result = query.populate(populateItem[0]);
                } else {
                    const error = new Error('Specify columns to be populated');
                    error.code = 400;
                    throw error;
                }
            }
        }
        return result;
    } catch (error) {
        ErrorService.log('populate', error);
        throw error;
    }
};

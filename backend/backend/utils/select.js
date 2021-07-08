const ErrorService = require('../services/errorService');
module.exports = (select, query) => {
    /**
     * select is an array of column(s) to show or hide
     *
     * eg: select = '_id -__v'
     */
    try {
        if (typeof select !== 'string') {
            const error = new Error(
                'Select should be a string containing column to show or hide'
            );
            error.code = 400;
            throw error;
        }
        if (!select || !select.trim()) {
            const error = new Error('Please specify fields to select');
            error.code = 400;
            throw error;
        }

        // TODO: Validate Select.
        // Validate to make sure it does not have "-" negated columns.

        return query.select(select);
    } catch (error) {
        ErrorService.log('select', error);
        throw error;
    }
};

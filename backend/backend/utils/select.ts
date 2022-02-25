import ErrorService from 'common-server/utils/error'
export default (select, query) => {
    /**
     * select is an array of column(s) to show
     *
     * eg: select = '_id createdAt'
     *
     * hidding of column(s) is not allowed, so don't do this
     *
     * select = '-__v -_id' // it will throw an error
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

        // Validate to make sure it does not have "-" negated columns.
        const regex = /((\s|'|")-(\w|\W))/g;
        if (regex.test(select)) {
            const error = new Error(
                'Negated columns are not allowed, only select the fields you need'
            );
            error.code = 400;
            throw error;
        }

        return query.select(select);
    } catch (error) {
        ErrorService.log('select', error);
        throw error;
    }
};

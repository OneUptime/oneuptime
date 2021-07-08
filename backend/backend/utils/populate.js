const ErrorService = require('../services/errorService');
module.exports = (populateArray, query) => {
    /**
     * populate should be an array of object
     *
     * [{ path, select }, ...] // it also takes all acceptable field as well
     *
     * It can also accept a populate key which will have the same structure as the initial object or an array of object
     *
     * [{ path, select, populate: { path, select } ...}]
     * OR
     * [{ path, select, populate: [{ path, select }, ...] }]
     */
    try {
        if (populateArray && !Array.isArray(populateArray)) {
            const error = new Error('Populate should be an array of fields');
            error.code = 400;
            throw error;
        }

        // TODO: Validate populate
        // Make sure populate has select prop so we dont "select" the entire object but ONLY a part of the object.
        // Make sure nested populate also has "select" so we dont select the entire object.

        return query.populate(populateArray);
    } catch (error) {
        ErrorService.log('populate', error);
        throw error;
    }
};

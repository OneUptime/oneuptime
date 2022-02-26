import ErrorService from 'common-server/utils/error'
export default (populateArray: $TSFixMe, query: $TSFixMe) => {
    /**
     * populate should be an array of object, no matter the depth it exist in
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // validate and check for path & select
        if (populateArray && !isPopulateValid(populateArray, true)) {
            const error = new Error(
                'Populate is not following the right convention, make sure to specify path and select property'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }

        return query.populate(populateArray);
    } catch (error) {
        ErrorService.log('populate', error);
        throw error;
    }
};

/**
 * @description checks the validity of populate
 * @param {Array} arr Array containing the populate items
 * @param {Boolean} isValid Boolean value to show validity
 * @returns true|false
 */
function isPopulateValid(arr: $TSFixMe, isValid: $TSFixMe) {
    for (const item of arr) {
        if (!item.path || !item.path.trim()) {
            isValid = false;
            return isValid;
        }
        if (!item.select || !item.select.trim()) {
            isValid = false;
            return isValid;
        }
        if (item.populate) {
            // if populate is an array, recurse and keep checking
            if (Array.isArray(item.populate)) {
                isValid = isPopulateValid(item.populate, isValid);
            }
            // checks if sub-populate is an object
            // then handle it appropriately
            if (
                Object.prototype.toString.call(item.populate) ===
                '[object Object]'
            ) {
                if (!item.populate.path || !item.populate.path.trim()) {
                    isValid = false;
                    return isValid;
                }
                if (!item.populate.select || !item.populate.select.trim()) {
                    isValid = false;
                    return isValid;
                }
            }
        }
    }

    return isValid;
}

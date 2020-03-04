/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    IS_FYIPE_HOSTED: process.env['IS_SAAS_SERVICE'] === 'true' ? true : false,
};

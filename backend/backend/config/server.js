module.exports = {
    IS_SAAS_SERVICE: process.env['IS_SAAS_SERVICE'] === 'true' ? true : false,
    IS_TESTING: process.env['IS_TESTING'] === 'true' ? true : false,
};

const { postApi } = require('./api');

module.exports = {
    scan: async function(security) {
        return await postApi(`application/scan/git`, { security });
    },
};

const { postApi } = require('./api');

module.exports = {
    scan: async function(security) {
        const { _id } = security;

        return await postApi(`probe/scan/git/${_id}`, { security });
    },
};

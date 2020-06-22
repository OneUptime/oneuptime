const { postApi } = require('./api');

module.exports = {
    scan: async function(security) {
        const { _id } = security;

        return await postApi(`probe/scan/docker/${_id}`, { security });
    },
};

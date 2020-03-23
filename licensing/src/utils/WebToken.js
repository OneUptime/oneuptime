/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const jwt = require('jsonwebtoken');
const { tokenSecret } = require('../config/token');

const _this = {
    generateWebToken: ({ licenseKey, presentTime, expiryTime }) => {
        const tokenExpiryTime = expiryTime - presentTime;

        return jwt.sign({ licenseKey }, tokenSecret, {
            expiresIn: String(tokenExpiryTime),
        });
    },
};

module.exports = _this;

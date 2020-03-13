const moment = require('moment');

const validDate = new Date(moment(new Date()).add(10, 'days'))
    .toISOString()
    .split('T')[0];
const expiredDate = new Date().toISOString().split('T')[0];

const validLicense = {
    'License Key': 'valid-license',
    Expires: validDate,
};
const invalidLicense = {
    'License Key': 'invalid-license',
    Expires: validDate,
};
const expiredLicense = {
    'License Key': 'expired-license',
    Expires: expiredDate,
};

module.exports = {
    validLicense,
    invalidLicense,
    expiredLicense,
};

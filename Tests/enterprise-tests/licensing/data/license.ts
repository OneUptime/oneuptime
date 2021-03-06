import moment from 'moment';

const validDate: $TSFixMe = new Date(moment(new Date()).add(10, 'days'))
    .toISOString()
    .split('T')[0];
const expiredDate: $TSFixMe = new Date().toISOString().split('T')[0];

const validLicense: $TSFixMe = {
    'License Key': 'valid-license',
    Expires: validDate,
};
const invalidLicense: $TSFixMe = {
    'License Key': 'invalid-license',
    Expires: validDate,
};
const expiredLicense: $TSFixMe = {
    'License Key': 'expired-license',
    Expires: expiredDate,
};

export default {
    validLicense,
    invalidLicense,
    expiredLicense,
};

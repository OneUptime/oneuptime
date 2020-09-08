const Crypto = require('crypto');
const { find, update } = require('../util/db');
const EncryptDecrypt = require('../util/encryptDecrypt');

const globalconfigsCollection = 'globalconfigs';
const twiliosCollection = 'twilios';

async function run() {
    //Get all globalConfig having authToken not encrypted.
    const globalConfigsWithPlainTextAuthTokens = await find(
        globalconfigsCollection,
        {
            name: 'twilio',
            'value.iv': { $exists: false },
        }
    );
    for (let i = 0; i < globalConfigsWithPlainTextAuthTokens.length; i++) {
        const iv = Crypto.randomBytes(16);
        const globalConfig = globalConfigsWithPlainTextAuthTokens[i];
        const { value } = globalConfig;
        value['authentication-token'] = await EncryptDecrypt.encrypt(
            value['authentication-token'],
            iv
        );
        value['iv'] = iv;
        await update(
            globalconfigsCollection,
            { _id: globalConfig._id },
            { value }
        );
    }
    //Get All the custom twilio settings not having a IV
    const customTwilioSettingsArray = await find(twiliosCollection, {
        iv: { $exists: false },
    });
    for (let i = 0; i < customTwilioSettingsArray.length; i++) {
        const customTwilioSettings = customTwilioSettingsArray[i];
        const iv = Crypto.randomBytes(16);
        const decryptedToken = await EncryptDecrypt.decrypt(
            customTwilioSettings.authToken
        );
        customTwilioSettings.authToken = await EncryptDecrypt.encrypt(
            decryptedToken,
            iv
        );
        customTwilioSettings.iv = iv;
        await update(
            twiliosCollection,
            { _id: customTwilioSettings._id },
            { ...customTwilioSettings }
        );
    }
    //Get all globalConfig having smtp password not encrypted.
    const globalConfigsWithPlainTextPassword = await find(
        globalconfigsCollection,
        {
            name: 'smtp',
            'value.iv': { $exists: false },
        }
    );
    for (let i = 0; i < globalConfigsWithPlainTextPassword.length; i++) {
        const iv = Crypto.randomBytes(16);
        const globalConfig = globalConfigsWithPlainTextPassword[i];
        const { value } = globalConfig;
        value['password'] = await EncryptDecrypt.encrypt(value['password'], iv);
        value['iv'] = iv;
        await update(
            globalconfigsCollection,
            { _id: globalConfig._id },
            { value }
        );
    }
}

module.exports = run;

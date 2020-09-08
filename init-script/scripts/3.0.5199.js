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
            'value.authentication-token': { $exists: true },
        }
    );
    for (let i = 0; i < globalConfigsWithPlainTextAuthTokens.length; i++) {
        const iv = Crypto.randomBytes(16);
        const globalConfig = globalConfigsWithPlainTextAuthTokens[i];
        const { value } = globalConfig;
        value['encrypted-authentication-token'] = await EncryptDecrypt.encrypt(
            value['authentication-token'],
            iv
        );
        value['iv'] = iv;
        delete value['authentication-token'];
        await update(
            globalconfigsCollection,
            { _id: globalConfig._id },
            { value }
        );
    }
    //Get all global configs that have the authTokens encrypted with the old IV stored in the ENV.
    const globalconfigsWithOldIVEncryptedAuthTokens = await find(
        globalconfigsCollection,
        {
            name: 'twilio',
            'value.encrypted-authentication-token': { $exists: true },
            'value.iv': { $exists: false },
        }
    );
    for (let i = 0; i < globalconfigsWithOldIVEncryptedAuthTokens.length; i++) {
        const iv = Crypto.randomBytes(16);
        const globalConfig = globalconfigsWithOldIVEncryptedAuthTokens[i];
        const { value } = globalConfig;
        const decryptedToken = await EncryptDecrypt.decrypt(
            value['encrypted-authentication-token']
        );
        value['encrypted-authentication-token'] = await EncryptDecrypt.encrypt(
            decryptedToken,
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
}

module.exports = run;

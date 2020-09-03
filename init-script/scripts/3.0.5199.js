const { find, update } = require('../util/db');
const EncryptDecrypt = require('../util/encryptDecrypt');

const globalconfigsCollection = 'globalconfigs';

async function run() {
    const globalconfigs = await find(globalconfigsCollection, {
        name:'twilio',
        'value.authentication-token': { $exists: true },
    });
    for(let i=0; i < globalconfigs.length; i++){
        const globalconfig = globalconfigs[i];
        const {value} = globalconfig;
        value['encrypted-authentication-token'] = await EncryptDecrypt.encrypt(value['authentication-token']);
        delete value['authentication-token']
        await update(
            globalconfigsCollection, 
            { _id: globalconfig._id }, 
            { value }
        );
    }
};

module.exports = run;

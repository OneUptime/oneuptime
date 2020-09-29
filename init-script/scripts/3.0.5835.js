const { find, update, save } = require('../util/db');
const bcrypt = require('bcrypt');
const { IS_TESTING, IS_SAAS_SERVICE } = process.env;

const userCollection = 'users';
const email = 'masteradmin@hackerbay.io';
const plainPassword = '1234567890';
const saltRounds = 10;

async function run() {
    if (IS_TESTING === 'true' && IS_SAAS_SERVICE === 'true') {
        const password = await bcrypt.hash(plainPassword, saltRounds);
        const result = await find(userCollection, { email });
        if (result.length > 0) {
            const masterAdmin = result[0];
            const { _id } = masterAdmin;
            update(userCollection, { _id }, { password });
        } else {
            save(userCollection, [
                {
                    email,
                    password,
                    name: 'administrator',
                    role: 'master-admin',
                    disabled: false,
                    isVerified: true,
                    twoFactorAuthEnabled: false,
                    isBlocked: false,
                    deleted: false,
                    companyName: 'hackerbay',
                    companyPhoneNumber: '+19173976235',
                },
            ]);
        }
    }
}

module.exports = run;

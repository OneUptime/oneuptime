const { find, update, removeField } = require('../util/db');

const ssoCollection = 'ssos';

async function run() {
    const ssos = await find(ssoCollection, {
        samlSsoUrl: { $exists: true },
    });

    for (const sso of ssos) {
        await update(
            ssoCollection,
            { _id: sso._id },
            { remoteLoginUrl: sso.samlSsoUrl }
        );

        await removeField(ssoCollection, { _id: sso._id }, { samlSsoUrl: '' });
    }

    return `Script ran for ${ssos.length} ssos`;
}

module.exports = run;

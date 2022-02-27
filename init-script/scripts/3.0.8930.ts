// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update, removeField } from '../util/db';

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

        await removeField(ssoCollection, { _id: sso._id }, 'samlSsoUrl');
    }

    return `Script ran for ${ssos.length} ssos`;
}

export default run;

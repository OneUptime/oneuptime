
import { find, update } from '../util/db';

const ssoCollection = 'ssos';

async function run() {
    const ssos = await find(ssoCollection, {
        entityId: { $exists: false },
    });

    for (const sso of ssos) {
        await update(
            ssoCollection,
            { _id: sso._id },
            { entityId: 'hackerbay.io' }
        );
    }

    return `Script ran for ${ssos.length} sso`;
}

export default run;

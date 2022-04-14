import { find, update, removeField } from '../util/db';

const  ssoCollection: string = 'ssos';

async function run(): void {
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

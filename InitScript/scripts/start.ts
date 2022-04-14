const PKG_VERSION: $TSFixMe = require('../package.json').version;

import { find, save, deleteDatabase } from '../util/db';

import bcrypt from 'bcrypt';

async function run(): void {
    await updateVersion();

    if (process.env['NODE_ENV'] === 'ci') {
        await deleteDatabase();
        await setupTestProbes();

        if (
            process.env['IS_SAAS_SERVICE'] === 'true' ||
            process.env['IS_SAAS_SERVICE'] === true
        ) {
            // if SaaS Service create master admin user automatically.
            await addMasterAdminUser();
        }
    }
}

async function updateVersion(): void {
    const collection: string = 'globalconfigs';
    const name: string = 'version';
    const docs: $TSFixMe = await find(collection, { name });

    if (docs.length === 0) {
        const doc: $TSFixMe = {
            name,
            value: PKG_VERSION,
        };
        await save(collection, [doc]);
    }
}

async function addMasterAdminUser(): void {
    const collection: string = 'users';

    const now: $TSFixMe = new Date().toISOString();

    const masterAdminUser: $TSFixMe = {
        name: 'Master Admin',
        email: 'masteradmin@hackerbay.io',
        password: await bcrypt.hash(
            '1234567890',
            10 //salt rounds
        ),
        isVerified: true,
        role: 'master-admin',
        twoFactorAuthEnabled: false,
        createdAt: now,
        lastActive: now,
        disabled: false,
        isBlocked: false,
        adminNotes: [],
        deleted: false,
    };

    await save(collection, [masterAdminUser]);
}

async function setupTestProbes(): void {
    const collection: string = 'probes';
    const docs: $TSFixMe = await find(collection, {
        probeName: { $in: ['Probe 1', 'Probe 2'] },
    });

    if (docs.length === 0) {
        const now: $TSFixMe = new Date().toISOString();
        const docs: $TSFixMe = [
            {
                deleted: false,
                createdAt: now,
                probeKey: 'test-key',
                probeName: 'Probe 1',
            },
            {
                deleted: false,
                createdAt: now,
                probeKey: 'test-key',
                probeName: 'Probe 2',
            },
        ];
        await save(collection, docs);
    }
}

export default run;

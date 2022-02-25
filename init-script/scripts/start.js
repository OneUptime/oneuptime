const PKG_VERSION = require('../package.json').version;
import { find, save, deleteDatabase } from '../util/db'
import bcrypt from 'bcrypt'

async function run() {
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

async function updateVersion() {
    const collection = 'globalconfigs';
    const name = 'version';
    const docs = await find(collection, { name });

    if (docs.length === 0) {
        const doc = {
            name,
            value: PKG_VERSION,
        };
        await save(collection, [doc]);
    }
}

async function addMasterAdminUser() {
    const collection = 'users';

    const now = new Date().toISOString();

    const masterAdminUser = {
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

async function setupTestProbes() {
    const collection = 'probes';
    const docs = await find(collection, {
        probeName: { $in: ['Probe 1', 'Probe 2'] },
    });

    if (docs.length === 0) {
        const now = new Date().toISOString();
        const docs = [
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

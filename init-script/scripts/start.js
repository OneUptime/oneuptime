const PKG_VERSION = require('../package.json').version;
const { find, save } = require('../util/db');

async function run() {
    await updateVersion();

    if (process.env['NODE_ENV'] === 'development') {
        await setupTestProbes();
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

module.exports = run;

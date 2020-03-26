const PKG_VERSION = require('../package.json').version;
const { update } = require('../util/db');

async function run() {
    const collection = 'globalconfigs';
    const name = 'version';
    await update(collection, { name }, { value: PKG_VERSION });
}

module.exports = run;

const PKG_VERSION = require('../package.json').version;

import { update } from '../util/db';

async function run(): void {
    const collection = 'globalconfigs';
    const name = 'version';
    await update(collection, { name }, { value: PKG_VERSION });
}

export default run;

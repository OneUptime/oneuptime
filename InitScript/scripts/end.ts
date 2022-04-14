const PKG_VERSION: $TSFixMe = require('../package.json').version;

import { update } from '../util/db';

async function run(): void {
    const collection: string = 'globalconfigs';
    const name: string = 'version';
    await update(collection, { name }, { value: PKG_VERSION });
}

export default run;

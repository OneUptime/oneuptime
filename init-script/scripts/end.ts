const PKG_VERSION = require('../package.json').version;
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'upda... Remove this comment to see the full error message
import { update } from '../util/db';

async function run() {
    const collection = 'globalconfigs';
    const name = 'version';
    await update(collection, { name }, { value: PKG_VERSION });
}

export default run;

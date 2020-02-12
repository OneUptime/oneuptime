const PKG_VERSION = require('../package.json').version;
const { find, save } = require('../util/db');

async function run() {
  const collection = 'GlobalConfig';
  const name = 'version';
  const docs = await find(collection, { name });

  if (docs.length === 0) {
    const doc = {
      name,
      value: PKG_VERSION
    };
    await save(collection, doc);
  }
}

module.exports = run;

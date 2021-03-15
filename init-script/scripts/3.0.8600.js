const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const containerSecurityCollection = 'containersecurities';

async function run() {
    const containerSecurities = await find(containerSecurityCollection, {
        deleted: false,
    });
    for (let i = 0; i < containerSecurities.length; i++) {
        let { name } = containerSecurities[i];
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        containerSecurities[i].slug = name.toLowerCase();
        await update(
            containerSecurityCollection,
            { _id: containerSecurities[i]._id },
            { slug: containerSecurities[i].slug }
        );
    }
    return `Script ran for ${containerSecurities.length} containerSecurities.`;
}
module.exports = run;
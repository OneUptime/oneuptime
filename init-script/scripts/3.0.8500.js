const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const applicationSecurityCollection = 'applicationsecurities';

async function run() {
    const applicationSecurities = await find(applicationSecurityCollection, {
        slug: { $exists: false }
    });
    for (let i = 0; i < applicationSecurities.length; i++) {
        let { name } = applicationSecurities[i];
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        applicationSecurities[i].slug = name.toLowerCase();
        await update(
            applicationSecurityCollection,
            { _id: applicationSecurities[i]._id },
            { slug: applicationSecurities[i].slug }
        );
    }
    return `Script ran for ${applicationSecurities.length} applicationSecurities.`;
}
module.exports = run;

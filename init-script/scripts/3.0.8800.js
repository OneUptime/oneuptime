const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const errortrackerCollection = 'errortrackers';

async function run() {
    const errorTrackers = await find(errortrackerCollection, {
        deleted: false,
    });
    for (let i = 0; i < errorTrackers.length; i++) {
        let { name } = errorTrackers[i];
        name = slugify(name);
        name = `${name}-${generate('1234567890', 8)}`;
        errorTrackers[i].slug = name.toLowerCase();
        await update(
            errortrackerCollection,
            { _id: errorTrackers[i]._id },
            { slug: errorTrackers[i].slug }
        );
    }
    return `Script ran for ${errorTrackers.length} errorTrackers.`;
}
module.exports = run;
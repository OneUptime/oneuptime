const { find, update } = require('../util/db');
const slugify = require('slugify');
const generate = require('nanoid/generate');
const projectCollection = 'projects';

async function run() {
    const projects = await find(projectCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[*+~.()'"!:@]/g } },
        ],
    });
    for (const project of projects) {
        let { name } = project;
        name = slugify(name, { remove: /[*+~.()'"!:@]/g });
        name = `${name}-${generate('1234567890', 8)}`;
        project.slug = name.toLowerCase();
        await update(
            projectCollection,
            { _id: project._id },
            { slug: project.slug }
        );
    }
    return `Script ran for ${projects.length} components.`;
}
module.exports = run;

const { find, update } = require('../util/db');
const getSlug = require('../util/getSlug');
const projectCollection = 'projects';

async function run() {
    const projects = await find(projectCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[*+~.()'"!:@]+/g } },
        ],
    });
    for (const project of projects) {
        const { name } = project;
        project.slug = getSlug(name);
        await update(
            projectCollection,
            { _id: project._id },
            { slug: project.slug }
        );
    }
    return `Script ran for ${projects.length} components.`;
}
module.exports = run;

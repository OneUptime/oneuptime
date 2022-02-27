// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const projectCollection = 'projects';

async function run() {
    const projects = await find(projectCollection, {
        $or: [
            { slug: { $exists: false } },
            { slug: { $regex: /[&*+~.,\\/()|'"!:@]+/g } },
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
export default run;

import { find, update } from '../util/db';
import getSlug from '../util/getSlug';
const projectCollection: string = 'projects';

async function run(): void {
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

import { find, save, update } from '../util/db';

const projectCollection: string = 'projects';
const componentCollection: string = 'components';
const monitorCollection: string = 'monitors';

async function run(): void {
    const projects: $TSFixMe = await find(projectCollection, {});

    for (let i: $TSFixMe = 0; i < projects.length; i++) {
        const project: $TSFixMe = projects[i];
        // Find monitors without a component
        const monitors: $TSFixMe = await find(monitorCollection, {
            projectId: project._id,
            componentId: undefined,
        });

        for (let i: $TSFixMe = 0; i < monitors.length; i++) {
            const { _id, name }: $TSFixMe = monitors[i];
            // Create a component for this monitor
            const { ops = [{}] }: $TSFixMe = await save(componentCollection, [
                {
                    name,
                    projectId: project._id,
                    createdAt: Date.now(),
                    deleted: false,
                },
            ]);
            const componentId: $TSFixMe = ops[0]._id;
            // Update monitor with component created
            await update(monitorCollection, { _id }, { componentId });
        }
    }

    return `Script ran for ${projects.length} projects.`;
}

export default run;

const { find, save, update } = require('../util/db');

const projectCollection = 'projects';
const componentCollection = 'components';
const monitorCollection = 'monitors';

async function run() {
    const projects = await find(projectCollection, { deleted: false });

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        // Find monitors without a component
        const monitors = await find(monitorCollection, {
            projectId: project._id,
            componentId: undefined,
            deleted: false,
        });

        for (let i = 0; i < monitors.length; i++) {
            const { _id, name } = monitors[i];
            // Create a component for this monitor
            const { ops = [{}] } = await save(componentCollection, [
                {
                    name,
                    projectId: project._id,
                    createdAt: Date.now(),
                    deleted: false,
                },
            ]);
            const componentId = ops[0]._id;
            // Update monitor with component created
            await update(monitorCollection, { _id }, { componentId });
        }
    }

    return `Script ran for ${projects.length} projects.`;
}

module.exports = run;

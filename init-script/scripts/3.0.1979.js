const { find, save, update } = require('../util/db');

const projectsCollection = 'projects';
const componentCollection = 'components';
const monitorCollection = 'monitors';

const defaultComponentName = 'Default Component';

async function run() {
    const projects = await find(projectsCollection, { deleted: false });

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        // Find default component in project
        const components = await find(componentCollection, {
            name: defaultComponentName,
            projectId: project._id,
            deleted: false,
        });

        let defaultComponentId;

        // If default component exists
        if (components.length > 0) {
            defaultComponentId = components[0]._id;
        } else {
            // Create default component for this project
            const idArray = await save(componentCollection, [
                {
                    name: defaultComponentName,
                    projectId: project._id,
                    createdAt: Date.now(),
                    deleted: false,
                },
            ]);
            defaultComponentId = idArray[0];
        }

        // Find monitors without a component
        const monitors = await find(monitorCollection, {
            projectId: project._id,
            componentId: undefined,
            deleted: false,
        });

        for (let i = 0; i < monitors.length; i++) {
            // Update monitor, set component to default component
            const { _id } = monitors[i];
            await update(
                monitorCollection,
                { _id },
                { componentId: defaultComponentId }
            );
        }
    }

    return `Script ran for ${projects.length} projects.`;
}

module.exports = run;

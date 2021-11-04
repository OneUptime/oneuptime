const { find, update } = require('../util/db');

const projectCollection = 'projects';

async function run() {
    // all main projects
    const projects = await find(projectCollection, {
        deleted: false,
        parentProjectId: null,
    });

    for (const project of projects) {
        const projectUsers =
            project.users?.map(users => ({
                ...users,
                show: true,
            })) || [];
        const mainUserIds = projectUsers.map(user => user.userId);
        // all subProjects
        const subProjects = await find(projectCollection, {
            parentProjectId: String(project._id),
        });

        for (const subProject of subProjects) {
            const subProjectUsers =
                subProject.users?.map(user => {
                    if (mainUserIds.includes(user.userId)) {
                        user.show = false;
                    }
                    return user;
                }) || [];

            await update(
                projectCollection,
                { _id: subProject._id },
                { users: subProjectUsers }
            );
        }

        await update(
            projectCollection,
            { _id: project._id },
            { users: projectUsers }
        );
    }

    return `Script completed`;
}

module.exports = run;

import { find, update } from '../util/db';

const projectCollection: string = 'projects';

async function run(): void {
    // all main projects
    const adminUser = await find('users', {
        role: 'master-admin',
        deleted: false,
    });

    const projects = await find(projectCollection, {
        deleted: false,
        parentProjectId: null,
    });

    const adminUserId = adminUser[0]?._id;

    for (const project of projects) {
        let projectUsers = project.users;
        let mainUserIds = projectUsers.map((user: $TSFixMe) => user.userId);
        if (adminUserId) {
            if (mainUserIds.includes(adminUserId.toString())) {
                projectUsers = project.users?.map((user: $TSFixMe) => {
                    if (
                        user.userId !== adminUserId.toString() ||
                        (user.userId === adminUserId.toString() &&
                            user.role === 'Owner')
                    ) {
                        return {
                            ...user,
                            show: true,
                        };
                    } else {
                        return user;
                    }
                });
            } else {
                projectUsers =
                    project.users?.map((user: $TSFixMe) => ({
                        ...user,
                        show: true,
                    })) || [];
                projectUsers.push({
                    show: false,
                    role: 'Administrator',
                    userId: adminUserId.toString(),
                });
            }
        } else {
            projectUsers =
                project.users?.map((users: $TSFixMe) => ({
                    ...users,
                    show: true,
                })) || [];
        }

        mainUserIds = projectUsers.map((user: $TSFixMe) => user.userId);

        // all subProjects
        const subProjects = await find(projectCollection, {
            parentProjectId: String(project._id.toString()),
        });

        for (const subProject of subProjects) {
            const subProjectUsers =
                subProject.users?.map((user: $TSFixMe) => {
                    if (mainUserIds.includes(user.userId.toString())) {
                        user.show = false;
                    }
                    return user;
                }) || [];

            const subProjectUserIds = subProjectUsers.map(
                (user: $TSFixMe) => user.userId
            );

            if (
                adminUserId &&
                !subProjectUserIds.includes(adminUserId.toString())
            ) {
                subProjectUsers.push({
                    show: false,
                    role: 'Administrator',
                    userId: adminUserId.toString(),
                });
            }

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

export default run;

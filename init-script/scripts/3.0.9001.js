const { find, update } = require('../util/db');

const projectCollection = 'projects';
const domainVerificationTokenCollection = 'domainverificationtokens';

async function run() {
    const domains = await find(domainVerificationTokenCollection, {
        deleted: false,
    });

    for (const domain of domains) {
        const oldProjectId = domain.projectId;

        let project = await find(projectCollection, {
            _id: oldProjectId,
            deleted: false,
        });
        project = project[0];

        if (project && project.parentProjectId) {
            const newProjectId = project.parentProjectId;

            await update(
                domainVerificationTokenCollection,
                {
                    _id: domain._id,
                },
                {
                    projectId: newProjectId,
                }
            );
        }
    }

    return `Script ran for ${domains.length} domains`;
}

module.exports = run;

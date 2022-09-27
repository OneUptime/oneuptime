export default {
    findOneBy: async function ({ query }: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const project: $TSFixMe = await projectCollection.findOne(query);
        return project;
    },
    findBy: async function ({ query, limit, skip }: $TSFixMe): void {
        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const projects: $TSFixMe = await projectCollection
            .find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .toArray();
        return projects;
    },
};

const projectCollection: $TSFixMe = global.db.collection('projects');

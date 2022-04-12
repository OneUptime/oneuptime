export default {
    findOneBy: async function ({ query }: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const project = await projectCollection.findOne(query);
        return project;
    },
    findBy: async function ({ query, limit, skip }: $TSFixMe): void {
        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const projects = await projectCollection
            .find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .toArray();
        return projects;
    },
};

const projectCollection = global.db.collection('projects');

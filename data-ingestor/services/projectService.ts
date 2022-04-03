export default {
    findOneBy: async function ({ query }: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const project = await projectCollection.findOne(query);
        return project;
    },
    findBy: async function ({ query, limit, skip }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const projects = await projectCollection
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip)
            .toArray();
        return projects;
    },
};

const projectCollection = global.db.collection('projects');

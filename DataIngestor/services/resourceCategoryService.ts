const resourceCategoryCollection = global.db.collection('resourcecategories');
import { ObjectId } from 'mongodb';

export default {
    findBy: async function ({ query, limit, skip, sort }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        let resourceCategories = await resourceCategoryCollection
            .find(query)
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort)
            .toArray();

        resourceCategories = resourceCategories.map(
            (resourceCategory: $TSFixMe) => ({
                name: resourceCategory.name,

                _id: ObjectId(resourceCategory._id),
                createdAt: resourceCategory.createdAt,
            })
        );
        return resourceCategories;
    },
};

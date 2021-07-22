module.exports = {
    findBy: async function({ query, limit, skip }) {
        try {
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

            query.deleted = false;

            let resourceCategories = await resourceCategoryCollection
                .find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .toArray();

            resourceCategories = resourceCategories.map(resourceCategory => ({
                name: resourceCategory.name,
                _id: ObjectId(resourceCategory._id),
                createdAt: resourceCategory.createdAt,
            }));
            return resourceCategories;
        } catch (error) {
            ErrorService.log('resourceCategoryService.findBy', error);
            throw error;
        }
    },
};

const resourceCategoryCollection = global.db.collection('resourcecategories');
const { ObjectId } = require('mongodb');
const ErrorService = require('./errorService');

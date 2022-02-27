export default {
    findBy: async function({ query, limit, skip }: $TSFixMe) {
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

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            let resourceCategories = await resourceCategoryCollection
                .find(query)
                .limit(limit)
                .skip(skip)
                .sort({ createdAt: -1 })
                .toArray();

            resourceCategories = resourceCategories.map(
                (resourceCategory: $TSFixMe) => ({
                    name: resourceCategory.name,
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    _id: ObjectId(resourceCategory._id),
                    createdAt: resourceCategory.createdAt,
                })
            );
            return resourceCategories;
        } catch (error) {
            ErrorService.log('resourceCategoryService.findBy', error);
            throw error;
        }
    },
};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const resourceCategoryCollection = global.db.collection('resourcecategories');
import { ObjectId } from 'mongodb';
import ErrorService from './errorService';

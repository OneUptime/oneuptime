import ResourceCategoryModel from '../Models/resourceCategory';
import MonitorModel from '../Models/monitor';
import ApplicationLogModel from '../Models/applicationLog';
import ErrorTrackerModel from '../Models/errorTracker';
import ApplicationSecurityModel from '../Models/applicationSecurity';
import ContainerSecurityModel from '../Models/containerSecurity';
import Query from '../Types/DB/Query';

export default class Service {
    async deleteBy(query: Query, userId: string) {
        const resourceCategory = await ResourceCategoryModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            { new: true }
        );

        await Promise.all([
            MonitorModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ApplicationLogModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ErrorTrackerModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ApplicationSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
            ContainerSecurityModel.updateMany(
                { resourceCategory: query._id },
                {
                    $set: {
                        resourceCategory: null,
                    },
                }
            ),
        ]);

        return resourceCategory;
    }
}

import ApiStatusModel from 'common-server/models/apiStatus';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindOneBy from 'common-server/types/db/FindOneBy';
import Query from 'common-server/types/db/Query';

export default {
    create: async function (data: $TSFixMe) {
        const apiStatus = await ApiStatusModel.create(data);
        return apiStatus;
    },
    findOneBy: async function ({ query, select, populate, sort }: FindOneBy) {
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let apiStatusQuery = ApiStatusModel.findOne(query).sort(sort).lean();

        apiStatusQuery = handleSelect(select, apiStatusQuery);
        apiStatusQuery = handlePopulate(populate, apiStatusQuery);

        const apiStatus = await apiStatusQuery;
        return apiStatus;
    },
    updateOneBy: async function (query: Query, data: $TSFixMe) {
        const _this = this;
        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;

        let apiStatus = await ApiStatusModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            { new: true }
        );

        // create apiStatus details if does not already exist
        if (!apiStatus) {
            apiStatus = await _this.create(data);
        }

        return apiStatus;
    },
    deleteBy: async function (query: Query) {
        const apiStatus = await this.updateOneBy(query, {
            deleted: true,
            deletedAt: Date.now(),
            lastOperation: 'delete',
        });
        return apiStatus;
    },
};

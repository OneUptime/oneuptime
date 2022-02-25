export default {
    findBy: async function({ query, skip, limit, populate, select }) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        let auditLogsQuery = AuditLogsModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        auditLogsQuery = handleSelect(select, auditLogsQuery);
        auditLogsQuery = handlePopulate(populate, auditLogsQuery);

        const auditLogs = await auditLogsQuery;

        return auditLogs;
    },

    countBy: async function({ query }) {
        if (!query) {
            query = {};
        }

        const count = await AuditLogsModel.countDocuments(query);
        return count;
    },

    create: async function(data) {
        const auditLogsModel = new AuditLogsModel({
            userId: data.userId,
            projectId: data.projectId,
            request: data.request,
            response: data.response,
        });

        const auditLog = await auditLogsModel.save();
        return auditLog;
    },

    search: async function({ filter, skip, limit }) {
        const _this = this;
        const query = {
            'request.apiSection': {
                $regex: new RegExp(filter),
                $options: 'i',
            },
        };

        const populateAuditLog = [
            { path: 'userId', select: 'name' },
            { path: 'projectId', select: 'name' },
        ];

        const selectAuditLog = 'userId projectId request response createdAt';

        const [searchedAuditLogs, totalSearchCount] = await Promise.all([
            _this.findBy({
                query,
                skip,
                limit,
                populate: populateAuditLog,
                select: selectAuditLog,
            }),
            _this.countBy({ query }),
        ]);

        return { searchedAuditLogs, totalSearchCount };
    },

    hardDeleteBy: async function({ query }) {
        await AuditLogsModel.deleteMany(query);
    },
};

import AuditLogsModel from '../models/auditLogs'
import handlePopulate from '../utils/populate'
import handleSelect from '../utils/select'

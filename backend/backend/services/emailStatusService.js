module.exports = {
    findBy: async function({ query, limit, skip, sort, populate, select }) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            if (!sort) {
                sort = { createdAt: 'desc' };
            }

            if (!query.deleted) query.deleted = false;
            let itemsQuery = EmailStatusModel.find(query)
                .lean()
                .limit(limit)
                .skip(skip)
                .sort(sort);

            itemsQuery = handleSelect(select, itemsQuery);
            itemsQuery = handlePopulate(populate, itemsQuery);

            const items = await itemsQuery;

            return items;
        } catch (error) {
            ErrorService.log('emailStatusService.findBy', error);
            throw error;
        }
    },

    create: async function({
        from,
        to,
        status,
        subject,
        body,
        template,
        content,
        error,
        smtpServer,
    }) {
        try {
            const globalConfig = await GlobalConfigService.findOneBy({
                name: 'emailLogMonitoringStatus',
            });
            if (globalConfig && globalConfig.value) {
                let item = new EmailStatusModel();

                item.status = status;
                item.from = from;
                item.to = to;
                item.subject = subject;
                item.body = body;
                item.template = template;
                item.content = content;
                item.error = error;
                item.smtpServer = smtpServer;
                item = await item.save();

                return item;
            }
            return;
        } catch (error) {
            ErrorService.log('emailStatusService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await EmailStatusModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('emailStatusService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const items = await EmailStatusModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            });
            return items;
        } catch (error) {
            ErrorService.log('emailStatusService.findOneAndUpdate', error);
            throw error;
        }
    },

    hardDeleteBy: async function({ query }) {
        try {
            await EmailStatusModel.deleteMany(query);
        } catch (error) {
            ErrorService.log('emailLogs.hardDeleteBy', error);
            throw error;
        }
    },

    // Description: Get EmailStatus by item Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with item or error.
    findOneBy: async function({ query, populate, select }) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            let itemQuery = EmailStatusModel.findOne(query).lean();

            itemQuery = handleSelect(select, itemQuery);
            itemQuery = handlePopulate(populate, itemQuery);

            const item = await itemQuery;
            return item;
        } catch (error) {
            ErrorService.log('emailStatusService.findOne', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;

            const updatedEmailStatus = await EmailStatusModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );
            return updatedEmailStatus;
        } catch (error) {
            ErrorService.log('emailStatusService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await EmailStatusModel.updateMany(query, {
                $set: data,
            });
            const selectEmailStatus =
                'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

            updatedData = await this.findBy({
                query,
                select: selectEmailStatus,
            });
            return updatedData;
        } catch (error) {
            ErrorService.log('emailStatusService.updateMany', error);
            throw error;
        }
    },

    search: async function({ filter, skip, limit }) {
        const _this = this;
        const query = {
            to: { $regex: new RegExp(filter), $options: 'i' },
        };

        const selectEmailStatus =
            'from to subject body createdAt template status content error deleted deletedAt deletedById replyTo smtpServer';

        const [searchedEmailLogs, totalSearchCount] = await Promise.all([
            _this.findBy({ query, skip, limit, select: selectEmailStatus }),
            _this.countBy({ query }),
        ]);

        return { searchedEmailLogs, totalSearchCount };
    },
};

const EmailStatusModel = require('../models/emailStatus');
const ErrorService = require('./errorService');
const GlobalConfigService = require('./globalConfigService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

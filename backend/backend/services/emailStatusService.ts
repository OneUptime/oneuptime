export default {
    findBy: async function({
        query,
        limit,
        skip,
        sort,
        populate,
        select
    }: $TSFixMe) {
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
        smtpServer
    }: $TSFixMe) {
        const globalConfig = await GlobalConfigService.findOneBy({
            query: { name: 'emailLogMonitoringStatus' },
            select: 'value',
        });
        if (globalConfig && globalConfig.value) {
            let item = new EmailStatusModel();

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
            item.status = status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'from' does not exist on type 'Document<a... Remove this comment to see the full error message
            item.from = from;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'to' does not exist on type 'Document<any... Remove this comment to see the full error message
            item.to = to;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'subject' does not exist on type 'Documen... Remove this comment to see the full error message
            item.subject = subject;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'body' does not exist on type 'Document<a... Remove this comment to see the full error message
            item.body = body;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'template' does not exist on type 'Docume... Remove this comment to see the full error message
            item.template = template;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'content' does not exist on type 'Documen... Remove this comment to see the full error message
            item.content = content;
            // @ts-expect-error ts-migrate(2551) FIXME: Property 'error' does not exist on type 'Document<... Remove this comment to see the full error message
            item.error = error;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'smtpServer' does not exist on type 'Docu... Remove this comment to see the full error message
            item.smtpServer = smtpServer;
            item = await item.save();

            return item;
        }
        return;
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await EmailStatusModel.countDocuments(query);
        return count;
    },

    deleteBy: async function(query: $TSFixMe, userId: $TSFixMe) {
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
    },

    hardDeleteBy: async function({
        query
    }: $TSFixMe) {
        await EmailStatusModel.deleteMany(query);
    },

    // Description: Get EmailStatus by item Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with item or error.
    findOneBy: async function({
        query,
        populate,
        select
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        let itemQuery = EmailStatusModel.findOne(query).lean();

        itemQuery = handleSelect(select, itemQuery);
        itemQuery = handlePopulate(populate, itemQuery);

        const item = await itemQuery;
        return item;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
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
    },

    updateBy: async function(query: $TSFixMe, data: $TSFixMe) {
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
    },

    search: async function({
        filter,
        skip,
        limit
    }: $TSFixMe) {
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

import EmailStatusModel from '../models/emailStatus'
import GlobalConfigService from './globalConfigService'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

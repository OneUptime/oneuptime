module.exports = {
    create: async function(data) {
        try {
            const _this = this;

            // prepare  log model
            let log = new LogModel();
            let content;

            try {
                content = JSON.parse(data.content);
            } catch (error) {
                content = data.content;
            }

            let stringifiedTags = '';
            if (data.tags) {
                typeof data.tags === 'string'
                    ? (stringifiedTags = data.tags)
                    : (stringifiedTags = data.tags.join());
            }

            log.content = content;
            log.stringifiedContent = JSON.stringify(content) + stringifiedTags;
            log.applicationLogId = data.applicationLogId;
            log.type = data.type;
            log.tags = data.tags;
            log.createdById = data.createdById;
            const savedlog = await log.save();

            const selectLog =
                'applicationLogId content stringifiedContent type tags createdById createdAt';

            const populateLog = [{ path: 'applicationLogId', select: 'name' }];
            log = await _this.findOneBy({
                query: { _id: savedlog._id },
                select: selectLog,
                populate: populateLog,
            });
            return log;
        } catch (error) {
            ErrorService.log('logService.create', error);
            throw error;
        }
    },
    async findOneBy({ query, select, populate }) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let logQuery = LogModel.findOne(query).lean();

            logQuery = handleSelect(select, logQuery);
            logQuery = handlePopulate(populate, logQuery);

            const log = await logQuery;

            return log;
        } catch (error) {
            ErrorService.log('logService.findOneBy', error);
            throw error;
        }
    },
    async findBy({ query, limit, skip, populate, select }) {
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

            if (!query.deleted) query.deleted = false;
            let logsQuery = LogModel.find(query)
                .lean()
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            logsQuery = handlePopulate(select, logsQuery);
            logsQuery = handlePopulate(populate, logsQuery);

            const logs = await logsQuery;

            return logs;
        } catch (error) {
            ErrorService.log('logService.findBy', error);
            throw error;
        }
    },
    async getLogsByApplicationLogId(applicationLogId, limit, skip) {
        // try to get the application log by the ID

        const applicationLogCount = await ApplicationLogService.countBy({
            _id: applicationLogId,
        });
        // send an error if the component doesnt exist
        if (applicationLogCount === 0) {
            const error = new Error('Application Log does not exist.');
            error.code = 400;
            ErrorService.log('logService.getLogsByApplicationLogId', error);
            throw error;
        }

        try {
            if (typeof limit === 'string') limit = parseInt(limit);
            if (typeof skip === 'string') skip = parseInt(skip);
            const _this = this;

            const selectLog =
                'applicationLogId content stringifiedContent type tags createdById createdAt';

            const populateLog = [{ path: 'applicationLogId', select: 'name' }];

            const logs = await _this.findBy({
                query: { applicationLogId: applicationLogId },
                limit,
                skip,
                select: selectLog,
                populate: populateLog,
            });
            return logs;
        } catch (error) {
            ErrorService.log('logService.getLogsByApplicationLogId', error);
            throw error;
        }
    },
    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            const count = await LogModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('logService.countBy', error);
            throw error;
        }
    },
    search: async function(query, filter, skip, limit) {
        const _this = this;
        query.stringifiedContent = {
            $regex: new RegExp(filter),
            $options: 'i',
        };
        const selectLog =
            'applicationLogId content stringifiedContent type tags createdById createdAt';

        const populateLog = [{ path: 'applicationLogId', select: 'name' }];
        const [searchedLogs, totalSearchCount] = await Promise.all([
            _this.findBy({
                query,
                skip,
                limit,
                select: selectLog,
                populate: populateLog,
            }),
            _this.countBy(query),
        ]);

        return { searchedLogs, totalSearchCount };
    },
    // Introduce this to know the current date range of the query incase it wasnt given by the user
    async getDateRange(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let dateRange = { startDate: '', endDate: '' };
            // if date range is given, it returns it
            if (query.createdAt)
                dateRange = {
                    startDate: query.createdAt.$gte,
                    endDate: query.createdAt.$lte,
                };
            else {
                // first and last log based on the query is fetched
                const [start_date, end_date] = await Promise.all([
                    LogModel.find(query).limit(1),
                    LogModel.find(query)
                        .sort([['createdAt', -1]])
                        .limit(1),
                ]);
                // if query returns anything, extrate date from both.
                start_date[0] && end_date[0]
                    ? (dateRange = {
                          startDate: start_date[0]['createdAt'],
                          endDate: end_date[0]['createdAt'],
                      })
                    : null;
            }

            return dateRange;
        } catch (error) {
            ErrorService.log('logService.getDateRange', error);
            throw error;
        }
    },
};

const LogModel = require('../models/log');
const ErrorService = require('./errorService');
const ApplicationLogService = require('./applicationLogService');
const handleSelect = require('../utils/select');
const handlePopulate = require('../utils/populate');

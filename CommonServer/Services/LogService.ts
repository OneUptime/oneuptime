import LogModel from '../Models/log';
import ApplicationLogService from './ApplicationLogService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
import PositiveNumber from 'Common/Types/PositiveNumber';

export default class Service {
    async create(data: $TSFixMe): void {
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
        log = await this.findOneBy({
            query: { _id: savedlog._id },
            select: selectLog,
            populate: populateLog,
        });
        return log;
    }
    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const logQuery = LogModel.findOne(query).sort(sort).lean();

        logQuery.select(select);
        logQuery.populate(populate);

        const log = await logQuery;

        return log;
    }
    async findBy({ query, limit, skip, populate, select, sort }: FindBy): void {
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

        if (!query['deleted']) query['deleted'] = false;
        const logsQuery = LogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        logsQuery.select(select);
        logsQuery.populate(populate);

        const logs = await logsQuery;

        return logs.reverse();
    }
    async getLogsByApplicationLogId(
        applicationLogId: $TSFixMe,
        limit: PositiveNumber,
        skip: PositiveNumber
    ): void {
        // try to get the application log by the ID

        const applicationLogCount = await ApplicationLogService.countBy({
            _id: applicationLogId,
        });
        // send an error if the component doesnt exist
        if (applicationLogCount === 0) {
            throw new BadDataException('Application Log does not exist.');
        }

        if (typeof limit === 'string') limit = parseInt(limit);
        if (typeof skip === 'string') skip = parseInt(skip);

        const selectLog =
            'applicationLogId content stringifiedContent type tags createdById createdAt';

        const populateLog = [{ path: 'applicationLogId', select: 'name' }];

        const logs = await this.findBy({
            query: { applicationLogId: applicationLogId },
            limit,
            skip,
            select: selectLog,
            populate: populateLog,
        });
        return logs;
    }
    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        const count = await LogModel.countDocuments(query);

        return count;
    }

    async search(
        query: Query,
        filter: $TSFixMe,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        query.stringifiedContent = {
            $regex: new RegExp(filter),
            $options: 'i',
        };
        const selectLog =
            'applicationLogId content stringifiedContent type tags createdById createdAt';

        const populateLog = [{ path: 'applicationLogId', select: 'name' }];
        const [searchedLogs, totalSearchCount] = await Promise.all([
            this.findBy({
                query,
                skip,
                limit,
                select: selectLog,
                populate: populateLog,
            }),
            this.countBy(query),
        ]);

        return { searchedLogs, totalSearchCount };
    }

    async searchByDuration(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const { startTime, endTime } = query;
        query = {
            ...query,
            createdAt: {
                $gte: endTime,
                $lte: startTime,
            },
        };
        delete query.startTime;
        delete query.endTime;
        const selectLog =
            'applicationLogId content stringifiedContent type tags createdById createdAt';
        const populateLog = [{ path: 'applicationLogId', select: 'name' }];

        const [searchedLogs, totalSearchCount] = await Promise.all([
            this.findBy({
                query,
                select: selectLog,
                populate: populateLog,
            }),
            this.countBy(query),
        ]);

        return { searchedLogs, totalSearchCount };
    }
    // Introduce this to know the current date range of the query incase it wasnt given by the user
    async getDateRange(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
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
                LogModel.find(query).limit(1),
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
    }
}

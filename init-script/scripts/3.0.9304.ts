// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'upda... Remove this comment to see the full error message
import { updateMany } from '../util/db';

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { incidentHistoryDays: { $exists: false } },
        { incidentHistoryDays: 14 }
    );

    await updateMany(
        statusPageCollection,
        { scheduleHistoryDays: { $exists: false } },
        { scheduleHistoryDays: 14 }
    );

    await updateMany(
        statusPageCollection,
        { announcementLogsHistory: { $exists: false } },
        { announcementLogsHistory: 14 }
    );

    return `Script completed`;
}

export default run;

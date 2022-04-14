import { updateMany } from '../util/db';

const  statusPageCollection: string = 'statuspages';

async function run(): void {
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

const { updateMany, removeFieldsFromMany } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { cleanThemeLayout: { $exists: false } },
        {
            cleanThemeLayout: {
                visible: [
                    { name: 'Announcement', id: 11, key: 'anouncement' },
                    { name: 'Resources Status', id: 12, key: 'resources' },
                    { name: 'Services Status', id: 13, key: 'services' },
                    { name: 'Past Incidents', id: 14, key: 'pastIncidents' },
                    {
                        name: 'Scheduled Maintenance',
                        id: 15,
                        key: 'maintenance',
                    },
                ],
                invisible: [],
            },
        }
    );

    await updateMany(
        statusPageCollection,
        { classicThemeLayout: { $exists: false } },
        {
            classicThemeLayout: {
                visible: [
                    { name: 'Announcement', id: 11, key: 'anouncement' },
                    {
                        name: 'Ongoing Schedule Events',
                        id: 12,
                        key: 'ongoingSchedule',
                    },
                    { name: 'Services Status', id: 13, key: 'services' },
                    {
                        name: 'Incidents',
                        id: 14,
                        key: 'incidents',
                    },
                    {
                        name: 'Future Schedule Events',
                        id: 15,
                        key: 'futureSchedule',
                    },
                ],
                invisible: [],
            },
        }
    );

    await removeFieldsFromMany(
        statusPageCollection,
        { moveIncidentToTheTop: { $exists: true } },
        { moveIncidentToTheTop: '' }
    );

    return `Script completed`;
}

module.exports = run;

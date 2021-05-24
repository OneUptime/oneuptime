const { updateMany, removeFieldsFromMany } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { moveIncidentToTheTop: true },
        {
            layout: {
                visible: [
                    { name: 'Header', key: 'header' },
                    {
                        name: 'Active Announcement',
                        key: 'anouncement',
                    },
                    {
                        name: 'Ongoing Schedule Events',
                        key: 'ongoingSchedule',
                    },
                    { name: 'Incidents', key: 'incidents' },
                    { name: 'Overall Status', key: 'resources' },
                    { name: 'Resource List', key: 'services' },
                    { name: 'Announcement Logs', key: 'AnnouncementLogs' },
                    {
                        name: 'Future Scheduled Events',
                        key: 'maintenance',
                    },
                    { name: 'Footer', key: 'footer' },
                ],
                invisible: [{ name: 'Past Scheduled Events', key: 'pastEvents' }],
            },
        }
    );

    await removeFieldsFromMany(
        statusPageCollection,
        { moveIncidentToTheTop: { $exists: true } },
        moveIncidentToTheTop
    );

    return `Script completed`;
}

module.exports = run;

const { updateMany } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { layout: { $exists: false } },
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
                    { name: 'Overall Status', key: 'resources' },
                    { name: 'Resource List', key: 'services' },
                    { name: 'Incidents', key: 'incidents' },
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
    return `Script completed`;
}

module.exports = run;

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
                    {
                        name: 'Scheduled Maintenance Events',
                        key: 'maintenance',
                    },
                    { name: 'Footer', key: 'footer' },
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

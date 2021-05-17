const { updateMany, removeFieldsFromMany } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    await updateMany(
        statusPageCollection,
        { layout: { $exists: false } },
        {
            layout: {
                visible: [
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
                    {
                        name: 'Scheduled Maintenance Events',
                        key: 'maintenance',
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

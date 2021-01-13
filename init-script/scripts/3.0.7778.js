const { find, update } = require('../util/db');

const MONITOR_COLLECTION = 'monitors';

async function run() {
    const monitorsWithOldCriteria = await find(MONITOR_COLLECTION, {
        $or: [
            { 'criteria.up': { $not: { $type: 'array' } } },
            { 'criteria.degraded': { $not: { $type: 'array' } } },
            { 'criteria.down': { $not: { $type: 'array' } } },
        ],
    });

    monitorsWithOldCriteria.forEach(monitor => {
        const newUpCriteria = [];
        const newDegradedCriteria = [];
        const newDownCriteria = [];

        const newFields = {
            scheduleIds: [],
            title: '',
            description: '',
            default: false,
        };

        // add default criterion
        newDownCriteria.push({
            createAlert:
                monitor.criteria && monitor.criteria.down
                    ? monitor.criteria.down.createAlert
                    : true,
            autoAcknowledge:
                monitor.criteria && monitor.criteria.down
                    ? monitor.criteria.down.autoAcknowledge
                    : false,
            autoResolve:
                monitor.criteria && monitor.criteria.down
                    ? monitor.criteria.down.autoResolve
                    : false,
            ...newFields,
            default: true,
        });

        if (monitor.criteria) {
            if (monitor.criteria.up) {
                newUpCriteria.push({
                    ...monitor.criteria.up,
                    ...newFields,
                    name: 'Online',
                });
            }
            if (monitor.criteria.degraded) {
                newDegradedCriteria.push({
                    ...monitor.criteria.degraded,
                    ...newFields,
                    name: 'Degraded',
                });
            }
            if (monitor.criteria.down) {
                newDownCriteria.push({
                    ...monitor.criteria.down,
                    ...newFields,
                    name: 'Offline',
                });
            }
        }
        update(
            MONITOR_COLLECTION,
            { _id: monitor._id },
            {
                criteria: {
                    up: newUpCriteria,
                    degraded: newDegradedCriteria,
                    down: newDownCriteria,
                },
                lastMatchedCriterion: {},
            }
        );
    });
}

module.exports = run;

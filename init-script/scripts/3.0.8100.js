const { find, update } = require('../util/db');

const monitorCollection = 'monitors';

async function run() {
    const monitorsWithOldCriteria = await find(monitorCollection, {
        deleted: false,
        $or: [
            {
                'criteria.up': {
                    $elemMatch: {
                        $or: [
                            { and: { $type: 'array' } },
                            { or: { $type: 'array' } },
                        ],
                    },
                },
            },
            {
                'criteria.degraded': {
                    $elemMatch: {
                        $or: [
                            { and: { $type: 'array' } },
                            { or: { $type: 'array' } },
                        ],
                    },
                },
            },
            {
                'criteria.down': {
                    $elemMatch: {
                        $or: [
                            { and: { $type: 'array' } },
                            { or: { $type: 'array' } },
                        ],
                    },
                },
            },
        ],
    });

    for (const monitor of monitorsWithOldCriteria) {
        if (
            monitor.criteria &&
            monitor.criteria.up &&
            monitor.criteria.up.length > 0
        ) {
            for (const up of monitor.criteria.up) {
                const and = [...up.and],
                    or = [...up.or];
                const cr = { and: [], or: [] };
                if (and && and.length > 0) {
                    and[0].match = 'all';
                } else if (or && or.length > 0) {
                    or[0].match = 'any';
                }

                if (and && and.length > 0) {
                    cr.and.push(and);
                    up.and = cr;
                }
                if (and && and.length === 0) {
                    up.and = { and: [], or: [] };
                }
                if (or && or.length > 0) {
                    cr.and.push(or);
                    up.or = cr;
                }
                if (or && or.length === 0) {
                    up.or = { and: [], or: [] };
                }
            }
        }
        if (
            monitor.criteria &&
            monitor.criteria.down &&
            monitor.criteria.down.length > 0
        ) {
            for (const down of monitor.criteria.down) {
                const and = [...down.and],
                    or = [...down.or];
                const cr = { and: [], or: [] };
                if (and && and.length > 0) {
                    and[0].match = 'all';
                } else if (or && or.length > 0) {
                    or[0].match = 'any';
                }

                if (and && and.length > 0) {
                    cr.and.push(and);
                    down.and = cr;
                }
                if (and && and.length === 0) {
                    down.and = { and: [], or: [] };
                }
                if (or && or.length > 0) {
                    cr.and.push(or);
                    down.or = cr;
                }
                if (or && or.length === 0) {
                    down.or = { and: [], or: [] };
                }
            }
        }
        if (
            monitor.criteria &&
            monitor.criteria.degraded &&
            monitor.criteria.degraded.length > 0
        ) {
            for (const degraded of monitor.criteria.degraded) {
                const and = [...degraded.and],
                    or = [...degraded.or];
                const cr = { and: [], or: [] };
                if (and && and.length > 0) {
                    and[0].match = 'all';
                } else if (or && or.length > 0) {
                    or[0].match = 'any';
                }

                if (and && and.length > 0) {
                    cr.and.push(and);
                    degraded.and = cr;
                }
                if (and && and.length === 0) {
                    degraded.and = { and: [], or: [] };
                }
                if (or && or.length > 0) {
                    cr.and.push(or);
                    degraded.or = cr;
                }
                if (or && or.length === 0) {
                    degraded.or = { and: [], or: [] };
                }
            }
        }

        update(
            monitorCollection,
            { _id: monitor._id },
            {
                ...monitor,
            }
        );
    }
}

module.exports = run;

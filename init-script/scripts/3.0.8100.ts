// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const monitorCollection = 'monitors';

async function run() {
    const monitorsWithOldCriteria = await find(monitorCollection, {
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
                let and: $TSFixMe = [],
                    or: $TSFixMe = [];
                if (up.and && up.and.length > 0) {
                    and = [...up.and];
                }
                if (up.or && up.or.length > 0) {
                    or = [...up.or];
                }
                const cr = { and: [], or: [] };
                if (and && and.length > 0) {
                    and[0].match = 'all';
                } else if (or && or.length > 0) {
                    or[0].match = 'any';
                }

                if (and && and.length > 0) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
                    cr.and.push(and);
                    up.and = cr;
                }
                if (and && and.length === 0) {
                    up.and = { and: [], or: [] };
                }
                if (or && or.length > 0) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
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
                let and: $TSFixMe = [],
                    or: $TSFixMe = [];
                if (down.and && down.and.length > 0) {
                    and = [...down.and];
                }
                if (down.or && down.or.length > 0) {
                    or = [...down.or];
                }
                const cr = { and: [], or: [] };
                if (and && and.length > 0) {
                    and[0].match = 'all';
                } else if (or && or.length > 0) {
                    or[0].match = 'any';
                }

                if (and && and.length > 0) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
                    cr.and.push(and);
                    down.and = cr;
                }
                if (and && and.length === 0) {
                    down.and = { and: [], or: [] };
                }
                if (or && or.length > 0) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
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
                let and: $TSFixMe = [],
                    or: $TSFixMe = [];
                if (degraded.and && degraded.and.length > 0) {
                    and = [...degraded.and];
                }
                if (degraded.or && degraded.or.length > 0) {
                    or = [...degraded.or];
                }
                const cr = { and: [], or: [] };
                if (and && and.length > 0) {
                    and[0].match = 'all';
                } else if (or && or.length > 0) {
                    or[0].match = 'any';
                }

                if (and && and.length > 0) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
                    cr.and.push(and);
                    degraded.and = cr;
                }
                if (and && and.length === 0) {
                    degraded.and = { and: [], or: [] };
                }
                if (or && or.length > 0) {
                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
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

export default run;

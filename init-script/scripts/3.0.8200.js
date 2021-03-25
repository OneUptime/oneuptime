const { find, update } = require('../util/db');

const monitorCollection = 'monitors';

async function run() {
    const monitors = await find(monitorCollection, {
        $or: [
            {
                'criteria.up': {
                    $elemMatch: {
                        $or: [
                            { and: { $type: 'object' } },
                            { or: { $type: 'object' } },
                        ],
                    },
                },
            },
            {
                'criteria.degraded': {
                    $elemMatch: {
                        $or: [
                            { and: { $type: 'object' } },
                            { or: { $type: 'object' } },
                        ],
                    },
                },
            },
            {
                'criteria.down': {
                    $elemMatch: {
                        $or: [
                            { and: { $type: 'object' } },
                            { or: { $type: 'object' } },
                        ],
                    },
                },
            },
        ],
    });

    for (const monitor of monitors) {
        if (
            monitor.criteria &&
            monitor.criteria.up &&
            monitor.criteria.up.length > 0
        ) {
            for (const up of monitor.criteria.up) {
                if (
                    up.and &&
                    ((up.and.and && up.and.and.length > 0) ||
                        (up.and.or && up.and.or.length > 0))
                ) {
                    up.criteria = {};
                    up.criteria.criteria = [];
                    if (up.and.and && up.and.and.length > 0) {
                        if (!up.criteria.condition) {
                            up.criteria.condition = 'and';
                        }
                        up.and.and.forEach(and => {
                            and.forEach(obj => {
                                if (obj.collection) {
                                    if (
                                        obj.collection.and &&
                                        obj.collection.and.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'and';
                                        nestVal.criteria.push(
                                            ...obj.collection.and
                                        );
                                        up.criteria.criteria.push(nestVal);
                                    }
                                    if (
                                        obj.collection.or &&
                                        obj.collection.or.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'or';
                                        nestVal.criteria.push(
                                            ...obj.collection.or
                                        );
                                        up.criteria.criteria.push(nestVal);
                                    }
                                } else {
                                    up.criteria.criteria.push(obj);
                                }
                            });
                        });
                    }
                    if (up.and.or && up.and.or.length > 0) {
                        if (up.criteria.condition) {
                            up.and.or.forEach(or => {
                                const nested = {
                                    condition: 'or',
                                    criteria: [],
                                };
                                nested.condition =
                                    or[0].match && or[0].match === 'any'
                                        ? 'or'
                                        : 'and';
                                nested.criteria.push(...or);
                                up.criteria.criteria.push(nested);
                            });
                        } else {
                            up.criteria.condition = 'or';

                            up.and.or.forEach(or => {
                                or.forEach(obj => {
                                    if (obj.collection) {
                                        if (
                                            obj.collection.and &&
                                            obj.collection.and.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'and';
                                            nestVal.criteria.push(
                                                ...obj.collection.and
                                            );
                                            up.criteria.criteria.push(nestVal);
                                        }
                                        if (
                                            obj.collection.or &&
                                            obj.collection.or.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'or';
                                            nestVal.criteria.push(
                                                ...obj.collection.or
                                            );
                                            up.criteria.criteria.push(nestVal);
                                        }
                                    } else {
                                        up.criteria.criteria.push(obj);
                                    }
                                });
                            });
                        }
                    }
                } else if (
                    up.or &&
                    ((up.or.or && up.or.or.length > 0) ||
                        (up.or.and && up.or.and.length > 0))
                ) {
                    up.criteria = {};
                    up.criteria.criteria = [];
                    if (up.or.or && up.or.or.length > 0) {
                        if (!up.criteria.condition) {
                            up.criteria.condition = 'or';
                        }
                        up.or.or.forEach(or => {
                            or.forEach(obj => {
                                if (obj.collection) {
                                    if (
                                        obj.collection.or &&
                                        obj.collection.or.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'or';
                                        nestVal.criteria.push(
                                            ...obj.collection.or
                                        );
                                        up.criteria.criteria.push(nestVal);
                                    }
                                    if (
                                        obj.collection.and &&
                                        obj.collection.and.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'and';
                                        nestVal.criteria.push(
                                            ...obj.collection.and
                                        );
                                        up.criteria.criteria.push(nestVal);
                                    }
                                } else {
                                    up.criteria.criteria.push(obj);
                                }
                            });
                        });
                    }
                    if (up.or.and && up.or.and.length > 0) {
                        if (up.criteria.condition) {
                            up.or.and.forEach(and => {
                                const nested = {
                                    condition: 'and',
                                    criteria: [],
                                };
                                nested.condition =
                                    and[0].match && and[0].match === 'any'
                                        ? 'or'
                                        : 'and';
                                nested.criteria.push(...and);
                                up.criteria.criteria.push(nested);
                            });
                        } else {
                            up.criteria.condition = 'and';

                            up.or.and.forEach(and => {
                                and.forEach(obj => {
                                    if (obj.collection) {
                                        if (
                                            obj.collection.and &&
                                            obj.collection.and.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'and';
                                            nestVal.criteria.push(
                                                ...obj.collection.and
                                            );
                                            up.criteria.criteria.push(nestVal);
                                        }
                                        if (
                                            obj.collection.or &&
                                            obj.collection.or.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'or';
                                            nestVal.criteria.push(
                                                ...obj.collection.or
                                            );
                                            up.criteria.criteria.push(nestVal);
                                        }
                                    } else {
                                        up.criteria.criteria.push(obj);
                                    }
                                });
                            });
                        }
                    }
                }

                up.and = null;
                up.or = null;
            }
        }

        if (
            monitor.criteria &&
            monitor.criteria.down &&
            monitor.criteria.down.length > 0
        ) {
            for (const down of monitor.criteria.down) {
                if (
                    down.and &&
                    ((down.and.and && down.and.and.length > 0) ||
                        (down.and.or && down.and.or.length > 0))
                ) {
                    down.criteria = {};
                    down.criteria.criteria = [];
                    if (down.and.and && down.and.and.length > 0) {
                        if (!down.criteria.condition) {
                            down.criteria.condition = 'and';
                        }
                        down.and.and.forEach(and => {
                            and.forEach(obj => {
                                if (obj.collection) {
                                    if (
                                        obj.collection.and &&
                                        obj.collection.and.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'and';
                                        nestVal.criteria.push(
                                            ...obj.collection.and
                                        );
                                        down.criteria.criteria.push(nestVal);
                                    }
                                    if (
                                        obj.collection.or &&
                                        obj.collection.or.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'or';
                                        nestVal.criteria.push(
                                            ...obj.collection.or
                                        );
                                        down.criteria.criteria.push(nestVal);
                                    }
                                } else {
                                    down.criteria.criteria.push(obj);
                                }
                            });
                        });
                    }
                    if (down.and.or && down.and.or.length > 0) {
                        if (down.criteria.condition) {
                            down.and.or.forEach(or => {
                                const nested = {
                                    condition: 'or',
                                    criteria: [],
                                };
                                nested.condition =
                                    or[0].match && or[0].match === 'any'
                                        ? 'or'
                                        : 'and';
                                nested.criteria.push(...or);
                                down.criteria.criteria.push(nested);
                            });
                        } else {
                            down.criteria.condition = 'or';

                            down.and.or.forEach(or => {
                                or.forEach(obj => {
                                    if (obj.collection) {
                                        if (
                                            obj.collection.and &&
                                            obj.collection.and.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'and';
                                            nestVal.criteria.push(
                                                ...obj.collection.and
                                            );
                                            down.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                        if (
                                            obj.collection.or &&
                                            obj.collection.or.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'or';
                                            nestVal.criteria.push(
                                                ...obj.collection.or
                                            );
                                            down.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                    } else {
                                        down.criteria.criteria.push(obj);
                                    }
                                });
                            });
                        }
                    }
                } else if (
                    down.or &&
                    ((down.or.or && down.or.or.length > 0) ||
                        (down.or.and && down.or.and.length > 0))
                ) {
                    down.criteria = {};
                    down.criteria.criteria = [];
                    if (down.or.or && down.or.or.length > 0) {
                        if (!down.criteria.condition) {
                            down.criteria.condition = 'or';
                        }
                        down.or.or.forEach(or => {
                            or.forEach(obj => {
                                if (obj.collection) {
                                    if (
                                        obj.collection.or &&
                                        obj.collection.or.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'or';
                                        nestVal.criteria.push(
                                            ...obj.collection.or
                                        );
                                        down.criteria.criteria.push(nestVal);
                                    }
                                    if (
                                        obj.collection.and &&
                                        obj.collection.and.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'and';
                                        nestVal.criteria.push(
                                            ...obj.collection.and
                                        );
                                        down.criteria.criteria.push(nestVal);
                                    }
                                } else {
                                    down.criteria.criteria.push(obj);
                                }
                            });
                        });
                    }
                    if (down.or.and && down.or.and.length > 0) {
                        if (down.criteria.condition) {
                            down.or.and.forEach(and => {
                                const nested = {
                                    condition: 'and',
                                    criteria: [],
                                };
                                nested.condition =
                                    and[0].match && and[0].match === 'any'
                                        ? 'or'
                                        : 'and';
                                nested.criteria.push(...and);
                                down.criteria.criteria.push(nested);
                            });
                        } else {
                            down.criteria.condition = 'and';

                            down.or.and.forEach(and => {
                                and.forEach(obj => {
                                    if (obj.collection) {
                                        if (
                                            obj.collection.and &&
                                            obj.collection.and.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'and';
                                            nestVal.criteria.push(
                                                ...obj.collection.and
                                            );
                                            down.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                        if (
                                            obj.collection.or &&
                                            obj.collection.or.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'or';
                                            nestVal.criteria.push(
                                                ...obj.collection.or
                                            );
                                            down.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                    } else {
                                        down.criteria.criteria.push(obj);
                                    }
                                });
                            });
                        }
                    }
                }

                down.and = null;
                down.or = null;
            }
        }

        if (
            monitor.criteria &&
            monitor.criteria.degraded &&
            monitor.criteria.degraded.length > 0
        ) {
            for (const degraded of monitor.criteria.degraded) {
                if (
                    degraded.and &&
                    ((degraded.and.and && degraded.and.and.length > 0) ||
                        (degraded.and.or && degraded.and.or.length > 0))
                ) {
                    degraded.criteria = {};
                    degraded.criteria.criteria = [];
                    if (degraded.and.and && degraded.and.and.length > 0) {
                        if (!degraded.criteria.condition) {
                            degraded.criteria.condition = 'and';
                        }
                        degraded.and.and.forEach(and => {
                            and.forEach(obj => {
                                if (obj.collection) {
                                    if (
                                        obj.collection.and &&
                                        obj.collection.and.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'and';
                                        nestVal.criteria.push(
                                            ...obj.collection.and
                                        );
                                        degraded.criteria.criteria.push(
                                            nestVal
                                        );
                                    }
                                    if (
                                        obj.collection.or &&
                                        obj.collection.or.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'or';
                                        nestVal.criteria.push(
                                            ...obj.collection.or
                                        );
                                        degraded.criteria.criteria.push(
                                            nestVal
                                        );
                                    }
                                } else {
                                    degraded.criteria.criteria.push(obj);
                                }
                            });
                        });
                    }
                    if (degraded.and.or && degraded.and.or.length > 0) {
                        if (degraded.criteria.condition) {
                            degraded.and.or.forEach(or => {
                                const nested = {
                                    condition: 'or',
                                    criteria: [],
                                };
                                nested.condition =
                                    or[0].match && or[0].match === 'any'
                                        ? 'or'
                                        : 'and';
                                nested.criteria.push(...or);
                                degraded.criteria.criteria.push(nested);
                            });
                        } else {
                            degraded.criteria.condition = 'or';

                            degraded.and.or.forEach(or => {
                                or.forEach(obj => {
                                    if (obj.collection) {
                                        if (
                                            obj.collection.and &&
                                            obj.collection.and.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'and';
                                            nestVal.criteria.push(
                                                ...obj.collection.and
                                            );
                                            degraded.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                        if (
                                            obj.collection.or &&
                                            obj.collection.or.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'or';
                                            nestVal.criteria.push(
                                                ...obj.collection.or
                                            );
                                            degraded.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                    } else {
                                        degraded.criteria.criteria.push(obj);
                                    }
                                });
                            });
                        }
                    }
                } else if (
                    degraded.or &&
                    ((degraded.or.or && degraded.or.or.length > 0) ||
                        (degraded.or.and && degraded.or.and.length > 0))
                ) {
                    degraded.criteria = {};
                    degraded.criteria.criteria = [];
                    if (degraded.or.or && degraded.or.or.length > 0) {
                        if (!degraded.criteria.condition) {
                            degraded.criteria.condition = 'or';
                        }
                        degraded.or.or.forEach(or => {
                            or.forEach(obj => {
                                if (obj.collection) {
                                    if (
                                        obj.collection.or &&
                                        obj.collection.or.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'or';
                                        nestVal.criteria.push(
                                            ...obj.collection.or
                                        );
                                        degraded.criteria.criteria.push(
                                            nestVal
                                        );
                                    }
                                    if (
                                        obj.collection.and &&
                                        obj.collection.and.length > 0
                                    ) {
                                        const nestVal = { criteria: [] };
                                        nestVal.condition = 'and';
                                        nestVal.criteria.push(
                                            ...obj.collection.and
                                        );
                                        degraded.criteria.criteria.push(
                                            nestVal
                                        );
                                    }
                                } else {
                                    degraded.criteria.criteria.push(obj);
                                }
                            });
                        });
                    }
                    if (degraded.or.and && degraded.or.and.length > 0) {
                        if (degraded.criteria.condition) {
                            degraded.or.and.forEach(and => {
                                const nested = {
                                    condition: 'and',
                                    criteria: [],
                                };
                                nested.condition =
                                    and[0].match && and[0].match === 'any'
                                        ? 'or'
                                        : 'and';
                                nested.criteria.push(...and);
                                degraded.criteria.criteria.push(nested);
                            });
                        } else {
                            degraded.criteria.condition = 'and';

                            degraded.or.and.forEach(and => {
                                and.forEach(obj => {
                                    if (obj.collection) {
                                        if (
                                            obj.collection.and &&
                                            obj.collection.and.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'and';
                                            nestVal.criteria.push(
                                                ...obj.collection.and
                                            );
                                            degraded.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                        if (
                                            obj.collection.or &&
                                            obj.collection.or.length > 0
                                        ) {
                                            const nestVal = { criteria: [] };
                                            nestVal.condition = 'or';
                                            nestVal.criteria.push(
                                                ...obj.collection.or
                                            );
                                            degraded.criteria.criteria.push(
                                                nestVal
                                            );
                                        }
                                    } else {
                                        degraded.criteria.criteria.push(obj);
                                    }
                                });
                            });
                        }
                    }
                }

                degraded.and = null;
                degraded.or = null;
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

import ApiService from '../utils/apiService';

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
export default {
    run: async ({ monitor }: $TSFixMe) => {
        if (monitor && monitor.type) {
            if (monitor.data.link && monitor.criteria) {
                const up = monitor.criteria.up
                    ? await checkCondition(monitor.criteria.up)
                    : false;
                const degraded = monitor.criteria.degraded
                    ? await checkCondition(monitor.criteria.degraded)
                    : false;
                const down = monitor.criteria.down
                    ? await checkCondition(monitor.criteria.down)
                    : false;
                if (up || degraded || down) {
                    await ApiService.ping(monitor._id, {
                        monitor,
                        res: null,
                        resp: null,
                        type: monitor.type,
                        retryCount: 3,
                    });
                }
            }
        }
    },
};

const checkCondition = async (condition: $TSFixMe) => {
    let response = false;
    if (condition && condition.and && condition.and.length) {
        for (let i = 0; i < condition.and.length; i++) {
            if (
                condition.and[i] &&
                condition.and[i].responseType &&
                condition.and[i].responseType === 'incomingTime'
            ) {
                response = true;
                break;
            } else if (
                condition.and[i] &&
                condition.and[i].collection &&
                condition.and[i].collection.length
            ) {
                const tempAnd = await checkCondition(
                    condition.and[i].collection
                );
                if (tempAnd) {
                    response = true;
                }
            }
        }
    } else if (condition && condition.or && condition.or.length) {
        for (let i = 0; i < condition.or.length; i++) {
            if (
                condition.or[i] &&
                condition.or[i].responseType &&
                condition.or[i].responseType === 'incomingTime'
            ) {
                response = true;
                break;
            } else if (
                condition.or[i] &&
                condition.or[i].collection &&
                condition.or[i].collection.length
            ) {
                const tempOr = await checkCondition(condition.or[i].collection);
                if (tempOr) {
                    response = true;
                }
            }
        }
    }
    return response;
};

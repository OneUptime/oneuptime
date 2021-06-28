// initialize services authorization collection
const { find, save } = require('../util/db');

const serviceAuthorizationCollection = 'serviceauthorizations';

// add script runner service authorization
// if not found
async function run() {
    const authorization = await find(serviceAuthorizationCollection, {
        serviceName: 'script-runner',
    });

    if (!authorization?.length) {
        await save(serviceAuthorizationCollection, [
            {
                serviceName: 'script-runner',
                serviceKey: 'PvBCHkIwuU416Xyl',
            },
        ]);
    }

    return `Script completed`;
}

module.exports = run;

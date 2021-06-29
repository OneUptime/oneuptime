const { update, find, removeFieldsFromMany } = require('../util/db');

const integrationsCollection = 'integrations';

async function run() {
    const integrations = await find(integrationsCollection, {
        monitors: { $exists: false },
    });

    for (const integration of integrations) {
        const obj = {};
        const data = integration.data;
        delete data.monitorId;
        obj.data = {
            ...data,
            monitors: [{ monitorId: integration.data.monitorId }],
        };
        obj.monitors = [{ monitorId: integration.monitorId }];
        await update(integrationsCollection, { _id: integration._id }, obj);
    }

    //remove monitor id field
    await removeFieldsFromMany(
        integrationsCollection,
        { monitorId: { $exists: true } },
        'monitorId'
    );

    return `Script ran for ${integrations.length} integrations`;
}

module.exports = run;

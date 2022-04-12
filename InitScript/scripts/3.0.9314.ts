import { update, find } from '../util/db';

const integrationsCollection = 'integrations';

async function run(): void {
    const integrations = await find(integrationsCollection, {
        monitors: { $exists: false },
    });

    for (const integration of integrations) {
        const obj = {};
        const data = integration.data;
        delete data.monitorId;

        obj.data = {
            ...data,
            monitors: [{ monitorId: integration.monitorId }],
        };

        obj.monitors = [{ monitorId: String(integration.monitorId) }];
        await update(integrationsCollection, { _id: integration._id }, obj);
    }

    return `Script ran for ${integrations.length} integrations`;
}

export default run;

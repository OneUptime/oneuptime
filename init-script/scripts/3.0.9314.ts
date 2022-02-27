// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'upda... Remove this comment to see the full error message
import { update, find } from '../util/db';

const integrationsCollection = 'integrations';

async function run() {
    const integrations = await find(integrationsCollection, {
        monitors: { $exists: false },
    });

    for (const integration of integrations) {
        const obj = {};
        const data = integration.data;
        delete data.monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
        obj.data = {
            ...data,
            monitors: [{ monitorId: integration.monitorId }],
        };
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{}'.
        obj.monitors = [{ monitorId: String(integration.monitorId) }];
        await update(integrationsCollection, { _id: integration._id }, obj);
    }

    return `Script ran for ${integrations.length} integrations`;
}

export default run;

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';
import { ObjectId } from 'mongodb';

const monitorCollection = 'monitors';
const incidentCollection = 'incidents';

async function run() {
    // fetch all monitor that is not online
    const monitors = await find(monitorCollection, {
        monitorStatus: { $ne: 'online' },
        deleted: false,
    });

    for (const monitor of monitors) {
        // check if there's no unresolved incident
        const query = {
            deleted: false,
            // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
            'monitors.monitorId': { $in: [ObjectId(monitor._id)] },
        };
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
        const incidents = await global.db
            .collection(incidentCollection)
            .find(query)
            .limit(1) // should return only one item if it exist
            .sort({ createdAt: -1 })
            .toArray();

        // grab the latest incident and check if it's resolved
        const incident = incidents[0];
        if (incident && incident.resolved) {
            await update(
                monitorCollection,
                { _id: monitor._id },
                { monitorStatus: 'online' }
            );
        }

        if (!incident) {
            await update(
                monitorCollection,
                { _id: monitor._id },
                { monitorStatus: 'online' }
            );
        }
    }

    return `Script completed`;
}

export default run;

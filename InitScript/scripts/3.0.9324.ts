import { find, update } from '../util/db';
import { ObjectId } from 'mongodb';

const monitorCollection: string = 'monitors';
const incidentCollection: string = 'incidents';

async function run(): void {
    // Fetch all monitor that is not online
    const monitors: $TSFixMe = await find(monitorCollection, {
        monitorStatus: { $ne: 'online' },
        deleted: false,
    });

    for (const monitor of monitors) {
        // Check if there's no unresolved incident
        const query: $TSFixMe = {
            deleted: false,

            'monitors.monitorId': { $in: [ObjectId(monitor._id)] },
        };

        const incidents: $TSFixMe = await global.db
            .collection(incidentCollection)
            .find(query)
            .limit(1) // Should return only one item if it exist
            .toArray();

        // Grab the latest incident and check if it's resolved
        const incident: $TSFixMe = incidents[0];
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

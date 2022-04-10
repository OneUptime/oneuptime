import { find, update } from '../util/db';
import { ObjectId } from 'mongodb';

const incidentCollection = 'incidents';

async function run() {
    const incidents = await find(incidentCollection, {
        monitors: { $exists: false },
        notifications: { $exists: false },
    });

    for (const incident of incidents) {
        const data = {
            notifications: [],
        };

        if (incident.monitorId) {
            const monitors = [{ monitorId: ObjectId(incident.monitorId) }];

            data.monitors = monitors;
        }
        if (incident.notificationId) {
            const notifications = [
                { notificationId: ObjectId(incident.notificationId) },
            ];

            data.notifications = notifications;
        }

        await update(incidentCollection, { _id: incident._id }, data);
    }

    return `Script ran for ${incidents.length} incidents`;
}

export default run;

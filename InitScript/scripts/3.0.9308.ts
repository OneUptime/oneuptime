import { find, update } from '../util/db';
import { ObjectId } from 'mongodb';

const incidentCollection: string = 'incidents';

async function run(): void {
    const incidents: $TSFixMe = await find(incidentCollection, {
        monitors: { $exists: false },
        notifications: { $exists: false },
    });

    for (const incident of incidents) {
        const data: $TSFixMe = {
            notifications: [],
        };

        if (incident.monitorId) {
            const monitors: $TSFixMe = [
                { monitorId: ObjectId(incident.monitorId) },
            ];

            data.monitors = monitors;
        }
        if (incident.notificationId) {
            const notifications: $TSFixMe = [
                { notificationId: ObjectId(incident.notificationId) },
            ];

            data.notifications = notifications;
        }

        await update(incidentCollection, { _id: incident._id }, data);
    }

    return `Script ran for ${incidents.length} incidents`;
}

export default run;

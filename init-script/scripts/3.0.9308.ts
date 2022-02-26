// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'
import { ObjectId } from 'mongodb'

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
            // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
            const monitors = [{ monitorId: ObjectId(incident.monitorId) }];
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitors' does not exist on type '{ noti... Remove this comment to see the full error message
            data.monitors = monitors;
        }
        if (incident.notificationId) {
            const notifications = [
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                { notificationId: ObjectId(incident.notificationId) },
            ];
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ notificationId: any; }[]' is not assignabl... Remove this comment to see the full error message
            data.notifications = notifications;
        }

        await update(incidentCollection, { _id: incident._id }, data);
    }

    return `Script ran for ${incidents.length} incidents`;
}

export default run;

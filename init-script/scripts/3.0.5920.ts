// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db'

const projectCollection = 'projects';

async function run() {
    const projects = await find(projectCollection, {
        deleted: false,
        sendCreatedIncidentNotificationSms: { $exists: false },
        sendAcknowledgedIncidentNotificationSms: { $exists: false },
        sendResolvedIncidentNotificationSms: { $exists: false },
        sendCreatedIncidentNotificationEmail: { $exists: false },
        sendAcknowledgedIncidentNotificationEmail: { $exists: false },
        sendResolvedIncidentNotificationEmail: { $exists: false },
    });

    projects.forEach(async (project: $TSFixMe) => {
        const data = {
            sendCreatedIncidentNotificationSms: true,
            sendAcknowledgedIncidentNotificationSms: true,
            sendResolvedIncidentNotificationSms: true,
            sendCreatedIncidentNotificationEmail: true,
            sendAcknowledgedIncidentNotificationEmail: true,
            sendResolvedIncidentNotificationEmail: true,
        };

        await update(projectCollection, { _id: project._id }, data);
    });

    return `Script ran for ${projects.length} projects`;
}

export default run;

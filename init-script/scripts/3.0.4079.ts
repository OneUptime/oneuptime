// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update, removeField } from '../util/db';

const scheduledEventCollection = 'scheduledevents';

async function run() {
    const scheduledEvents = await find(scheduledEventCollection, {
        monitorId: { $type: 'string' },
    });
    scheduledEvents.forEach(async (event: $TSFixMe) => {
        const monitors = [
            {
                monitorId: event.monitorId,
            },
        ];
        await update(
            scheduledEventCollection,
            { _id: event._id },
            { monitors }
        );

        await removeField(
            scheduledEventCollection,
            { _id: event._id },
            'monitorId'
        );
    });

    return `Script ran for ${scheduledEvents.length} scheduled events`;
}

export default run;

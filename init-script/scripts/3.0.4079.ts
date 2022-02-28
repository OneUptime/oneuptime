
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

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update, findOne } from '../util/db'

const scheduledEventNoteCollection = 'scheduledeventnotes';
const scheduledEventCollection = 'scheduledevents';

// run this script once
async function run() {
    const scheduledEventNotes = await find(scheduledEventNoteCollection, {
        content: 'THIS SCHEDULED EVENT HAS BEEN CREATED',
        event_state: 'Created',
        deleted: false,
    });

    for (const note of scheduledEventNotes) {
        const scheduledEvent = await findOne(scheduledEventCollection, {
            _id: note.scheduledEventId,
        });

        if (scheduledEvent) {
            await update(
                scheduledEventNoteCollection,
                { _id: note._id },
                { content: scheduledEvent.description }
            );
        }
    }

    return `Script ran for ${scheduledEventNotes.length} scheduled event notes`;
}

export default run;

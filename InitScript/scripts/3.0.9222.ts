import { find, update, findOne } from '../util/db';

const scheduledEventNoteCollection: string = 'scheduledeventnotes';
const scheduledEventCollection: string = 'scheduledevents';

// run this script once
async function run(): void {
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

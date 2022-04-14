import { find, update, removeField } from '../util/db';

const  scheduledEventNoteCollection: string = 'scheduledeventnotes';

async function run(): void {
    const scheduledEventNotes = await find(scheduledEventNoteCollection, {
        incident_state: { $type: 'string' },
    });

    scheduledEventNotes.forEach(async (eventNote: $TSFixMe) => {
        const event_state = eventNote.incident_state;

        await update(
            scheduledEventNoteCollection,
            { _id: eventNote._id },
            { event_state }
        );

        await removeField(
            scheduledEventNoteCollection,
            { _id: eventNote._id },
            'incident_state'
        );
    });
}

export default run;

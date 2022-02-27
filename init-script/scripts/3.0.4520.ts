// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update, removeField } from '../util/db';

const scheduledEventNoteCollection = 'scheduledeventnotes';

async function run() {
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

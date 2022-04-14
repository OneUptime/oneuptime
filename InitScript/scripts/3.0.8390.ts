import { find, update } from '../util/db';

const escalationsCollection: string = 'escalations';

async function run(): void {
    const escalations: $TSFixMe = await find(escalationsCollection, {
        pushReminders: { $exists: false },
    });

    for (let i = 0; i < escalations.length; i++) {
        const escalation: $TSFixMe = escalations[i];
        await update(
            escalationsCollection,
            { _id: escalation._id },
            { pushReminders: 3, push: false }
        );
    }
}

export default run;

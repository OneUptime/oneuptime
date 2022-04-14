import { find, update } from '../util/db';

const  incomingRequestCollection: string = 'incomingrequests';

async function run(): void {
    const incomingRequests = await find(incomingRequestCollection, {
        deleted: false,
        updateIncidentNote: true,
    });

    for (const incomingRequest of incomingRequests) {
        const data = {
            // set updateInternalNote to true
            // since both internal and incident notes are the same
            updateInternalNote: true,
        };

        await update(
            incomingRequestCollection,
            { _id: incomingRequest._id },
            data
        );
    }

    return `Script ran for ${incomingRequests.length} incoming requests`;
}

export default run;

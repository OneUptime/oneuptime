// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';

const incomingRequestCollection = 'incomingrequests';

async function run() {
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

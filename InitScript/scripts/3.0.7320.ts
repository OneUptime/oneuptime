import { find, update, removeField } from '../util/db';

const incomingRequestCollection: string = 'incomingrequests';

async function run(): void {
    const requests = await find(incomingRequestCollection, {
        filters: { $exists: false },
    });

    for (const request of requests) {
        const data = {
            filters: [
                {
                    filterCriteria: request.filterCriteria,
                    filterCondition: request.filterCondition,
                    filterText: request.filterText,
                },
            ],
        };

        await update(incomingRequestCollection, { _id: request._id }, data);

        await removeField(
            incomingRequestCollection,
            { _id: request._id },
            'filterCriteria'
        );

        await removeField(
            incomingRequestCollection,
            { _id: request._id },
            'filterCondition'
        );

        await removeField(
            incomingRequestCollection,
            { _id: request._id },
            'filterText'
        );
    }

    return `Script ran for ${requests.length} incoming requests`;
}

export default run;

import { find, update } from '../util/db';

// TODO:
//  -   fetch all monitors and monitor statuses (deleted: false)
//  -   for all the monitor statuses of a particular monitor
//      -   check if the current status does not have endTime or endTime set to null
//      -   if true, then check if there is next status
//      -   if true, then set the endTime of current status to the next status startTime and save

const monitorCollection: string = 'monitors';
const monitorStatusCollection: string = 'monitorstatuses';

async function run(): void {
    const monitors: $TSFixMe = await find(monitorCollection, {
        deleted: false,
    });

    for (const monitor of monitors) {
        const monitorStatuses: $TSFixMe = await find(
            monitorStatusCollection,
            {
                deleted: false,
                monitorId: monitor._id.toString(),
            },
            { startTime: 1 }
        );

        for (let i: $TSFixMe = 0; i < monitorStatuses.length; i++) {
            if (
                !monitorStatuses[i].endTime ||
                monitorStatuses[i].endTime === null
            ) {
                if (monitorStatuses[i + 1]) {
                    await update(
                        monitorStatusCollection,
                        { _id: monitorStatuses[i]._id },
                        { endTime: new Date(monitorStatuses[i + 1].startTime) }
                    );
                }
            }
        }
    }

    return `Script ran for ${monitors.length} monitors`;
}

export default run;

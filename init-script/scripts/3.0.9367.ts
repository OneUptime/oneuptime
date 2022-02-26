// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update, findOne } from '../util/db'

const monitorCollection = 'monitors';
const componentCollection = 'components';

async function run() {
    const monitors = await find(monitorCollection, { deleted: false });

    for (const monitor of monitors) {
        const component = await findOne(componentCollection, {
            _id: monitor.componentId,
        });

        if (
            component &&
            String(monitor.projectId) !== String(component.projectId)
        ) {
            await update(
                monitorCollection,
                { _id: monitor._id },
                { projectId: component.projectId }
            );
        }
    }

    return `Script completed`;
}

export default run;

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'cust... Remove this comment to see the full error message
import { customUpdate } from '../util/db';

const statusPageCollection = 'statuspages';

async function run() {
    await customUpdate(
        statusPageCollection,
        {
            'layout.invisible.key': {
                $nin: ['externalStatusPage'],
            },
            'layout.visible.key': {
                $nin: ['externalStatusPage'],
            },
        },
        {
            $push: {
                'layout.invisible': {
                    name: 'External Status Pages',
                    key: 'externalStatusPage',
                },
            },
        }
    );
    return `Script completed`;
}

export default run;

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, update } from '../util/db';

const incidentSettingsCollection = 'incidentsettings';

// run this script once
async function run() {
    const templates = await find(incidentSettingsCollection, {
        deleted: false,
        name: { $exists: false },
    });

    for (const template of templates) {
        // default values used when templates is created automatically
        // when projects are created
        const data = {
            isDefault: true,
            name: 'Default',
        };

        await update(incidentSettingsCollection, { _id: template._id }, data);
    }

    return `Script ran for ${templates.length} templates`;
}

export default run;

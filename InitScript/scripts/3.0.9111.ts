import { find, update } from '../util/db';

const incidentSettingsCollection: string = 'incidentsettings';

// run this script once
async function run(): void {
    const templates: $TSFixMe = await find(incidentSettingsCollection, {
        deleted: false,
        name: { $exists: false },
    });

    for (const template of templates) {
        // default values used when templates is created automatically
        // when projects are created
        const data: $TSFixMe = {
            isDefault: true,
            name: 'Default',
        };

        await update(incidentSettingsCollection, { _id: template._id }, data);
    }

    return `Script ran for ${templates.length} templates`;
}

export default run;

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../util/db"' has no exported member 'find... Remove this comment to see the full error message
import { find, save, findOne } from '../util/db';
import { ObjectId } from 'mongodb';
import moment from 'moment';

const incidentSettingsCollection = 'incidentsettings';
const projectCollection = 'projects';
const incidentPriorityCollection = 'incidentpriorities';

// run this script once
async function run() {
    const projects = await find(projectCollection, {
        deleted: false,
    });

    for (const project of projects) {
        const incidentPriority = await findOne(incidentPriorityCollection, {
            projectId: project._id,
            name: 'High',
            deleted: false,
        });
        const templates = await find(incidentSettingsCollection, {
            // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
            projectId: ObjectId(project._id),
            name: { $exists: true },
            deleted: false,
        });

        if ((!templates || templates.length === 0) && incidentPriority) {
            await save(incidentSettingsCollection, [
                {
                    name: 'Default',
                    deleted: false,
                    isDefault: true,
                    title: '{{monitorName}} is {{incidentType}}.',
                    description:
                        '{{monitorName}} is {{incidentType}}. This incident is currently being investigated by our team and more information will be added soon.',
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    projectId: ObjectId(project._id),
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    incidentPriority: ObjectId(incidentPriority._id),
                    createdAt: new Date(moment().format()),
                },
            ]);
        }
    }

    return `Script ran for ${projects.length} projects`;
}

export default run;

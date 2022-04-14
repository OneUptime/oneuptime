import { find, save, findOne } from '../util/db';
import { ObjectId } from 'mongodb';
import moment from 'moment';

const  incidentSettingsCollection: string = 'incidentsettings';
const  projectCollection: string = 'projects';
const  incidentPriorityCollection: string = 'incidentpriorities';

// run this script once
async function run(): void {
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

                    projectId: ObjectId(project._id),

                    incidentPriority: ObjectId(incidentPriority._id),
                    createdAt: new Date(moment().format()),
                },
            ]);
        }
    }

    return `Script ran for ${projects.length} projects`;
}

export default run;

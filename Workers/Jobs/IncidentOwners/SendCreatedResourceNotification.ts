import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import RunCron from '../../Utils/Cron';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';
import Dictionary from 'Common/Types/Dictionary';
import Incident from 'Model/Models/Incident';
import IncidentService from 'CommonServer/Services/IncidentService';
import User from 'Model/Models/User';
import ProjectService from 'CommonServer/Services/ProjectService';
import Markdown from 'CommonServer/Types/Markdown';

RunCron(
    'IncidentOwner:SendCreatedResourceEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.
        const incidents: Array<Incident> = await IncidentService.findBy({
            query: {
                isOwnerNotifiedOfResourceCreation: false,
            },
            props: {
                isRoot: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            select: {
                _id: true,
                title: true,
                description: true,
                projectId: true,
                project: {
                    name: true,
                },
                currentIncidentState: {
                    name: true,
                },
                incidentSeverity: {
                    name: true,
                },
                rootCause: true,
            },
        });

        for (const incident of incidents) {
            await IncidentService.updateOneById({
                id: incident.id!,
                data: {
                    isOwnerNotifiedOfResourceCreation: true,
                },
                props: {
                    isRoot: true,
                },
            });

            // now find owners.

            let doesResourceHasOwners: boolean = true;

            let owners: Array<User> = await IncidentService.findOwners(
                incident.id!
            );

            if (owners.length === 0) {
                doesResourceHasOwners = false;

                // find project owners.
                owners = await ProjectService.getOwners(incident.projectId!);
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                incidentTitle: incident.title!,
                projectName: incident.project!.name!,
                currentState: incident.currentIncidentState!.name!,
                incidentDescription: Markdown.convertToHTML(
                    incident.description! || ''
                ),
                incidentSeverity: incident.incidentSeverity!.name!,
                rootCause:
                    incident.rootCause ||
                    'No root cause identified for this incident',
                incidentViewLink: IncidentService.getIncidentLinkInDashboard(
                    incident.projectId!,
                    incident.id!
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType:
                        EmailTemplateType.IncidentOwnerResourceCreated,
                    vars: vars,
                    subject: 'New incident created - ' + incident.title!,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);

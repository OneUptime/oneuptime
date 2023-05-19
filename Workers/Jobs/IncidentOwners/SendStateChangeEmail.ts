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
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService from 'CommonServer/Services/IncidentStateTimelineService';
import IncidentState from 'Model/Models/IncidentState';
import OneUptimeDate from 'Common/Types/Date';

RunCron(
    'IncidentOwner:SendStateChangeEmail',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        // get all scheduled events of all the projects.

        const incidentStateTimelines: Array<IncidentStateTimeline> =
            await IncidentStateTimelineService.findBy({
                query: {
                    isOwnerNotified: false,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                select: {
                    _id: true,
                    createdAt: true,
                    projectId: true,
                },
                populate: {
                    project: {
                        name: true,
                    },
                    incident: {
                        _id: true,
                        title: true,
                        description: true,
                    },
                    incidentState: {
                        name: true,
                    },
                },
            });

        for (const incidentStateTimeline of incidentStateTimelines) {
            const incident: Incident = incidentStateTimeline.incident!;
            const incidentState: IncidentState =
                incidentStateTimeline.incidentState!;

            // get incident severity
            const incidentWithSeverity: Incident | null =
                await IncidentService.findOneById({
                    id: incident.id!,
                    props: {
                        isRoot: true,
                    },
                    select: {
                        _id: true,
                    },
                    populate: {
                        incidentSeverity: {
                            name: true,
                        },
                    },
                });

            if (!incidentWithSeverity) {
                continue;
            }

            await IncidentStateTimelineService.updateOneById({
                id: incidentStateTimeline.id!,
                data: {
                    isOwnerNotified: true,
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
                owners = await ProjectService.getOwners(
                    incidentStateTimeline.projectId!
                );
            }

            if (owners.length === 0) {
                continue;
            }

            const vars: Dictionary<string> = {
                incidentTitle: incident.title!,
                projectName: incidentStateTimeline.project!.name!,
                currentState: incidentState!.name!,
                incidentDescription: Markdown.convertToHTML(
                    incident.description! || ''
                ),
                stateChangedAt:
                    OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
                        incidentStateTimeline.createdAt!
                    ),
                incidentSeverity: incidentWithSeverity.incidentSeverity!.name!,
                incidentViewLink: IncidentService.getIncidentLinkInDashboard(
                    incidentStateTimeline.projectId!,
                    incident.id!
                ).toString(),
            };

            if (doesResourceHasOwners === true) {
                vars['isOwner'] = 'true';
            }

            for (const user of owners) {
                MailService.sendMail({
                    toEmail: user.email!,
                    templateType: EmailTemplateType.IncidentOwnerStateChanged,
                    vars: vars,
                    subject:
                        'Incident state changed to - ' + incidentState!.name!,
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }
    }
);

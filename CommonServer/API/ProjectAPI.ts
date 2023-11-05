import Project from 'Model/Models/Project';
import ProjectService, {
    Service as ProjectServiceType,
} from '../Services/ProjectService';
import BaseAPI from './BaseAPI';
import UserMiddleware from '../Middleware/UserAuthorization';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    OneUptimeRequest,
} from '../Utils/Express';
import TeamMemberService from '../Services/TeamMemberService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Response from '../Utils/Response';
import TeamMember from 'Model/Models/TeamMember';
import NotAuthenticatedException from 'Common/Types/Exception/NotAuthenticatedException';

export default class ProjectAPI extends BaseAPI<Project, ProjectServiceType> {
    public constructor() {
        super(Project, ProjectService);

        /// This API lists all the projects where user is its team member.
        /// This API is usually used to show project selector dropdown in the UI
        this.router.post(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/list-user-projects`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (!(req as OneUptimeRequest).userAuthorization?.userId) {
                        throw new NotAuthenticatedException(
                            'User should be logged in to access this API'
                        );
                    }

                    const teamMembers: Array<TeamMember> =
                        await TeamMemberService.findBy({
                            query: {
                                userId: (req as OneUptimeRequest)
                                    .userAuthorization!.userId!,
                                hasAcceptedInvitation: true,
                            },
                            select: {
                                project: {
                                    _id: true,
                                    name: true,
                                    trialEndsAt: true,
                                    paymentProviderPlanId: true,
                                    resellerId: true,
                                    isFeatureFlagMonitorGroupsEnabled: true,
                                    paymentProviderMeteredSubscriptionStatus:
                                        true,
                                    paymentProviderSubscriptionStatus: true,
                                },
                            },
                            limit: LIMIT_PER_PROJECT,
                            skip: 0,
                            props: {
                                isRoot: true,
                            },
                        });

                    const projects: Array<Project> = [];

                    for (const teamMember of teamMembers) {
                        if (!teamMember.project) {
                            continue;
                        }

                        if (
                            projects.findIndex((project: Project) => {
                                return (
                                    project._id?.toString() ===
                                    teamMember.project!._id?.toString()
                                );
                            }) === -1
                        ) {
                            projects.push(teamMember.project!);
                        }
                    }

                    return Response.sendEntityArrayResponse(
                        req,
                        res,
                        projects,
                        new PositiveNumber(projects.length),
                        Project
                    );
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}

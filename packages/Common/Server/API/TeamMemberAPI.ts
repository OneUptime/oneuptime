import CommonAPI from "./CommonAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import InvitationLink, {
  InvitationLinkAnswer,
  MAX_MEMBERSHIPS_PER_SIGN_UP_READ,
} from "../Utils/InvitationLink";
import AccessTokenService from "../Services/AccessTokenService";
import ProjectSCIMService from "../Services/ProjectSCIMService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceType,
  TeamsOutOfRemovalReach,
} from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import ProjectMemberSearch from "../Utils/Team/ProjectMemberSearch";
import ReadableTeamNames from "../Utils/Team/ReadableTeamNames";
import EditionEnforcement from "../Utils/EditionEnforcement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import UserType from "../../Types/UserType";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import {
  ProjectMemberSearchMatch,
  readProjectMemberSearchText,
  toProjectMemberSearchAnswerJSON,
} from "../../Types/Team/ProjectMemberSearch";
import {
  PersonKeptInProject,
  readProjectRemovalReachRequest,
  toProjectRemovalReachAnswerJSON,
} from "../../Types/Team/ProjectRemovalReach";

export default class TeamMemberAPI extends BaseAPI<
  TeamMember,
  TeamMemberServiceType
> {
  public constructor() {
    super(TeamMember, TeamMemberService);

    /*
     * Used by the invite-user forms to decide whether to ask for the
     * invitee's name (only needed when the email has no OneUptime account
     * yet). Returns just a boolean — no user details — and requires an
     * authenticated user.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/is-user-registered`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          const userId: ObjectID | undefined =
            oneUptimeRequest.userAuthorization?.userId;
          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException("Not authenticated"),
            );
          }

          const emailString: string = (
            (req.body?.["email"] as string) || ""
          ).trim();

          if (!emailString || !Email.isValid(emailString)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("A valid email is required"),
            );
          }

          const user: User | null = await UserService.findByEmail(
            new Email(emailString),
            {
              isRoot: true,
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            isRegistered: Boolean(user),
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /team-member/search-members - Search's people (#7036,
     * Types/Team/ProjectMemberSearch): the project's members whose name - or
     * email, for a reader who may see the project's emails - holds what was
     * typed, read as the Users page reads them, with the caller's own
     * permissions (Utils/Team/ProjectMemberSearch). For a signed-in member
     * of the project or a project API key; a reader who may not see the
     * project's people is refused, and fewer than two letters are refused
     * rather than answered with everyone. Nothing is written or cached.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/search-members`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const text: string = readProjectMemberSearchText(req.body);

          const members: Array<ProjectMemberSearchMatch> =
            await ProjectMemberSearch.search({
              projectId: projectId,
              text: text,
              props: props,
            });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            toProjectMemberSearchAnswerJSON(members),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Removes one user from the current project - every team they belong to in
     * it - in a single call.
     *
     * The Users table lists people rather than memberships, so "remove" there
     * means "remove from the project". Doing that as N separate DELETEs from
     * the browser is not equivalent: TeamMemberService.onBeforeDelete rejects
     * the removal of the last accepted member of a team that
     * `shouldHaveAtLeastOneMember` (the Owners team), and it rejects it per
     * request - so a client-side loop deletes every other membership first and
     * only then hits the guard, leaving the user stripped of the teams the
     * caller was told they had not been removed from. One deleteBy over the
     * whole set runs that guard against all of the user's memberships before
     * anything is deleted, so the removal either happens or it does not.
     *
     * The project is taken from the request's tenant, never from the body, and
     * the delete runs with the caller's own permissions - so this grants
     * nothing that DELETE /team-member/:id did not already grant.
     */
    /*
     * POST /team-member/invitation-link - the link an invitation email
     * carries, for a master admin to send the person themselves: on a
     * server that cannot send email, the invite dialogs offer it once the
     * invitation is created (InvitationLink). Master admins only: the link
     * claims the account at that address.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/invitation-link`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const requested: unknown = req.body?.["teamMemberId"];
          const teamMemberId: string =
            typeof requested === "string" ? requested.trim() : "";

          if (!teamMemberId || !ObjectID.isValidUUID(teamMemberId)) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Team member ID is required."),
            );
          }

          const answer: InvitationLinkAnswer =
            await InvitationLink.getForTeamMember(new ObjectID(teamMemberId));

          return Response.sendJsonObjectResponse(req, res, {
            link: answer.link,
            isRegistered: answer.isRegistered,
            isAccepted: answer.isAccepted,
            email: answer.email,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /team-member/not-signed-up - which of these memberships belong to
     * someone who has not signed up yet (#8191). A membership accepted for a
     * person with no account reads "Member", and only this tells the lists
     * to offer that person's sign-up link. Master admins only, like the link
     * itself; the answer is the memberships alone, never anything about a
     * password but that there is none (InvitationLink).
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/not-signed-up`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const requested: unknown = req.body?.["teamMemberIds"];

          if (
            !Array.isArray(requested) ||
            requested.some((value: unknown): boolean => {
              return typeof value !== "string" || !ObjectID.isValidUUID(value);
            })
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Team member IDs are required."),
            );
          }

          const teamMemberIds: Array<string> = Array.from(
            new Set<string>(requested as Array<string>),
          );

          if (teamMemberIds.length > MAX_MEMBERSHIPS_PER_SIGN_UP_READ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                `Ask about at most ${MAX_MEMBERSHIPS_PER_SIGN_UP_READ} memberships at a time.`,
              ),
            );
          }

          const notSignedUp: Array<ObjectID> =
            await InvitationLink.getMembershipsNotSignedUp(
              teamMemberIds.map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
            );

          return Response.sendJsonObjectResponse(req, res, {
            teamMemberIds: notSignedUp.map((id: ObjectID): string => {
              return id.toString();
            }),
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * POST /team-member/project-removal-reach - of the people on a page of
     * the Users list, the ones the caller's Remove from Project would leave
     * in the project, with the teams that keep them there (#6599,
     * Types/Team/ProjectRemovalReach). Asked with the caller's own
     * permissions, as the removal is (TeamMemberService.
     * getTeamsOutOfRemovalReach), so the page locks Remove from Project for
     * exactly the people the server would refuse to remove. A team is named
     * only for a caller who may read it; the others are counted. Reads
     * only: nothing is written or cached.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/project-removal-reach`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectPrincipal(props);

          const userIds: Array<ObjectID> = readProjectRemovalReachRequest(
            req.body,
          );

          const outOfReach: Array<TeamsOutOfRemovalReach> =
            await this.service.getTeamsOutOfRemovalReach({
              userIds: userIds,
              projectId: projectId,
              props: props,
            });

          const teamNames: Map<string, string> = await ReadableTeamNames.read({
            teamIds: outOfReach.flatMap(
              (person: TeamsOutOfRemovalReach): Array<ObjectID> => {
                return person.teamIds;
              },
            ),
            projectId: projectId,
            props: props,
          });

          const people: Array<PersonKeptInProject> = outOfReach.map(
            (person: TeamsOutOfRemovalReach): PersonKeptInProject => {
              const names: Array<string> = [];
              let hiddenTeamCount: number = person.membershipsWithoutTeam;

              for (const teamId of person.teamIds) {
                const name: string | undefined = teamNames.get(
                  teamId.toString().toLowerCase(),
                );

                if (name) {
                  names.push(name);
                } else {
                  hiddenTeamCount += 1;
                }
              }

              return {
                userId: person.userId.toString(),
                teamNames: names,
                hiddenTeamCount: hiddenTeamCount,
                hasTeamInReach: person.hasTeamInReach,
              };
            },
          );

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            toProjectRemovalReachAnswerJSON(people),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/remove-user-from-project`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          if (!oneUptimeRequest.userAuthorization?.userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException("Not authenticated"),
            );
          }

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID | undefined = props.tenantId;

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          const userIdParam: string = (
            (req.body?.["userId"] as string) || ""
          ).trim();

          if (!userIdParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("User ID is required"),
            );
          }

          ObjectID.validateUUID(userIdParam);

          /*
           * Every membership or none: a caller who may take the person off
           * only some of their teams - Remove Team Members scoped to Owned -
           * is refused, before anything is removed.
           */
          await this.service.assertCallerMayRemoveUserFromProject({
            userId: new ObjectID(userIdParam),
            projectId: projectId,
            props: props,
          });

          const numberOfMembershipsDeleted: number =
            await this.service.deleteBy({
              query: {
                userId: new ObjectID(userIdParam),
                projectId: projectId,
              } as Query<TeamMember>,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            numberOfMembershipsDeleted: numberOfMembershipsDeleted,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/leave`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

          const idParam: string = req.params["id"] as string;
          if (!idParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Team member id is required"),
            );
          }

          ObjectID.validateUUID(idParam);
          const teamMemberId: ObjectID = new ObjectID(idParam);

          const userId: ObjectID | undefined =
            oneUptimeRequest.userAuthorization?.userId;
          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException("Not authenticated"),
            );
          }

          const teamMember: TeamMember | null = await this.service.findOneById({
            id: teamMemberId,
            props: { isRoot: true },
            select: {
              userId: true,
              projectId: true,
              teamId: true,
              hasAcceptedInvitation: true,
            },
          });

          if (!teamMember) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Team member not found"),
            );
          }

          if (teamMember.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotAuthorizedException(
                "You can only leave teams you are a member of",
              ),
            );
          }

          /*
           * While SCIM Push Groups owns the project's teams only the identity
           * provider may remove members. Not on the Community Edition, which
           * has no SCIM endpoint: a leftover setting would trap the member.
           */
          if (
            teamMember.projectId &&
            EditionEnforcement.areScimTeamLocksEnforced()
          ) {
            const scimCount: number = (
              await ProjectSCIMService.countBy({
                query: {
                  projectId: teamMember.projectId,
                  enablePushGroups: true,
                },
                props: { isRoot: true },
              })
            ).toNumber();

            if (scimCount > 0) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  "Team membership is managed by SCIM Push Groups for this project. Please contact your administrator to be removed.",
                ),
              );
            }
          }

          /*
           * Leaving a team lifts its blocks from the person who leaves, so
           * it is held to what a removal by anyone else is held to
           * (TeamMemberService.assertRemoverMayLiftBlocks) - with the
           * leaver's own permissions in the team's project, whatever project
           * the request names. A pending invitation holds no permissions,
           * and a master admin may lift any block. The membership is then
           * removed as root: a member needs no permission to manage teams to
           * leave one.
           */
          if (
            teamMember.projectId &&
            teamMember.hasAcceptedInvitation &&
            oneUptimeRequest.userType !== UserType.MasterAdmin
          ) {
            teamMember.id = teamMemberId;

            try {
              await this.service.assertRemoverMayLiftBlocks({
                members: [teamMember],
                props:
                  await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
                    {
                      userId: userId,
                      projectId: teamMember.projectId,
                    },
                  ),
              });
            } catch (err) {
              if (err instanceof NotAuthorizedException) {
                return Response.sendErrorResponse(req, res, err);
              }

              throw err;
            }
          }

          await this.service.deleteOneById({
            id: teamMemberId,
            props: { isRoot: true },
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}

import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../Types/BaseDatabase/Query";
import LIMIT_MAX, { DEFAULT_LIMIT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import TeamMembersByProject, {
  UserProjectMembership,
} from "../../Utils/TeamMembersByProject";
import Email from "../../Types/Email";
import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
import TeamMemberService from "../Services/TeamMemberService";
import UserAuthenticationStatus from "../../Types/UserAuthenticationStatus";
import UserService, {
  Service as UserServiceType,
} from "../Services/UserService";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";

const BLANK_PROFILE_PICTURE_PATH: string =
  "/usr/src/Common/UI/Images/users/blank-profile.svg";

export default class UserAPI extends BaseAPI<User, UserServiceType> {
  public constructor() {
    super(User, UserService);

    /*
     * Every project one user belongs to, one row per project, for the Admin
     * Dashboard's User > Projects page.
     *
     * There is no CRUD list that answers this. `GET /team-member` scoped to a
     * user returns MEMBERSHIPS - a (user, team) pair - so a user on three teams
     * of one project comes back as three rows and reads as three projects. This
     * endpoint folds those into one row per project carrying every team the
     * user is on there, which is both what the page renders and what any
     * caller asking "which projects is this person in?" actually wants.
     *
     * Master-admin only: it deliberately reads across every tenant, which is
     * exactly what no project-scoped caller is allowed to do. The middleware is
     * the gate; the read below runs as root because a master admin is not a
     * member of the projects being listed and so has no tenant permissions to
     * read them with.
     *
     * The gate accepts the instance-wide master API key as well as a
     * master-admin session, because the caller asking "which projects is this
     * person in?" is typically a script rather than somebody with a browser
     * open. That is a widening, so it is worth being explicit about why it is
     * the right one HERE and not on the routes below: this endpoint only reads,
     * and it reads nothing the key does not already reach through
     * POST /team-member/get-list, which any master-key caller can call today
     * (untenanted, so cross-project) to assemble the same answer one membership
     * at a time. The key buys convenience and correct paging, not new reach.
     *
     * The writes below stay on the session-only middleware. A leaked static key
     * that can list memberships is a disclosure of what it could already
     * disclose; one that can remove a user from a project, set their password or
     * mail them a reset link is a headless account takeover.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:userId/projects`,
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = UserAPI.getUserIdFromParams(req);

          const memberships: Array<TeamMember> = await TeamMemberService.findBy(
            {
              query: {
                userId: userId,
              },
              select: {
                _id: true,
                projectId: true,
                teamId: true,
                hasAcceptedInvitation: true,
                createdAt: true,
                project: {
                  _id: true,
                  name: true,
                  slug: true,
                },
                team: {
                  _id: true,
                  name: true,
                },
              },
              limit: LIMIT_MAX,
              skip: 0,
              sort: {},
              props: {
                isRoot: true,
              },
            },
          );

          const rows: Array<UserProjectMembership> =
            TeamMembersByProject.sortByProjectName(
              TeamMembersByProject.groupByProject(memberships),
            );

          const skip: number = UserAPI.getPositiveIntegerParam(
            req.query["skip"],
            0,
          );
          const limit: number = UserAPI.getPositiveIntegerParam(
            req.query["limit"],
            DEFAULT_LIMIT,
          );

          const page: Array<UserProjectMembership> = rows.slice(
            skip,
            skip + limit,
          );

          return Response.sendJsonArrayResponse(
            req,
            res,
            page.map((row: UserProjectMembership) => {
              return UserAPI.serializeUserProjectMembership(userId, row);
            }),
            new PositiveNumber(rows.length),
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Removes one user from one project - every team they belong to in it - in
     * a single call.
     *
     * A row on the User > Projects page is a project, so "remove" there means
     * "remove from the project". Doing that as N separate DELETEs from the
     * browser is not equivalent: TeamMemberService.onBeforeDelete refuses to
     * remove the last accepted member of a team that shouldHaveAtLeastOneMember
     * (the Owners team), and it refuses per request - so a client-side loop
     * deletes every other membership first and only then reports the failure,
     * leaving the user stripped of the teams the admin was just told they had
     * not lost. One deleteBy over the whole set runs that guard against all of
     * the user's memberships in the project before anything is deleted.
     *
     * This is the master-admin twin of
     * POST /team-member/remove-user-from-project, which takes its project from
     * the request's tenant. A master admin is not a member of the project and
     * sends no tenant, so the project is named in the body here - the
     * master-admin middleware, not a tenant, is what authorizes the call.
     *
     * The delete runs with the CALLER'S props rather than as root, so the
     * Owners-team and SCIM Push Groups guards still apply: a master admin can
     * remove people, but not leave a project ownerless or fight the customer's
     * identity provider behind its back.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:userId/remove-from-project`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = UserAPI.getUserIdFromParams(req);

          const projectIdParam: string = (
            (req.body?.["projectId"] as string) || ""
          ).trim();

          if (!projectIdParam) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          ObjectID.validateUUID(projectIdParam);

          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const numberOfMembershipsDeleted: number =
            await TeamMemberService.deleteBy({
              query: {
                userId: userId,
                projectId: new ObjectID(projectIdParam),
              } as Query<TeamMember>,
              limit: LIMIT_MAX,
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

    /*
     * How one user can sign in, for Admin Dashboard > User > Authentication.
     *
     * A dedicated endpoint rather than extra columns on the CRUD read, because
     * the interesting fact -- "does this account have a password at all?" --
     * cannot be answered from the CRUD API without shipping the password
     * column itself. A master admin bypasses column read permissions, so
     * selecting `password` in the browser would put every user's scrypt digest
     * in a page's network tab. The booleans below are derived server-side and
     * nothing secret crosses the wire.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/:userId/authentication-status`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = UserAPI.getUserIdFromParams(req);

          const status: UserAuthenticationStatus =
            await UserService.getAuthenticationStatus(userId);

          /*
           * Whether an account has a password is exactly the sort of answer a
           * shared cache must not keep -- and it changes the moment either
           * action below is used.
           */
          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            status as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Set a user's password on their behalf.
     *
     * Master-admin only, and deliberately its own route rather than a PUT to
     * /user/:id with a password in it. That generic write would work -- a
     * master admin bypasses the password column's `update: [CurrentUser]` ACL
     * -- but nothing about the URL would say so, the password policy could not
     * be enforced, and the payload would have to be a hand-serialized
     * HashedString. Here the gate is a middleware anyone can grep for, and the
     * body is a plain string.
     *
     * Session revocation and the "Password Changed." email happen in
     * UserService's update hook, not here, so they cannot be forgotten by a
     * caller and cannot fire twice.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:userId/set-password`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = UserAPI.getUserIdFromParams(req);

          const password: unknown = req.body?.["password"];

          /*
           * Type-checked rather than cast. `as string` on a JSON body is a
           * lie the moment somebody posts {"password": {...}} or a number, and
           * the value flows into the hasher.
           */
          if (typeof password !== "string") {
            throw new BadDataException("Password is required");
          }

          await UserService.setPassword({
            userId: userId,
            password: password,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );

    /*
     * Email the user a link that lets them choose their own password.
     *
     * The counterpart to setting one for them: it never puts the operator in
     * possession of the user's credentials, which is the better default when
     * the point is simply to get somebody back into a locked-out account. The
     * link is the same one /forgot-password sends, redeemed by the same page.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:userId/send-password-reset-link`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = UserAPI.getUserIdFromParams(req);

          const email: Email = await UserService.sendPasswordResetLink({
            userId: userId,
          });

          /*
           * Echoed back so the page can say where the link went. The caller is
           * a master admin who can already read this user's email through the
           * CRUD API, so this discloses nothing new.
           */
          return Response.sendJsonObjectResponse(req, res, {
            email: email.toString(),
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/profile-picture/:userId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const userIdParam: string | undefined = req.params["userId"];

        if (!userIdParam) {
          return this.sendBlankProfile(req, res);
        }

        let userId: ObjectID;

        try {
          userId = new ObjectID(userIdParam);
        } catch {
          return this.sendBlankProfile(req, res);
        }

        try {
          const profilePictureSelect: {
            profilePictureFile: {
              _id: boolean;
              file: boolean;
              fileType: boolean;
              name: boolean;
            };
          } = {
            profilePictureFile: {
              _id: true,
              file: true,
              fileType: true,
              name: true,
            },
          };

          const userById: User | null = await UserService.findOneBy({
            query: {
              _id: userId,
            },
            select: profilePictureSelect,
            props: {
              isRoot: true,
            },
          });

          if (userById && userById.profilePictureFile) {
            Response.setNoCacheHeaders(res);
            return Response.sendFileResponse(
              req,
              res,
              userById.profilePictureFile,
            );
          }

          return this.sendBlankProfile(req, res);
        } catch (error) {
          logger.error(error, getLogAttributesFromRequest(req as any));
          return this.sendBlankProfile(req, res);
        }
      },
    );
  }

  /**
   * The `:userId` in the path, rejected loudly if it is not a uuid.
   *
   * Validating rather than trusting matters even behind the master-admin gate:
   * the value flows into a query, and a malformed id should fail as bad input
   * rather than reach the database layer.
   */
  private static getUserIdFromParams(req: ExpressRequest): ObjectID {
    const userIdParam: string = ((req.params["userId"] as string) || "").trim();

    if (!userIdParam) {
      throw new BadDataException("User ID is required");
    }

    ObjectID.validateUUID(userIdParam);

    return new ObjectID(userIdParam);
  }

  /**
   * A non-negative integer from a query string, or the fallback.
   *
   * Anything unparseable (missing, "abc", "-5", "1e9999") falls back rather
   * than becoming NaN - a NaN skip/limit turns Array.slice into "return
   * everything from 0", which would silently ignore paging instead of failing.
   */
  private static getPositiveIntegerParam(
    value: unknown,
    fallback: number,
  ): number {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const parsed: number = Number(value.toString());

    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      return fallback;
    }

    return parsed;
  }

  /**
   * One grouped row as JSON.
   *
   * The row is sent as a TeamMember - the model the row is built from, and the
   * one the Admin Dashboard's table is typed against - carrying the project it
   * stands for. The aggregate fields (`teams`, the counts) are not columns of
   * TeamMember, so they are attached after serialization; the client reads them
   * off the raw JSON before hydrating the model.
   */
  private static serializeUserProjectMembership(
    userId: ObjectID,
    row: UserProjectMembership,
  ): JSONObject {
    const teamMember: TeamMember = new TeamMember();

    if (row.id) {
      teamMember._id = row.id;
    }

    teamMember.userId = userId;
    teamMember.hasAcceptedInvitation = row.hasAcceptedInvitation;

    if (row.projectId) {
      teamMember.projectId = row.projectId;
    }

    if (row.project) {
      teamMember.project = row.project;
    }

    if (row.joinedAt) {
      teamMember.createdAt = row.joinedAt;
    }

    const json: JSONObject = BaseModel.toJSON(teamMember, TeamMember);

    json["teams"] = BaseModel.toJSONArray(row.teams, Team) as JSONArray;
    json["teamCount"] = row.teams.length;
    json["pendingTeamCount"] = row.pendingTeamCount;
    json["teamMemberIds"] = [...row.teamMemberIds];

    return json;
  }

  private sendBlankProfile(req: ExpressRequest, res: ExpressResponse): void {
    Response.setNoCacheHeaders(res);

    try {
      Response.sendFileByPath(req, res, BLANK_PROFILE_PICTURE_PATH);
    } catch (error) {
      logger.error(error, getLogAttributesFromRequest(req as any));
      Response.sendErrorResponse(
        req,
        res,
        new NotFoundException("User profile picture not found"),
      );
    }
  }
}

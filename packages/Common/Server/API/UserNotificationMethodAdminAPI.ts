import UserMiddleware from "../Middleware/UserAuthorization";
import UserNotificationMethodAdminService, {
  AdminNotificationMethodDeletionPreview,
  AdminNotificationMethodView,
} from "../Services/UserNotificationMethodAdminService";
import TeamMemberService from "../Services/TeamMemberService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserPermission } from "../../Types/Permission";
import TeamMember from "../../Models/DatabaseModels/TeamMember";

/*
 * Managing another project member's notification methods over HTTP.
 *
 * Everything this router does is done by UserNotificationMethodAdminService,
 * which holds the whole of the reasoning about masking, verification and the
 * owner's mail. This file is transport and AUTHORISATION, and the authorisation
 * is the part worth reading, because the usual reasoning does not apply here.
 *
 * The seven notification method models are scoped to the person who owns the
 * device, and they stay that way — see the essay at the top of UserEmail.ts.
 * The service therefore does its reads and writes with `isRoot: true`, which
 * means the model's own TableAccessControl never runs on this path AND THESE
 * HANDLERS ARE THE ONLY GATE UNDERNEATH. UserMiddleware.getUserMiddleware is
 * not that gate: it admits anonymous callers as UserType.Public and calls
 * next(), and the tenant id it attaches comes straight off the caller-supplied
 * `tenantid` header before any authorisation runs.
 *
 * So every route below asserts, itself, in this order:
 *
 *   1. the caller is a signed-in member of the project they named
 *      (CommonAPI.assertAuthenticatedProjectMember, which checks the caller
 *      against that same header);
 *   2. the caller holds a permission that lets them act on other people's
 *      accounts in it (assertCanManageUserNotificationMethods below), EXCEPT on
 *      the read, which additionally lets a person read their own; and
 *   3. the user named in the path is a member of that same project — enforced
 *      again inside the service, on purpose, so the service is safe for any
 *      caller and not only for this router.
 *
 * WHY THE READ IS SEPARATELY GATED FROM THE WRITES. Reading the masked list is
 * a disclosure ("this person has an unverified SMS"), and the readiness surface
 * already discloses exactly that to every project member. Writing is an ACTION
 * on somebody else's account. Those are different questions and the router does
 * not answer them with one permission.
 */
const router: ExpressRouter = Express.getRouter();

/*
 * Who may LOOK at another member's notification methods.
 *
 * The same triple the admin rules page uses, and for the same reason: existing
 * project teams are seeded with ROLES, never with individual granular
 * permissions, so a permission introduced in this release is held by nobody at
 * all until an administrator explicitly grants it. A gate naming only the
 * granular permission would ship a feature that is dead on arrival for every
 * project that already exists — the owner of a project would open the page and
 * be told they may not look at it.
 */
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

/*
 * Who may ADD or REMOVE one.
 *
 * Deliberately NOT EditProjectUserNotificationRule. Repairing somebody's rules
 * and putting a new address on their account are different powers with
 * different blast radii: the first re-points pages between devices that person
 * has already proved they hold, the second introduces a device nobody has
 * proved anything about. An installation that wants to hand out the first
 * without the second must be able to, so this is its own permission.
 */
const MANAGE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ManageProjectUserNotificationMethod,
];

/*
 * The permission check, read the way the rest of the API reads permissions.
 *
 * getUserPermissions(Allow) rather than indexing userTenantAccessPermission
 * directly, and that is not a stylistic preference. That dictionary's entries
 * hold GRANTS AND DENIALS in one array, discriminated only by
 * `isBlockPermission`, so mapping it raw would count a team's explicit BLOCK of
 * ProjectAdmin as a grant of it — the admin action that restricts a team would
 * be the thing that handed it this endpoint.
 *
 * Every refusal in this file reuses one sentence, so an under-privileged member
 * cannot tell "you may not do this" apart from "you are not in this project"
 * and use the difference to probe.
 */
function assertHasAnyPermission(
  databaseProps: DatabaseCommonInteractionProps,
  allowed: Array<Permission>,
): void {
  if (databaseProps.isMasterAdmin) {
    return;
  }

  const permissions: Array<Permission> =
    DatabaseCommonInteractionPropsUtil.getUserPermissions(
      databaseProps,
      PermissionType.Allow,
    ).map((userPermission: UserPermission): Permission => {
      return userPermission.permission;
    });

  const isAllowed: boolean = permissions.some(
    (permission: Permission): boolean => {
      return allowed.includes(permission);
    },
  );

  if (!isAllowed) {
    throw new NotAuthorizedException(
      "You are not authorized to access this project's data.",
    );
  }
}

/*
 * Project membership for the user NAMED IN THE PATH, not the caller.
 *
 * Without it these routes are a cross-project probe: the service's reads are
 * projectId-scoped and would come back empty for a stranger, but a write path
 * that skipped this would let somebody holding ProjectAdmin on one throwaway
 * project act on a user id belonging to any other.
 *
 * The rejection reuses the router's single refusal sentence so a caller cannot
 * tell "this user exists but is in another project" apart from "this user does
 * not exist", and therefore cannot enumerate users through it. The service
 * repeats the check with its own wording once the caller is past this point.
 */
async function assertUserBelongsToProject(
  userId: ObjectID,
  projectId: ObjectID,
): Promise<void> {
  const memberships: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      userId: userId,
      projectId: projectId,
    },
    select: {
      _id: true,
    },
    limit: 1,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  if (memberships.length === 0) {
    throw new NotAuthorizedException(
      "You are not authorized to access this project's data.",
    );
  }
}

/*
 * ObjectID's constructor accepts any string, so an unvalidated path segment
 * would travel all the way to a query that matches nothing and read as "this
 * user has no notification methods" rather than as "you sent nonsense".
 */
function readObjectIdParam(req: ExpressRequest, name: string): ObjectID {
  const raw: string = (req.params[name] as string) || "";
  ObjectID.validateUUID(raw);
  return new ObjectID(raw);
}

function readStringFromBody(req: ExpressRequest, name: string): string {
  const body: JSONObject = (req.body || {}) as JSONObject;
  const raw: unknown = body[name];

  if (typeof raw !== "string" || !raw.trim()) {
    throw new BadDataException(`${name} is required.`);
  }

  return raw.trim();
}

/*
 * ObjectID.toJSON() serialises to `{ _type: "ObjectID", value: "..." }`, which
 * is right for model payloads the client parses back through JSONFunctions but
 * wrong for a hand-rolled response body. Ids are flattened to plain strings, the
 * same way OnCallReadinessAPI does it, so the browser can read `methodId`
 * without knowing about ObjectID at all.
 *
 * `maskedIdentifier` is copied and nothing else is: there is no raw field on
 * the service's view type to leak, which is deliberate — a future change would
 * have to widen that contract in the open rather than slip a phone number
 * through a boolean flag here.
 */
function serializeMethod(method: AdminNotificationMethodView): JSONObject {
  return {
    methodId: method.methodId.toString(),
    methodType: method.methodType,
    maskedIdentifier: method.maskedIdentifier,
    isVerified: method.isVerified,
    isAdminAddable: method.isAdminAddable,
    createdAt: method.createdAt ? method.createdAt.toISOString() : undefined,
  };
}

/*
 * Every notification method this user has, masked.
 *
 * A member reading their OWN row is allowed through without the admin
 * permission. The page behind this is reachable from the project's user list,
 * and a person looking at themselves there is reading rows the self-serve
 * settings pages already show them in full.
 */
router.get(
  "/user-notification-method-admin/user/:userId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      const userId: ObjectID = readObjectIdParam(req, "userId");

      const isSelf: boolean =
        Boolean(databaseProps.userId) &&
        databaseProps.userId!.toString() === userId.toString();

      if (!isSelf) {
        assertHasAnyPermission(databaseProps, READ_PERMISSIONS);
      }

      await assertUserBelongsToProject(userId, projectId);

      const methods: Array<AdminNotificationMethodView> =
        await UserNotificationMethodAdminService.listMethodsForUser({
          projectId: projectId,
          userId: userId,
        });

      return Response.sendJsonObjectResponse(req, res, {
        methods: methods.map(serializeMethod),
      });
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Add a notification method to this user's account.
 *
 * The row lands UNVERIFIED and a verification code goes to the address itself,
 * which is what keeps this from being a way to redirect somebody's pages: the
 * verify endpoints refuse anybody but the row's owner, so the administrator who
 * just typed the value in cannot complete it. See the service header.
 */
router.post(
  "/user-notification-method-admin/user/:userId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      /*
       * Both gates run before the body is read. A route that validates a
       * payload for a caller it is about to refuse has told that caller
       * something about the payload format.
       */
      assertHasAnyPermission(databaseProps, MANAGE_PERMISSIONS);

      const userId: ObjectID = readObjectIdParam(req, "userId");

      await assertUserBelongsToProject(userId, projectId);

      const methodType: string = readStringFromBody(req, "methodType");
      const value: string = readStringFromBody(req, "value");

      const created: AdminNotificationMethodView =
        await UserNotificationMethodAdminService.addMethodForUser({
          projectId: projectId,
          targetUserId: userId,
          /*
           * The actor the SERVER resolved, never anything from the body. This
           * value names somebody in an audit entry and in a mail to the account
           * holder, so a body-supplied one would let a caller sign their own
           * change with a colleague's name.
           */
          actorUserId: databaseProps.userId,
          methodType: methodType,
          value: value,
          props: databaseProps,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        serializeMethod(created),
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * What removing this method would cost, before anybody confirms it.
 *
 * Read-only, and gated as a WRITE rather than as a read: the numbers it returns
 * are about this user's rule coverage, and the only reason to ask for them is
 * that you are about to delete something.
 */
router.get(
  "/user-notification-method-admin/user/:userId/:methodType/:methodId/deletion-impact",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      assertHasAnyPermission(databaseProps, MANAGE_PERMISSIONS);

      const userId: ObjectID = readObjectIdParam(req, "userId");

      await assertUserBelongsToProject(userId, projectId);

      const methodId: ObjectID = readObjectIdParam(req, "methodId");

      const preview: AdminNotificationMethodDeletionPreview =
        await UserNotificationMethodAdminService.getDeletionPreview({
          projectId: projectId,
          targetUserId: userId,
          methodType: (req.params["methodType"] as string) || "",
          methodId: methodId,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        preview as unknown as JSONObject,
      );
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Send the verification code again, to the device.
 *
 * Discloses nothing — the code goes to the address on the row, which is the one
 * thing on it the administrator cannot read — and it is the lever that makes
 * adding a method on somebody's behalf actually finish: "I added your work
 * mobile, here is another code" rather than re-typing the number.
 */
router.post(
  "/user-notification-method-admin/user/:userId/:methodType/:methodId/resend-verification-code",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      assertHasAnyPermission(databaseProps, MANAGE_PERMISSIONS);

      const userId: ObjectID = readObjectIdParam(req, "userId");

      await assertUserBelongsToProject(userId, projectId);

      const methodId: ObjectID = readObjectIdParam(req, "methodId");

      await UserNotificationMethodAdminService.resendVerificationCodeForUser({
        projectId: projectId,
        targetUserId: userId,
        methodType: (req.params["methodType"] as string) || "",
        methodId: methodId,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      next(err);
    }
  },
);

/*
 * Remove one of this user's notification methods.
 *
 * DELETE rather than a POST to a /delete path, because it is one, and because
 * the id it names is the only thing that identifies the row — there is no body
 * to get out of step with the URL.
 *
 * Every rule pointing at this method goes with it (the foreign keys are all
 * onDelete: "CASCADE"), which is why the preview route above exists and why the
 * owner is always mailed about this one.
 */
router.delete(
  "/user-notification-method-admin/user/:userId/:methodType/:methodId",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(databaseProps);

      assertHasAnyPermission(databaseProps, MANAGE_PERMISSIONS);

      const userId: ObjectID = readObjectIdParam(req, "userId");

      await assertUserBelongsToProject(userId, projectId);

      const methodId: ObjectID = readObjectIdParam(req, "methodId");

      await UserNotificationMethodAdminService.deleteMethodForUser({
        projectId: projectId,
        targetUserId: userId,
        actorUserId: databaseProps.userId,
        methodType: (req.params["methodType"] as string) || "",
        methodId: methodId,
        props: databaseProps,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

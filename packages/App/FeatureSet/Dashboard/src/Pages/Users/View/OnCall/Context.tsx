import { NotificationMethodChoice } from "../../../../Components/NotificationRule/OnCallRulesTable";
import {
  ReadinessDeliveryContext,
  ReadinessSummaryWire,
  UserReadinessWire,
  getSelfAddressedConsequence,
  parseReadinessSummary,
} from "../../../../Components/OnCallPolicy/Readiness/ReadinessTypes";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Exception from "Common/Types/Exception/Exception";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL, DASHBOARD_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import React, {
  ReactElement,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

/*
 * Users > View > On-Call — the state every page in that section is built on,
 * loaded ONCE and shared.
 *
 * This section used to be a single route, and everything in it — the readiness
 * tiles, the coverage grid, the notification methods and four rule tables that
 * each expand to one card per severity band — was stacked onto one page that
 * ran to well over a dozen screens. It was reorganised into six, and this file
 * is what makes that split cheap: identity and readiness are read by the
 * SECTION rather than by each page, so moving between "Readiness" and "Incident
 * Rules" re-renders rather than re-fetches, and every page in the section
 * agrees about who it is talking about.
 *
 * That last part is not a performance note. The whole risk of this section is
 * an administrator editing the wrong person's paging configuration while
 * believing it is their own, and six pages that each answered "whose page is
 * this?" separately would be six chances to answer it differently.
 *
 * WHAT IS DELIBERATELY NOT HERE: any read of a notification METHOD model.
 * UserEmail, UserSMS, UserCall, UserPush, UserWhatsApp, UserTelegram,
 * UserSlack, UserMicrosoftTeams and UserWebhook are scoped to the person who
 * owns the device, and nothing in this section reads them — not directly, and not through a nested relation select
 * on a rule, which reaches the same columns through a table an administrator IS
 * allowed to read. Everything any page here knows about a method comes masked
 * from the server: from the readiness payload, or from the admin notification
 * method endpoint. See the header of NotificationMethods.tsx.
 */

/*
 * Who may look at another member's on-call configuration, and who may change
 * it.
 *
 * Both triples list the two project-administration ROLES alongside the granular
 * permission, because OneUptime's teams hold roles and not individual granular
 * permissions: a permission introduced in a release is held by nobody at all
 * until an administrator hands it out, so a check naming only the granular one
 * would hide this section from the owner of every project that already exists.
 *
 * The same triples gate the model's own table access control, so what is drawn
 * here and what the API will accept agree. Hiding a control is never the
 * boundary — somebody who types the URL still reaches the page, which repeats
 * these checks, and the server refuses the write regardless.
 */
export const NOTIFICATION_RULE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

export const NOTIFICATION_RULE_EDIT_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectUserNotificationRule,
];

/*
 * Managing somebody else's notification METHODS is its own permission, not a
 * consequence of being allowed to edit their rules. Repairing a rule re-points
 * a page between devices that person has already proved they hold; adding a
 * method introduces a device nobody has proved anything about.
 */
export const NOTIFICATION_METHOD_MANAGE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ManageProjectUserNotificationMethod,
];

/*
 * Namespaces this section's stored table preferences away from the self-serve
 * settings pages. Both surfaces render the same rule table against the same
 * rule types, and a shared prefix would make paging your own Sev1 table
 * repaginate the admin one you last had open for a colleague.
 */
export const ADMIN_TABLE_PREFERENCES_PREFIX: string =
  "admin-user-notification-rules";

export interface UserOnCallContextValue {
  userId: ObjectID;
  /** Null while loading, and whenever the identity read failed. */
  targetUser: User | null;
  /** Name, or login email, or "" — never a placeholder like "this user". */
  displayName: string;
  /** First name, or "this user" when there is nothing to shorten. */
  firstName: string;
  isSelf: boolean;
  canRead: boolean;
  canEdit: boolean;
  canManageMethods: boolean;

  readinessSummary: ReadinessSummaryWire | null;
  readiness: UserReadinessWire | undefined;
  isLoadingReadiness: boolean;
  readinessError: string;
  reloadReadiness: (refresh: boolean) => Promise<void>;

  delivery: ReadinessDeliveryContext;
  /**
   * Three states, not two, and the third is why this is not just
   * `delivery.isFallbackEnabled`. What a missing rule COSTS is decided by a
   * project setting: with the fallback on it is a page delivered on some other
   * verified channel, with it off it is no page at all. A failed read has to
   * read as unknown rather than as "your pages are dropped", which would be a
   * specific and possibly false claim about this project made because a request
   * timed out.
   */
  fallbackState: "on" | "off" | "unknown";

  /**
   * Everything the rule tables are allowed to say about a method: a masked
   * label and the foreign key to submit. Built from the readiness payload
   * because there is nothing else this section may build it from.
   */
  methodChoices: Array<NotificationMethodChoice>;

  /** A prefilled mailto for "please finish your own setup". */
  getReminderHref: (readiness: UserReadinessWire) => string;
}

/*
 * Undefined rather than a fabricated default. A page rendered outside the
 * section's layout is a routing mistake, and a context full of empty strings
 * would let it render a plausible-looking page about nobody.
 */
const UserOnCallContext: React.Context<UserOnCallContextValue | undefined> =
  createContext<UserOnCallContextValue | undefined>(undefined);

export const UserOnCallContextProvider: React.Provider<
  UserOnCallContextValue | undefined
> = UserOnCallContext.Provider;

export function useUserOnCallContext(): UserOnCallContextValue {
  const value: UserOnCallContextValue | undefined =
    useContext(UserOnCallContext);

  if (!value) {
    throw new Error(
      "useUserOnCallContext must be used inside the Users > View > On-Call layout.",
    );
  }

  return value;
}

export const getFirstName: (displayName: string) => string = (
  displayName: string,
): string => {
  const trimmed: string = displayName.trim();

  if (!trimmed) {
    return "this user";
  }

  return trimmed.split(" ")[0] || trimmed;
};

export interface UserOnCallData {
  value: UserOnCallContextValue;
  isLoadingUser: boolean;
  userError: string;
}

/**
 * Loads the two things this section is built on, separately, because they fail
 * differently.
 *
 * Without an IDENTITY the section must not render its editing surfaces at all —
 * "editing on behalf of somebody" with nobody named is precisely the state an
 * administrator must never be in — whereas READINESS is a computed opinion that
 * can be unavailable while the rules underneath remain perfectly editable.
 * Folding them into one state would let a readiness outage take away the repair
 * this section exists to offer.
 */
export function useUserOnCallData(userId: ObjectID): UserOnCallData {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const signedInUserId: string = UserUtil.getUserId().toString();

  /*
   * The emptiness guard matters: getUserId() answers with an empty ObjectID
   * when the session has no id, and "" === "" would otherwise treat a
   * signed-out reader looking at a blank model id as the owner of the page.
   */
  const isSelf: boolean =
    Boolean(signedInUserId) && signedInUserId === userId.toString();

  const canRead: boolean =
    UserUtil.isMasterAdmin() ||
    isSelf ||
    PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      NOTIFICATION_RULE_READ_PERMISSIONS,
    );

  const canEdit: boolean =
    UserUtil.isMasterAdmin() ||
    isSelf ||
    PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      NOTIFICATION_RULE_EDIT_PERMISSIONS,
    );

  const canManageMethods: boolean =
    UserUtil.isMasterAdmin() ||
    isSelf ||
    PermissionHelper.doesPermissionsIntersect(
      PermissionUtil.getAllPermissions(),
      NOTIFICATION_METHOD_MANAGE_PERMISSIONS,
    );

  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState<boolean>(true);
  const [userError, setUserError] = useState<string>("");

  const [readinessSummary, setReadinessSummary] =
    useState<ReadinessSummaryWire | null>(null);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState<boolean>(true);
  const [readinessError, setReadinessError] = useState<string>("");

  /*
   * Identity comes from TeamMember rather than from User, so the read is scoped
   * to this project by the same table that decides membership. A User read
   * would answer for any id on the instance, and this section would happily
   * name — and offer to configure — somebody who is not in the project at all.
   */
  const loadUser: PromiseVoidFunction = async (): Promise<void> => {
    if (!projectId) {
      setUserError("Project not loaded.");
      setIsLoadingUser(false);
      return;
    }

    try {
      setIsLoadingUser(true);
      setUserError("");

      const teamMembers: ListResult<TeamMember> =
        await ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: userId,
            projectId: projectId,
          },
          select: {
            user: {
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          sort: {},
          skip: 0,
          limit: 1,
        });

      const member: TeamMember | undefined = teamMembers.data[0];

      if (!member || !member.user) {
        setUserError("User not found in this project.");
        return;
      }

      setTargetUser(member.user);
    } catch (err) {
      setUserError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoadingUser(false);
    }
  };

  /*
   * Readiness for this one responder, plus the single project setting the copy
   * cannot be written without.
   *
   * The payload is fed through parseReadinessSummary — the same parser every
   * other readiness surface uses — by wrapping it as the one-element `users`
   * list it is. A second bespoke parser here is how two surfaces end up
   * disagreeing about what a status means, and this is the surface somebody
   * acts on.
   *
   * isFallbackEnabled is read from the project rather than defaulted, because
   * every sentence about a rule gap changes sign with it. The per-user endpoint
   * does not carry the flag, so it is fetched alongside; a failure to read it
   * fails the whole header rather than letting the section guess, since the
   * comforting guess is the wrong one.
   */
  const loadReadiness: (refresh: boolean) => Promise<void> = async (
    refresh: boolean,
  ): Promise<void> => {
    if (!projectId) {
      setReadinessError("Project not loaded.");
      setIsLoadingReadiness(false);
      return;
    }

    try {
      setIsLoadingReadiness(true);
      setReadinessError("");

      const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
        `/on-call-readiness/user/${userId.toString()}`,
      );

      if (refresh) {
        url.addQueryParam("refresh", "true");
      }

      const [response, project]: [
        HTTPResponse<JSONObject> | HTTPErrorResponse,
        Project | null,
      ] = await Promise.all([
        API.get<JSONObject>({
          url: url,
          headers: ModelAPI.getCommonHeaders(),
        }),
        ModelAPI.getItem<Project>({
          modelType: Project,
          id: projectId,
          select: {
            disableOnCallNotificationFallback: true,
          },
        }),
      ]);

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setReadinessSummary(
        parseReadinessSummary({
          projectId: projectId.toString(),
          isFallbackEnabled: !project?.disableOnCallNotificationFallback,
          users: [response.data],
        }),
      );
    } catch (err) {
      setReadinessError(API.getFriendlyMessage(err));
      setReadinessSummary(null);
    } finally {
      setIsLoadingReadiness(false);
    }
  };

  useEffect(() => {
    if (!canRead) {
      setIsLoadingUser(false);
      setIsLoadingReadiness(false);
      return;
    }

    loadUser().catch((err: Error) => {
      setUserError(API.getFriendlyErrorMessage(err as Exception));
    });

    loadReadiness(false).catch((err: Error) => {
      setReadinessError(API.getFriendlyMessage(err));
    });
  }, []);

  const displayName: string =
    targetUser?.name?.toString() || targetUser?.email?.toString() || "";
  const firstName: string = getFirstName(displayName);
  const readiness: UserReadinessWire | undefined = readinessSummary?.users[0];

  const delivery: ReadinessDeliveryContext = {
    isFallbackEnabled: Boolean(readinessSummary?.isFallbackEnabled),
  };

  const fallbackState: "on" | "off" | "unknown" = readinessSummary
    ? readinessSummary.isFallbackEnabled
      ? "on"
      : "off"
    : "unknown";

  /*
   * A method is offered to the rule form only if readiness told us its
   * `methodId`. That id is the foreign key the form submits — userSmsId,
   * userEmailId and so on — so a method without one is a row we can describe
   * but cannot point a rule at, and offering it would produce a create with no
   * method on it that the server refuses.
   */
  const methodChoices: Array<NotificationMethodChoice> = [];

  for (const method of readiness?.methods || []) {
    if (!method.methodId) {
      continue;
    }

    methodChoices.push({
      methodType: method.methodType,
      methodId: method.methodId,
      maskedIdentifier: method.maskedIdentifier,
      isVerified: method.isVerified,
    });
  }

  /*
   * A prefilled draft in the administrator's own mail client, for the one thing
   * they still cannot do from here: complete a verification. An admin can now
   * ADD a method on somebody's behalf, but only the person holding the device
   * can confirm the code that was sent to it, so the reminder asks for exactly
   * that rather than reading as "please do the work I could have done".
   */
  const getReminderHref: (user: UserReadinessWire) => string = (
    user: UserReadinessWire,
  ): string => {
    const methodsRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_METHODS] as Route,
    );

    const methodsUrl: string = new URL(
      DASHBOARD_URL.protocol,
      DASHBOARD_URL.hostname,
      methodsRoute,
    ).toString();

    const subject: string = "Please finish your OneUptime on-call setup";
    const body: string = [
      `Hi ${firstName},`,
      "",
      `You are a responder on a OneUptime on-call policy, but ${getSelfAddressedConsequence(
        user,
        delivery,
      )}`,
      "",
      `Add and verify a notification method here: ${methodsUrl}`,
      "",
      "I can set your notification rules up for you and add a method for you to confirm, but only you can verify the device or address it sends to.",
      "",
      "Thank you!",
    ].join("\n");

    return `mailto:${encodeURIComponent(
      user.userEmail || targetUser?.email?.toString() || "",
    )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return {
    isLoadingUser: isLoadingUser,
    userError: userError,
    value: {
      userId: userId,
      targetUser: targetUser,
      displayName: displayName,
      firstName: firstName,
      isSelf: isSelf,
      canRead: canRead,
      canEdit: canEdit,
      canManageMethods: canManageMethods,
      readinessSummary: readinessSummary,
      readiness: readiness,
      isLoadingReadiness: isLoadingReadiness,
      readinessError: readinessError,
      reloadReadiness: loadReadiness,
      delivery: delivery,
      fallbackState: fallbackState,
      methodChoices: methodChoices,
      getReminderHref: getReminderHref,
    },
  };
}

/**
 * The "you are looking at somebody else" banner, rendered once by the section
 * layout above whichever page is open.
 *
 * It is sticky because the pages under it are long. An administrator who
 * scrolls past a one-off strip at the top is, several screens later, looking at
 * a rules table that is indistinguishable from their own settings page — and
 * the whole risk of this section is somebody editing the wrong person's paging
 * configuration while believing it is theirs.
 *
 * The "and they are told" clause is a promise the SERVER keeps, not this
 * component: UserNotificationRuleService notifies the owner on every rule write
 * made by anybody else, and UserNotificationMethodAdminService does the same
 * for methods, both off the server-resolved actor rather than anything in the
 * request body. It is stated here because an admin should know before they
 * click, not after.
 */
export function OnBehalfOfBanner(props: {
  isSelf: boolean;
  canEdit: boolean;
  displayName: string;
  firstName: string;
}): ReactElement {
  if (props.isSelf) {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <Icon
          icon={IconProp.Info}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
        />
        <p className="text-sm leading-relaxed text-gray-700">
          This is your own on-call configuration. Changes here are the same as
          the ones you would make in User Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <Icon
          icon={IconProp.Alert}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
        />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {props.canEdit
              ? "You are editing on behalf of "
              : "You are viewing "}
            {props.displayName || "another user"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            {props.canEdit
              ? `This decides how ${props.firstName} is paged — not you. Every change is recorded in the audit log and ${props.firstName} is notified of it.`
              : `You can see ${props.firstName}'s configuration but not change it. Ask a project owner or admin for the "Edit User Notification Rules" permission.`}
          </p>
        </div>
      </div>
    </div>
  );
}

export default UserOnCallContext;

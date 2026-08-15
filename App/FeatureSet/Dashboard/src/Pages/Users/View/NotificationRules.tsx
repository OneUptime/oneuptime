import OnCallRulesTable, {
  NotificationMethodChoice,
  OnCallRuleSeverity,
  SeverityForeignKeyColumn,
} from "../../../Components/NotificationRule/OnCallRulesTable";
import CoverageMatrix, {
  CoverageModel,
  buildCoverageModel,
} from "../../../Components/OnCallPolicy/Readiness/CoverageMatrix";
import {
  READINESS_STATUS_READY,
  ReadinessCoverageCellWire,
  ReadinessDeliveryContext,
  ReadinessMethodWire,
  ReadinessStatusValue,
  ReadinessSummaryWire,
  UserReadinessWire,
  getCoverageGaps,
  getSelfAddressedConsequence,
  getStatusConsequence,
  getVerifiedMethods,
  parseReadinessSummary,
} from "../../../Components/OnCallPolicy/Readiness/ReadinessTypes";
import StatTile, {
  StatTileTone,
} from "../../../Components/OnCallPolicy/Readiness/StatTile";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import Exception from "Common/Types/Exception/Exception";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { APP_API_URL, DASHBOARD_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Users > View > Notification Rules — an administrator's view of somebody
 * else's on-call notification configuration.
 *
 * Phases 1 and 2 stopped pages being dropped and made the gaps visible. Both
 * were diagnostic: an admin could see that a responder was unreachable and had
 * no way to do anything about it, because notification rules were readable and
 * writable only by the person who owned them. Every warning the readiness
 * surfaces printed ended in "ask them to fix it". This page is where the fixing
 * happens.
 *
 * WHAT AN ADMIN MAY DO HERE, AND WHAT THEY MAY NOT.
 *
 * Rules: full CRUD. A rule says "page me on this method after this many
 * minutes"; repairing one is exactly the class of tedious configuration an
 * on-call lead should be able to do on behalf of a teammate who is asleep.
 *
 * Methods: READ-ONLY, and masked. Letting an admin add a phone number, webhook
 * or email address to somebody else's account would let them — or anyone who
 * takes over their session — point that person's pages at a device they
 * control, silently, because the ownership column decides whose pages select
 * the rule while the address actually messaged comes from the method the rule
 * points at. It would also not solve the problem it appears to solve: a
 * responder with no methods needs a device THEY hold and can verify. The
 * admin's lever for that case is a reminder, not a keyboard, which is why the
 * empty state below offers a prefilled message rather than a form.
 *
 * THIS PAGE NEVER READS A METHOD MODEL. Not "reads them and hides most of the
 * columns" — never reads them. UserEmail, UserSMS, UserCall, UserPush,
 * UserWhatsApp, UserTelegram and UserWebhook are scoped to the person who owns
 * the device, and that scope was briefly widened so an administrator could
 * populate the rule form's method dropdown. What it exposed was not the label
 * anybody wanted but the whole row behind it — the raw number, the webhook
 * bearer url, the push device token, the telegram chat id, the verification
 * code — and each attempt to fence off the columns failed for a different
 * reason. The scope is back where it was, so an administrator's every read of
 * those models is refused, and this page issues none.
 *
 * THAT SENTENCE HAS A SECOND HALF, and the first version of this page satisfied
 * only the first. "Reads a method model" is not just ModelAPI.getList over
 * UserSMS. A NESTED RELATION SELECT on the rule — `{ userSms: { phone: true } }`
 * — reaches the same column through UserNotificationRule, which an administrator
 * IS allowed to read and which is deliberately NOT row-scoped for them, and the
 * permission machinery permits it end to end: the nested key is authorised
 * against the rule's own `userSms` column, whose read list is
 * [Permission.CurrentUser] — auto-granted to every authenticated caller — and
 * then `canReadOnRelationQuery: true` on UserSMS.phone short-circuits that
 * model's own read list entirely. Three permissive steps, no single one of which
 * looks like a hole. The rules table below asked for exactly that select in
 * order to render its "Notification Method" cell, so this page masked every
 * identifier on the card above and printed them in full one card down.
 *
 * Everything it shows about methods therefore comes from ONE source, the
 * readiness payload, which is masked server-side by the only code that ever
 * holds the unmasked value. That includes the card below, the dropdown in the
 * rule form, AND the method cell on every listed rule: `methodChoices` hands
 * OnCallRulesTable a list of (masked label, method id) pairs, the table asks the
 * server only for the rule's foreign keys, and the two are matched in the
 * browser. A rule can be read, labelled and re-pointed without the method's row
 * ever being fetched.
 *
 * THE PAGE IS NOT THE GATE. POST and PATCH on /api/user-notification-rule stay
 * reachable with any project member's session, so every rule enforced here is
 * also enforced server-side (table and column access control on
 * UserNotificationRule, the ownership check in CreatePermission, and the
 * same-owner assertion on the method foreign keys). What this file does is
 * decline to draw controls the server would refuse and make the on-behalf-of
 * context impossible to miss — both convenience, neither a boundary.
 *
 * WHAT THE EDIT FORM DOES NOT YET OFFER, AND WHY. The model opens the seven
 * method foreign keys to update, so re-pointing somebody's rule at a different
 * one of THEIR OWN verified devices is a capability the API already has. The
 * form does not expose it, because the browser has no way to send it on the
 * update path: the method dropdown is an override field whose value travels in
 * `miscDataProps`, ModelForm applies those only through `onBeforeCreate`, and
 * BaseAPI.updateItem never reads `miscDataProps` at all. Drawing the dropdown
 * anyway would produce a control that accepts a choice, says "Saved" and leaves
 * the rule paging the old device. Making it real needs three changes outside
 * this feature — ModelForm calling a before-save hook on FormType.Update,
 * BaseAPI.updateItem forwarding `miscDataProps` into UpdateBy, and
 * UserNotificationRuleService applying the chosen method while clearing the
 * other six keys — after which the field's `doNotShowWhenEditing` in
 * OnCallRulesTable comes off. Until then the repair is remove-and-re-add.
 */

/*
 * The two admin permissions, each listed with the project-administration roles.
 *
 * Existing project teams are seeded with ROLES, never with individual granular
 * permissions, so a permission introduced in this release is held by nobody at
 * all until an administrator explicitly grants it. Checking the granular
 * permission alone would ship a feature that is dead on arrival for every
 * project that already exists — the owner of a project would open this page and
 * be told they may not look at it. The same triples appear on the model's table
 * access control, so what is drawn here and what the API will accept agree.
 */
const NOTIFICATION_RULE_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

const NOTIFICATION_RULE_EDIT_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectUserNotificationRule,
];

/*
 * Channel icons for the read-only methods list, keyed by the `methodType`
 * strings OnCallReadinessService puts on the wire. A method type this build has
 * never heard of falls back to a bell rather than rendering nothing, because a
 * row with no icon reads as a broken row rather than as a new channel.
 */
const CHANNEL_ICONS: Dictionary<IconProp> = {
  Email: IconProp.Email,
  SMS: IconProp.SMS,
  Call: IconProp.Call,
  Push: IconProp.Bell,
  WhatsApp: IconProp.WhatsApp,
  Telegram: IconProp.Telegram,
  Webhook: IconProp.Webhook,
};

const STATUS_LABELS: Record<ReadinessStatusValue, string> = {
  Ready: "Ready",
  PartiallyReady: "Needs setup",
  NotReachable: "Unreachable",
};

const STATUS_ICONS: Record<ReadinessStatusValue, IconProp> = {
  Ready: IconProp.CheckCircle,
  PartiallyReady: IconProp.Alert,
  NotReachable: IconProp.BellSlash,
};

const STATUS_TONES: Record<ReadinessStatusValue, StatTileTone> = {
  Ready: "positive",
  PartiallyReady: "warning",
  NotReachable: "critical",
};

/*
 * Namespaces this page's stored table preferences away from the self-serve
 * settings pages. Both surfaces render the same component against the same rule
 * types, and a shared prefix would make paging your own Sev1 table repaginate
 * the admin one you last had open for a colleague.
 */
const ADMIN_TABLE_PREFERENCES_PREFIX: string = "admin-user-notification-rules";

interface RuleTableDefinition {
  ruleType: NotificationRuleType;
  /*
   * Both axes are typed from OnCallRulesTable's own exports rather than
   * restated, so a change to the contract fails this file to compile instead of
   * silently rendering a table that filters on one column and writes another.
   */
  severityModelType: { new (): OnCallRuleSeverity };
  severityForeignKeyColumn: SeverityForeignKeyColumn;
  /** The noun the copy puts in front of "is assigned to them". */
  subject: string;
}

/*
 * The four severity-scoped rule types, with the two axes stated separately
 * exactly as OnCallRulesTable requires them. They do not line up the way the
 * names suggest — an alert episode is banded by AlertSeverity, an incident
 * episode by IncidentSeverity — so deriving one from the other silently
 * produces a table that lists every severity's rules at once.
 */
const RULE_TABLES: Array<RuleTableDefinition> = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityModelType: IncidentSeverity,
    severityForeignKeyColumn: "incidentSeverityId",
    subject: "incident",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    severityModelType: IncidentSeverity,
    severityForeignKeyColumn: "incidentSeverityId",
    subject: "incident episode",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    severityModelType: AlertSeverity,
    severityForeignKeyColumn: "alertSeverityId",
    subject: "alert",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    severityModelType: AlertSeverity,
    severityForeignKeyColumn: "alertSeverityId",
    subject: "alert episode",
  },
];

const getFirstName: (displayName: string) => string = (
  displayName: string,
): string => {
  const trimmed: string = displayName.trim();

  if (!trimmed) {
    return "this user";
  }

  return trimmed.split(" ")[0] || trimmed;
};

const UserViewNotificationRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Offset 1, not 0. This is a sub-page of Users > View, so the last segment of
   * the URL is "notification-rules" and the model id is the one before it. The
   * index page next door calls the same function with no argument and is
   * correct to; copying it here would read the literal string as a user id.
   */
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const signedInUserId: string = UserUtil.getUserId().toString();
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

  /*
   * Identity and readiness are loaded separately because they fail
   * differently. Without an identity this page must not render the rule tables
   * at all — "editing on behalf of somebody" with nobody named is precisely the
   * state an admin must never be in — whereas readiness is a computed opinion
   * that can be unavailable while the rules underneath remain perfectly
   * editable. Folding them into one state would let a readiness outage take
   * away the repair this page exists to offer.
   */
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
   * would answer for any id on the instance, and this page would happily name —
   * and offer to edit rules for — somebody who is not in the project at all.
   * The server makes the same check on every write; this one keeps the page
   * from ever showing a stranger's name.
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
   * disagreeing about what a status means, and this one would be the surface
   * somebody acts on.
   *
   * isFallbackEnabled is read from the project rather than defaulted, because
   * every sentence about a rule gap changes sign with it: with the fallback on
   * a gap is a page delivered on the wrong channel, with it off a gap is no
   * page at all. The per-user endpoint does not carry the flag, so it is
   * fetched alongside; a failure to read it fails the whole header rather than
   * letting the page guess, since the comforting guess is the wrong one.
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

  if (!canRead) {
    return (
      <ErrorMessage message="You do not have permission to view this user's on-call notification configuration. Ask a project owner or admin for the 'Read User Notification Rules' permission." />
    );
  }

  if (isLoadingUser) {
    return <PageLoader isVisible={true} />;
  }

  if (userError) {
    return <ErrorMessage message={userError} />;
  }

  const displayName: string =
    targetUser?.name?.toString() || targetUser?.email?.toString() || "";
  const firstName: string = getFirstName(displayName);
  const readiness: UserReadinessWire | undefined = readinessSummary?.users[0];
  const delivery: ReadinessDeliveryContext = {
    isFallbackEnabled: Boolean(readinessSummary?.isFallbackEnabled),
  };

  /*
   * Three states, not two, and the third one is why this is not just
   * `delivery.isFallbackEnabled`.
   *
   * What a missing rule COSTS is decided by a project setting: with the
   * fallback on it is a page delivered on some other verified channel, with it
   * off it is no page at all. The empty state under each rule table is read at
   * exactly the moment somebody decides whether a hole is worth filling, so
   * getting the sign wrong there is worse than saying nothing.
   *
   * `delivery` collapses a failed read into `false` because every sentence it
   * feeds is a warning, and understating delivery is the safe direction for a
   * warning. An empty state is not a warning - it is a description of what
   * happens next - so a failed read has to read as unknown rather than as "your
   * pages are dropped", which would be a specific and possibly false claim
   * about this project made because a request timed out.
   */
  const fallbackState: "on" | "off" | "unknown" = readinessSummary
    ? readinessSummary.isFallbackEnabled
      ? "on"
      : "off"
    : "unknown";

  const getNoRuleMessage: () => string = (): string => {
    const opening: string = isSelf
      ? "You have no rule here."
      : `${displayName || "This user"} has no rule here.`;
    const owner: string = isSelf ? "you" : "they";

    if (fallbackState === "off") {
      return `${opening} Add one - with no rule these pages are dropped rather than delivered on another channel, because this project has on-call notification fallback switched off.`;
    }

    if (fallbackState === "unknown") {
      return `${opening} Add one. Whether these pages fall back to another verified method depends on a project setting that could not be read just now.`;
    }

    return `${opening} Add one, or these pages fall back to whatever verified method ${owner} have.`;
  };

  /*
   * A prefilled draft in the admin's own mail client, deliberately narrower
   * than the one on the policy readiness card: from this page the admin can
   * already repair the rules themselves, so the only thing they genuinely need
   * the responder for is a METHOD — a device or address only that person can
   * add and verify. Saying exactly that is what keeps the reminder from reading
   * as "please do the work I could have done".
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
      "I can set your notification rules up for you, but only you can add the device or address they send to.",
      "",
      "Thank you!",
    ].join("\n");

    return `mailto:${encodeURIComponent(
      user.userEmail || targetUser?.email?.toString() || "",
    )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  /*
   * Everything the rule tables are allowed to say about a method, built out of
   * the readiness payload because there is nothing else this page may build it
   * from. It feeds the create form's dropdown AND the method cell on every rule
   * listed below — the cell being the one that is easy to forget, since it looks
   * like rendering rather than fetching.
   *
   * A method is offered only if readiness told us its `methodId`. That id is the
   * foreign key the form submits — userSmsId, userEmailId and so on — so a
   * method without one is a row we can describe but cannot point a rule at, and
   * offering it would produce a create with no method on it that the server
   * refuses. It is absent only when this bundle is talking to a server that
   * predates the field, which is a rollout window rather than a state to render
   * copy about: the methods card above still lists the method, so the admin is
   * not told it does not exist, they simply cannot select it for a moment.
   *
   * OnCallRulesTable ignores this entirely when the page is the viewer's OWN —
   * reading your own methods is allowed, and the unmasked labels are more useful
   * to you than a mask of your own phone number.
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

  const getReadinessHeader: () => ReactElement = (): ReactElement => {
    if (isLoadingReadiness && !readinessSummary) {
      return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index: number): ReactElement => {
            return (
              <div
                key={`tile-skeleton-${index}`}
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            );
          })}
        </div>
      );
    }

    if (readinessError) {
      return (
        <ErrorMessage
          message={readinessError}
          onRefreshClick={() => {
            loadReadiness(true).catch(() => {
              // loadReadiness routes every failure into the error state.
            });
          }}
        />
      );
    }

    if (!readiness) {
      return <></>;
    }

    const verifiedMethods: Array<ReadinessMethodWire> =
      getVerifiedMethods(readiness);
    const gaps: Array<ReadinessCoverageCellWire> = getCoverageGaps(readiness);
    const coveredCount: number = readiness.coverage.length - gaps.length;

    return (
      <div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={STATUS_ICONS[readiness.status]}
            label="Status"
            value={STATUS_LABELS[readiness.status]}
            tone={STATUS_TONES[readiness.status]}
          />
          <StatTile
            icon={IconProp.Bell}
            label={
              readiness.methods.length > verifiedMethods.length
                ? `Verified methods (${
                    readiness.methods.length - verifiedMethods.length
                  } unverified)`
                : "Verified methods"
            }
            value={`${verifiedMethods.length}`}
            tone={verifiedMethods.length > 0 ? "positive" : "critical"}
          />
          <StatTile
            icon={IconProp.TableCells}
            label="Rule coverage"
            value={
              readiness.coverage.length > 0
                ? `${coveredCount} of ${readiness.coverage.length}`
                : "Not reported"
            }
          />
          <StatTile
            icon={IconProp.Alert}
            label={gaps.length === 1 ? "Gap" : "Gaps"}
            value={`${gaps.length}`}
            tone={gaps.length > 0 ? "warning" : "neutral"}
          />
        </div>

        {/*
         * Stated once, above everything, because it changes what every gap
         * below means. A reader who knows the product assumes the fallback is
         * on - it is on by default and on almost everywhere - and reads an
         * amber cell as "late page" when in this project it is "no page".
         */}
        {readinessSummary?.isFallbackEnabled ? (
          <></>
        ) : (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
            />
            <p className="text-sm leading-relaxed text-amber-800">
              On-call notification fallback is switched off for this project, so
              a missing notification rule is not a late page — it is no page at
              all. Every gap below is dropped rather than delivered on another
              channel.
            </p>
          </div>
        )}

        <p className="mt-4 text-sm leading-relaxed text-gray-700">
          {getStatusConsequence(readiness, delivery, displayName)}
        </p>

        {readiness.reasons.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {readiness.reasons.map(
              (reason: string, index: number): ReactElement => {
                return (
                  <li
                    key={`reason-${index}`}
                    className="flex items-start gap-2 text-xs leading-relaxed text-gray-600"
                  >
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" />
                    {reason}
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getMethodsBody: () => ReactElement = (): ReactElement => {
    if (isLoadingReadiness && !readinessSummary) {
      return (
        <div className="space-y-2">
          {[0, 1].map((index: number): ReactElement => {
            return (
              <div
                key={`method-skeleton-${index}`}
                className="h-6 w-64 animate-pulse rounded bg-gray-100"
              />
            );
          })}
        </div>
      );
    }

    if (!readiness) {
      /*
       * The methods list is a projection of the readiness payload, so when that
       * is unavailable this section says nothing rather than claiming an empty
       * list. "No methods" is the single most alarming thing this page can
       * print about somebody, and printing it because a request failed would
       * send an admin chasing an account that is perfectly well configured.
       */
      return (
        <p className="text-sm text-gray-500">
          Notification methods could not be loaded, so this list is not shown.
          Nothing here implies {firstName} has none.
        </p>
      );
    }

    if (readiness.methods.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-red-200 bg-red-50/50 p-5">
          <p className="text-sm leading-relaxed text-gray-700">
            <span className="font-semibold text-gray-900">
              {displayName || "This user"}
            </span>{" "}
            has no notification methods at all, so every page routed to them is
            dropped no matter what the rules below say.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            Only {firstName} can add one. A notification method is a device or
            an address that has to be verified by the person who holds it, and
            letting an administrator type one in would point another
            person&apos;s pages at a phone they do not own. The fix here is a
            nudge with the link already in it.
          </p>
          <a
            href={getReminderHref(readiness)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            <Icon icon={IconProp.Email} className="h-3.5 w-3.5" />
            Email {firstName} the setup link
          </a>
        </div>
      );
    }

    return (
      <div>
        <ul className="space-y-2">
          {readiness.methods.map(
            (method: ReadinessMethodWire, index: number): ReactElement => {
              return (
                <li
                  key={`method-${index}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <Icon
                    icon={CHANNEL_ICONS[method.methodType] || IconProp.Bell}
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                  />
                  <span className="font-medium text-gray-900">
                    {method.methodType}
                  </span>
                  <span className="text-gray-500">
                    {method.maskedIdentifier}
                  </span>
                  {method.isVerified ? (
                    <span className="ml-auto inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      Verified
                    </span>
                  ) : (
                    <span className="ml-auto inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                      Unverified
                    </span>
                  )}
                </li>
              );
            },
          )}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs leading-relaxed text-gray-500">
            Identifiers are masked and cannot be edited from here — only{" "}
            {firstName} can add, verify or remove a notification method.
          </p>
          {readiness.status === READINESS_STATUS_READY ? (
            <></>
          ) : (
            <a
              href={getReminderHref(readiness)}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.Email} className="h-3.5 w-3.5" />
              Email {firstName} the setup link
            </a>
          )}
        </div>
      </div>
    );
  };

  const getCoverageBody: () => ReactElement = (): ReactElement => {
    if (isLoadingReadiness && !readinessSummary) {
      return (
        <div className="h-40 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
      );
    }

    if (!readiness) {
      /*
       * Deliberately not an empty grid. An unreported coverage matrix and a
       * matrix full of holes look identical once drawn, and only one of them is
       * a reason to go and add rules.
       */
      return (
        <p className="text-sm text-gray-500">
          Coverage could not be loaded, so the grid is not shown.{" "}
          {canEdit
            ? "The rules below are still editable."
            : "The rules below are still listed."}
        </p>
      );
    }

    const model: CoverageModel = buildCoverageModel(readiness.coverage);

    return <CoverageMatrix model={model} />;
  };

  /*
   * The banner. It is sticky because the four rule tables below are long: an
   * admin who scrolls past a one-off strip at the top is, four screens later,
   * looking at a rules table that is indistinguishable from their own settings
   * page — and the whole risk of this feature is somebody editing the wrong
   * person's paging configuration while believing it is theirs.
   *
   * The "and they are told" clause is a promise the server keeps, not this
   * page: UserNotificationRuleService notifies the owner on every write made by
   * anybody else, off the server-resolved actor rather than anything in the
   * request body. It is stated here because an admin should know before they
   * click, not after.
   */
  const getOnBehalfOfBanner: () => ReactElement = (): ReactElement => {
    if (isSelf) {
      return (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
          />
          <p className="text-sm leading-relaxed text-gray-700">
            These are your own notification rules. Changes here are the same as
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
              {canEdit ? "You are editing on behalf of " : "You are viewing "}
              {displayName || "another user"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              {canEdit
                ? `These rules decide how ${firstName} is paged — not you. Every change is recorded in the audit log and ${firstName} is notified of it.`
                : `You can see ${firstName}'s configuration but not change it. Ask a project owner or admin for the "Edit User Notification Rules" permission.`}
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      {getOnBehalfOfBanner()}

      <Card
        title="On-call readiness"
        description={
          isSelf
            ? "Whether a page routed to you would actually arrive right now."
            : `Whether a page routed to ${
                displayName || "this user"
              } would actually arrive right now.`
        }
        buttons={[
          {
            title: "Recheck",
            icon: IconProp.Reload,
            buttonStyle: ButtonStyleType.OUTLINE,
            buttonSize: ButtonSize.Small,
            disabled: isLoadingReadiness,
            onClick: () => {
              /*
               * Explicitly bypasses the readiness service's 60s cache. This is
               * the one interaction where the reader has just CHANGED the
               * answer - they fixed a rule in a table below - and a cached
               * summary redrawing them as still broken reads as "the fix did
               * not work".
               */
              loadReadiness(true).catch(() => {
                // loadReadiness routes every failure into the error state.
              });
            },
          },
        ]}
      >
        {getReadinessHeader()}
      </Card>

      <Card
        title="Notification methods"
        description={
          isSelf
            ? "The devices and addresses your rules can send to."
            : `The devices and addresses ${firstName}'s rules can send to. Read-only.`
        }
      >
        {getMethodsBody()}
      </Card>

      <Card
        title="Coverage"
        description={
          isSelf
            ? "A rule for every severity and rule type you can be paged for. A hole here is a page that does not arrive the way it was meant to."
            : `A rule for every severity and rule type ${firstName} can be paged for. A hole here is a page that does not arrive the way it was meant to.`
        }
      >
        {getCoverageBody()}
      </Card>

      {/*
       * The same component the self-serve settings pages render, pointed at
       * somebody else. `isEditable` decides whether the add, edit and remove
       * controls are drawn at all; it is a convenience over the server's own
       * check, not a substitute for it, so a member who reaches this page
       * without the edit permission simply sees the configuration rather than a
       * set of buttons that would be refused.
       *
       * `onBehalfOfName` is what carries the context INTO the modal. The banner
       * above is sticky, but a modal covers it, and the moment a modal is open
       * is precisely the moment an admin is about to rewrite how a colleague
       * gets paged. Passing the name only when this is not the viewer's own
       * page keeps the self-serve copy in the first person, where it belongs.
       *
       * `notificationMethods` is what stops this table doing what the four
       * self-serve pages do — listing the seven method models to fill its
       * dropdown, and selecting the seven method RELATIONS to fill its method
       * cell. The first is refused for anybody but the owner; the second is not
       * refused at all, which is why it had to be closed here rather than left
       * to the server. The masked choices assembled above replace both.
       */}
      {RULE_TABLES.map((definition: RuleTableDefinition): ReactElement => {
        return (
          <OnCallRulesTable
            key={`rules-${definition.ruleType}`}
            severityModelType={definition.severityModelType}
            severityForeignKeyColumn={definition.severityForeignKeyColumn}
            ruleType={definition.ruleType}
            userId={userId}
            notificationMethods={methodChoices}
            isEditable={canEdit}
            onBehalfOfName={isSelf ? undefined : displayName || undefined}
            userPreferencesKeyPrefix={ADMIN_TABLE_PREFERENCES_PREFIX}
            getTitle={(severityName: string): string => {
              return isSelf
                ? `${severityName} Severity: when I am on call and a ${severityName} ${definition.subject} is assigned to me...`
                : `${severityName} Severity: when ${firstName} is on call and a ${severityName} ${definition.subject} is assigned to them...`;
            }}
            getDescription={(severityName: string): string => {
              return isSelf
                ? `How you are notified when a ${severityName} ${definition.subject} is assigned to you.`
                : `How ${firstName} is notified when a ${severityName} ${definition.subject} is assigned to them.`;
            }}
            noItemsMessage={getNoRuleMessage()}
          />
        );
      })}
    </Fragment>
  );
};

export default UserViewNotificationRules;

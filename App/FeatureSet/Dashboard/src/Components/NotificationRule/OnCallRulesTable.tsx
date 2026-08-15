import NotificationMethodView, {
  DeletionImpactModal,
} from "../NotificationMethods/NotificationMethod";
import NotifyAfterDropdownOptions from "./NotifyAfterMinutesDropdownOptions";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import UserTelegram from "Common/Models/DatabaseModels/UserTelegram";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "Common/Models/DatabaseModels/UserWhatsApp";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import {
  ErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import SelectEntityField from "Common/UI/Types/SelectEntityField";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * One severity band on a project. Incidents and alerts each have their own
 * severity model, and this component has to work with either, so the union is
 * the widest thing it ever needs: both classes carry `name`, both carry `id`,
 * and nothing else here is read off them.
 */
export type OnCallRuleSeverity = IncidentSeverity | AlertSeverity;

/*
 * The column on UserNotificationRule that ties a rule to its severity band.
 *
 * This is the SECOND axis, and it is deliberately independent of the severity
 * model above rather than derived from it. The four rule types do not line up
 * the way the names suggest: the alert *episode* page reads AlertSeverity, the
 * incident *episode* page reads IncidentSeverity, so "is this an episode?" tells
 * you nothing about which column to write. Deriving one axis from the other is
 * how you end up writing `alertSeverityId` on a table that filters on
 * `incidentSeverityId` - which does not error, it just returns a table that
 * silently lists rules for EVERY severity, and pages the user for a Sev 4 the
 * same way it pages them for a Sev 1.
 */
export type SeverityForeignKeyColumn = "incidentSeverityId" | "alertSeverityId";

/*
 * One pickable notification method, described WITHOUT its underlying row.
 *
 * This is the whole of what the create form needs in order to point a rule at a
 * method: something to render, and the foreign key to submit. It deliberately
 * carries no address, no phone number, no webhook url and no device token —
 * `maskedIdentifier` is already masked by the only code that can mask it
 * (OnCallReadinessService), and nothing here can un-mask it.
 *
 * ReadinessMethodWire satisfies this shape apart from `methodId` being optional
 * there, which is the one difference worth having: a caller has to state that it
 * HAS an id before it can hand a method over, so a method the server could not
 * address is dropped at the call site rather than becoming a dropdown entry that
 * submits nothing and is refused.
 */
export interface NotificationMethodChoice {
  /* One of the seven channel names: Email, SMS, Call, Push, WhatsApp, Telegram, Webhook. */
  methodType: string;
  /* The method row's own id — UserSMS._id and so on — as a plain uuid string. */
  methodId: string;
  /* Already masked. "+1 ••• ••• 4821", never the number. */
  maskedIdentifier: string;
  isVerified: boolean;
}

/*
 * Which foreign key on UserNotificationRule each channel corresponds to.
 *
 * The seven columns are mutually exclusive - a rule points at exactly one method
 * - and on the self-serve path NotificationMethodUtil derives the column from
 * the MODEL CLASS of the chosen row. That is not available here: the supplied
 * path never loads a row, it is handed a channel name and an id, so the mapping
 * from the one vocabulary to the other has to be written down. A channel this
 * build does not know is absent from the table rather than defaulted, so it is
 * dropped from the dropdown instead of becoming a rule with no method on it.
 *
 * It is ONE table read in both directions rather than two, because the supplied
 * path needs both: submitting a choice goes methodType -> column, and rendering
 * the method cell goes column -> methodType to find the masked label again. Two
 * tables would let the write and the read drift apart on a channel, and the
 * symptom of that drift is a cell that reads "Email" above a rule which in fact
 * pages a phone - a wrong answer to the exact question this page is opened to
 * settle.
 */
type MethodForeignKeyColumn =
  | "userEmailId"
  | "userSmsId"
  | "userCallId"
  | "userPushId"
  | "userWhatsAppId"
  | "userTelegramId"
  | "userWebhookId";

interface MethodChannel {
  /* One of the seven channel names OnCallReadinessService puts on the wire. */
  methodType: string;
  foreignKeyColumn: MethodForeignKeyColumn;
}

const METHOD_CHANNELS: Array<MethodChannel> = [
  { methodType: "Email", foreignKeyColumn: "userEmailId" },
  { methodType: "SMS", foreignKeyColumn: "userSmsId" },
  { methodType: "Call", foreignKeyColumn: "userCallId" },
  { methodType: "Push", foreignKeyColumn: "userPushId" },
  { methodType: "WhatsApp", foreignKeyColumn: "userWhatsAppId" },
  { methodType: "Telegram", foreignKeyColumn: "userTelegramId" },
  { methodType: "Webhook", foreignKeyColumn: "userWebhookId" },
];

type GetForeignKeyColumn = (
  methodType: string,
) => MethodForeignKeyColumn | undefined;

const getForeignKeyColumn: GetForeignKeyColumn = (
  methodType: string,
): MethodForeignKeyColumn | undefined => {
  return METHOD_CHANNELS.find((channel: MethodChannel): boolean => {
    return channel.methodType === methodType;
  })?.foreignKeyColumn;
};

/*
 * Whether a supplied method may be picked at all.
 *
 * Three ways to say no, and each mirrors something the self-serve path gets from
 * its queries rather than from code. Unverified methods are refused because six
 * of the seven model reads below filter `isVerified: true` (webhooks have no
 * verification concept and readiness reports them verified, which is the same
 * asymmetry). A method with no id cannot be addressed. An unknown channel has no
 * column to be written to. Any of the three, allowed through, produces a create
 * the server refuses - or worse, a rule with no method that looks saved.
 *
 * It is one predicate rather than two so the list OFFERED and the list ACCEPTED
 * cannot drift apart: a value that is not in the dropdown must not become a rule
 * just because something submitted it.
 *
 * DISPLAY does not use this predicate, and must not. A rule that already points
 * at a since-unverified method is exactly the misconfiguration this page exists
 * to show, so its cell has to name the method even though the dropdown refuses
 * to offer it again.
 */
type IsSelectableMethod = (method: NotificationMethodChoice) => boolean;

const isSelectableMethod: IsSelectableMethod = (
  method: NotificationMethodChoice,
): boolean => {
  return Boolean(
    method.isVerified &&
      method.methodId &&
      getForeignKeyColumn(method.methodType),
  );
};

/* The supplied methods as dropdown entries, in the order they were given. */
type GetSuppliedDropdownOptions = (
  methods: Array<NotificationMethodChoice>,
) => Array<DropdownOption>;

const getSuppliedDropdownOptions: GetSuppliedDropdownOptions = (
  methods: Array<NotificationMethodChoice>,
): Array<DropdownOption> => {
  const options: Array<DropdownOption> = [];

  for (const method of methods) {
    if (!isSelectableMethod(method)) {
      continue;
    }

    /*
     * The same `Channel: identifier` shape NotificationMethodUtil.getLabel
     * produces, so the two paths read identically - the only difference a
     * viewer can see is that this one is masked.
     */
    options.push({
      label: method.maskedIdentifier
        ? `${method.methodType}: ${method.maskedIdentifier}`
        : method.methodType,
      value: method.methodId,
    });
  }

  return options;
};

/*
 * The method projection for a table that is about SOMEBODY ELSE: the seven
 * foreign keys, and not one column of the seven models behind them.
 *
 * THIS IS A SECOND DOOR INTO THE SAME ROOM, and it is not the one anybody
 * watches. The obvious exposure is a direct read of UserEmail or UserSMS, which
 * `loadOwnNotificationMethods` below is careful never to issue for another user.
 * But a nested relation select on the RULE - `{ userEmail: { email: true } }`,
 * which is exactly what NotificationMethodUtil.getSelectForNotificationMethods
 * returns - reaches the same columns through a table an administrator IS allowed
 * to read, and it is not refused:
 *
 *   - SelectPermission checks the nested key against UserNotificationRule's own
 *     `userEmail` column, whose read list is [Permission.CurrentUser] - and
 *     CurrentUser is auto-granted to EVERY authenticated caller, so it passes.
 *   - QueryPermission.checkRelationQueryPermission then sees
 *     `canReadOnRelationQuery: true` on UserEmail.email and returns early
 *     WITHOUT consulting that model's own read list at all.
 *   - A read of UserNotificationRule is deliberately not row-scoped for an
 *     administrator, which is the entire point of the admin surface.
 *
 * Three permissive steps compose into "an admin may read any member's raw email
 * address and phone number", one card below a readiness panel that took care to
 * mask both. So the supplied path asks only for the ids, which ARE admin
 * readable and carry nothing, and gets its labels from the masked payload.
 */
type GetSuppliedMethodSelect = () => Select<UserNotificationRule>;

const getSuppliedMethodSelect: GetSuppliedMethodSelect =
  (): Select<UserNotificationRule> => {
    const select: Record<string, boolean> = {};

    for (const channel of METHOD_CHANNELS) {
      select[channel.foreignKeyColumn] = true;
    }

    return select as Select<UserNotificationRule>;
  };

/*
 * A rule that names a method we cannot label.
 *
 * The supplied path can only name what readiness told it about, so a rule whose
 * method was deleted, or whose id readiness did not carry, or every rule at all
 * when readiness is simply down, arrives here. Rendering nothing is the one
 * option that is actually wrong: a blank method cell is what an OPT-OUT row
 * looks like, and the two mean opposite things - "deliberately never page me
 * here" against "paged on a device this screen cannot name". An admin who reads
 * the second as the first deletes a working rule.
 */
const UNRESOLVED_METHOD_LABEL: string =
  "A notification method is set - its identifier is not shown here";

/*
 * The method cell for a table that is about somebody else, resolved from ids.
 *
 * Exactly one of the seven foreign keys is set on a rule, so the first one found
 * is the answer. The id is matched against the masked list REGARDLESS of
 * verification - see `isSelectableMethod` - because a rule pointing at a method
 * that has since become unverified is a real state, and the whole reason an
 * administrator is looking.
 */
type GetSuppliedMethodLabel = (
  methods: Array<NotificationMethodChoice>,
  rule: UserNotificationRule,
) => string;

const getSuppliedMethodLabel: GetSuppliedMethodLabel = (
  methods: Array<NotificationMethodChoice>,
  rule: UserNotificationRule,
): string => {
  for (const channel of METHOD_CHANNELS) {
    const rawValue: unknown = (rule as unknown as Record<string, unknown>)[
      channel.foreignKeyColumn
    ];

    if (!rawValue) {
      continue;
    }

    /*
     * ObjectID's constructor already understands all three shapes this value
     * arrives in - a hydrated ObjectID, a bare uuid string, and the
     * `{ _type, value }` JSON an un-hydrated row carries - so the comparison
     * below is between two plain strings whatever the table handed over.
     */
    const methodId: string = new ObjectID(rawValue as string).toString();

    if (!methodId) {
      continue;
    }

    const method: NotificationMethodChoice | undefined = methods.find(
      (candidate: NotificationMethodChoice): boolean => {
        return candidate.methodId === methodId;
      },
    );

    if (method && method.maskedIdentifier) {
      return `${method.methodType}: ${method.maskedIdentifier}`;
    }

    /*
     * Matched, but readiness carried no masked identifier for it. The CHANNEL is
     * still known - from the column the id was found in, not from the payload -
     * and naming it carries no identifier at all: "Telegram" says which kind of
     * device is meant to ring without saying which account it is.
     */
    if (method) {
      return channel.methodType;
    }

    return UNRESOLVED_METHOD_LABEL;
  }

  return "";
};

export interface ComponentProps {
  /* Which severity model to enumerate: one table is rendered per row. */
  severityModelType: { new (): OnCallRuleSeverity };

  /* Which UserNotificationRule column the severity id is read from/written to. */
  severityForeignKeyColumn: SeverityForeignKeyColumn;

  /* The rule type every table on this page filters on and creates with. */
  ruleType: NotificationRuleType;

  /*
   * Namespace for the per-table stored preferences. The component appends the
   * rule type and the severity id to this, which is what keeps the rendered
   * tables from clobbering each other; the caller only has to make the PREFIX
   * unique across the surfaces that can be mounted on one route (self-serve
   * settings vs. an admin viewing somebody else's rules).
   */
  userPreferencesKeyPrefix: string;

  /* Card heading and blurb, given the severity's name. */
  getTitle: (severityName: string) => string;
  getDescription: (severityName: string) => string;

  /*
   * Whose rules and whose notification methods these are. Defaults to the
   * signed-in user, which is every self-serve settings page. The admin surface
   * passes somebody else's id.
   */
  userId?: ObjectID | undefined;

  /*
   * The methods this table may name, for a table that is about SOMEBODY ELSE.
   * Required in that case; ignored when the table is about the signed-in user,
   * who is served by the reads in `init` below.
   *
   * It feeds BOTH surfaces that speak about a method: the "Notification Method"
   * dropdown on the create form, and the "Notification Method" cell on every
   * listed rule. The cell is the one that is easy to forget, because it does not
   * look like it fetches anything - and it is the one that leaked.
   *
   * WHY THE TWO PATHS DIFFER, since the asymmetry looks arbitrary until you know
   * what is on the other side of it.
   *
   * A notification method row is not just an addressable id. UserEmail holds the
   * address, UserSMS/UserCall/UserWhatsApp the phone number, UserTelegram the
   * chat id, UserPush the device token, UserWebhook the url — which for a
   * Slack/Discord/Teams hook is a bearer credential — and most of them a
   * verification code. All seven models are therefore scoped to their owner:
   * only the person who holds the device may read the row. That scope was
   * widened once, so that an administrator could populate this dropdown for a
   * colleague, and every attempt to contain what it exposed failed - a
   * column-level guard cannot see nested relation selects, cannot see `query`,
   * and cannot see columns injected after it has run. The scope is back, and
   * with it the exposure is not "guarded" but impossible.
   *
   * So the administrator's view of a method is built from something that was
   * masked server-side by the one component that can mask it: the readiness
   * payload the admin surface already fetches, which carries `methodId`
   * alongside a masked identifier for exactly this. The admin picks
   * "SMS: +1 ••• ••• 4821", the form submits `userSmsId`, and the number itself
   * never reaches the browser. The listed rules are labelled the same way, by
   * matching each rule's foreign key back onto that same masked list.
   *
   * Note that "read a method model" covers more than ModelAPI.getList over the
   * seven models. A nested relation select on the RULE reaches the same columns
   * through a table an administrator may read, and is not refused - the essay on
   * `getSuppliedMethodSelect` sets out the three permissive steps that compose
   * into that. Both doors are shut by the same `isViewerTheOwner` switch.
   *
   * The self-serve path is left exactly as it was because it is not the same
   * question: those four settings pages are a person reading their own rows, the
   * unmasked labels are theirs, and readiness is not fetched there at all.
   */
  notificationMethods?: Array<NotificationMethodChoice> | undefined;

  /*
   * Whether the viewer may change these rules: it drives create, delete AND the
   * row editor together, because all three are the same question ("may this
   * person rewrite how somebody gets paged?") and the server answers it the
   * same way for all three.
   *
   * It is a convenience, never a gate: POST, PUT and DELETE on
   * /api/user-notification-rule stay reachable with any member session, so the
   * server-side permission check is the real boundary and this only decides
   * whether we draw buttons the viewer would be refused for anyway.
   */
  isEditable?: boolean | undefined;

  /*
   * The display name of the person these rules belong to, passed ONLY when that
   * is somebody other than the viewer.
   *
   * It exists because every word in this component was written in the first
   * person for the self-serve settings pages - "Notify me after", "How do you
   * want to be notified?" - and an administrator repairing a colleague's paging
   * reads all of it as being about themselves. The page-level "you are editing
   * on behalf of Jane" banner does not help at the one moment that matters:
   * it is behind the modal, so the context disappears exactly when the write is
   * about to happen. Naming the person inside the modal - in its title, in its
   * field labels and on the button that opened it - is the only placement the
   * reader cannot scroll away from.
   */
  onBehalfOfName?: string | undefined;

  noItemsMessage?: string | undefined;
}

const DEFAULT_NO_ITEMS_MESSAGE: string =
  "No notification rules found for this user. Please add one to receive notifications.";

/*
 * What an opt-out row is, said in the one cell where its absence of a method
 * would otherwise be indistinguishable from a broken row.
 *
 * An opt-out rule carries a rule type and a severity and no notification method
 * at all - the absence is the point, it is how "deliberately do not page me
 * here" is written down. Rendered through the method cell, that absence became
 * an empty cell and nothing else, and a reader looking at a blank in a table
 * full of "Email: j@example.com" concludes the row is corrupt and deletes it -
 * which silently re-enables paging the owner had asked to stop.
 */
const OPT_OUT_LABEL: string = "Muted - notifications turned off for this rule";

/*
 * The on-call notification rules table, one per severity band.
 *
 * This was four ~370-line pages (incident, alert, incident episode, alert
 * episode) that were ~95% identical and had already drifted apart: two of them
 * still carried a commented-out block for rule types the other two had dropped.
 * Every one of them fetched the same seven notification-method models the same
 * way, built the same dropdown, and rendered the same two columns. Phase 3 needs
 * a fifth caller - an admin looking at somebody else's configuration - and a
 * fifth copy was not a thing worth having.
 */
const OnCallRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [severities, setSeverities] = useState<Array<OnCallRuleSeverity>>([]);
  const [userEmails, setUserEmails] = useState<Array<UserEmail>>([]);
  const [userSMSs, setUserSMSs] = useState<Array<UserSMS>>([]);
  const [userWhatsApps, setUserWhatsApps] = useState<Array<UserWhatsApp>>([]);
  const [userTelegrams, setUserTelegrams] = useState<Array<UserTelegram>>([]);
  const [userWebhooks, setUserWebhooks] = useState<Array<UserWebhook>>([]);
  const [userCalls, setUserCalls] = useState<Array<UserCall>>([]);
  const [userPush, setUserPush] = useState<Array<UserPush>>([]);

  const isEditable: boolean = props.isEditable ?? true;

  /*
   * Resolved once per render rather than at each call site, so that "which user
   * is this page about?" has exactly one answer and the rule query, the method
   * lookups and the created row can never disagree about it.
   */
  const targetUserId: ObjectID | null = props.userId || User.getUserId();

  /*
   * The single condition that decides where the method dropdown comes from, and
   * it governs BOTH the fetch and the source so the two can never disagree.
   *
   * "The rules on screen belong to the person looking at them" is exactly the
   * predicate the seven method models enforce server-side, so this is not a
   * guess about permissions - it is the same fact, asked in advance. When it
   * holds, the reads below are a person reading their own rows and are answered.
   * When it does not, they are refused, so they are not issued at all and the
   * dropdown is whatever the caller handed over.
   *
   * Deriving it from the resolved target rather than from the presence of the
   * prop matters on the admin page: readiness is fetched asynchronously and can
   * fail outright, so `notificationMethods` is legitimately absent on the first
   * render and possibly forever. Falling back to "then fetch them yourself"
   * would fire seven requests that 4xx, and this component turns a failed fetch
   * into a full-card error - taking away the rule repair the admin page exists
   * to offer, because a DIFFERENT read failed.
   */
  const isViewerTheOwner: boolean =
    !props.userId || props.userId.toString() === User.getUserId()?.toString();

  const notificationMethodsDropdownOptions: Array<DropdownOption> =
    isViewerTheOwner
      ? NotificationMethodUtil.getDropdownOptions({
          userCalls: userCalls,
          userEmails: userEmails,
          userSMSs: userSMSs,
          userPush: userPush,
          userWhatsApps: userWhatsApps,
          userTelegrams: userTelegrams,
          userWebhooks: userWebhooks,
        })
      : getSuppliedDropdownOptions(props.notificationMethods || []);

  /*
   * Maps the id the dropdown submitted back onto one of the rule's seven method
   * foreign keys, by whichever route built that dropdown.
   *
   * Both branches fail the same way on an id that matches nothing: the rule is
   * left with no method at all and the server refuses the create. That is the
   * right failure - the alternative is guessing which column an unrecognised id
   * belongs in, and a rule pointed at the wrong method pages the wrong device
   * without ever erroring.
   */
  type ApplySelectedMethod = (
    rule: UserNotificationRule,
    selectedValue: unknown,
  ) => void;

  const applySelectedMethod: ApplySelectedMethod = (
    rule: UserNotificationRule,
    selectedValue: unknown,
  ): void => {
    if (isViewerTheOwner) {
      NotificationMethodUtil.setSelectedMethodOnRule(rule, selectedValue, {
        userCalls: userCalls,
        userEmails: userEmails,
        userSMSs: userSMSs,
        userPush: userPush,
        userWhatsApps: userWhatsApps,
        userTelegrams: userTelegrams,
        userWebhooks: userWebhooks,
      });

      return;
    }

    if (!selectedValue) {
      return;
    }

    const selectedId: string = selectedValue.toString();

    const selectedMethod: NotificationMethodChoice | undefined = (
      props.notificationMethods || []
    ).find((method: NotificationMethodChoice): boolean => {
      return method.methodId === selectedId && isSelectableMethod(method);
    });

    if (!selectedMethod) {
      return;
    }

    const foreignKeyColumn: MethodForeignKeyColumn | undefined =
      getForeignKeyColumn(selectedMethod.methodType);

    if (!foreignKeyColumn) {
      return;
    }

    /*
     * All seven keys are `ObjectID | undefined`, so writing through the union of
     * their names is the same assignment the seven hand-written setters made -
     * with the column name coming from the one table the read side also uses.
     */
    rule[foreignKeyColumn] = new ObjectID(selectedId);
  };

  /*
   * The modal's own on-behalf-of context, and the only copy in this component
   * that changes with who is looking.
   *
   * `singularName` is what ModelTable puts in the create button, the modal
   * title, the delete confirmation and the bulk labels, so setting it once
   * carries the name to every one of those without a prop per surface. On the
   * self-serve pages it stays undefined and the model's own "Notification Rule"
   * is used, which keeps those four pages byte-identical to what shipped.
   */
  const ruleSingularName: string | undefined = props.onBehalfOfName
    ? `Notification Rule for ${props.onBehalfOfName}`
    : undefined;

  const notifyAfterFieldTitle: string = props.onBehalfOfName
    ? `Notify ${props.onBehalfOfName} after`
    : "Notify me after";

  const notificationMethodFieldDescription: string = props.onBehalfOfName
    ? `How should ${props.onBehalfOfName} be notified?`
    : "How do you want to be notified?";

  /*
   * ==========================================================================
   * DELETE GUARD
   * ==========================================================================
   *
   * Deleting a notification rule is the delete that quietly removes coverage. A
   * row here reads "Email: jane@example.com / after 5 minutes" and says nothing
   * about whether it is the LAST rule standing for this severity - and the
   * stock ModelTable confirmation cannot say either, because its description is
   * a fixed string ("Are you sure you want to delete this...?") with nowhere to
   * put a number.
   *
   * So the table's built-in delete is turned off (`isDeleteable={false}`) and
   * the Delete action is supplied here instead, opening DeletionImpactModal -
   * the same confirmation the notification method tables use, so somebody
   * tidying their settings meets one account of what a delete costs rather than
   * two that disagree. The modal counts across ALL of this user's rules in the
   * project rather than the table the row happens to sit in, which is why one
   * copy of it here serves every severity band on the page.
   *
   * IT DOES NOT BLOCK. Deleting your own notification rule is your call. The
   * only thing being changed is that you make it knowing whether anything is
   * still going to page you for that severity, and whether anyone is relying on
   * you answering.
   *
   * THIS LIVES HERE, IN THE SHARED COMPONENT, and not on the four settings
   * pages it shipped on. Those pages are now four calls into this file, so a
   * guard left behind in them would be a guard nothing runs - four Delete
   * buttons back on the generic "are you sure", with the counts silently gone.
   */
  const [ruleToDelete, setRuleToDelete] = useState<UserNotificationRule | null>(
    null,
  );
  const [isDeletingRule, setIsDeletingRule] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  /*
   * Whether a delete on this table goes through the impact modal at all, and
   * the one place the answer is "only for the person whose rules these are".
   *
   * The modal is not a rendering of numbers this component already holds: it
   * loads them, and the load is `useNotificationRuleImpactData` ->
   * `getSelectForRuleImpact()`, which is the shared method select with `_id`
   * added to every relation - `{ userEmail: { email: true, _id: true } }` and
   * the six others. That is precisely the nested relation select the essay on
   * `getSuppliedMethodSelect` above is about: it is NOT refused for an
   * administrator, and mounting it here for somebody else's rules would hand
   * that administrator the raw email addresses and phone numbers this component
   * goes to some trouble never to fetch - through the delete confirmation,
   * which does not look like a read at all.
   *
   * So for a table about somebody else the built-in delete stays, with its
   * generic confirmation. That is a weaker warning, and it is the same warning
   * that surface has always had; it is not a Phase 4 regression, because the
   * impact modal never covered an admin editing a colleague's rules. Giving it
   * the counts too means teaching the loader to fetch coverage WITHOUT the
   * method identifiers - the rule-deletion copy needs only rule type, severity
   * and isOptOut, never a method label - which is a change to
   * NotificationMethod.tsx rather than a prop that can be passed from here.
   */
  const isDeleteGuarded: boolean = isViewerTheOwner;

  /*
   * The same gate BaseModelTable puts on its own delete action, and `isEditable`
   * on top of it. Replacing that action with one of ours would otherwise hand a
   * Delete button to a read-only member, who would then meet the refusal only
   * after confirming it.
   */
  const canDeleteRules: boolean =
    isEditable &&
    Boolean(
      new UserNotificationRule().hasDeletePermissions(
        PermissionUtil.getAllPermissions(),
      ) || User.isMasterAdmin(),
    );

  type DeleteRuleFunction = (rule: UserNotificationRule) => Promise<void>;

  const deleteRule: DeleteRuleFunction = async (
    rule: UserNotificationRule,
  ): Promise<void> => {
    if (!rule.id) {
      return;
    }

    setIsDeletingRule(true);

    try {
      await ModelAPI.deleteItem<UserNotificationRule>({
        modelType: UserNotificationRule,
        id: rule.id,
      });

      /*
       * Every table on the page is refetched rather than only the one the row
       * sat in. A rule belongs to exactly one of them, but one shared toggle is
       * cheaper than threading a per-severity one and cannot leave a deleted
       * row on screen.
       */
      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    }

    setRuleToDelete(null);
    setIsDeletingRule(false);
  };

  /*
   * The Delete action that stands in for the built-in one, and nothing at all
   * when this table is not the guarded path or the viewer may not delete.
   */
  const deleteActionButtons: Array<ActionButtonSchema<UserNotificationRule>> =
    isDeleteGuarded && canDeleteRules
      ? [
          {
            title: "Delete",
            icon: IconProp.Trash,
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            onClick: (
              item: UserNotificationRule,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): void => {
              try {
                setDeleteError("");
                setRuleToDelete(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]
      : [];

  /*
   * What the table asks the server for in order to render the method cell, and
   * the second place `isViewerTheOwner` decides between reading the methods and
   * being handed them.
   *
   * Resolved ONCE and used for both `selectMoreFields` and the method column's
   * `field`, because ModelTable unions the two into the projection it sends: a
   * fix applied to only one of them still puts the relation on the wire, and the
   * one that is easy to overlook is the column, which does not look like a
   * request at all. See `getSuppliedMethodSelect` for why the nested relation
   * select is not merely redundant here but is itself the exposure.
   */
  const methodProjection: Select<UserNotificationRule> = isViewerTheOwner
    ? NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>()
    : getSuppliedMethodSelect();

  /*
   * The two places the severity foreign key is used - reading the rules back and
   * stamping a new one - are both funnelled through these, so the column name
   * is spelled out once per direction. A mismatch between the filter and the
   * write is invisible at runtime: the table would just list every severity's
   * rules while creating rules nobody's table shows.
   */
  type GetSeverityFilter = (
    severityId: ObjectID | undefined,
  ) => Query<UserNotificationRule>;

  const getSeverityFilter: GetSeverityFilter = (
    severityId: ObjectID | undefined,
  ): Query<UserNotificationRule> => {
    if (props.severityForeignKeyColumn === "incidentSeverityId") {
      return { incidentSeverityId: severityId };
    }

    return { alertSeverityId: severityId };
  };

  type SetSeverityOnRule = (
    rule: UserNotificationRule,
    severityId: ObjectID,
  ) => void;

  const setSeverityOnRule: SetSeverityOnRule = (
    rule: UserNotificationRule,
    severityId: ObjectID,
  ): void => {
    if (props.severityForeignKeyColumn === "incidentSeverityId") {
      rule.incidentSeverityId = severityId;
      return;
    }

    rule.alertSeverityId = severityId;
  };

  type GetTableFunction = (severity: OnCallRuleSeverity) => ReactElement;

  const getModelTable: GetTableFunction = (
    severity: OnCallRuleSeverity,
  ): ReactElement => {
    const severityName: string = severity.name || "";

    const ruleQuery: Query<UserNotificationRule> = {
      projectId: ProjectUtil.getCurrentProjectId()!,
      userId: targetUserId!,
      ruleType: props.ruleType,
      ...getSeverityFilter(severity.id || undefined),
    };

    return (
      <ModelTable<UserNotificationRule>
        modelType={UserNotificationRule}
        /*
         * One of these tables is rendered per severity, so the severity has to
         * be part of the key: it namespaces both the stored page-size
         * preference and this table's slice of the URL state. Without it every
         * table on the page would share one namespace and paging one would
         * repaginate the rest.
         */
        userPreferencesKey={`${props.userPreferencesKeyPrefix}-${props.ruleType}${
          severity.id ? `-${severity.id.toString()}` : ""
        }`}
        query={ruleQuery}
        onBeforeCreate={(
          model: UserNotificationRule,
          miscDataProps: JSONObject,
        ): Promise<UserNotificationRule> => {
          model.projectId = ProjectUtil.getCurrentProjectId()!;

          /*
           * The owner is stamped from the same resolved id the table filters
           * on, so a rule can never be created into a table that would not
           * then show it. The server re-derives ownership regardless - this is
           * the form's half of that, not the enforcement.
           */
          if (targetUserId) {
            model.userId = targetUserId;
          }

          model.ruleType = props.ruleType;

          if (severity.id) {
            setSeverityOnRule(model, severity.id);
          }

          applySelectedMethod(model, miscDataProps["notificationMethod"]);

          return Promise.resolve(model);
        }}
        sortOrder={SortOrder.Ascending}
        sortBy="notifyAfterMinutes"
        createVerb={"Add"}
        id="notification-rules"
        name={`User Settings > Notification Rules > ${
          severityName || props.ruleType
        }`}
        singularName={ruleSingularName}
        refreshToggle={refreshToggle}
        /*
         * Off wherever the impact modal is the delete, and replaced by the
         * action button below. See the DELETE GUARD note above: the built-in
         * confirmation takes a fixed description and so cannot say what this
         * particular delete costs, and `isDeleteable={true}` next to an impact
         * modal nobody opens is exactly the failure this replaces.
         */
        isDeleteable={isDeleteGuarded ? false : isEditable}
        actionButtons={deleteActionButtons}
        /*
         * The row editor, on at last.
         *
         * This was hardcoded false, which made the whole edit capability inert:
         * no PATCH was ever issued from this table, so opening
         * `notifyAfterMinutes` to update on the model bought nothing a user
         * could reach. The delay is the single most common repair on this
         * screen - "you are first in the escalation policy but your first rule
         * waits thirty minutes" - and doing it by deleting the rule and adding
         * it back is both tedious and a window during which the person is not
         * paged at all.
         */
        isEditable={isEditable}
        isCreateable={isEditable}
        cardProps={{
          title: props.getTitle(severityName),
          description: props.getDescription(severityName),
        }}
        noItemsMessage={props.noItemsMessage || DEFAULT_NO_ITEMS_MESSAGE}
        /*
         * The form offers exactly what the server will accept on the path it is
         * being submitted on, which is not the same list for create and edit.
         *
         * On create both fields are real: `onBeforeCreate` below maps the chosen
         * method onto whichever of the seven foreign keys it belongs to, and the
         * model's create access control opens all seven.
         *
         * On EDIT the method dropdown is withheld, and that is a deliberate
         * subtraction rather than an oversight. It is an `overrideField`, so its
         * value travels in `miscDataProps` and is applied by `onBeforeCreate` -
         * and ModelForm calls that hook only for FormType.Create, while
         * BaseAPI.updateItem never reads `miscDataProps` at all. Rendering it
         * here would give an administrator a dropdown that accepts a choice,
         * reports "Saved", and changes nothing: the rule would keep paging the
         * old device while the screen claimed otherwise. That is a worse failure
         * than not offering the control, and re-pointing a rule at a different
         * method is still available as remove-and-re-add. See the note in the
         * file header of the admin page for what would have to change server-
         * side to make the dropdown honest on update.
         *
         * `isOptOut` is likewise absent from both forms. It is updatable
         * server-side, but neither direction can be expressed as a free toggle
         * without producing a row the create path would have refused: switching
         * it on leaves a rule that both names a method and says never to use
         * one, switching it off leaves a rule with no method at all, and there
         * is no update-side validation to catch either. Lifting an opt-out is
         * deleting the row - which returns the cell to "no rule", the state the
         * fallback rescues - and the method column below now labels opt-out rows
         * so the administrator can tell which row that is.
         */
        formFields={[
          {
            overrideField: {
              notificationMethod: true,
            },
            showEvenIfPermissionDoesNotExist: true,
            overrideFieldKey: "notificationMethod",
            title: "Notification Method",
            description: notificationMethodFieldDescription,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Notification Method",
            dropdownOptions: notificationMethodsDropdownOptions,
            doNotShowWhenEditing: true,
          },
          {
            field: {
              notifyAfterMinutes: true,
            },
            title: notifyAfterFieldTitle,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Immediately",
            dropdownOptions: NotifyAfterDropdownOptions,
          },
        ]}
        showRefreshButton={true}
        selectMoreFields={{
          ...methodProjection,
          /*
           * Selected for the cell below rather than for a column of its own. A
           * whole column that reads "No" on every ordinary rule spends the
           * width of a column to say nothing.
           */
          isOptOut: true,
        }}
        filters={[]}
        columns={[
          {
            field: methodProjection as SelectEntityField<UserNotificationRule>,
            title: "Notification Method",
            type: FieldType.Text,
            getElement: (item: UserNotificationRule): ReactElement => {
              /*
               * An opt-out row has no method by design, so the default cell
               * renders empty - identical to a rule whose method relation
               * failed to load, and identical to nothing at all. Labelling it
               * is what stops "this row looks broken, delete it" from silently
               * turning somebody's paging back on.
               */
              if (item["isOptOut"]) {
                return <p className="text-gray-500 italic">{OPT_OUT_LABEL}</p>;
              }

              /*
               * The owner reads their own identifiers unmasked, out of the
               * relations selected above - unchanged, and the four self-serve
               * pages are the whole reason it stays that way.
               */
              if (isViewerTheOwner) {
                return (
                  <NotificationMethodView
                    item={item}
                    modelType={UserNotificationRule}
                  />
                );
              }

              const suppliedLabel: string = getSuppliedMethodLabel(
                props.notificationMethods || [],
                item,
              );

              /*
               * No method column set at all, and not an opt-out either. The
               * owner path renders an empty cell for the same row, so this
               * does too rather than inventing a state the other path does
               * not have.
               */
              if (!suppliedLabel) {
                return <></>;
              }

              if (suppliedLabel === UNRESOLVED_METHOD_LABEL) {
                return <p className="text-gray-500 italic">{suppliedLabel}</p>;
              }

              return <p>{suppliedLabel}</p>;
            },
          },
          {
            field: {
              notifyAfterMinutes: true,
            },
            title: "Notify After",
            type: FieldType.Text,
            getElement: (item: UserNotificationRule): ReactElement => {
              /*
               * A muted rule has no delay to speak of, and the stored zero
               * would otherwise render as "Immediately" - the exact opposite of
               * what the row means, sitting one cell away from the word Muted.
               */
              if (item["isOptOut"]) {
                return <p className="text-gray-500">&mdash;</p>;
              }

              return (
                <div>
                  {item["notifyAfterMinutes"] === 0 && <p>Immediately</p>}
                  {(item["notifyAfterMinutes"] as number) > 0 && (
                    <p>{item["notifyAfterMinutes"] as number} minutes</p>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    );
  };

  /*
   * The seven method models, read for the signed-in user and nobody else.
   *
   * Every query below is scoped to `targetUserId`, and this function is only
   * ever called when that IS the signed-in user - which is the same predicate
   * the models enforce, so these reads are answered rather than refused. For any
   * other user the caller supplies the list instead; see `notificationMethods`
   * on ComponentProps for why the two paths cannot be the same one.
   */
  const loadOwnNotificationMethods: PromiseVoidFunction =
    async (): Promise<void> => {
      const userEmails: ListResult<UserEmail> = await ModelAPI.getList({
        modelType: UserEmail,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: targetUserId!,
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          email: true,
        },
        sort: {},
      });

      setUserEmails(userEmails.data);

      const userSMSes: ListResult<UserSMS> = await ModelAPI.getList({
        modelType: UserSMS,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: targetUserId!,
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          phone: true,
        },
        sort: {},
      });

      setUserSMSs(userSMSes.data);

      const userCalls: ListResult<UserCall> = await ModelAPI.getList({
        modelType: UserCall,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: targetUserId!,
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          phone: true,
        },
        sort: {},
      });

      setUserCalls(userCalls.data);

      const userPushDevices: ListResult<UserPush> = await ModelAPI.getList({
        modelType: UserPush,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: targetUserId!,
          isVerified: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          deviceName: true,
          deviceType: true,
        },
        sort: {},
      });

      setUserPush(userPushDevices.data);

      const userWhatsAppList: ListResult<UserWhatsApp> = await ModelAPI.getList(
        {
          modelType: UserWhatsApp,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            userId: targetUserId!,
            isVerified: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            phone: true,
          },
          sort: {},
        },
      );

      setUserWhatsApps(userWhatsAppList.data);

      const userTelegramList: ListResult<UserTelegram> = await ModelAPI.getList(
        {
          modelType: UserTelegram,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            userId: targetUserId!,
            isVerified: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            telegramUserHandle: true,
            telegramChatId: true,
          },
          sort: {},
        },
      );

      setUserTelegrams(userTelegramList.data);

      /*
       * Webhooks are the one method with no verification step - there is no
       * device to confirm - so unlike the six above this query has no
       * `isVerified` filter. That asymmetry predates this component; it is
       * carried over deliberately rather than "fixed", because adding the
       * filter here would silently drop every existing webhook rule from the
       * dropdown.
       */
      const userWebhookList: ListResult<UserWebhook> = await ModelAPI.getList({
        modelType: UserWebhook,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: targetUserId!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
        },
        sort: {},
      });

      setUserWebhooks(userWebhookList.data);
    };

  const init: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const severityList: ListResult<OnCallRuleSeverity> =
        await ModelAPI.getList({
          modelType: props.severityModelType,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            name: true,
          },
          sort: {},
        });

      if (isViewerTheOwner) {
        await loadOwnNotificationMethods();
      }

      setSeverities(severityList.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    init().catch((err: Error) => {
      setError(err.toString());
    });
    /*
     * The two things that change what this fetch returns: whose methods to load
     * and which severity model to enumerate. On the four self-serve pages both
     * are fixed for the life of the route, so this behaves exactly as the
     * mount-once effect it replaces. The admin surface is the one that can hold
     * a mounted instance and point it somewhere else, and a stale severity list
     * there would render tables banded by the previous user's project.
     */
  }, [targetUserId?.toString(), props.severityModelType]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <div>
        {severities.map((severity: OnCallRuleSeverity, i: number) => {
          return <div key={i}>{getModelTable(severity)}</div>;
        })}
      </div>

      {/*
       * Mounted conditionally so each open is a fresh mount: the modal reads
       * the user's rules when it mounts, and a cached list would let the second
       * delete of a session be explained by the state before the first one.
       *
       * `targetUserId` and not `User.getUserId()`, so the counts are about the
       * rules on screen. It is only ever reached when the two are the same
       * person - see `isDeleteGuarded` - and spelling it as the target is what
       * keeps that true if the guard is ever widened.
       */}
      {ruleToDelete ? (
        <DeletionImpactModal
          target={{
            type: "rule",
            ruleId: ruleToDelete.id?.toString() || "",
          }}
          userId={targetUserId}
          projectId={ProjectUtil.getCurrentProjectId()}
          title="Delete Notification Rule"
          submitButtonText="Delete"
          isDeleting={isDeletingRule}
          onClose={() => {
            setRuleToDelete(null);
          }}
          onConfirm={() => {
            deleteRule(ruleToDelete).catch((err: Error) => {
              setDeleteError(API.getFriendlyMessage(err));
              setRuleToDelete(null);
              setIsDeletingRule(false);
            });
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * The delete's own failure, which the impact modal has no room for: it is
       * showing what the delete WOULD cost, and by the time this is set the
       * delete has already been attempted and refused.
       */}
      {deleteError ? (
        <ConfirmModal
          title="Error"
          description={deleteError}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setDeleteError("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OnCallRulesTable;

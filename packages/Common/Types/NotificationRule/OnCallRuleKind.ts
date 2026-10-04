import Dictionary from "../Dictionary";
import NotificationRuleType from "./NotificationRuleType";

/*
 * THE FOUR KINDS OF ON-CALL RULE, AND THE ADDRESS OF EACH ONE'S TAB.
 *
 * A person keeps on-call notification rules for four kinds of page:
 * incidents, incident episodes, alerts and alert episodes. They live on one
 * On-Call Rules page with a tab per kind - in User Settings for your own,
 * and under Users > (a member) > On-Call for an admin looking at somebody
 * else's. The address says which tab is open: `?type=alerts`. The first tab,
 * Incidents, is the bare address, so every tab has exactly one address.
 *
 * Everything that sends somebody to fix a rule builds that address from
 * here: the dashboard's own links (the setup checklist, a policy's readiness
 * card, a team's compliance page) and the server's emails (the setup
 * reminder, "you were paged without a notification rule"). The server cannot
 * import dashboard code, so this lives in Common for both.
 *
 * The page used to be four pages, one per kind, at
 * `user-settings/incident-on-call-rules` and its three siblings. Those
 * addresses still work: they forward to the tab they named
 * (MOVED_ON_CALL_RULES_PATHS).
 */
enum OnCallRuleKind {
  Incidents = "incidents",
  IncidentEpisodes = "incident-episodes",
  Alerts = "alerts",
  AlertEpisodes = "alert-episodes",
}

// In tab order. The first is the tab a bare address opens.
export const ON_CALL_RULE_KINDS: ReadonlyArray<OnCallRuleKind> = [
  OnCallRuleKind.Incidents,
  OnCallRuleKind.IncidentEpisodes,
  OnCallRuleKind.Alerts,
  OnCallRuleKind.AlertEpisodes,
];

export const DEFAULT_ON_CALL_RULE_KIND: OnCallRuleKind =
  OnCallRuleKind.Incidents;

// The query parameter that names the open tab.
export const ON_CALL_RULE_KIND_QUERY_PARAM: string = "type";

/*
 * The page's last path segment: `user-settings/on-call-rules` for your own,
 * `users/<id>/on-call-rules` for a member's.
 */
export const ON_CALL_RULES_PAGE_PATH: string = "on-call-rules";

/*
 * The four pages the tabs replaced, by the last part of their address (the
 * same in User Settings and under Users > (a member)), and the tab each one
 * forwards to.
 */
export const MOVED_ON_CALL_RULES_PATHS: Readonly<
  Record<string, OnCallRuleKind>
> = {
  "incident-on-call-rules": OnCallRuleKind.Incidents,
  "incident-episode-on-call-rules": OnCallRuleKind.IncidentEpisodes,
  "alert-on-call-rules": OnCallRuleKind.Alerts,
  "alert-episode-on-call-rules": OnCallRuleKind.AlertEpisodes,
};

const RULE_TYPE_BY_KIND: Readonly<
  Record<OnCallRuleKind, NotificationRuleType>
> = {
  [OnCallRuleKind.Incidents]: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  [OnCallRuleKind.IncidentEpisodes]:
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  [OnCallRuleKind.Alerts]: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  [OnCallRuleKind.AlertEpisodes]:
    NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
};

// The rule type every rule on a kind's tab has.
export const getRuleTypeForOnCallRuleKind: (
  kind: OnCallRuleKind,
) => NotificationRuleType = (kind: OnCallRuleKind): NotificationRuleType => {
  return RULE_TYPE_BY_KIND[kind];
};

/*
 * The tab a rule of this type is on. The two shift rule types ("when I go on
 * call", "when I go off call") have no tab of their own and are not paged
 * for an event, so a link about one opens the first tab, as a bare address
 * does.
 */
export const getOnCallRuleKindForRuleType: (
  ruleType: NotificationRuleType,
) => OnCallRuleKind = (ruleType: NotificationRuleType): OnCallRuleKind => {
  for (const kind of ON_CALL_RULE_KINDS) {
    if (RULE_TYPE_BY_KIND[kind] === ruleType) {
      return kind;
    }
  }

  return DEFAULT_ON_CALL_RULE_KIND;
};

/*
 * The tab an address asks for, or null when it asks for none we have: no
 * parameter, an empty one, or a kind this build does not know (a link from
 * a newer server, or one typed by hand). Case and surrounding spaces are
 * forgiven, since people type and paste these.
 */
export const readOnCallRuleKind: (
  value: string | null | undefined,
) => OnCallRuleKind | null = (
  value: string | null | undefined,
): OnCallRuleKind | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  for (const kind of ON_CALL_RULE_KINDS) {
    if (kind === normalized) {
      return kind;
    }
  }

  return null;
};

/*
 * The query that opens the page on a kind's tab: { type: "alerts" }, and
 * nothing for the first tab, whose address is the bare one - the address the
 * page itself shows once that tab is open.
 */
export const getOnCallRuleKindQuery: (
  kind: OnCallRuleKind,
) => Dictionary<string> = (kind: OnCallRuleKind): Dictionary<string> => {
  if (kind === DEFAULT_ON_CALL_RULE_KIND) {
    return {};
  }

  return { [ON_CALL_RULE_KIND_QUERY_PARAM]: kind };
};

// The query that opens the page on the tab holding a rule type's rules.
export const getOnCallRuleKindQueryForRuleType: (
  ruleType: NotificationRuleType,
) => Dictionary<string> = (
  ruleType: NotificationRuleType,
): Dictionary<string> => {
  return getOnCallRuleKindQuery(getOnCallRuleKindForRuleType(ruleType));
};

// Whether a value is one of the rule types this build knows.
export const isKnownNotificationRuleType: (
  value: unknown,
) => value is NotificationRuleType = (
  value: unknown,
): value is NotificationRuleType => {
  return Object.values(NotificationRuleType).includes(
    value as NotificationRuleType,
  );
};

export interface OnCallRulesLink {
  // Under the dashboard's address: `/<projectId>/user-settings/on-call-rules`.
  path: string;
  // What opens the tab, as getOnCallRuleKindQuery gives it.
  query: Dictionary<string>;
}

/*
 * Where somebody fixes a missing rule of this type, for a link built outside
 * the dashboard (the server's emails): their own On-Call Rules page in the
 * project, on the tab that holds the rule type. Null for a rule type this
 * build has never heard of, which the caller sends to Notification Methods -
 * the one page that matters for every gap there could ever be.
 */
export const getUserSettingsOnCallRulesLink: (data: {
  projectId: string;
  ruleType: unknown;
}) => OnCallRulesLink | null = (data: {
  projectId: string;
  ruleType: unknown;
}): OnCallRulesLink | null => {
  if (!isKnownNotificationRuleType(data.ruleType)) {
    return null;
  }

  return {
    path: `/${data.projectId}/user-settings/${ON_CALL_RULES_PAGE_PATH}`,
    query: getOnCallRuleKindQueryForRuleType(data.ruleType),
  };
};

export default OnCallRuleKind;

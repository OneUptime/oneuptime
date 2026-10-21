import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import OnCallRuleKind, {
  DEFAULT_ON_CALL_RULE_KIND,
  ON_CALL_RULE_KINDS,
  getRuleTypeForOnCallRuleKind,
} from "Common/Types/NotificationRule/OnCallRuleKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The four tabs of the On-Call Rules page, each a kind of on-call rule, and
 * everything the page needs to draw one: its name, which rules it lists and
 * how they are tied to a severity, and what its cards say.
 *
 * One table, read by both places the page is drawn - your own rules in User
 * Settings and a member's under Users > (a member) > On-Call - so the two
 * cannot drift apart. React-free, so tests can read it without rendering.
 */

/*
 * One severity band on a project. Incidents and alerts each have their own
 * severity model, and a rules table has to work with either, so the union is
 * the widest thing it ever needs: both classes carry `name`, `color` and
 * `id`, and nothing else is read off them.
 */
export type OnCallRuleSeverity = IncidentSeverity | AlertSeverity;

/*
 * The column on UserNotificationRule that ties a rule to its severity band.
 *
 * This is the SECOND axis, and it is deliberately independent of the severity
 * model above rather than derived from it. The four kinds do not line up the
 * way the names suggest: alert *episodes* are banded by AlertSeverity,
 * incident *episodes* by IncidentSeverity, so "is this an episode?" tells you
 * nothing about which column to write. Deriving one axis from the other is
 * how you end up writing `alertSeverityId` on a table that filters on
 * `incidentSeverityId` - which does not error, it just returns a table that
 * silently lists rules for EVERY severity, and pages the user for a Sev 4 the
 * same way it pages them for a Sev 1.
 */
export type SeverityForeignKeyColumn = "incidentSeverityId" | "alertSeverityId";

export interface OnCallRuleKindDefinition {
  // The kind, which is also the tab's `?type=` value.
  kind: OnCallRuleKind;
  // The tab's name, an English locale key the tab translates.
  tabName: string;
  // The rule type every rule on the tab has, and every new one is given.
  ruleType: NotificationRuleType;
  // The severities the tab has a card for, one card each.
  severityModelType: { new (): OnCallRuleSeverity };
  // Which rule column ties a rule to one of those severities.
  severityForeignKeyColumn: SeverityForeignKeyColumn;
  // What every card on the tab is for, on your own page.
  ownCardDescription: string;
  // The same on a member's page, with {{name}} for their first name.
  memberCardDescription: string;
}

const DEFINITIONS: Readonly<
  Record<OnCallRuleKind, Omit<OnCallRuleKindDefinition, "kind" | "ruleType">>
> = {
  [OnCallRuleKind.Incidents]: {
    tabName: "Incidents",
    severityModelType: IncidentSeverity,
    severityForeignKeyColumn: "incidentSeverityId",
    ownCardDescription: translationKey(
      "How you are notified when an incident of this severity is assigned to you while you are on call.",
    ),
    memberCardDescription: translationKey(
      "How {{name}} is notified when an incident of this severity is assigned to them while they are on call.",
    ),
  },
  /*
   * The crossed pair: an incident EPISODE is banded by IncidentSeverity, an
   * alert episode (below) by AlertSeverity.
   */
  [OnCallRuleKind.IncidentEpisodes]: {
    tabName: "Incident Episodes",
    severityModelType: IncidentSeverity,
    severityForeignKeyColumn: "incidentSeverityId",
    ownCardDescription: translationKey(
      "How you are notified when an incident episode of this severity is assigned to you while you are on call.",
    ),
    memberCardDescription: translationKey(
      "How {{name}} is notified when an incident episode of this severity is assigned to them while they are on call.",
    ),
  },
  [OnCallRuleKind.Alerts]: {
    tabName: "Alerts",
    severityModelType: AlertSeverity,
    severityForeignKeyColumn: "alertSeverityId",
    ownCardDescription: translationKey(
      "How you are notified when an alert of this severity is assigned to you while you are on call.",
    ),
    memberCardDescription: translationKey(
      "How {{name}} is notified when an alert of this severity is assigned to them while they are on call.",
    ),
  },
  [OnCallRuleKind.AlertEpisodes]: {
    tabName: "Alert Episodes",
    severityModelType: AlertSeverity,
    severityForeignKeyColumn: "alertSeverityId",
    ownCardDescription: translationKey(
      "How you are notified when an alert episode of this severity is assigned to you while you are on call.",
    ),
    memberCardDescription: translationKey(
      "How {{name}} is notified when an alert episode of this severity is assigned to them while they are on call.",
    ),
  },
};

// The four tabs, in order.
export const ON_CALL_RULE_KIND_DEFINITIONS: ReadonlyArray<OnCallRuleKindDefinition> =
  ON_CALL_RULE_KINDS.map((kind: OnCallRuleKind): OnCallRuleKindDefinition => {
    return {
      kind: kind,
      ruleType: getRuleTypeForOnCallRuleKind(kind),
      ...DEFINITIONS[kind],
    };
  });

export const getOnCallRuleKindDefinition: (
  kind: OnCallRuleKind,
) => OnCallRuleKindDefinition = (
  kind: OnCallRuleKind,
): OnCallRuleKindDefinition => {
  return (
    ON_CALL_RULE_KIND_DEFINITIONS.find(
      (definition: OnCallRuleKindDefinition): boolean => {
        return definition.kind === kind;
      },
    ) ||
    (ON_CALL_RULE_KIND_DEFINITIONS.find(
      (definition: OnCallRuleKindDefinition): boolean => {
        return definition.kind === DEFAULT_ON_CALL_RULE_KIND;
      },
    ) as OnCallRuleKindDefinition)
  );
};

// The tab a tab name belongs to, or undefined for a name that is not one.
export const getOnCallRuleKindDefinitionByTabName: (
  tabName: string,
) => OnCallRuleKindDefinition | undefined = (
  tabName: string,
): OnCallRuleKindDefinition | undefined => {
  return ON_CALL_RULE_KIND_DEFINITIONS.find(
    (definition: OnCallRuleKindDefinition): boolean => {
      return definition.tabName === tabName;
    },
  );
};

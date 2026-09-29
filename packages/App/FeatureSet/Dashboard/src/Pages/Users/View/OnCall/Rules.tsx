import OnCallRulesTable, {
  OnCallRuleSeverity,
  SeverityForeignKeyColumn,
} from "../../../../Components/NotificationRule/OnCallRulesTable";
import {
  ADMIN_TABLE_PREFERENCES_PREFIX,
  UserOnCallContextValue,
  useUserOnCallContext,
} from "./Context";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One rule type's notification rules for another project member.
 *
 * The combined page this replaced rendered all FOUR rule types at once, and
 * each of them expands to one card per severity band — a project with six
 * incident severities and six alert severities got forty-eight cards on a
 * single route, under a readiness summary nobody could see once they had
 * scrolled. Splitting it four ways mirrors what the self-serve settings pages
 * have always done (Incident, Incident Episode, Alert, Alert Episode are four
 * separate pages there too), so an administrator repairing somebody else's
 * configuration navigates the same shape they navigate for their own.
 *
 * The four routes render THIS component with different props rather than four
 * near-identical files. The self-serve side keeps four thin files because each
 * is a route target with its own copy; here the copy is derived from the
 * `subject` below, so a fifth file would only be a fifth place to get the
 * severity axis wrong.
 */

export interface ComponentProps {
  /*
   * Which severity model to enumerate, and which UserNotificationRule column
   * the severity id is read from and written to. The two are passed SEPARATELY
   * and neither is derived from the other or from the rule type: an alert
   * episode is banded by AlertSeverity, an incident episode by
   * IncidentSeverity, so "is this an episode?" tells you nothing about which
   * model to read. Getting it wrong does not throw — it silently renders a
   * table listing rules for every severity at once, so a Sev 4 pages exactly
   * like a Sev 1.
   */
  severityModelType: { new (): OnCallRuleSeverity };
  severityForeignKeyColumn: SeverityForeignKeyColumn;
  ruleType: NotificationRuleType;
  /** The noun the copy puts in front of "is assigned to them". */
  subject: string;
}

const UserViewOnCallRules: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const context: UserOnCallContextValue = useUserOnCallContext();

  const { isSelf, firstName, displayName, fallbackState, canEdit } = context;

  /*
   * What a missing rule COSTS, said at the moment somebody decides whether a
   * hole is worth filling. Three states, not two: a readiness read that failed
   * has to read as unknown rather than as "your pages are dropped", which would
   * be a specific and possibly false claim about this project made because a
   * request timed out.
   */
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

  return (
    /*
     * The same component the self-serve settings pages render, pointed at
     * somebody else.
     *
     * `isEditable` decides whether the add, edit and remove controls are drawn
     * at all; it is a convenience over the server's own check, not a substitute
     * for it, so a member who reaches this page without the edit permission
     * simply sees the configuration rather than a set of buttons that would be
     * refused.
     *
     * `onBehalfOfName` is what carries the context INTO the modal. The section
     * banner is sticky, but a modal covers it, and the moment a modal is open
     * is precisely the moment an admin is about to rewrite how a colleague gets
     * paged. Passing the name only when this is not the viewer's own page keeps
     * the self-serve copy in the first person, where it belongs.
     *
     * `notificationMethods` is what stops this table doing what the four
     * self-serve pages do — listing the seven method models to fill its
     * dropdown, and selecting the seven method RELATIONS to fill its method
     * cell. The first is refused for anybody but the owner; the second is not
     * refused at all, which is why it has to be closed here rather than left to
     * the server. The masked choices from the readiness payload replace both.
     */
    <OnCallRulesTable
      severityModelType={props.severityModelType}
      severityForeignKeyColumn={props.severityForeignKeyColumn}
      ruleType={props.ruleType}
      userId={context.userId}
      notificationMethods={context.methodChoices}
      isEditable={canEdit}
      onBehalfOfName={isSelf ? undefined : displayName || undefined}
      userPreferencesKeyPrefix={ADMIN_TABLE_PREFERENCES_PREFIX}
      getTitle={(severityName: string): string => {
        return isSelf
          ? `${severityName} Severity: when I am on call and a ${severityName} ${props.subject} is assigned to me...`
          : `${severityName} Severity: when ${firstName} is on call and a ${severityName} ${props.subject} is assigned to them...`;
      }}
      getDescription={(severityName: string): string => {
        return isSelf
          ? `How you are notified when a ${severityName} ${props.subject} is assigned to you.`
          : `How ${firstName} is notified when a ${severityName} ${props.subject} is assigned to them.`;
      }}
      noItemsMessage={getNoRuleMessage()}
    />
  );
};

/*
 * The four rule types, with both axes stated. They do not line up the way the
 * names suggest — see ComponentProps above — so these four objects are the one
 * place the pairing is written down, and the routes read them rather than
 * restating them.
 */
export const INCIDENT_RULES_PROPS: ComponentProps = {
  severityModelType: IncidentSeverity,
  severityForeignKeyColumn: "incidentSeverityId",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  subject: "incident",
};

export const INCIDENT_EPISODE_RULES_PROPS: ComponentProps = {
  severityModelType: IncidentSeverity,
  severityForeignKeyColumn: "incidentSeverityId",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  subject: "incident episode",
};

export const ALERT_RULES_PROPS: ComponentProps = {
  severityModelType: AlertSeverity,
  severityForeignKeyColumn: "alertSeverityId",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  subject: "alert",
};

export const ALERT_EPISODE_RULES_PROPS: ComponentProps = {
  severityModelType: AlertSeverity,
  severityForeignKeyColumn: "alertSeverityId",
  ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  subject: "alert episode",
};

export default UserViewOnCallRules;
